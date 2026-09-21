import type { FastifyInstance } from "fastify";
import {
  applyCapacityChange,
  cancelPendingCapacityChange,
  getCapacityState,
  previewCapacityChange,
  type CapacityUseCaseDeps,
} from "../../../../application/billing/capacity-use-cases.js";
import { ConflictError, NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

export type BillingCapacityRoutesDeps = CapacityUseCaseDeps;

function translateCapacityError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message.startsWith("SUBSCRIPTION_NOT_FOUND") || error.message.startsWith("CAPACITY_PLAN_VERSION_NOT_FOUND") || error.message.startsWith("CAPACITY_PENDING_CHANGE_NOT_FOUND")) {
      throw new NotFoundError(error.message);
    }
    if (
      error.message.startsWith("CAPACITY_REDUCTION_BELOW_USAGE") ||
      error.message.startsWith("CAPACITY_PENDING_CHANGE_EXISTS") ||
      error.message.startsWith("CAPACITY_PENDING_CHANGE_ALREADY_APPLIED")
    ) {
      throw new ConflictError(error.message);
    }
    if (
      error.message.startsWith("CAPACITY_BELOW_PLAN_MINIMUM") ||
      error.message.startsWith("CAPACITY_ADDON_NOT_AVAILABLE") ||
      error.message.startsWith("CAPACITY_NOTHING_TO_REDUCE") ||
      error.message.endsWith("_NO_PROVIDER_SUBSCRIPTION") ||
      error.message.startsWith("ADDON_")
    ) {
      throw new ValidationError(error.message);
    }
  }
  throw error;
}

const PREVIEW_BODY_SCHEMA = {
  type: "object",
  required: ["users", "whatsappConnections"],
  additionalProperties: false,
  properties: {
    users: { type: "integer", minimum: 0, maximum: 10_000 },
    whatsappConnections: { type: "integer", minimum: 0, maximum: 1_000 },
  },
} as const;

const APPLY_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    users: { type: "integer", minimum: 0, maximum: 10_000 },
    whatsappConnections: { type: "integer", minimum: 0, maximum: 1_000 },
  },
} as const;

const CANCEL_PENDING_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

/**
 * `/v1/billing/capacity/*` — Pricing/Capacity Etapa B. "Capacidade" (usuários/números WhatsApp) é
 * conceitualmente distinta de plano/addon já expostos em `/billing/*` — rotas próprias, mas
 * reusando 100% dos mesmos casos de uso/repositórios de billing (nunca uma segunda infraestrutura).
 */
export async function registerBillingCapacityRoutes(app: FastifyInstance, deps: BillingCapacityRoutesDeps): Promise<void> {
  app.get("/billing/capacity", async (request) => {
    const principal = requirePrincipal(request);
    const state = await getCapacityState(deps, principal.tenantId).catch(translateCapacityError);
    return successEnvelope(state, request.id);
  });

  app.post("/billing/capacity/preview", { schema: { body: PREVIEW_BODY_SCHEMA } }, async (request) => {
    const principal = requirePrincipal(request);
    const body = request.body as { users: number; whatsappConnections: number };
    const result = await previewCapacityChange(deps, { tenantId: principal.tenantId, ...body }).catch(translateCapacityError);
    return successEnvelope(result, request.id);
  });

  app.post("/billing/capacity/apply", { schema: { body: APPLY_BODY_SCHEMA }, config: { idempotent: true } }, async (request) => {
    const principal = requirePrincipal(request);
    const body = request.body as { users?: number; whatsappConnections?: number };
    const result = await applyCapacityChange(deps, { tenantId: principal.tenantId, ...body }).catch(translateCapacityError);
    return successEnvelope(result, request.id);
  });

  app.post("/billing/capacity/pending/:id/cancel", { schema: { params: CANCEL_PENDING_PARAMS_SCHEMA } }, async (request) => {
    const principal = requirePrincipal(request);
    const { id } = request.params as { id: string };
    await cancelPendingCapacityChange(deps, { tenantId: principal.tenantId, pendingChangeId: id }).catch(translateCapacityError);
    return successEnvelope({ cancelled: true }, request.id);
  });
}
