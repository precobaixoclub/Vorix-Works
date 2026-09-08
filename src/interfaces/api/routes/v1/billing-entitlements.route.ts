import type { FastifyInstance } from "fastify";
import { getLimit, resolveEffectiveEntitlements } from "../../../../application/billing/entitlement-use-cases.js";
import type { EntitlementUseCaseDeps } from "../../../../application/billing/entitlement-use-cases.js";
import { PLAN_LIMIT_RESOURCES } from "../../../../domain/platform-billing/plan-entitlements.model.js";
import { requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/**
 * `GET /v1/entitlements` — SaaS Commercialization, Fase 1. Único ponto de leitura de
 * capabilities/limites do tenant autenticado; qualquer tela do produto ou módulo backend que
 * precise saber "posso usar X?"/"quanto falta de Y?" consulta isto, nunca reimplementa a lógica
 * de resolução de plano por conta própria.
 */
export async function registerBillingEntitlementsRoutes(app: FastifyInstance, deps: EntitlementUseCaseDeps): Promise<void> {
  app.get("/entitlements", async (request) => {
    const principal = requirePrincipal(request);
    const entitlements = await resolveEffectiveEntitlements(deps, principal.tenantId);
    const limits = await Promise.all(
      PLAN_LIMIT_RESOURCES.map(async (resource) => ({ resource, ...(await getLimit(deps, { tenantId: principal.tenantId, resource })) })),
    );
    return successEnvelope(
      {
        planCode: entitlements.planCode,
        planVersionId: entitlements.planVersionId,
        virtual: entitlements.virtual,
        readOnly: entitlements.readOnly,
        capabilities: entitlements.capabilities,
        limits,
      },
      request.id,
    );
  });
}
