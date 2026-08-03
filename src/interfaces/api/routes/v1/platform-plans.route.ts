import type { FastifyInstance } from "fastify";
import { listPublicPlans } from "../../../../domain/platform-billing/index.js";
import { successEnvelope } from "../../http/response-envelope.js";

/**
 * Endpoint público de catálogo de planos — usado pela landing (`/`) e pela página `/signup` do
 * frontend. Não precisa de autenticação; retorna a mesma lista que o `PLATFORM_PLAN_CATALOG`
 * exceto ENTERPRISE (que é "fale conosco").
 */
export async function registerPlatformPlansRoutes(app: FastifyInstance): Promise<void> {
  app.get("/platform/plans", async (request) => {
    const plans = listPublicPlans();
    return successEnvelope({ plans }, request.id);
  });
}
