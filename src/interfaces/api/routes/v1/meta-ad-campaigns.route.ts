import type { FastifyInstance } from "fastify";
import type { MetaAdAccountRepositoryPort } from "../../../../application/ports/meta-ad-account-repository.port.js";
import type { MetaAdCampaignRepositoryPort } from "../../../../application/ports/meta-ad-campaign-repository.port.js";
import type { MetaAdSetRepositoryPort } from "../../../../application/ports/meta-ad-set-repository.port.js";
import type { MetaAdRepositoryPort } from "../../../../application/ports/meta-ad-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../../../../application/ports/meta-ads-credential-repository.port.js";
import { syncMetaAdCampaignsForAccount } from "../../../../application/meta-ads/sync-meta-ad-campaigns.js";
import type { SecretManagerPort } from "../../../../application/ports/secret-manager.port.js";
import { AppError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/** Árvore de gestão de campanhas — Fase 2 do módulo Meta Ads Manager (leitura + resync manual;
 * criação/edição chegam na Fase 3). */

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 }, adAccountId: { type: "string" } } } as const;
const SYNC_BODY_SCHEMA = { type: "object", required: ["workspaceId", "adAccountId"], properties: { workspaceId: { type: "string", minLength: 1 }, adAccountId: { type: "string", minLength: 1 } } } as const;

export type MetaAdCampaignsRoutesDeps = {
  metaAdAccountRepository: MetaAdAccountRepositoryPort;
  metaAdCampaignRepository: MetaAdCampaignRepositoryPort;
  metaAdSetRepository: MetaAdSetRepositoryPort;
  metaAdRepository: MetaAdRepositoryPort;
  metaAdsCredentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
};

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
}
