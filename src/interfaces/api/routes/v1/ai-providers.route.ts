import type { FastifyInstance } from "fastify";
import {
  getAiProvidersFinanceSummary,
  listAiOperationTypes,
  listAiProvidersOverview,
  setAiProviderApiKey,
  setAiProviderStatus,
  updateAiOperationTypeCredits,
  type AiProvidersAdminDeps,
} from "../../../../application/platform-admin/ai-providers-admin.usecases.js";
import { AI_PROVIDER_CODES } from "../../../../domain/ai-providers/index.js";
import { periodOf } from "../../../../domain/platform-billing/tenant-billing.model.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePlatformAdmin } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const PROVIDER_CODE_PARAMS_SCHEMA = {
  type: "object",
  required: ["code"],
  properties: { code: { type: "string", enum: [...AI_PROVIDER_CODES] } },
} as const;

const OPERATION_CODE_PARAMS_SCHEMA = {
  type: "object",
  required: ["code"],
  properties: { code: { type: "string", minLength: 1, maxLength: 120 } },
} as const;

const STATUS_BODY_SCHEMA = {
  type: "object",
  required: ["status"],
  additionalProperties: false,
  properties: { status: { type: "string", enum: ["active", "disabled"] } },
} as const;

const API_KEY_BODY_SCHEMA = {
  type: "object",
  required: ["apiKey"],
  additionalProperties: false,
  properties: { apiKey: { type: "string", maxLength: 500 } },
} as const;

const OPERATION_TYPE_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    creditsCost: { type: "integer", minimum: 0, maximum: 100_000 },
    active: { type: "boolean" },
  },
} as const;

const FINANCE_QUERYSTRING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    periodStart: { type: "string" },
    periodEnd: { type: "string" },
  },
} as const;

function translateAiProvidersError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("AI_PROVIDER_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("AI_PROVIDER_MODEL_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("AI_OPERATION_TYPE_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("AI_OPERATION_TYPE_INVALID_CREDITS")) throw new ValidationError(error.message);
  }
  throw error;
}

/** Módulo admin "Provedores de IA" — Sprint 26. Cadastro/config de provedores (OpenAI, Google;
 * Anthropic aparece como card informativo, gerido em `/admin/platform-ai-settings`), catálogo de
 * operações que consomem crédito, e painel financeiro (gasto/receita/lucro por provedor). Só
 * registrado quando há `identity` real (mesmo padrão de `registerAdminRoutes`). */
export async function registerAiProvidersRoutes(app: FastifyInstance, deps: AiProvidersAdminDeps): Promise<void> {
  app.get("/admin/ai-providers", async (request) => {
    requirePlatformAdmin(request);
    const providers = await listAiProvidersOverview(deps).catch(translateAiProvidersError);
    return successEnvelope({ providers }, request.id);
  });

  app.put(
    "/admin/ai-providers/:code/status",
    { schema: { params: PROVIDER_CODE_PARAMS_SCHEMA, body: STATUS_BODY_SCHEMA } },
    async (request) => {
      const principal = requirePlatformAdmin(request);
      const { code } = request.params as { code: (typeof AI_PROVIDER_CODES)[number] };
      const body = request.body as { status: "active" | "disabled" };
      const provider = await setAiProviderStatus(deps, { code, status: body.status, actor: { userId: principal.userId } }).catch(translateAiProvidersError);
      return successEnvelope(provider, request.id);
    },
  );

  app.put(
    "/admin/ai-providers/:code/api-key",
    { schema: { params: PROVIDER_CODE_PARAMS_SCHEMA, body: API_KEY_BODY_SCHEMA } },
    async (request) => {
      const principal = requirePlatformAdmin(request);
      const { code } = request.params as { code: (typeof AI_PROVIDER_CODES)[number] };
      const body = request.body as { apiKey: string };
      const provider = await setAiProviderApiKey(deps, { code, apiKey: body.apiKey, actor: { userId: principal.userId } }).catch(translateAiProvidersError);
      return successEnvelope(provider, request.id);
    },
  );

  app.get("/admin/ai-operation-types", async (request) => {
    requirePlatformAdmin(request);
    const operationTypes = await listAiOperationTypes(deps).catch(translateAiProvidersError);
    return successEnvelope({ operationTypes }, request.id);
  });

  app.put(
    "/admin/ai-operation-types/:code",
    { schema: { params: OPERATION_CODE_PARAMS_SCHEMA, body: OPERATION_TYPE_BODY_SCHEMA } },
    async (request) => {
      const principal = requirePlatformAdmin(request);
      const { code } = request.params as { code: string };
      const body = request.body as { creditsCost?: number; active?: boolean };
      const operationType = await updateAiOperationTypeCredits(deps, { code, ...body, actor: { userId: principal.userId } }).catch(translateAiProvidersError);
      return successEnvelope(operationType, request.id);
    },
  );

  app.get("/admin/ai-finance", { schema: { querystring: FINANCE_QUERYSTRING_SCHEMA } }, async (request) => {
    requirePlatformAdmin(request);
    const query = request.query as { periodStart?: string; periodEnd?: string };
    const now = deps.now();
    const periodStart = query.periodStart ?? `${periodOf(now)}-01`;
    const periodEnd = query.periodEnd ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    const summary = await getAiProvidersFinanceSummary(deps, { periodStart, periodEnd }).catch(translateAiProvidersError);
    return successEnvelope(summary, request.id);
  });
}
