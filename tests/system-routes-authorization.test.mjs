import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { PERMISSIONS, ROLE_PERMISSIONS, TENANT_ROLES, effectivePermissions } from "../dist/domain/identity/identity.model.js";

/**
 * Segurança — `/v1/system/*` é operação da PLATAFORMA (cofre de segredos, trava de produção, plano de
 * backup, estado global de saúde). Antes, `system:operate` vinha por padrão nos papéis owner/admin de
 * qualquer empresa cliente. Agora só o administrador global (`isPlatformAdmin`) entra.
 * Ambiente 100% simulado (AUTH_MODE=noop, memória); logs silenciosos — nada sensível é impresso.
 */

const GET_ROUTES = [
  "/v1/system/health",
  "/v1/system/readiness",
  "/v1/system/circuit-breakers",
  "/v1/system/rate-limits",
  "/v1/system/backpressure",
  "/v1/system/queues",
  "/v1/system/secrets/health",
  "/v1/system/release-gate",
  "/v1/system/slo",
  "/v1/system/audit",
  "/v1/system/backup-restore",
];
const POST_ROUTES = [
  { url: "/v1/system/circuit-breakers/breaker-inexistente/reset", payload: undefined },
  { url: "/v1/system/recovery/run", payload: {} },
];

function config(env = {}) {
  return loadApiConfig({ AUTH_MODE: "noop", ZUNO_LOG_LEVEL: "silent", ...env });
}
const principal = (role, platformAdmin = false) => ({ DEV_PRINCIPAL_TENANT_ID: "tenant-sec", DEV_PRINCIPAL_USER_ID: `user-${role}`, DEV_PRINCIPAL_ROLE: role, ...(platformAdmin ? { DEV_PRINCIPAL_PLATFORM_ADMIN: "true" } : {}) });

async function hitAll(app, suffix = "") {
  const results = [];
  for (const url of GET_ROUTES) results.push({ url, response: await app.inject({ method: "GET", url: `${url}${suffix}` }) });
  for (const route of POST_ROUTES) results.push({ url: route.url, response: await app.inject({ method: "POST", url: `${route.url}${suffix}`, ...(route.payload ? { payload: route.payload } : {}) }) });
  return results;
}

test("sem autenticação: todas as rotas /v1/system respondem 401", async () => {
  const app = await buildApp({ config: config() });
  try {
    for (const { url, response } of await hitAll(app)) assert.equal(response.statusCode, 401, url);
  } finally {
    await app.close();
  }
});

for (const role of ["viewer", "editor", "admin", "owner"]) {
  test(`papel de empresa "${role}" (sem ser admin da plataforma): 403 em todas as rotas, sem vazar nada`, async () => {
    const app = await buildApp({ config: config(principal(role)) });
    try {
      for (const { url, response } of await hitAll(app)) {
        assert.equal(response.statusCode, 403, `${role} ${url}`);
        const body = response.body;
        // A negativa não traz estado da plataforma (segredos, canário, backup, filas).
        for (const leak of ["provider", "canary", "productionEnabled", "localJobs", "backup", "restore"]) assert.equal(body.includes(leak), false, `${role} ${url} vazou "${leak}"`);
      }
    } finally {
      await app.close();
    }
  });
}

test("workspace na query não muda o privilégio: no próprio workspace 403; em workspace alheio 404 — nunca dados", async () => {
  const app = await buildApp({ config: config(principal("owner")) });
  try {
    const created = await app.inject({ method: "POST", url: "/v1/workspaces", payload: { name: "Empresa QA" } });
    const ownWorkspaceId = created.json().data.id;
    assert.ok(ownWorkspaceId);
    for (const { url, response } of await hitAll(app, `?workspaceId=${encodeURIComponent(ownWorkspaceId)}`)) assert.equal(response.statusCode, 403, url);
    // Workspace de outro tenant: o guarda de workspace nega antes (404), sem revelar nada.
    for (const { url, response } of await hitAll(app, "?workspaceId=workspace-de-outro-tenant")) {
      assert.equal(response.statusCode, 404, url);
      assert.equal(response.json().error.code, "NOT_FOUND", url);
    }
  } finally {
    await app.close();
  }
});

test("administrador global da plataforma: acesso permitido (escopo por tenant preservado)", async () => {
  const app = await buildApp({ config: config(principal("owner", true)) });
  try {
    for (const url of GET_ROUTES) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 200, url);
    }
    // Autorizado, mas o breaker não existe: 404 (não 403) — a regra de negócio segue valendo.
    const reset = await app.inject({ method: "POST", url: "/v1/system/circuit-breakers/breaker-inexistente/reset" });
    assert.equal(reset.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("operações legítimas do workspace continuam funcionando para o dono da empresa", async () => {
  const app = await buildApp({ config: config(principal("owner")) });
  try {
    const workspaces = await app.inject({ method: "GET", url: "/v1/workspaces" });
    assert.equal(workspaces.statusCode, 200);
    const created = await app.inject({ method: "POST", url: "/v1/workspaces", payload: { name: "Empresa QA" } });
    assert.ok([200, 201].includes(created.statusCode), `criar workspace: ${created.statusCode}`);
  } finally {
    await app.close();
  }
});

test("/v1/admin continua protegido no servidor: dono de empresa recebe 403", async () => {
  const app = await buildApp({ config: config(principal("owner")) });
  try {
    // Rotas /v1/admin registradas no modo em memória (as demais exigem banco).
    for (const url of ["/v1/admin/social-providers", "/v1/admin/creative-engine-entitlements", "/v1/admin/tenants/tenant-sec/solutions"]) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 403, url);
    }
  } finally {
    await app.close();
  }
});

test("system:operate não existe mais: nenhum papel a recebe e concessão antiga é ignorada", () => {
  assert.equal(PERMISSIONS.includes("system:operate"), false);
  for (const role of TENANT_ROLES) {
    assert.equal(ROLE_PERMISSIONS[role].includes("system:operate"), false, role);
    assert.equal(effectivePermissions(role, ["system:operate"]).includes("system:operate"), false, role);
  }
});
