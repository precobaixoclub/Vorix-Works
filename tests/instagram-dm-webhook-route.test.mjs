import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";

/**
 * Rota do webhook de Mensageria do Instagram, via `app.inject` (app real, sem porta) — pega
 * exatamente a classe de bug que um teste de unidade da função isolada NUNCA pegaria: um crash do
 * PROCESSO inteiro causado por `reply.send()` chamado sem `return` dentro de um handler async,
 * que só se manifesta com a cadeia real de hooks do Fastify (`onSend` de
 * segurança/rate-limit/idempotência) em volta do handler — achado ao vivo em produção logo após
 * o primeiro deploy desta rota (`ERR_HTTP_HEADERS_SENT`, processo inteiro caindo e reiniciando).
 */

function buildTestApp(env = {}) {
  return buildApp({ config: loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", ...env }) });
}

test("GET /webhooks/instagram: handshake com verify_token errado responde 403 sem derrubar o processo (regressão do crash de produção)", async () => {
  const app = await buildTestApp({ META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "correct-token" });
  const response = await app.inject({ method: "GET", url: "/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc" });
  assert.equal(response.statusCode, 403);

  // Uma segunda requisição na mesma app confirma que o processo/servidor Fastify continua vivo e
  // respondendo normalmente — é exatamente isto que quebrava em produção (o processo Node caía).
  const second = await app.inject({ method: "GET", url: "/health" });
  assert.equal(second.statusCode, 200);
  await app.close();
});

test("GET /webhooks/instagram: handshake com verify_token correto ecoa o challenge como texto puro", async () => {
  const app = await buildTestApp({ META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "correct-token" });
  const response = await app.inject({ method: "GET", url: "/webhooks/instagram?hub.mode=subscribe&hub.verify_token=correct-token&hub.challenge=echo-me" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "echo-me");
  await app.close();
});

test("POST /webhooks/instagram: sem META_APP_SECRET configurado, responde 503 sem crashar", async () => {
  const app = await buildTestApp({});
  const response = await app.inject({ method: "POST", url: "/webhooks/instagram", payload: {} });
  assert.equal(response.statusCode, 503);
  const second = await app.inject({ method: "GET", url: "/health" });
  assert.equal(second.statusCode, 200);
  await app.close();
});

test("POST /webhooks/instagram: assinatura ausente/errada responde 401 sem crashar; assinatura válida responde 200", async () => {
  const appSecret = "app-secret-1";
  const app = await buildTestApp({ META_APP_SECRET: appSecret });

  const noSignature = await app.inject({ method: "POST", url: "/webhooks/instagram", payload: { object: "instagram", entry: [] } });
  assert.equal(noSignature.statusCode, 401);

  const rawBody = JSON.stringify({ object: "instagram", entry: [] });
  const validSignature = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const valid = await app.inject({ method: "POST", url: "/webhooks/instagram", payload: rawBody, headers: { "content-type": "application/json", "x-hub-signature-256": validSignature } });
  assert.equal(valid.statusCode, 200);

  const stillAlive = await app.inject({ method: "GET", url: "/health" });
  assert.equal(stillAlive.statusCode, 200);
  await app.close();
});
