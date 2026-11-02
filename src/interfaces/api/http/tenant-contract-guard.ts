import type { FastifyInstance } from "fastify";
import { resolveEffectiveEntitlements, type EntitlementUseCaseDeps } from "../../../application/billing/entitlement-use-cases.js";
import type { PlanCapability } from "../../../domain/platform-billing/plan-entitlements.model.js";
import { ForbiddenError } from "./app-error.js";

export function capabilityForPath(path: string): PlanCapability | undefined {
  if (/^\/v1\/(?:proposals|proposal-templates)(?:\/|$)|^\/v1\/(?:deals|inbox\/conversations)\/[^/]+\/proposals(?:\/|$)/.test(path)) return "proposals";
  if (/^\/v1\/(?:automation-rules|automation-run-logs)(?:\/|$)/.test(path)) return "automation";
  if (/^\/v1\/(?:contacts|companies|deals|pipelines|tasks)(?:\/|$)/.test(path)) return "crm";
  if (/^\/v1\/(?:crm-analytics|commercial-analytics|commercial-metrics|reports)(?:\/|$)/.test(path)) return "advanced_analytics";
  return undefined;
}

/** Admin and billing remain reachable to restore access. RBAC and solution guards still apply. */
export function registerTenantContractGuard(app: FastifyInstance, deps: EntitlementUseCaseDeps): void {
  const cache = new Map<string, { at: number; value: Awaited<ReturnType<typeof resolveEffectiveEntitlements>> }>();
  app.addHook("preHandler", async request => {
    const principal = request.zunoContext?.principal;
    if (!principal) return;
    const path = request.url.split("?")[0];
    if (/^\/v1\/(?:admin|auth|billing|solutions|health)(?:\/|$)/.test(path)) return;
    const controls = await deps.platformBillingRepository.getTenantControls?.(principal.tenantId);
    if (controls?.accessMode === "blocked") throw new ForbiddenError("Esta conta foi bloqueada pelo administrador da plataforma.");
    const capability = capabilityForPath(path);
    if (!capability) return;
    const cached = cache.get(principal.tenantId);
    const value = cached && Date.now() - cached.at < 1000 ? cached.value : await resolveEffectiveEntitlements(deps, principal.tenantId);
    if (cache.size > 2000) cache.clear();
    // Do not extend the TTL on cache hits.
    if (!cached || Date.now() - cached.at >= 1000) cache.set(principal.tenantId, { at: Date.now(), value });
    if (!value.capabilities[capability]) throw new ForbiddenError("Este recurso está bloqueado para esta conta. Consulte o administrador.", { capability });
  });
}
