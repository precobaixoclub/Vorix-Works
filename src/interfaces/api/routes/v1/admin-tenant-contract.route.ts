import type { FastifyInstance } from "fastify";
import { getCapacityState, previewCapacityChange, applyCapacityChange, cancelPendingCapacityChange, type CapacityUseCaseDeps, type CapacityPreviewInput } from "../../../../application/billing/capacity-use-cases.js";
import { getLimit, resolveContractEntitlements, resolveEffectiveEntitlements } from "../../../../application/billing/entitlement-use-cases.js";
import { defaultTenantControls, type TenantControls } from "../../../../domain/platform-billing/tenant-controls.model.js";
import { PLAN_LIMIT_RESOURCES } from "../../../../domain/platform-billing/plan-entitlements.model.js";
import { requirePlatformAdmin } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { ConflictError, NotFoundError, ValidationError } from "../../http/app-error.js";

const params = { type: "object", required: ["tenantId"], properties: { tenantId: { type: "string", minLength: 1, maxLength: 200 } } } as const;
const controlsSchema = {
  type: "object", additionalProperties: false, required: ["expectedVersion", "reason", "accessMode", "capabilities", "limits"],
  properties: {
    expectedVersion: { type: "integer", minimum: 0 }, reason: { type: "string", minLength: 3, maxLength: 500, pattern: "\\S.*\\S" },
    displayName: { type: "string", minLength: 1, maxLength: 120, pattern: "\\S" },
    accessMode: { type: "string", enum: ["inherit", "enabled", "blocked"] },
    capabilities: { type: "object", additionalProperties: false, properties: Object.fromEntries(["crm", "proposals", "automation", "ai_auto_reply", "advanced_analytics"].map(key => [key, { type: "boolean" }])) },
    limits: { type: "object", additionalProperties: false, properties: Object.fromEntries(PLAN_LIMIT_RESOURCES.filter(key => key !== "storage_mb").map(key => [key, { anyOf: [{ type: "integer", minimum: 0, maximum: 1_000_000_000 }, { type: "null" }] }])) },
  },
};
const capacityProperties = {
  users: { type: "integer", minimum: 0, maximum: 10000 }, whatsappConnections: { type: "integer", minimum: 0, maximum: 1000 }, workspaces: { type: "integer", minimum: 0, maximum: 1000 }, concurrentRecordings: { type: "integer", minimum: 0, maximum: 100 },
  addonQuantities: { type: "object", maxProperties: 30, propertyNames: { pattern: "^[a-zA-Z0-9_-]{1,100}$" }, additionalProperties: { type: "integer", minimum: 0, maximum: 10000 } },
};
function translate(error: unknown): never {
  if (error instanceof Error) {
    if (/NOT_FOUND/.test(error.message)) throw new NotFoundError(error.message);
    if (/CONFLICT|BELOW_USAGE|PENDING_CHANGE_EXISTS|ALREADY_APPLIED/.test(error.message)) throw new ConflictError(error.message);
    if (/^(CAPACITY_|CHECKOUT_|MEETINGS_|ADDON_)|NO_PROVIDER_SUBSCRIPTION/.test(error.message)) throw new ValidationError(error.message);
  }
  throw error;
}
export async function registerAdminTenantContractRoutes(app: FastifyInstance, deps: CapacityUseCaseDeps): Promise<void> {
  async function account(tenantId: string) {
    if (!await deps.platformBillingRepository.getTenantBilling(tenantId)) throw new NotFoundError("Conta não encontrada.");
  }
  app.get("/admin/tenants/:tenantId/contract", { schema: { params } }, async request => {
    requirePlatformAdmin(request);
    const { tenantId } = request.params as { tenantId: string }; await account(tenantId);
    const [contract, effective, subscription, controls, capacity, history, usage, plans] = await Promise.all([
      resolveContractEntitlements(deps, tenantId), resolveEffectiveEntitlements(deps, tenantId), deps.subscriptionRepository.getActiveByTenant(tenantId),
      deps.platformBillingRepository.getTenantControls?.(tenantId) ?? defaultTenantControls(tenantId), getCapacityState(deps, tenantId),
      deps.platformBillingRepository.listTenantControlChanges?.(tenantId) ?? [],
      Promise.all(PLAN_LIMIT_RESOURCES.map(async resource => [resource, (await getLimit(deps, { tenantId, resource })).used] as const)), deps.planVersionRepository.listActivePlans(),
    ]);
    const items = subscription ? await deps.subscriptionItemRepository.listBySubscription(subscription.id) : [];
    const addons = await Promise.all(items.map(async item => { const definition = await deps.addonDefinitionRepository.getByCode(item.addonCode); return { code: item.addonCode, name: definition?.name ?? item.addonCode, resource: definition?.resource, quantity: item.quantity, unitPrice: item.unitPriceUsd }; }));
    const version = await deps.planVersionRepository.getById(contract.planVersionId);
    return successEnvelope({ contract, effective, controls, usage: Object.fromEntries(usage), capacity, history, addons,
      planName: version?.name ?? contract.planCode,
      // Expose contract facts only, never customer payment tokens or provider credentials.
      subscription: subscription ? { id: subscription.id, status: subscription.status, interval: subscription.billingInterval, provider: subscription.billingProvider, currentPeriodEnd: subscription.currentPeriodEnd, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, trialEnd: subscription.trialEnd, linkedToProvider: !!subscription.providerSubscriptionId } : null,
      plans: plans.map(plan => ({ code: plan.planCode, name: plan.name, limits: plan.limits, monthlyPrice: plan.monthlyPriceUsd, yearlyPrice: plan.yearlyPriceUsd, currency: plan.currency })),
    }, request.id);
  });
  app.put("/admin/tenants/:tenantId/controls", { schema: { params, body: controlsSchema }, preValidation: async request => {
    requirePlatformAdmin(request);
    // Fastify strips additional properties by default. Reject misspellings before that happens.
    const body = request.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") return;
    for (const key of Object.keys(body)) if (!Object.hasOwn(controlsSchema.properties, key)) throw new ValidationError(`Campo administrativo desconhecido: ${key}`);
    for (const key of ["capabilities", "limits"] as const) {
      const values = body[key];
      if (values && typeof values === "object") for (const name of Object.keys(values)) if (!Object.hasOwn(controlsSchema.properties[key].properties, name)) throw new ValidationError(`Recurso administrativo desconhecido: ${name}`);
    }
  } }, async request => {
    const principal = requirePlatformAdmin(request);
    const { tenantId } = request.params as { tenantId: string }; await account(tenantId);
    const { expectedVersion, reason, ...body } = request.body as Omit<TenantControls, "tenantId" | "version" | "updatedAt"> & { expectedVersion: number; reason: string };
    if (reason.trim().length < 3) throw new ValidationError("Informe um motivo com pelo menos três caracteres.");
    const saved = await deps.platformBillingRepository.saveTenantControls!({ controls: { ...body, displayName: body.displayName?.trim(), tenantId, version: expectedVersion }, expectedVersion, reason: reason.trim(), actorUserId: principal.userId }).catch(translate);
    return successEnvelope(saved, request.id);
  });
  app.post("/admin/tenants/:tenantId/capacity/preview", { schema: { params, body: { type: "object", additionalProperties: false, required: ["users", "whatsappConnections"], properties: capacityProperties } } }, async request => {
    requirePlatformAdmin(request); const { tenantId } = request.params as { tenantId: string }; await account(tenantId);
    return successEnvelope(await previewCapacityChange(deps, { ...request.body as Omit<CapacityPreviewInput, "tenantId">, tenantId }).catch(translate), request.id);
  });
  app.post("/admin/tenants/:tenantId/capacity/apply", { schema: { params, body: { type: "object", additionalProperties: false, required: ["confirmed"], properties: { ...capacityProperties, confirmed: { const: true, type: "boolean" } } } }, config: { idempotent: true } }, async request => {
    requirePlatformAdmin(request); const { tenantId } = request.params as { tenantId: string }; await account(tenantId);
    const { confirmed: _confirmed, ...body } = request.body as Omit<CapacityPreviewInput, "tenantId"> & { confirmed: boolean };
    return successEnvelope(await applyCapacityChange(deps, { ...body, tenantId }).catch(translate), request.id);
  });
  app.post("/admin/tenants/:tenantId/capacity/pending/:id/cancel", { schema: { params: { ...params, required: ["tenantId", "id"], properties: { ...params.properties, id: { type: "string", minLength: 1 } } } } }, async request => {
    requirePlatformAdmin(request); const { tenantId, id } = request.params as { tenantId: string; id: string }; await account(tenantId);
    await cancelPendingCapacityChange(deps, { tenantId, pendingChangeId: id }).catch(translate);
    return successEnvelope({ cancelled: true }, request.id);
  });
}
