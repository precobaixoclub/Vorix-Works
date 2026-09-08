import type { FastifyInstance, FastifyRequest } from "fastify";
import { processBillingWebhook, type WebhookUseCaseDeps } from "../../../application/billing/webhook-use-cases.js";

/**
 * Webhook do gateway de pagamento (Stripe) — SaaS Commercialization, Fase 2.
 *
 * FORA do namespace autenticado `/v1` — o gateway chama isto diretamente, sem sessão Vorix
 * nenhuma. A segurança vem inteiramente da verificação de assinatura dentro de
 * `BillingProviderPort.handleWebhook` (HMAC contra `STRIPE_WEBHOOK_SECRET`), nunca de
 * `requirePermission`.
 *
 * Registrado dentro do PRÓPRIO contexto de encapsulamento do Fastify — mesmo motivo do webhook do
 * Instagram DM (`instagram-dm-webhook.route.ts`): o content-type parser que preserva o corpo cru
 * (`rawBody`, exigido para verificar a assinatura HMAC) nunca pode vazar pro resto da API.
 */
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export type BillingWebhookRoutesDeps = WebhookUseCaseDeps;

export async function registerBillingWebhookRoutes(app: FastifyInstance, deps: BillingWebhookRoutesDeps): Promise<void> {
  await app.register(async (instance) => {
    instance.addContentTypeParser("application/json", { parseAs: "buffer" }, (request: FastifyRequest, body: Buffer, done) => {
      request.rawBody = body;
      if (body.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body.toString("utf8")));
      } catch (error) {
        done(error as Error, undefined);
      }
    });

    instance.post(`/webhooks/billing/${deps.billingProvider.providerId}`, async (request, reply) => {
      const result = await processBillingWebhook(deps, {
        rawBody: request.rawBody ?? Buffer.alloc(0),
        signatureHeader: request.headers["stripe-signature"],
      });

      if (!result.ok) {
        // Assinatura inválida/gateway não configurado — nunca um 200 (o gateway não deveria
        // reentregar um evento com assinatura já inválida, mas se reentregar, reprocessa do zero).
        request.log.warn({ reason: result.reason }, "billing-webhook: evento rejeitado");
        return reply.code(400).send();
      }

      // Erros de PROCESSAMENTO (ex.: banco fora do ar) propagam como 500 de propósito — ao
      // contrário do webhook do Instagram DM, aqui uma reentrega do gateway é desejável (dinheiro
      // real) e é segura: `payment_webhook_events` garante que o efeito colateral nunca reaplica.
      return reply.code(200).send({ outcome: result.outcome });
    });
  });
}
