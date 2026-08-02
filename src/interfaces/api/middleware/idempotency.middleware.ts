import type { FastifyInstance, FastifyRequest } from "fastify";
import { InMemoryIdempotencyKeyStore } from "../http/idempotency-key-store.js";

/**
 * Middleware de `Idempotency-Key` — Release Track 1.0 (Fase 2). Opt-in por rota via
 * `{ config: { idempotent: true } }` no registro do `app.post(...)` — nunca global, para não
 * cachear acidentalmente uma rota que já tem sua própria idempotência de domínio (Execution/
 * Publication) ou uma rota de leitura. Quando o cliente envia o header `Idempotency-Key` numa rota
 * marcada, uma repetição exata (mesmo tenant + mesma rota + mesma chave) devolve a resposta já
 * computada em vez de rodar o handler de novo — protege contra duplo efeito por retry de rede.
 * Ausência do header nunca bloqueia a requisição — o comportamento sem a chave é idêntico ao de
 * antes desta sprint.
 */
export function registerIdempotencyMiddleware(app: FastifyInstance, store: InMemoryIdempotencyKeyStore = new InMemoryIdempotencyKeyStore()): void {
  function cacheKeyFor(request: FastifyRequest, idempotencyKey: string): string {
    // Inclui tenantId E userId (nunca só tenantId) — duas pessoas diferentes do MESMO tenant que
    // coincidentemente reusassem a mesma chave de idempotência nunca podem receber a resposta uma
    // da outra. Requisição sem principal resolvido (autenticação falhou) nunca reaproveita cache
    // de uma requisição autenticada anterior — cai num bucket "anon" que nenhuma chamada
    // autenticada bem-sucedida jamais escreve.
    const principal = request.zunoContext?.principal;
    const actor = principal ? `${principal.tenantId}:${principal.userId}` : "anon";
    const routePath = request.routeOptions?.url ?? request.url;
    return `${actor}:${routePath}:${idempotencyKey}`;
  }

  app.addHook("preHandler", async (request, reply) => {
    const config = request.routeOptions?.config as { idempotent?: boolean } | undefined;
    if (!config?.idempotent) return;

    const header = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(header) ? header[0] : header;
    if (!idempotencyKey) return;

    const cached = store.get(cacheKeyFor(request, idempotencyKey));
    if (cached) {
      reply.header("Idempotency-Replayed", "true");
      reply.status(cached.statusCode);
      reply.send(cached.body);
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const config = request.routeOptions?.config as { idempotent?: boolean } | undefined;
    if (!config?.idempotent) return payload;

    const header = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(header) ? header[0] : header;
    if (!idempotencyKey) return payload;
    // Nunca cacheia erro de servidor (5xx) — um retry depois de uma falha de infraestrutura deve
    // poder tentar de novo de verdade, não receber o mesmo erro eternamente até o TTL expirar.
    if (reply.statusCode >= 500) return payload;

    let body: unknown = payload;
    if (typeof payload === "string") {
      try {
        body = JSON.parse(payload);
      } catch {
        body = payload;
      }
    }

    store.set(cacheKeyFor(request, idempotencyKey), { statusCode: reply.statusCode, body, createdAt: Date.now() });
    return payload;
  });
}
