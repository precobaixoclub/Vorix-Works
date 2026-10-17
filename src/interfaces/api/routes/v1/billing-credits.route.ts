import type { FastifyInstance } from "fastify";
import { getAiCreditsOverview, purchaseAiCredits, type AiCreditsDeps } from "../../../../application/billing/ai-credits-use-cases.js";
import { ForbiddenError, ValidationError } from "../../http/app-error.js";
import { requirePrincipal } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const PURCHASE_BODY_SCHEMA = {
  type: "object",
  required: ["credits"],
  additionalProperties: false,
  properties: {
    credits: { type: "integer", minimum: 1, maximum: 10_000_000 },
    returnPath: { type: "string", maxLength: 300 },
  },
} as const;

/**
 * `/v1/billing/credits` — saldo de créditos de IA, preço e recarga avulsa (quantidade livre).
 * Comprar gera cobrança real: só dono/administrador da conta.
 */
export async function registerBillingCreditsRoutes(app: FastifyInstance, deps: AiCreditsDeps): Promise<void> {
  app.get("/billing/credits", async (request) => {
    const principal = requirePrincipal(request);
    return successEnvelope(await getAiCreditsOverview(deps, principal.tenantId), request.id);
  });

  app.post("/billing/credits/purchase", { schema: { body: PURCHASE_BODY_SCHEMA }, config: { idempotent: true } }, async (request) => {
    const principal = requirePrincipal(request);
    if (principal.role !== "owner" && principal.role !== "admin") throw new ForbiddenError("Só o dono ou um administrador da conta pode comprar créditos.");
    const body = request.body as { credits: number; returnPath?: string };
    const result = await purchaseAiCredits(deps, { tenantId: principal.tenantId, userId: principal.userId, credits: body.credits, returnPath: body.returnPath }).catch((error: unknown) => {
      if (error instanceof Error && /^AI_CREDITS_(INVALID_AMOUNT|ACCOUNT_BLOCKED|PAYMENT_UNAVAILABLE)/.test(error.message)) throw new ValidationError(error.message);
      throw error;
    });
    return successEnvelope(result, request.id);
  });
}
