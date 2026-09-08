import type { FastifyInstance } from "fastify";
import {
  cancelSubscriptionSelfService,
  changePlan,
  detectDowngradeOverage,
  purchaseAddon,
  reactivateSubscription,
  removeAddon,
  type LifecycleUseCaseDeps,
} from "../../../../application/billing/lifecycle-use-cases.js";
import { BILLING_INTERVALS } from "../../../../domain/platform-billing/subscription.model.js";
import { PLATFORM_PLAN_CODES } from "../../../../domain/platform-billing/platform-plan-catalog.js";
import { ConflictError, NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

export type BillingLifecycleRoutesDeps = LifecycleUseCaseDeps;

function translateLifecycleError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("SUBSCRIPTION_NOT_FOUND") || error.message.startsWith("CHANGE_PLAN_VERSION_NOT_FOUND") || error.message.startsWith("ADDON_ITEM_NOT_FOUND")) {
      throw new NotFoundError(error.message);
    }
    if (error.message.startsWith("CHANGE_PLAN_DOWNGRADE_OVERAGE")) {
      throw new ConflictError(error.message, { overages: (error as Error & { overages?: unknown }).overages });
    }
    if (error.message.startsWith("REACTIVATE_NOT_CANCELED")) {
      throw new ConflictError(error.message);
    }
    if (
      error.message.startsWith("ADDON_NOT_ALLOWED") ||
      error.message.startsWith("ADDON_NOT_FOUND") ||
      error.message.startsWith("ADDON_INVALID_QUANTITY") ||
      error.message.endsWith("_NO_PROVIDER_SUBSCRIPTION")
    ) {
      throw new ValidationError(error.message);
    }
  }
  throw error;
}

const CHANGE_PLAN_BODY_SCHEMA = {
  type: "object",
  required: ["newPlanCode", "billingInterval"],
  additionalProperties: false,
  properties: {
    newPlanCode: { type: "string", enum: [...PLATFORM_PLAN_CODES] },
    billingInterval: { type: "string", enum: [...BILLING_INTERVALS] },
    prorate: { type: "boolean" },
  },
} as const;

const DOWNGRADE_PREVIEW_QUERY_SCHEMA = {
  type: "object",
  required: ["newPlanCode"],
  properties: { newPlanCode: { type: "string", enum: [...PLATFORM_PLAN_CODES] } },
} as const;

const ADDON_BODY_SCHEMA = {
  type: "object",
  required: ["addonCode", "quantity", "billingInterval"],
  additionalProperties: false,
  properties: {
    addonCode: { type: "string", minLength: 1 },
    quantity: { type: "integer", minimum: 1 },
    billingInterval: { type: "string", enum: [...BILLING_INTERVALS] },
  },
} as const;

const CANCEL_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { reason: { type: "string", maxLength: 500 } },
} as const;

const ADDON_ITEM_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

/**
 * `/v1/billing/*` — SaaS Commercialization, Fase 3 (Subscription Lifecycle). Ao contrário do
 * checkout (Fase 2), estas ações confiam na resposta síncrona do `BillingProviderPort` — o tenant
 * já é um assinante pago existente, então a confirmação do gateway aqui É a fonte de verdade
 * imediata (o webhook continua como rede de segurança para mudanças de STATUS, não de plano).
 */
export async function registerBillingLifecycleRoutes(app: FastifyInstance, deps: BillingLifecycleRoutesDeps): Promise<void> {
  app.get("/billing/downgrade-preview", { schema: { querystring: DOWNGRADE_PREVIEW_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePrincipal(request);
    const query = request.query as { newPlanCode: (typeof PLATFORM_PLAN_CODES)[number] };
    const overages = await detectDowngradeOverage(deps, { tenantId: principal.tenantId, newPlanCode: query.newPlanCode }).catch(translateLifecycleError);
    return successEnvelope({ overages, safeToChange: overages.length === 0 }, request.id);
  });

  app.post("/billing/change-plan", { schema: { body: CHANGE_PLAN_BODY_SCHEMA } }, async (request) => {
    const principal = requirePrincipal(request);
    const body = request.body as { newPlanCode: (typeof PLATFORM_PLAN_CODES)[number]; billingInterval: (typeof BILLING_INTERVALS)[number]; prorate?: boolean };
    await changePlan(deps, { tenantId: principal.tenantId, ...body }).catch(translateLifecycleError);
    return successEnvelope({ changed: true }, request.id);
  });

  app.post("/billing/addons", { schema: { body: ADDON_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = request.body as { addonCode: string; quantity: number; billingInterval: (typeof BILLING_INTERVALS)[number] };
    await purchaseAddon(deps, { tenantId: principal.tenantId, ...body }).catch(translateLifecycleError);
    reply.code(201);
    return successEnvelope({ purchased: true }, request.id);
  });

  app.delete("/billing/addons/:id", { schema: { params: ADDON_ITEM_PARAMS_SCHEMA } }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const { id } = request.params as { id: string };
    await removeAddon(deps, { tenantId: principal.tenantId, subscriptionItemId: id }).catch(translateLifecycleError);
    reply.code(204);
    return null;
  });

  app.post("/billing/cancel", { schema: { body: CANCEL_BODY_SCHEMA } }, async (request) => {
    const principal = requirePrincipal(request);
    const body = request.body as { reason?: string };
    await cancelSubscriptionSelfService(deps, { tenantId: principal.tenantId, reason: body.reason }).catch(translateLifecycleError);
    return successEnvelope({ cancelAtPeriodEnd: true }, request.id);
  });

  app.post("/billing/reactivate", async (request) => {
    const principal = requirePrincipal(request);
    await reactivateSubscription(deps, { tenantId: principal.tenantId }).catch(translateLifecycleError);
    return successEnvelope({ reactivated: true }, request.id);
  });
}
