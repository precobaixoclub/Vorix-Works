import type { FastifyInstance } from "fastify";
import type { MetaAdAccountRepositoryPort } from "../../../../application/ports/meta-ad-account-repository.port.js";
import type { MetaAdCampaignRepositoryPort } from "../../../../application/ports/meta-ad-campaign-repository.port.js";
import type { MetaAdSetRepositoryPort } from "../../../../application/ports/meta-ad-set-repository.port.js";
import type { MetaAdRepositoryPort } from "../../../../application/ports/meta-ad-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../../../../application/ports/meta-ads-credential-repository.port.js";
import { syncMetaAdCampaignsForAccount } from "../../../../application/meta-ads/sync-meta-ad-campaigns.js";
import { createMetaAdCampaign } from "../../../../application/meta-ads/create-meta-ad-campaign.js";
import { updateMetaAdCampaign } from "../../../../application/meta-ads/update-meta-ad-campaign.js";
import { createMetaAdSet } from "../../../../application/meta-ads/create-meta-ad-set.js";
import { updateMetaAdSet } from "../../../../application/meta-ads/update-meta-ad-set.js";
import { createMetaAd } from "../../../../application/meta-ads/create-meta-ad.js";
import { updateMetaAd } from "../../../../application/meta-ads/update-meta-ad.js";
import type { SecretManagerPort } from "../../../../application/ports/secret-manager.port.js";
import { AppError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/** Árvore de gestão de campanhas — Fase 2 (leitura + resync manual) e Fase 3 (criação/edição de
 * campanha/ad set/ad) do módulo Meta Ads Manager. */

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 }, adAccountId: { type: "string" } } } as const;
const SYNC_BODY_SCHEMA = { type: "object", required: ["workspaceId", "adAccountId"], properties: { workspaceId: { type: "string", minLength: 1 }, adAccountId: { type: "string", minLength: 1 } } } as const;

const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

const CREATE_CAMPAIGN_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "adAccountId", "name", "objective"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    adAccountId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    objective: { type: "string", minLength: 1 },
    specialAdCategories: { type: "array", items: { type: "string" } },
    dailyBudget: { type: "number", minimum: 0 },
    lifetimeBudget: { type: "number", minimum: 0 },
    buyingType: { type: "string" },
  },
} as const;

const UPDATE_CAMPAIGN_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
    dailyBudget: { type: "number", minimum: 0 },
    lifetimeBudget: { type: "number", minimum: 0 },
  },
} as const;

const CREATE_ADSET_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "campaignId", "name", "optimizationGoal", "billingEvent", "targeting"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    /** id INTERNO (`meta_ad_campaigns.id`), nunca o campaignId externo da Meta. */
    campaignId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    optimizationGoal: { type: "string", minLength: 1 },
    billingEvent: { type: "string", minLength: 1 },
    dailyBudget: { type: "number", minimum: 0 },
    lifetimeBudget: { type: "number", minimum: 0 },
    bidAmount: { type: "number", minimum: 0 },
    targeting: { type: "object" },
  },
} as const;

const UPDATE_ADSET_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
    dailyBudget: { type: "number", minimum: 0 },
    lifetimeBudget: { type: "number", minimum: 0 },
    bidAmount: { type: "number", minimum: 0 },
  },
} as const;

const CREATE_AD_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "adSetId", "name", "pageId", "creative"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    /** id INTERNO (`meta_ad_sets.id`), nunca o adSetId externo da Meta. */
    adSetId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    pageId: { type: "string", minLength: 1 },
    creative: {
      type: "object",
      required: ["link"],
      properties: {
        link: { type: "string", minLength: 1 },
        message: { type: "string" },
        headline: { type: "string" },
        description: { type: "string" },
        imageUrl: { type: "string" },
        callToActionType: { type: "string" },
      },
    },
  },
} as const;

const UPDATE_AD_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["ACTIVE", "PAUSED"] },
  },
} as const;

export type MetaAdCampaignsRoutesDeps = {
  metaAdAccountRepository: MetaAdAccountRepositoryPort;
  metaAdCampaignRepository: MetaAdCampaignRepositoryPort;
  metaAdSetRepository: MetaAdSetRepositoryPort;
  metaAdRepository: MetaAdRepositoryPort;
  metaAdsCredentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
};

/** Mapeamento único dos erros `"CODE: mensagem"` lançados por `create-*`/`update-*` (Fase 3) e
 * `sync-meta-ad-campaigns.ts` (Fase 2) — cada rota de escrita passa o erro capturado por aqui;
 * um prefixo desconhecido sobe como 500 (erro inesperado, nunca deveria acontecer). */
const META_ADS_WRITE_ERROR_STATUS: Record<string, number> = {
  META_ADS_CREDENTIAL_NOT_ACTIVE: 409,
  META_ADS_TOKEN_MISSING: 409,
  META_ADS_ACCOUNT_NOT_FOUND: 404,
  META_ADS_CAMPAIGN_NOT_FOUND: 404,
  META_ADS_CAMPAIGN_DELETED: 409,
  META_ADS_ADSET_NOT_FOUND: 404,
  META_ADS_ADSET_DELETED: 409,
  META_ADS_AD_NOT_FOUND: 404,
};

function rethrowMetaAdsWriteError(error: unknown): never {
  if (error instanceof Error) {
    const [code, ...rest] = error.message.split(": ");
    const statusCode = META_ADS_WRITE_ERROR_STATUS[code];
    if (statusCode !== undefined) {
      throw new AppError({ code, message: rest.join(": ") || error.message, statusCode, recoverable: statusCode !== 404 });
    }
  }
  throw error;
}

export async function registerMetaAdCampaignsRoutes(app: FastifyInstance, deps: MetaAdCampaignsRoutesDeps): Promise<void> {
  // Árvore completa numa chamada só — campanhas + adsets + ads já resolvidos, a UI monta a
  // hierarquia no cliente (nunca N chamadas por nível, o mesmo raciocínio de custo do sync).
  app.get("/meta-ads/campaigns", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:read");
    const { workspaceId, adAccountId } = request.query as { workspaceId: string; adAccountId?: string };
    const [campaigns, adSets, ads] = await Promise.all([
      deps.metaAdCampaignRepository.listByWorkspace({ tenantId: principal.tenantId, workspaceId, adAccountId }),
      deps.metaAdSetRepository.listByWorkspace({ tenantId: principal.tenantId, workspaceId, adAccountId }),
      deps.metaAdRepository.listByWorkspace({ tenantId: principal.tenantId, workspaceId, adAccountId }),
    ]);
    return successEnvelope({ campaigns, adSets, ads }, request.id);
  });

  app.post("/meta-ads/campaigns/sync", { schema: { body: SYNC_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:sync");
    const { workspaceId, adAccountId } = request.body as { workspaceId: string; adAccountId: string };
    const account = await deps.metaAdAccountRepository.getById(adAccountId);
    if (!account || account.tenantId !== principal.tenantId || account.workspaceId !== workspaceId) {
      throw new AppError({ code: "META_ADS_ACCOUNT_NOT_FOUND", message: "Conta de anúncio não encontrada para este workspace.", statusCode: 404, recoverable: false });
    }
    try {
      const result = await syncMetaAdCampaignsForAccount(
        { campaignRepository: deps.metaAdCampaignRepository, adSetRepository: deps.metaAdSetRepository, adRepository: deps.metaAdRepository, credentialRepository: deps.metaAdsCredentialRepository, secretManager: deps.secretManager },
        { tenantId: principal.tenantId, workspaceId, adAccount: account },
      );
      return successEnvelope(result, request.id);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("META_ADS_CREDENTIAL_NOT_ACTIVE")) {
        throw new AppError({ code: "META_ADS_CREDENTIAL_NOT_ACTIVE", message: "Esta conexão não está ativa — reconecte antes de sincronizar.", statusCode: 409, recoverable: true });
      }
      if (error instanceof Error && error.message.startsWith("META_ADS_TOKEN_MISSING")) {
        throw new AppError({ code: "META_ADS_TOKEN_MISSING", message: "Token não encontrado para esta conexão — reconecte.", statusCode: 409, recoverable: true });
      }
      throw error;
    }
  });

  // --- Fase 3: criação e edição -------------------------------------------------------------
  // Toda entidade criada nasce PAUSADA (ver comentário de topo de cada `create-*.ts`) — ativar é
  // sempre uma ação separada via PATCH.

  app.post("/meta-ads/campaigns", { schema: { body: CREATE_CAMPAIGN_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:manage");
    const body = request.body as { workspaceId: string; adAccountId: string; name: string; objective: string; specialAdCategories?: string[]; dailyBudget?: number; lifetimeBudget?: number; buyingType?: string };
    const adAccount = await deps.metaAdAccountRepository.getById(body.adAccountId);
    if (!adAccount || adAccount.tenantId !== principal.tenantId || adAccount.workspaceId !== body.workspaceId) {
      throw new AppError({ code: "META_ADS_ACCOUNT_NOT_FOUND", message: "Conta de anúncio não encontrada para este workspace.", statusCode: 404, recoverable: false });
    }
    try {
      const campaign = await createMetaAdCampaign(
        { campaignRepository: deps.metaAdCampaignRepository, credentialRepository: deps.metaAdsCredentialRepository, secretManager: deps.secretManager },
        { tenantId: principal.tenantId, workspaceId: body.workspaceId, adAccount, name: body.name, objective: body.objective, specialAdCategories: body.specialAdCategories, dailyBudget: body.dailyBudget, lifetimeBudget: body.lifetimeBudget, buyingType: body.buyingType },
      );
      return successEnvelope(campaign, request.id);
    } catch (error) {
      rethrowMetaAdsWriteError(error);
    }
  });

  app.patch("/meta-ads/campaigns/:id", { schema: { params: ID_PARAMS_SCHEMA, body: UPDATE_CAMPAIGN_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:manage");
    const { id } = request.params as { id: string };
    const body = request.body as { workspaceId: string; name?: string; status?: "ACTIVE" | "PAUSED"; dailyBudget?: number; lifetimeBudget?: number };
    const existing = await deps.metaAdCampaignRepository.getById(id);
    if (!existing || existing.tenantId !== principal.tenantId || existing.workspaceId !== body.workspaceId) {
      throw new AppError({ code: "META_ADS_CAMPAIGN_NOT_FOUND", message: "Campanha não encontrada para este workspace.", statusCode: 404, recoverable: false });
    }
    try {
      const campaign = await updateMetaAdCampaign(
        { campaignRepository: deps.metaAdCampaignRepository, adAccountRepository: deps.metaAdAccountRepository, credentialRepository: deps.metaAdsCredentialRepository, secretManager: deps.secretManager },
        { tenantId: principal.tenantId, workspaceId: body.workspaceId, id, name: body.name, status: body.status, dailyBudget: body.dailyBudget, lifetimeBudget: body.lifetimeBudget },
      );
      return successEnvelope(campaign, request.id);
    } catch (error) {
      rethrowMetaAdsWriteError(error);
    }
  });

  app.post("/meta-ads/adsets", { schema: { body: CREATE_ADSET_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:manage");
    const body = request.body as { workspaceId: string; campaignId: string; name: string; optimizationGoal: string; billingEvent: string; dailyBudget?: number; lifetimeBudget?: number; bidAmount?: number; targeting: Record<string, unknown> };
    const campaign = await deps.metaAdCampaignRepository.getById(body.campaignId);
    if (!campaign || campaign.tenantId !== principal.tenantId || campaign.workspaceId !== body.workspaceId) {
      throw new AppError({ code: "META_ADS_CAMPAIGN_NOT_FOUND", message: "Campanha não encontrada para este workspace.", statusCode: 404, recoverable: false });
    }
    try {
      const adSet = await createMetaAdSet(
        { adSetRepository: deps.metaAdSetRepository, adAccountRepository: deps.metaAdAccountRepository, credentialRepository: deps.metaAdsCredentialRepository, secretManager: deps.secretManager },
        { tenantId: principal.tenantId, workspaceId: body.workspaceId, campaign, name: body.name, optimizationGoal: body.optimizationGoal, billingEvent: body.billingEvent, dailyBudget: body.dailyBudget, lifetimeBudget: body.lifetimeBudget, bidAmount: body.bidAmount, targeting: body.targeting },
      );
      return successEnvelope(adSet, request.id);
    } catch (error) {
      rethrowMetaAdsWriteError(error);
    }
  });

  app.patch("/meta-ads/adsets/:id", { schema: { params: ID_PARAMS_SCHEMA, body: UPDATE_ADSET_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:manage");
    const { id } = request.params as { id: string };
    const body = request.body as { workspaceId: string; name?: string; status?: "ACTIVE" | "PAUSED"; dailyBudget?: number; lifetimeBudget?: number; bidAmount?: number };
    const existing = await deps.metaAdSetRepository.getById(id);
    if (!existing || existing.tenantId !== principal.tenantId || existing.workspaceId !== body.workspaceId) {
      throw new AppError({ code: "META_ADS_ADSET_NOT_FOUND", message: "Conjunto de anúncios não encontrado para este workspace.", statusCode: 404, recoverable: false });
    }
    try {
      const adSet = await updateMetaAdSet(
        { adSetRepository: deps.metaAdSetRepository, adAccountRepository: deps.metaAdAccountRepository, credentialRepository: deps.metaAdsCredentialRepository, secretManager: deps.secretManager },
        { tenantId: principal.tenantId, workspaceId: body.workspaceId, id, name: body.name, status: body.status, dailyBudget: body.dailyBudget, lifetimeBudget: body.lifetimeBudget, bidAmount: body.bidAmount },
      );
      return successEnvelope(adSet, request.id);
    } catch (error) {
      rethrowMetaAdsWriteError(error);
    }
  });

  app.post("/meta-ads/ads", { schema: { body: CREATE_AD_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:manage");
    const body = request.body as { workspaceId: string; adSetId: string; name: string; pageId: string; creative: { link: string; message?: string; headline?: string; description?: string; imageUrl?: string; callToActionType?: string } };
    const adSet = await deps.metaAdSetRepository.getById(body.adSetId);
    if (!adSet || adSet.tenantId !== principal.tenantId || adSet.workspaceId !== body.workspaceId) {
      throw new AppError({ code: "META_ADS_ADSET_NOT_FOUND", message: "Conjunto de anúncios não encontrado para este workspace.", statusCode: 404, recoverable: false });
    }
    try {
      const ad = await createMetaAd(
        { adRepository: deps.metaAdRepository, adAccountRepository: deps.metaAdAccountRepository, credentialRepository: deps.metaAdsCredentialRepository, secretManager: deps.secretManager },
        { tenantId: principal.tenantId, workspaceId: body.workspaceId, adSet, name: body.name, pageId: body.pageId, creative: body.creative },
      );
      return successEnvelope(ad, request.id);
    } catch (error) {
      rethrowMetaAdsWriteError(error);
    }
  });

  app.patch("/meta-ads/ads/:id", { schema: { params: ID_PARAMS_SCHEMA, body: UPDATE_AD_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:manage");
    const { id } = request.params as { id: string };
    const body = request.body as { workspaceId: string; name?: string; status?: "ACTIVE" | "PAUSED" };
    const existing = await deps.metaAdRepository.getById(id);
    if (!existing || existing.tenantId !== principal.tenantId || existing.workspaceId !== body.workspaceId) {
      throw new AppError({ code: "META_ADS_AD_NOT_FOUND", message: "Anúncio não encontrado para este workspace.", statusCode: 404, recoverable: false });
    }
    try {
      const ad = await updateMetaAd(
        { adRepository: deps.metaAdRepository, adAccountRepository: deps.metaAdAccountRepository, credentialRepository: deps.metaAdsCredentialRepository, secretManager: deps.secretManager },
        { tenantId: principal.tenantId, workspaceId: body.workspaceId, id, name: body.name, status: body.status },
      );
      return successEnvelope(ad, request.id);
    } catch (error) {
      rethrowMetaAdsWriteError(error);
    }
  });
}
