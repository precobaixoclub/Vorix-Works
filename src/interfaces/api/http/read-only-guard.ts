import type { FastifyInstance } from "fastify";
import { resolveEffectiveEntitlements, type EntitlementUseCaseDeps } from "../../../application/billing/entitlement-use-cases.js";
import { PaymentRequiredError } from "./app-error.js";

/**
 * Aquisição self-service (seção 39-42 do pedido) — trial vencido ou pagamento pendente entra no
 * MESMO modo somente-leitura já resolvido por `resolveEffectiveEntitlements` (nunca uma regra
 * paralela), mas até agora nada além da própria tela de Billing checava isso: um tenant com trial
 * vencido continuava criando Contato/Negócio/Tarefa/Proposta/Automação livremente via API. Este
 * guard fecha esse gap para as rotas de CRIAÇÃO operacional que o pedido cita explicitamente
 * ("criação operacional"; IA/envio/publicação ficam para uma rodada futura — ver riscos restantes
 * do relatório) — nunca bloqueia leitura, billing, auth ou configurações de conta.
 *
 * Opt-in por rota via `{ config: { readOnlyGuard: true } }` (mesmo idioma de
 * `idempotency.middleware.ts`/`config.idempotent`) — nunca um bloqueio global por método HTTP, que
 * arriscaria pegar rota nova/esquecida e quebrar algo que não devia (ex.: a própria reativação de
 * assinatura, que TEM que continuar funcionando em modo somente-leitura).
 */
export function registerReadOnlyGuard(app: FastifyInstance, deps: EntitlementUseCaseDeps): void {
  app.addHook("preHandler", async (request) => {
    const config = request.routeOptions?.config as { readOnlyGuard?: boolean } | undefined;
    if (!config?.readOnlyGuard) return;

    const principal = request.zunoContext?.principal;
    if (!principal || principal.isPlatformAdmin) return;

    const entitlements = await resolveEffectiveEntitlements(deps, principal.tenantId);
    if (entitlements.readOnly) {
      throw new PaymentRequiredError();
    }
  });
}
