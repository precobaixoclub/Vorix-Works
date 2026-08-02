import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";

/**
 * Headers de segurança HTTP — Release Track 1.0 (Fase 3), achado da Sprint 24. `PERSISTENCE_DRIVER`
 * fica no padrão "memory" (não configurado aqui) — não precisa de Postgres para verificar headers.
 */

test("headers de segurança: presentes em toda resposta, inclusive erro (404)", async () => {
  const app = await buildApp({ config: loadApiConfig({ AUTH_MODE: "noop" }) });
  const ok = await app.inject({ method: "GET", url: "/health" });
  const notFound = await app.inject({ method: "GET", url: "/rota-que-nao-existe" });

  for (const response of [ok, notFound]) {
    assert.equal(response.headers["content-security-policy"], "default-src 'none'; frame-ancestors 'none'");
    assert.equal(response.headers["x-frame-options"], "DENY");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["referrer-policy"], "no-referrer");
    assert.equal(response.headers["permissions-policy"], "geolocation=(), camera=(), microphone=(), payment=(), usb=()");
  }
  await app.close();
});

test("headers de segurança: Strict-Transport-Security ausente quando COOKIE_SECURE não está ligado (dev local)", async () => {
  const app = await buildApp({ config: loadApiConfig({ AUTH_MODE: "noop", COOKIE_SECURE: "false" }) });
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.headers["strict-transport-security"], undefined);
  await app.close();
});

test("headers de segurança: Strict-Transport-Security presente quando COOKIE_SECURE=true (ambiente servido via HTTPS)", async () => {
  const app = await buildApp({ config: loadApiConfig({ AUTH_MODE: "noop", COOKIE_SECURE: "true" }) });
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.headers["strict-transport-security"], "max-age=63072000; includeSubDomains");
  await app.close();
});
