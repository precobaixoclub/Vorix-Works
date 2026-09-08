import type { FastifyInstance } from "fastify";
import { createBillingPortalSession, getBillingOverview, type BillingOverviewUseCaseDeps } from "../../../../application/billing/overview-use-cases.js";
import { ValidationError } from "../../http/app-error.js";
import { requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

export type BillingOverviewRoutesDeps = BillingOverviewUseCaseDeps & { appBaseUrl: string };

const PORTAL_BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { returnPath: { type: "string", maxLength: 300 } },
} as const;

/**
 * `GET /v1/billing/overview` — SaaS Commercialization, Fase 4. Único endpoint que a tela "Plano e
 * Cobrança" consulta (plano atual, consumo, add-ons, forma de pagamento, faturas recentes) — de
 * propósito, pra manter essa tela simples em vez de agregar N chamadas no frontend.
 */
export async function registerBillingOverviewRoutes(app: FastifyInstance, deps: BillingOverviewRoutesDeps): Promise<void> {
  app.get("/billing/overview", async (request) => {
    const principal = requirePrincipal(request);
    const overview = await getBillingOverview(deps, principal.tenantId);
    return successEnvelope(overview, request.id);
  });

  app.post("/billing/portal", { schema: { body: PORTAL_BODY_SCHEMA } }, async (request) => {
    const principal = requirePrincipal(request);
    const body = request.body as { returnPath?: string };
    const returnUrl = new URL(body.returnPath ?? "/configuracoes/plano", deps.appBaseUrl).toString();
    const result = await createBillingPortalSession(deps, { tenantId: principal.tenantId, returnUrl }).catch((error) => {
      if (error instanceof Error && error.message.startsWith("BILLING_PORTAL_NO_PROVIDER_CUSTOMER")) throw new ValidationError(error.message);
      throw error;
    });
    return successEnvelope(result, request.id);
  });
}
