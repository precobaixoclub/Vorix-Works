import type { FastifyInstance, FastifyRequest } from "fastify";
import { verifyMetaWebhookSignature } from "../../../infrastructure/meta/meta-webhook-signature-verifier.js";
import { receiveInstagramDmWebhook, type ReceiveInstagramDmWebhookDeps } from "../../../application/instagram-dm/receive-instagram-dm-webhook.js";

/**
 * Webhook de Mensageria do Instagram (Meta) — módulo Instagram DM Automation, Fase 5.
 *
 * FORA do namespace autenticado `/v1` — a Meta chama isto diretamente, sem sessão Vorix nenhuma.
 * A segurança vem inteiramente da verificação de assinatura (`verifyMetaWebhookSignature`), nunca
 * de `requirePermission`.
 *
 * Registrado dentro do PRÓPRIO contexto de encapsulamento do Fastify (`app.register(async
 * (instance) => ...)`) pra que o content-type parser que preserva o corpo cru (`rawBody`) NUNCA
 * vaze pro resto da aplicação — um parser assim registrado direto no `app` top-level substituiria
 * o parsing JSON padrão de TODA rota, quebrando silenciosamente o resto da API.
 */
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export type InstagramDmWebhookRoutesDeps = ReceiveInstagramDmWebhookDeps & {
  appSecret?: string;
  webhookVerifyToken?: string;
};

const VERIFY_QUERY_SCHEMA = {
  type: "object",
  properties: {
    "hub.mode": { type: "string" },
    "hub.verify_token": { type: "string" },
    "hub.challenge": { type: "string" },
  },
} as const;

export async function registerInstagramDmWebhookRoutes(app: FastifyInstance, deps: InstagramDmWebhookRoutesDeps): Promise<void> {
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

    // Handshake de assinatura do webhook (uma vez, ao configurar a assinatura no App Dashboard) —
    // a Meta manda `hub.mode=subscribe`+`hub.verify_token`, espera o `hub.challenge` ecoado de
    // volta como texto puro se o token bater.
    instance.get("/webhooks/instagram", { schema: { querystring: VERIFY_QUERY_SCHEMA } }, async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const mode = query["hub.mode"];
      const token = query["hub.verify_token"];
      const challenge = query["hub.challenge"];
      if (mode === "subscribe" && deps.webhookVerifyToken && token === deps.webhookVerifyToken && challenge) {
        reply.code(200).type("text/plain").send(challenge);
        return;
      }
      reply.code(403).send();
    });

    instance.post("/webhooks/instagram", async (request, reply) => {
      if (!deps.appSecret) {
        reply.code(503).send();
        return;
      }
      const valid = verifyMetaWebhookSignature({ appSecret: deps.appSecret, rawBody: request.rawBody ?? Buffer.alloc(0), signatureHeader: request.headers["x-hub-signature-256"] });
      if (!valid) {
        reply.code(401).send();
        return;
      }

      // A Meta exige um 200 rápido (retenta com backoff se não receber); processar tudo aqui
      // dentro é aceitável porque o trabalho por evento é pequeno (poucos INSERTs + no máximo UMA
      // chamada de Graph API pra automação) — nunca uma fila separada só pra isto, ainda.
      try {
        await receiveInstagramDmWebhook(deps, request.body);
      } catch (error) {
        // Nunca deixa uma falha de processamento virar um não-200 pra Meta — isso faria a Meta
        // reentregar o MESMO evento repetidamente. O erro já foi contido dentro de
        // `receiveInstagramDmWebhook` por entry/mensagem; um erro escapando daqui é inesperado o
        // bastante pra só logar, nunca travar o ack.
        request.log.error({ err: error }, "instagram-dm-webhook: falha ao processar evento");
      }
      reply.code(200).send();
    });
  });
}
