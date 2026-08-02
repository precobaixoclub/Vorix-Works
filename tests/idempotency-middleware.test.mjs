import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerRequestContext } from "../dist/interfaces/api/middleware/request-context.js";
import { registerIdempotencyMiddleware } from "../dist/interfaces/api/middleware/idempotency.middleware.js";
import { InMemoryIdempotencyKeyStore } from "../dist/interfaces/api/http/idempotency-key-store.js";

/**
 * Middleware de Idempotency-Key — Release Track 1.0 (Fase 2). Testado isoladamente (app Fastify
 * mínimo, sem DI/Postgres) para cobrir exatamente o contrato do middleware: opt-in por rota,
 * replay exato por (tenant+usuário+rota+chave), nunca cacheia 5xx, ausência de header não muda
 * nada.
 */

function buildTestApp(counter) {
  const app = Fastify();
  registerRequestContext(app);
  app.addHook("onRequest", async (request) => {
    // Simula o que `auth.middleware.ts` faria de verdade — popula o principal a partir de um
    // header simples, só para o teste.
    const tenant = request.headers["x-test-tenant"];
    if (tenant) {
      request.zunoContext.principal = { userId: "user-1", tenantId: String(tenant), role: "owner", sessionId: "s1" };
    }
  });

  const store = new InMemoryIdempotencyKeyStore();
  registerIdempotencyMiddleware(app, store);

  app.post("/idempotent", { config: { idempotent: true } }, async () => {
    counter.idempotent += 1;
    return { count: counter.idempotent };
  });

  app.post("/not-idempotent", async () => {
    counter.plain += 1;
    return { count: counter.plain };
  });

  app.post("/idempotent-fails", { config: { idempotent: true } }, async (_request, reply) => {
    counter.failing += 1;
    reply.status(500);
    return { error: "boom" };
  });

  return app;
}

test("rota marcada idempotent: mesma chave -> resposta em cache, handler roda só 1 vez", async () => {
  const counter = { idempotent: 0, plain: 0, failing: 0 };
  const app = buildTestApp(counter);

  const first = await app.inject({ method: "POST", url: "/idempotent", headers: { "x-test-tenant": "tenant-a", "idempotency-key": "abc" } });
  const second = await app.inject({ method: "POST", url: "/idempotent", headers: { "x-test-tenant": "tenant-a", "idempotency-key": "abc" } });

  assert.equal(counter.idempotent, 1, "o handler real só deveria ter rodado uma vez");
  assert.deepEqual(JSON.parse(first.body), { count: 1 });
  assert.deepEqual(JSON.parse(second.body), { count: 1 }, "a segunda resposta deve ser a réplica exata da primeira");
  assert.equal(second.headers["idempotency-replayed"], "true");
  await app.close();
});

test("rota marcada idempotent: chaves diferentes -> handler roda de novo normalmente", async () => {
  const counter = { idempotent: 0, plain: 0, failing: 0 };
  const app = buildTestApp(counter);

  await app.inject({ method: "POST", url: "/idempotent", headers: { "x-test-tenant": "tenant-a", "idempotency-key": "chave-1" } });
  await app.inject({ method: "POST", url: "/idempotent", headers: { "x-test-tenant": "tenant-a", "idempotency-key": "chave-2" } });

  assert.equal(counter.idempotent, 2);
  await app.close();
});

test("rota marcada idempotent: mesma chave, tenants diferentes -> nunca reaproveita a resposta de outro tenant", async () => {
  const counter = { idempotent: 0, plain: 0, failing: 0 };
  const app = buildTestApp(counter);

  await app.inject({ method: "POST", url: "/idempotent", headers: { "x-test-tenant": "tenant-a", "idempotency-key": "mesma-chave" } });
  await app.inject({ method: "POST", url: "/idempotent", headers: { "x-test-tenant": "tenant-b", "idempotency-key": "mesma-chave" } });

  assert.equal(counter.idempotent, 2, "tenants diferentes com a mesma chave nunca podem compartilhar cache");
  await app.close();
});

test("rota SEM opt-in: header Idempotency-Key é ignorado, handler sempre roda", async () => {
  const counter = { idempotent: 0, plain: 0, failing: 0 };
  const app = buildTestApp(counter);

  await app.inject({ method: "POST", url: "/not-idempotent", headers: { "x-test-tenant": "tenant-a", "idempotency-key": "abc" } });
  await app.inject({ method: "POST", url: "/not-idempotent", headers: { "x-test-tenant": "tenant-a", "idempotency-key": "abc" } });

  assert.equal(counter.plain, 2, "rota não marcada como idempotent nunca deveria cachear nada");
  await app.close();
});

test("requisição sem header Idempotency-Key numa rota idempotent: comportamento normal (handler roda sempre)", async () => {
  const counter = { idempotent: 0, plain: 0, failing: 0 };
  const app = buildTestApp(counter);

  await app.inject({ method: "POST", url: "/idempotent", headers: { "x-test-tenant": "tenant-a" } });
  await app.inject({ method: "POST", url: "/idempotent", headers: { "x-test-tenant": "tenant-a" } });

  assert.equal(counter.idempotent, 2, "sem header, a ausência de chave nunca pode bloquear ou alterar o comportamento existente");
  await app.close();
});

test("resposta 5xx nunca é cacheada — próxima tentativa com a mesma chave roda o handler de novo", async () => {
  const counter = { idempotent: 0, plain: 0, failing: 0 };
  const app = buildTestApp(counter);

  const first = await app.inject({ method: "POST", url: "/idempotent-fails", headers: { "x-test-tenant": "tenant-a", "idempotency-key": "retry-me" } });
  const second = await app.inject({ method: "POST", url: "/idempotent-fails", headers: { "x-test-tenant": "tenant-a", "idempotency-key": "retry-me" } });

  assert.equal(first.statusCode, 500);
  assert.equal(second.statusCode, 500);
  assert.equal(counter.failing, 2, "um erro de servidor nunca deveria travar o cliente num retry eterno do mesmo erro");
  await app.close();
});
