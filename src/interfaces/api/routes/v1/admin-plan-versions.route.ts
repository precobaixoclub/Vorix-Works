import type { FastifyInstance } from "fastify";
import {
  deactivatePlanVersion,
  listActiveAddons,
  listActivePlanVersions,
  listPlanVersionHistory,
  publishPlanVersion,
} from "../../../../application/billing/plan-version-use-cases.js";
import type { PlanVersionUseCaseDeps } from "../../../../application/billing/plan-version-use-cases.js";
import { PLAN_CAPABILITIES, PLAN_LIMIT_RESOURCES } from "../../../../domain/platform-billing/plan-entitlements.model.js";
import { PLATFORM_PLAN_CODES } from "../../../../domain/platform-billing/platform-plan-catalog.js";
import { requirePlatformAdmin } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const CAPABILITIES_SCHEMA = {
  type: "object",
  required: [...PLAN_CAPABILITIES],
  additionalProperties: false,
  properties: Object.fromEntries(PLAN_CAPABILITIES.map((capability) => [capability, { type: "boolean" }])),
} as const;

const LIMITS_SCHEMA = {
  type: "object",
  required: [...PLAN_LIMIT_RESOURCES],
  additionalProperties: false,
  properties: Object.fromEntries(PLAN_LIMIT_RESOURCES.map((resource) => [resource, { type: ["integer", "null"], minimum: 0 }])),
} as const;

const PUBLISH_BODY_SCHEMA = {
  type: "object",
  required: ["planCode", "name", "tagline", "monthlyPriceUsd", "yearlyPriceUsd", "capabilities", "limits", "allowedAddonCodes"],
  additionalProperties: false,
  properties: {
    planCode: { type: "string", enum: [...PLATFORM_PLAN_CODES] },
    name: { type: "string", minLength: 1, maxLength: 80 },
    tagline: { type: "string", minLength: 1, maxLength: 200 },
    monthlyPriceUsd: { type: "number", minimum: 0 },
    yearlyPriceUsd: { type: "number", minimum: 0 },
    currency: { type: "string", minLength: 3, maxLength: 3 },
    capabilities: CAPABILITIES_SCHEMA,
    limits: LIMITS_SCHEMA,
    allowedAddonCodes: { type: "array", items: { type: "string" } },
    trialDays: { type: ["integer", "null"], minimum: 0 },
    monthlyProviderPriceRef: { type: "string", minLength: 1 },
    yearlyProviderPriceRef: { type: "string", minLength: 1 },
  },
} as const;

const PLAN_CODE_PARAMS_SCHEMA = { type: "object", required: ["planCode"], properties: { planCode: { type: "string", enum: [...PLATFORM_PLAN_CODES] } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

/**
 * Gestão de versões de plano/add-ons — SaaS Commercialization, Fase 1. Restrito a administradores
 * da plataforma (`requirePlatformAdmin`), mesmo padrão de `admin.route.ts` (Sprint 25). Publicar
 * uma versão nova NUNCA sobrescreve a anterior — quem já assina a antiga continua nela.
 */
export async function registerAdminPlanVersionsRoutes(app: FastifyInstance, deps: PlanVersionUseCaseDeps): Promise<void> {
  app.get("/admin/plan-versions", async (request) => {
    requirePlatformAdmin(request);
    const plans = await listActivePlanVersions(deps);
    return successEnvelope(plans, request.id);
  });

  app.get("/admin/plan-versions/:planCode/history", { schema: { params: PLAN_CODE_PARAMS_SCHEMA } }, async (request) => {
    requirePlatformAdmin(request);
    const { planCode } = request.params as { planCode: (typeof PLATFORM_PLAN_CODES)[number] };
    const history = await listPlanVersionHistory(deps, planCode);
    return successEnvelope(history, request.id);
  });

  app.post("/admin/plan-versions", { schema: { body: PUBLISH_BODY_SCHEMA } }, async (request, reply) => {
    requirePlatformAdmin(request);
    const body = request.body as Parameters<typeof publishPlanVersion>[1];
    const planVersion = await publishPlanVersion(deps, body);
    reply.code(201);
    return successEnvelope(planVersion, request.id);
  });

  app.post("/admin/plan-versions/:id/deactivate", { schema: { params: ID_PARAMS_SCHEMA } }, async (request, reply) => {
    requirePlatformAdmin(request);
    const { id } = request.params as { id: string };
    await deactivatePlanVersion(deps, id);
    reply.code(204);
    return null;
  });

  app.get("/admin/addons", async (request) => {
    requirePlatformAdmin(request);
    const addons = await listActiveAddons(deps);
    return successEnvelope(addons, request.id);
  });
}
