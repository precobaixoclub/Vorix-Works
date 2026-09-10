import { test } from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { isPrincipalAuthorizedForRequest } from "../dist/interfaces/api/middleware/auth.middleware.js";
import { JsonWebTokenJwtAdapter } from "../dist/infrastructure/auth/jsonwebtoken-jwt-adapter.js";
import { JwtAuthAdapter } from "../dist/infrastructure/auth/jwt-auth-adapter.js";

/**
 * Fase 10 (Pre-Pilot Hardening) — fecha os riscos residuais documentados em
 * `docs/vorix-visual-qa-producao-fechamento.md`: (1) `GET /v1/inbox/status` sempre disponível,
 * nunca 404, mesmo com o módulo desligado; (2) o access token de sessão nunca mais autentica via
 * querystring — só um token de curtíssima duração e escopo único (`purpose: "inbox_stream"`,
 * emitido por `POST /v1/inbox/stream-token`), e só na própria rota de stream.
 *
 * Usa um `JsonWebTokenJwtAdapter` REAL (não o `fakeAuthPortFor` das outras suítes de Inbox) —
 * testar assinatura/expiração/purpose de verdade exige um JWT de verdade, não um dublê que
 * autentica sem olhar o token.
 */

const TEST_SECRET = "test-secret-fase10-pre-pilot-hardening";

function testJwtPort() {
  return new JsonWebTokenJwtAdapter(TEST_SECRET);
}

async function buildRealJwtTestApp({ conversationsModuleEnabled }) {
  const jwt = testJwtPort();
  const config = loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", CONVERSATIONS_MODULE_ENABLED: String(conversationsModuleEnabled) });
  const app = await buildApp({
    config,
    // `app.js` registra um hook `onClose` que chama `container.identity.pool.end()` sempre que
    // `container.identity` existe — precisa de um pool (mesmo que fake/no-op) pra não quebrar o
    // `app.close()` no fim de cada teste; nenhum destes testes toca Postgres de verdade.
    container: { authPort: new JwtAuthAdapter(jwt), identity: { jwt, pool: { end: async () => {} } } },
  });
  return { app, jwt };
}

function accessPayload({ tenantId = "tenant-hardening", role = "admin", userId = "user-hardening" } = {}) {
  return { userId, tenantId, role, sessionId: "session-hardening", isPlatformAdmin: false };
}

// ------------------------------------------------------------------------------------------
// GET /inbox/status — sempre disponível
// ------------------------------------------------------------------------------------------

test("GET /v1/inbox/status responde 200 com enabled:true quando o módulo está ligado", async () => {
  const { app, jwt } = await buildRealJwtTestApp({ conversationsModuleEnabled: true });
  const token = jwt.sign(accessPayload(), 3600);
  const response = await app.inject({ method: "GET", url: "/v1/inbox/status", headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).data.enabled, true);
  await app.close();
});

test("GET /v1/inbox/status responde 200 com enabled:false quando o módulo está desligado — NUNCA 404", async () => {
  const { app, jwt } = await buildRealJwtTestApp({ conversationsModuleEnabled: false });
  const token = jwt.sign(accessPayload(), 3600);
  const response = await app.inject({ method: "GET", url: "/v1/inbox/status", headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200, "o sinal de feature flag precisa existir mesmo com o módulo desligado, nunca 404");
  assert.equal(JSON.parse(response.body).data.enabled, false);

  // Confirma que o resto de /v1/inbox/* continua genuinamente ausente (comportamento antigo,
  // preservado) — só /status é a exceção deliberada.
  const conversations = await app.inject({ method: "GET", url: "/v1/inbox/conversations?workspaceId=ws-1", headers: { authorization: `Bearer ${token}` } });
  assert.equal(conversations.statusCode, 404);
  await app.close();
});

test("GET /v1/inbox/status exige autenticação (401 sem token)", async () => {
  const { app } = await buildRealJwtTestApp({ conversationsModuleEnabled: false });
  const response = await app.inject({ method: "GET", url: "/v1/inbox/status" });
  assert.equal(response.statusCode, 401);
  await app.close();
});

// ------------------------------------------------------------------------------------------
// POST /inbox/stream-token — mint do token de curta duração
// ------------------------------------------------------------------------------------------

test("POST /v1/inbox/stream-token emite um token de escopo único, autenticado normalmente por header", async () => {
  const { app, jwt } = await buildRealJwtTestApp({ conversationsModuleEnabled: true });
  const accessToken = jwt.sign(accessPayload(), 3600);
  const response = await app.inject({ method: "POST", url: "/v1/inbox/stream-token", headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body).data;
  assert.ok(typeof body.streamToken === "string" && body.streamToken.length > 0);
  assert.equal(body.expiresIn, 60);

  const verified = jwt.verify(body.streamToken);
  assert.equal(verified.valid, true);
  assert.equal(verified.payload.purpose, "inbox_stream", "o token emitido precisa carregar purpose=inbox_stream");
  assert.equal(verified.payload.tenantId, "tenant-hardening");
  await app.close();
});

test("POST /v1/inbox/stream-token exige autenticação (401 sem token)", async () => {
  const { app } = await buildRealJwtTestApp({ conversationsModuleEnabled: true });
  const response = await app.inject({ method: "POST", url: "/v1/inbox/stream-token" });
  assert.equal(response.statusCode, 401);
  await app.close();
});

// ------------------------------------------------------------------------------------------
// GET /inbox/stream — o access token normal NUNCA mais autentica via querystring
// ------------------------------------------------------------------------------------------

test("GET /v1/inbox/stream com o access token NORMAL na querystring (?stream_token=) é rejeitado — nunca mais aceita o token de sessão ali", async () => {
  const { app, jwt } = await buildRealJwtTestApp({ conversationsModuleEnabled: true });
  const accessToken = jwt.sign(accessPayload(), 3600); // sem purpose — token de sessão normal
  const response = await app.inject({ method: "GET", url: `/v1/inbox/stream?workspaceId=ws-1&stream_token=${accessToken}` });
  assert.equal(response.statusCode, 401, "access token normal na querystring precisa ser recusado, mesmo na rota de stream");
  await app.close();
});

test("GET /v1/inbox/stream com um stream_token EXPIRADO é rejeitado", async () => {
  const { app, jwt } = await buildRealJwtTestApp({ conversationsModuleEnabled: true });
  const expiredStreamToken = jwt.sign({ ...accessPayload(), purpose: "inbox_stream" }, -10); // já expirado
  const response = await app.inject({ method: "GET", url: `/v1/inbox/stream?workspaceId=ws-1&stream_token=${expiredStreamToken}` });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("GET /v1/inbox/stream sem nenhum token é rejeitado", async () => {
  const { app } = await buildRealJwtTestApp({ conversationsModuleEnabled: true });
  const response = await app.inject({ method: "GET", url: "/v1/inbox/stream?workspaceId=ws-1" });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("um stream_token válido (purpose=inbox_stream) usado via header Authorization em OUTRA rota é rejeitado — nunca autoriza mais nada além do stream", async () => {
  const { app, jwt } = await buildRealJwtTestApp({ conversationsModuleEnabled: true });
  const streamToken = jwt.sign({ ...accessPayload(), purpose: "inbox_stream" }, 60);
  const response = await app.inject({ method: "GET", url: "/v1/inbox/conversations?workspaceId=ws-1", headers: { authorization: `Bearer ${streamToken}` } });
  assert.equal(response.statusCode, 401, "um token de escopo único pra SSE nunca pode autenticar outra rota, mesmo com role admin dentro do payload");
  await app.close();
});

test("um stream_token válido usado via header Authorization NA PRÓPRIA rota de stream (em vez de querystring) também é rejeitado — só a querystring é aceita", async () => {
  const { app, jwt } = await buildRealJwtTestApp({ conversationsModuleEnabled: true });
  const streamToken = jwt.sign({ ...accessPayload(), purpose: "inbox_stream" }, 60);
  const response = await app.inject({ method: "GET", url: "/v1/inbox/stream?workspaceId=ws-1", headers: { authorization: `Bearer ${streamToken}` } });
  assert.equal(response.statusCode, 401);
  await app.close();
});

// ------------------------------------------------------------------------------------------
// isPrincipalAuthorizedForRequest — predicado puro, testado exaustivamente (mesmo racional de
// shouldDeliverInboxNotification em inbox.route.ts)
// ------------------------------------------------------------------------------------------

test("isPrincipalAuthorizedForRequest: matriz completa de decisão", () => {
  const normalPrincipal = { userId: "u1", tenantId: "t1", role: "admin", sessionId: "s1", isPlatformAdmin: false };
  const streamPrincipal = { ...normalPrincipal, purpose: "inbox_stream" };

  // Access token normal: só autentica via header, em qualquer rota.
  assert.equal(isPrincipalAuthorizedForRequest(normalPrincipal, { isStreamRoute: false, tokenSource: "header" }), true);
  assert.equal(isPrincipalAuthorizedForRequest(normalPrincipal, { isStreamRoute: true, tokenSource: "header" }), true);
  assert.equal(isPrincipalAuthorizedForRequest(normalPrincipal, { isStreamRoute: false, tokenSource: "query" }), false, "access token normal nunca mais autentica via querystring, rota nenhuma");
  assert.equal(isPrincipalAuthorizedForRequest(normalPrincipal, { isStreamRoute: true, tokenSource: "query" }), false, "nem na própria rota de stream");

  // Token de escopo único (purpose=inbox_stream): só autentica a rota de stream, só via querystring.
  assert.equal(isPrincipalAuthorizedForRequest(streamPrincipal, { isStreamRoute: true, tokenSource: "query" }), true);
  assert.equal(isPrincipalAuthorizedForRequest(streamPrincipal, { isStreamRoute: true, tokenSource: "header" }), false);
  assert.equal(isPrincipalAuthorizedForRequest(streamPrincipal, { isStreamRoute: false, tokenSource: "query" }), false);
  assert.equal(isPrincipalAuthorizedForRequest(streamPrincipal, { isStreamRoute: false, tokenSource: "header" }), false);
});
