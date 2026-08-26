import type { FastifyInstance } from "fastify";
import type { MetaAdAccountRepositoryPort } from "../../../../application/ports/meta-ad-account-repository.port.js";
import type { MetaCustomAudienceRepositoryPort } from "../../../../application/ports/meta-custom-audience-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../../../../application/ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../../../../application/ports/secret-manager.port.js";
import { syncMetaCustomAudiencesForAccount } from "../../../../application/meta-ads/sync-meta-custom-audiences.js";
import { createMetaCustomAudience } from "../../../../application/meta-ads/create-meta-custom-audience.js";
import { createMetaLookalikeAudience } from "../../../../application/meta-ads/create-meta-lookalike-audience.js";
import { searchMetaAdInterests } from "../../../../application/meta-ads/search-meta-ad-interests.js";
import { AppError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/** Públicos customizados/semelhantes e busca de interesses — Fase 4 do módulo Meta Ads Manager. */

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 }, adAccountId: { type: "string" } } } as const;
const SYNC_BODY_SCHEMA = { type: "object", required: ["workspaceId", "adAccountId"], properties: { workspaceId: { type: "string", minLength: 1 }, adAccountId: { type: "string", minLength: 1 } } } as const;

const CREATE_AUDIENCE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "adAccountId", "name"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    adAccountId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    customers: {
      type: "array",
      items: { type: "object", properties: { email: { type: "string" }, phone: { type: "string" } } },
    },
  },
} as const;

const CREATE_LOOKALIKE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "originAudienceId", "name", "ratio", "country"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    /** id INTERNO (`meta_custom_audiences.id`) do público de origem. */
    originAudienceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    ratio: { type: "number", minimum: 0.01, maximum: 0.2 },
    country: { type: "string", minLength: 2, maxLength: 2 },
  },
} as const;

const SEARCH_INTERESTS_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "credentialReferenceId", "q"],
  properties: { workspaceId: { type: "string", minLength: 1 }, credentialReferenceId: { type: "string", minLength: 1 }, q: { type: "string", minLength: 1 } },
} as const;

const META_ADS_AUDIENCE_WRITE_ERROR_STATUS: Record<string, number> = {
  META_ADS_CREDENTIAL_NOT_ACTIVE: 409,
  META_ADS_TOKEN_MISSING: 409,
  META_ADS_ACCOUNT_NOT_FOUND: 404,
  META_ADS_AUDIENCE_DELETED: 409,
  META_ADS_LOOKALIKE_RATIO_INVALID: 422,
  META_ADS_AUDIENCE_UPLOAD_EMPTY_ROW: 422,
  META_ADS_AUDIENCE_UPLOAD_INCONSISTENT_SCHEMA: 422,
};

function rethrowMetaAdsAudienceError(error: unknown): never {
  if (error instanceof Error) {
    const [code, ...rest] = error.message.split(": ");
    const statusCode = META_ADS_AUDIENCE_WRITE_ERROR_STATUS[code];
    if (statusCode !== undefined) {
      throw new AppError({ code, message: rest.join(": ") || error.message, statusCode, recoverable: statusCode !== 404 });
    }
  }
  throw error;
}

export type MetaAudiencesRoutesDeps = {
  metaAdAccountRepository: MetaAdAccountRepositoryPort;
  metaCustomAudienceRepository: MetaCustomAudienceRepositoryPort;
  metaAdsCredentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
};

export async function registerMetaAudiencesRoutes(app: FastifyInstance, deps: MetaAudiencesRoutesDeps): Promise<void> {
  app.get("/meta-ads/audiences", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:read");
    const { workspaceId, adAccountId } = request.query as { workspaceId: string; adAccountId?: string };
    const audiences = await deps.metaCustomAudienceRepository.listByWorkspace({ tenantId: principal.tenantId, workspaceId, adAccountId });
    return successEnvelope({ audiences }, request.id);
  });

  app.post("/meta-ads/audiences/sync", { schema: { body: SYNC_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:sync");
    const { workspaceId, adAccountId } = request.body as { workspaceId: string; adAccountId: string };
    const account = await deps.metaAdAccountRepository.getById(adAccountId);
    if (!account || account.tenantId !== principal.tenantId || account.workspaceId !== workspaceId) {
      throw new AppError({ code: "META_ADS_ACCOUNT_NOT_FOUND", message: "Conta de anúncio não encontrada para este workspace.", statusCode: 404, recoverable: false });
    }
    try {
      const result = await syncMetaCustomAudiencesForAccount(
        { audienceRepository: deps.metaCustomAudienceRepository, credentialRepository: deps.metaAdsCredentialRepository, secretManager: deps.secretManager },
        { tenantId: principal.tenantId, workspaceId, adAccount: account },
      );
      return successEnvelope(result, request.id);
    } catch (error) {
      rethrowMetaAdsAudienceError(error);
    }
  });

  app.post("/meta-ads/audiences", { schema: { body: CREATE_AUDIENCE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:manage");
    const body = request.body as { workspaceId: string; adAccountId: string; name: string; description?: string; customers?: { email?: string; phone?: string }[] };
    const adAccount = await deps.metaAdAccountRepository.getById(body.adAccountId);
    if (!adAccount || adAccount.tenantId !== principal.tenantId || adAccount.workspaceId !== body.workspaceId) {
      throw new AppError({ code: "META_ADS_ACCOUNT_NOT_FOUND", message: "Conta de anúncio não encontrada para este workspace.", statusCode: 404, recoverable: false });
    }
    try {
      const result = await createMetaCustomAudience(
        { audienceRepository: deps.metaCustomAudienceRepository, credentialRepository: deps.metaAdsCredentialRepository, secretManager: deps.secretManager },
        { tenantId: principal.tenantId, workspaceId: body.workspaceId, adAccount, name: body.name, description: body.description, customers: body.customers },
      );
      return successEnvelope(result, request.id);
    } catch (error) {
      rethrowMetaAdsAudienceError(error);
    }
  });

  app.post("/meta-ads/audiences/lookalike", { schema: { body: CREATE_LOOKALIKE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:manage");
    const body = request.body as { workspaceId: string; originAudienceId: string; name: string; ratio: number; country: string };
    const originAudience = await deps.metaCustomAudienceRepository.getById(body.originAudienceId);
    if (!originAudience || originAudience.tenantId !== principal.tenantId || originAudience.workspaceId !== body.workspaceId) {
      throw new AppError({ code: "META_ADS_AUDIENCE_NOT_FOUND", message: "Público de origem não encontrado para este workspace.", statusCode: 404, recoverable: false });
    }
    try {
      const audience = await createMetaLookalikeAudience(
        { audienceRepository: deps.metaCustomAudienceRepository, adAccountRepository: deps.metaAdAccountRepository, credentialRepository: deps.metaAdsCredentialRepository, secretManager: deps.secretManager },
        { tenantId: principal.tenantId, workspaceId: body.workspaceId, originAudience, name: body.name, ratio: body.ratio, country: body.country },
      );
      return successEnvelope(audience, request.id);
    } catch (error) {
      rethrowMetaAdsAudienceError(error);
    }
  });

  app.get("/meta-ads/interests", { schema: { querystring: SEARCH_INTERESTS_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:read");
    const { workspaceId, credentialReferenceId, q } = request.query as { workspaceId: string; credentialReferenceId: string; q: string };
    try {
      const interests = await searchMetaAdInterests(
        { credentialRepository: deps.metaAdsCredentialRepository, secretManager: deps.secretManager },
        { tenantId: principal.tenantId, workspaceId, credentialReferenceId, query: q },
      );
      return successEnvelope({ interests }, request.id);
    } catch (error) {
      rethrowMetaAdsAudienceError(error);
    }
  });
}
