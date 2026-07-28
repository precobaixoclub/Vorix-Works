import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { AppError, NotFoundError, ValidationError, UnauthorizedError, NotImplementedError } from "../dist/interfaces/api/http/app-error.js";
import { successEnvelope, errorEnvelope } from "../dist/interfaces/api/http/response-envelope.js";
import { NoopAuthAdapter } from "../dist/infrastructure/auth/noop-auth-adapter.js";

// ---------------------------------------------------------------------------------------------
// api-config
// ---------------------------------------------------------------------------------------------

test("loadApiConfig: usa padrões seguros quando nenhuma variável de ambiente está definida", () => {
  const config = loadApiConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.jwtSecret, undefined);
  assert.equal(config.databaseUrl, undefined);
  assert.equal(config.logLevel, "info");
});

test("loadApiConfig: respeita variáveis de ambiente válidas", () => {
  const config = loadApiConfig({ API_PORT: "8080", API_HOST: "127.0.0.1", ZUNO_LOG_LEVEL: "debug", JWT_SECRET: "x", DATABASE_URL: "postgres://x" });
  assert.equal(config.port, 8080);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.logLevel, "debug");
  assert.equal(config.jwtSecret, "x");
  assert.equal(config.databaseUrl, "postgres://x");
});

test("loadApiConfig: ignora porta inválida e cai no padrão", () => {
  for (const invalid of ["0", "-1", "abc", "99999999"]) {
    const config = loadApiConfig({ API_PORT: invalid });
    assert.equal(config.port, 3000, `porta ${invalid} deveria cair no padrão`);
  }
});

// ---------------------------------------------------------------------------------------------
// AppError e subclasses
// ---------------------------------------------------------------------------------------------

test("AppError: subclasses têm o statusCode/code corretos", () => {
  assert.equal(new NotFoundError().statusCode, 404);
  assert.equal(new NotFoundError().code, "NOT_FOUND");
  assert.equal(new ValidationError().statusCode, 400);
  assert.equal(new ValidationError().code, "VALIDATION_ERROR");
  assert.equal(new UnauthorizedError().statusCode, 401);
  assert.equal(new UnauthorizedError().code, "UNAUTHORIZED");
  assert.equal(new NotImplementedError().statusCode, 501);
  assert.equal(new NotImplementedError().code, "NOT_IMPLEMENTED");
  assert.ok(new NotFoundError() instanceof AppError);
});

// ---------------------------------------------------------------------------------------------
// Envelope de resposta
// ---------------------------------------------------------------------------------------------

test("successEnvelope / errorEnvelope: formato consistente", () => {
  assert.deepEqual(successEnvelope({ a: 1 }), { ok: true, data: { a: 1 } });
  assert.deepEqual(successEnvelope({ a: 1 }, "req-1"), { ok: true, data: { a: 1 }, meta: { requestId: "req-1" } });
  const err = errorEnvelope({ code: "X", message: "y", recoverable: true }, "req-2");
  assert.deepEqual(err, { ok: false, error: { code: "X", message: "y", recoverable: true }, meta: { requestId: "req-2" } });
});

// ---------------------------------------------------------------------------------------------
// NoopAuthAdapter
// ---------------------------------------------------------------------------------------------

test("NoopAuthAdapter: nunca autentica, independente do token", async () => {
  const adapter = new NoopAuthAdapter();
  const withToken = await adapter.verifyToken("qualquer-coisa");
  const withoutToken = await adapter.verifyToken(undefined);
  assert.deepEqual(withToken, { authenticated: false, reason: "not_implemented" });
  assert.deepEqual(withoutToken, { authenticated: false, reason: "not_implemented" });
});

// ---------------------------------------------------------------------------------------------
// App Fastify — via app.inject, nunca abre porta real
// ---------------------------------------------------------------------------------------------

test("GET /health responde 200 com envelope de sucesso", async () => {
  const app = await buildApp({ config: loadApiConfig({ ZUNO_LOG_LEVEL: "silent" }) });
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.status, "ok");
  await app.close();
});

test("GET /v1/health responde 200 com status/uptime/version", async () => {
  const app = await buildApp({ config: loadApiConfig({ ZUNO_LOG_LEVEL: "silent" }) });
  const response = await app.inject({ method: "GET", url: "/v1/health" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.status, "ok");
  assert.equal(body.data.version, "v1");
  assert.ok(typeof body.data.uptimeSeconds === "number");
  await app.close();
});

test("Rota inexistente responde 404 com envelope de erro padrão (nunca um corpo solto do Fastify)", async () => {
  const app = await buildApp({ config: loadApiConfig({ ZUNO_LOG_LEVEL: "silent" }) });
  const response = await app.inject({ method: "GET", url: "/v1/isso-nao-existe" });
  assert.equal(response.statusCode, 404);
  const body = response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "ROUTE_NOT_FOUND");
  await app.close();
});

test("Requisição sem Authorization continua funcionando (autenticação nunca bloqueia nesta sprint)", async () => {
  const app = await buildApp({ config: loadApiConfig({ ZUNO_LOG_LEVEL: "silent" }) });
  const withAuthHeader = await app.inject({ method: "GET", url: "/health", headers: { authorization: "Bearer qualquer-token-invalido" } });
  const withoutAuthHeader = await app.inject({ method: "GET", url: "/health" });
  assert.equal(withAuthHeader.statusCode, 200);
  assert.equal(withoutAuthHeader.statusCode, 200);
  await app.close();
});

test("Cada requisição recebe um requestId único (rastreável em log/erro)", async () => {
  const app = await buildApp({ config: loadApiConfig({ ZUNO_LOG_LEVEL: "silent" }) });
  const a = await app.inject({ method: "GET", url: "/health" });
  const b = await app.inject({ method: "GET", url: "/health" });
  assert.notEqual(a.headers["x-request-id"] ?? a.json().meta, b.headers["x-request-id"] ?? b.json().meta);
  await app.close();
});

test("buildApp aceita um container customizado (composição substituível para testes futuros)", async () => {
  let called = 0;
  const fakeAuthPort = {
    async verifyToken() {
      called += 1;
      return { authenticated: false, reason: "not_implemented" };
    },
  };
  const app = await buildApp({ config: loadApiConfig({ ZUNO_LOG_LEVEL: "silent" }), container: { authPort: fakeAuthPort } });
  await app.inject({ method: "GET", url: "/health" });
  assert.equal(called, 1);
  await app.close();
});
