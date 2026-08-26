import type { FastifyInstance } from "fastify";
import type { MetaAdAccountRepositoryPort } from "../../../../application/ports/meta-ad-account-repository.port.js";
import type { MetaPixelRepositoryPort } from "../../../../application/ports/meta-pixel-repository.port.js";
import type { MetaCapiEventRepositoryPort } from "../../../../application/ports/meta-capi-event-repository.port.js";
import type { MetaAdsCredentialRepositoryPort } from "../../../../application/ports/meta-ads-credential-repository.port.js";
import type { SecretManagerPort } from "../../../../application/ports/secret-manager.port.js";
import { syncMetaPixelsForAccount } from "../../../../application/meta-ads/sync-meta-pixels.js";
import { createMetaPixel } from "../../../../application/meta-ads/create-meta-pixel.js";
import { sendMetaCapiEvent } from "../../../../application/meta-ads/send-meta-capi-event.js";
import { AppError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/** Pixels e Conversions API (CAPI) — Fase 4 do módulo Meta Ads Manager. */

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 }, adAccountId: { type: "string" } } } as const;
const SYNC_BODY_SCHEMA = { type: "object", required: ["workspaceId", "adAccountId"], properties: { workspaceId: { type: "string", minLength: 1 }, adAccountId: { type: "string", minLength: 1 } } } as const;
const CREATE_PIXEL_BODY_SCHEMA = { type: "object", required: ["workspaceId", "adAccountId", "name"], properties: { workspaceId: { type: "string", minLength: 1 }, adAccountId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const EVENTS_LIST_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;

const SEND_EVENT_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "eventName", "userData"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    eventName: { type: "string", minLength: 1 },
    eventTime: { type: "string" },
    eventId: { type: "string" },
    actionSource: { type: "string", enum: ["website", "app", "phone_call", "chat", "email", "other", "physical_store", "system_generated"] },
    userData: {
      type: "object",
      properties: {
        email: { type: "string" },
        phone: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        countryCode: { type: "string" },
      },
    },
    customData: { type: "object" },
    eventSourceUrl: { type: "string" },
    testEventCode: { type: "string" },
  },
} as const;

const META_ADS_PIXEL_ERROR_STATUS: Record<string, number> = {
  META_ADS_CREDENTIAL_NOT_ACTIVE: 409,
  META_ADS_TOKEN_MISSING: 409,
  META_ADS_ACCOUNT_NOT_FOUND: 404,
};

function rethrowMetaAdsPixelError(error: unknown): never {
  if (error instanceof Error) {
    const [code, ...rest] = error.message.split(": ");
    const statusCode = META_ADS_PIXEL_ERROR_STATUS[code];
    if (statusCode !== undefined) {
      throw new AppError({ code, message: rest.join(": ") || error.message, statusCode, recoverable: statusCode !== 404 });
    }
  }
  throw error;
}

export type MetaPixelsRoutesDeps = {
  metaAdAccountRepository: MetaAdAccountRepositoryPort;
  metaPixelRepository: MetaPixelRepositoryPort;
  metaCapiEventRepository: MetaCapiEventRepositoryPort;
  metaAdsCredentialRepository: MetaAdsCredentialRepositoryPort;
  secretManager: SecretManagerPort;
};

export async function registerMetaPixelsRoutes(app: FastifyInstance, deps: MetaPixelsRoutesDeps): Promise<void> {
  app.get("/meta-ads/pixels", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:read");
    const { workspaceId, adAccountId } = request.query as { workspaceId: string; adAccountId?: string };
    const pixels = await deps.metaPixelRepository.listByWorkspace({ tenantId: principal.tenantId, workspaceId, adAccountId });
    return successEnvelope({ pixels }, request.id);
  });

  app.post("/meta-ads/pixels/sync", { schema: { body: SYNC_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:sync");
    const { workspaceId, adAccountId } = request.body as { workspaceId: string; adAccountId: string };
    const account = await deps.metaAdAccountRepository.getById(adAccountId);
    if (!account || account.tenantId !== principal.tenantId || account.workspaceId !== workspaceId) {
      throw new AppError({ code: "META_ADS_ACCOUNT_NOT_FOUND", message: "Conta de anúncio não encontrada para este workspace.", statusCode: 404, recoverable: false });
    }
    try {
      const result = await syncMetaPixelsForAccount(
        { pixelRepository: deps.metaPixelRepository, credentialRepository: deps.metaAdsCredentialRepository, secretManager: deps.secretManager },
        { tenantId: principal.tenantId, workspaceId, adAccount: account },
      );
      return successEnvelope(result, request.id);
    } catch (error) {
      rethrowMetaAdsPixelError(error);
    }
  });

  app.post("/meta-ads/pixels", { schema: { body: CREATE_PIXEL_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:manage");
    const body = request.body as { workspaceId: string; adAccountId: string; name: string };
    const adAccount = await deps.metaAdAccountRepository.getById(body.adAccountId);
    if (!adAccount || adAccount.tenantId !== principal.tenantId || adAccount.workspaceId !== body.workspaceId) {
      throw new AppError({ code: "META_ADS_ACCOUNT_NOT_FOUND", message: "Conta de anúncio não encontrada para este workspace.", statusCode: 404, recoverable: false });
    }
    try {
      const pixel = await createMetaPixel(
        { pixelRepository: deps.metaPixelRepository, credentialRepository: deps.metaAdsCredentialRepository, secretManager: deps.secretManager },
        { tenantId: principal.tenantId, workspaceId: body.workspaceId, adAccount, name: body.name },
      );
      return successEnvelope(pixel, request.id);
    } catch (error) {
      rethrowMetaAdsPixelError(error);
    }
  });

  app.get("/meta-ads/pixels/:id/events", { schema: { params: ID_PARAMS_SCHEMA, querystring: EVENTS_LIST_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    const pixel = await deps.metaPixelRepository.getById(id);
    if (!pixel || pixel.tenantId !== principal.tenantId || pixel.workspaceId !== workspaceId) {
      throw new AppError({ code: "META_ADS_PIXEL_NOT_FOUND", message: "Pixel não encontrado para este workspace.", statusCode: 404, recoverable: false });
    }
    const events = await deps.metaCapiEventRepository.listByPixel({ tenantId: principal.tenantId, workspaceId, metaPixelId: pixel.id });
    return successEnvelope({ events }, request.id);
  });

  // Envio manual pro "Testar eventos" do Events Manager (`testEventCode`) — valida a integração
  // de CAPI sem esperar tráfego real. Nada impede um envio de produção pela mesma rota (sem
  // `testEventCode`); a UI decide quando oferecer cada modo.
  app.post("/meta-ads/pixels/:id/events", { schema: { params: ID_PARAMS_SCHEMA, body: SEND_EVENT_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "ads:manage");
    const { id } = request.params as { id: string };
    const body = request.body as {
      workspaceId: string; eventName: string; eventTime?: string; eventId?: string;
      actionSource?: "website" | "app" | "phone_call" | "chat" | "email" | "other" | "physical_store" | "system_generated";
      userData: { email?: string; phone?: string; firstName?: string; lastName?: string; countryCode?: string };
      customData?: Record<string, unknown>; eventSourceUrl?: string; testEventCode?: string;
    };
    const pixel = await deps.metaPixelRepository.getById(id);
    if (!pixel || pixel.tenantId !== principal.tenantId || pixel.workspaceId !== body.workspaceId) {
      throw new AppError({ code: "META_ADS_PIXEL_NOT_FOUND", message: "Pixel não encontrado para este workspace.", statusCode: 404, recoverable: false });
    }
    try {
      const result = await sendMetaCapiEvent(
        { adAccountRepository: deps.metaAdAccountRepository, capiEventRepository: deps.metaCapiEventRepository, credentialRepository: deps.metaAdsCredentialRepository, secretManager: deps.secretManager },
        {
          tenantId: principal.tenantId, workspaceId: body.workspaceId, pixel, eventName: body.eventName, eventTime: body.eventTime,
          eventId: body.eventId, actionSource: body.actionSource, userData: body.userData, customData: body.customData,
          eventSourceUrl: body.eventSourceUrl, testEventCode: body.testEventCode,
        },
      );
      return successEnvelope(result, request.id);
    } catch (error) {
      rethrowMetaAdsPixelError(error);
    }
  });
}
