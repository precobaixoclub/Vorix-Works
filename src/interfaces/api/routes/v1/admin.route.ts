import type { FastifyInstance } from "fastify";
import {
  activateTenant,
  adjustTenantCredits,
  changeTenantPlan,
  getPlatformDashboard,
  getTenantDetail,
  listTenantsOverview,
  setPriceMultiplier,
  suspendTenant,
  type PlatformAdminUseCaseDeps,
} from "../../../../application/platform-admin/index.js";
import { PLATFORM_PLAN_CODES } from "../../../../domain/platform-billing/platform-plan-catalog.js";
import { NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePlatformAdmin } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const LIST_QUERYSTRING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 200 },
    offset: { type: "integer", minimum: 0 },
    planCode: { type: "string", enum: [...PLATFORM_PLAN_CODES] },
    subscriptionStatus: { type: "string", enum: ["trial", "active", "past_due", "cancelled", "expired", "suspended"] },
  },
} as const;

const TENANT_ID_PARAMS_SCHEMA = {
  type: "object",
  required: ["tenantId"],
  properties: { tenantId: { type: "string", minLength: 1 } },
} as const;

const CREDITS_BODY_SCHEMA = {
  type: "object",
  required: ["deltaTokens", "reason"],
  additionalProperties: false,
  properties: {
    deltaTokens: { type: "integer" },
    reason: { type: "string", minLength: 3, maxLength: 500 },
  },
} as const;

const CHANGE_PLAN_BODY_SCHEMA = {
  type: "object",
  required: ["planCode"],
  additionalProperties: false,
  properties: { planCode: { type: "string", enum: [...PLATFORM_PLAN_CODES] } },
} as const;

const MULTIPLIER_BODY_SCHEMA = {
  type: "object",
  required: ["multiplier"],
  additionalProperties: false,
  properties: { multiplier: { type: "number", minimum: 1, maximum: 100 } },
} as const;

function translatePlatformError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("PLATFORM_ADMIN_TENANT_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("PLATFORM_BILLING_TENANT_NOT_FOUND")) throw new NotFoundError(error.message);
    if (error.message.startsWith("PLATFORM_ADMIN_INVALID_DELTA")) throw new ValidationError(error.message);
    if (error.message.startsWith("PLATFORM_ADMIN_INVALID_MULTIPLIER")) throw new ValidationError(error.message);
    if (error.message.startsWith("PLATFORM_BILLING_INVALID_MULTIPLIER")) throw new ValidationError(error.message);
  }
  throw error;
}

export async function registerAdminRoutes(app: FastifyInstance, deps: PlatformAdminUseCaseDeps): Promise<void> {
  // Dashboard geral \u2014 receita/lucro agregado do m\u00eas + top clientes.
  app.get("/admin/dashboard", async (request) => {
    requirePlatformAdmin(request);
    const summary = await getPlatformDashboard(deps).catch(translatePlatformError);
    return successEnvelope(summary, request.id);
  });

  // Lista de tenants (com overview do m\u00eas). Pagina\u00e7\u00e3o e filtros por plano/status.
  app.get("/admin/tenants", { schema: { querystring: LIST_QUERYSTRING_SCHEMA } }, async (request) => {
    requirePlatformAdmin(request);
    const query = request.query as {
      limit?: number;
      offset?: number;
      planCode?: (typeof PLATFORM_PLAN_CODES)[number];
      subscriptionStatus?: "trial" | "active" | "past_due" | "cancelled" | "expired" | "suspended";
    };
    const result = await listTenantsOverview(deps, query).catch(translatePlatformError);
    return successEnvelope(result, request.id);
  });

  // Detalhe de um tenant \u2014 billing + workspaces + membros + hist\u00f3rico de consumo.
  app.get("/admin/tenants/:tenantId", { schema: { params: TENANT_ID_PARAMS_SCHEMA } }, async (request) => {
    requirePlatformAdmin(request);
    const { tenantId } = request.params as { tenantId: string };
    const detail = await getTenantDetail(deps, { tenantId }).catch(translatePlatformError);
    return successEnvelope(detail, request.id);
  });

  // Ajusta cr\u00e9ditos avulsos \u2014 positivo adiciona, negativo debita. Gera ledger entry.
  app.post(
    "/admin/tenants/:tenantId/credits",
    { schema: { params: TENANT_ID_PARAMS_SCHEMA, body: CREDITS_BODY_SCHEMA } },
    async (request) => {
      const principal = requirePlatformAdmin(request);
      const { tenantId } = request.params as { tenantId: string };
      const body = request.body as { deltaTokens: number; reason: string };
      const result = await adjustTenantCredits(deps, {
        tenantId,
        deltaTokens: body.deltaTokens,
        reason: body.reason,
        actor: { userId: principal.userId },
      }).catch(translatePlatformError);
      return successEnvelope(result, request.id);
    },
  );

  // Muda o plano contratado.
  app.post(
    "/admin/tenants/:tenantId/plan",
    { schema: { params: TENANT_ID_PARAMS_SCHEMA, body: CHANGE_PLAN_BODY_SCHEMA } },
    async (request) => {
      const principal = requirePlatformAdmin(request);
      const { tenantId } = request.params as { tenantId: string };
      const body = request.body as { planCode: (typeof PLATFORM_PLAN_CODES)[number] };
      const billing = await changeTenantPlan(deps, {
        tenantId,
        planCode: body.planCode,
        actor: { userId: principal.userId },
      }).catch(translatePlatformError);
      return successEnvelope(billing, request.id);
    },
  );

  app.post(
    "/admin/tenants/:tenantId/suspend",
    { schema: { params: TENANT_ID_PARAMS_SCHEMA } },
    async (request) => {
      const principal = requirePlatformAdmin(request);
      const { tenantId } = request.params as { tenantId: string };
      const billing = await suspendTenant(deps, { tenantId, actor: { userId: principal.userId } })
        .catch(translatePlatformError);
      return successEnvelope(billing, request.id);
    },
  );

  app.post(
    "/admin/tenants/:tenantId/activate",
    { schema: { params: TENANT_ID_PARAMS_SCHEMA } },
    async (request) => {
      const principal = requirePlatformAdmin(request);
      const { tenantId } = request.params as { tenantId: string };
      const billing = await activateTenant(deps, { tenantId, actor: { userId: principal.userId } })
        .catch(translatePlatformError);
      return successEnvelope(billing, request.id);
    },
  );

  app.post(
    "/admin/tenants/:tenantId/multiplier",
    { schema: { params: TENANT_ID_PARAMS_SCHEMA, body: MULTIPLIER_BODY_SCHEMA } },
    async (request) => {
      const principal = requirePlatformAdmin(request);
      const { tenantId } = request.params as { tenantId: string };
      const body = request.body as { multiplier: number };
      const billing = await setPriceMultiplier(deps, {
        tenantId,
        multiplier: body.multiplier,
        actor: { userId: principal.userId },
      }).catch(translatePlatformError);
      return successEnvelope(billing, request.id);
    },
  );
}
