import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../dist/interfaces/api/app.js";
import { InMemoryWorkspaceRepository } from "../dist/infrastructure/storage/in-memory-workspace-repository.js";

/**
 * `TestTokenAuthPort` — mesma ideia de um Bearer token real (Sprint 04), mas o "token" É o
 * tenantId em texto puro. Permite testar isolamento entre tenants de verdade pela API (duas
 * requisições, dois tokens, MESMO container/repositório compartilhado) sem esperar autenticação
 * real existir — o container customizado é o mesmo ponto de extensão já usado em
 * `api-foundation.test.mjs` ("buildApp aceita um container customizado").
 */
class TestTokenAuthPort {
  async verifyToken(token) {
    if (!token) return { authenticated: false, reason: "missing_token" };
    return { authenticated: true, principal: { userId: "test-user", tenantId: token } };
  }
}

function buildTestApp() {
  const workspaceRepository = new InMemoryWorkspaceRepository();
  return buildApp({ container: { authPort: new TestTokenAuthPort(), workspaceRepository } });
}

function authHeader(tenantId) {
  return { authorization: `Bearer ${tenantId}` };
}

// ---------------------------------------------------------------------------------------------
// GET /version
// ---------------------------------------------------------------------------------------------

test("GET /version: contrato de saída (apiVersion + packageVersion)", async () => {
  const app = await buildTestApp();
  const response = await app.inject({ method: "GET", url: "/version" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.apiVersion, "v1");
  assert.equal(typeof body.data.packageVersion, "string");
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// POST /v1/workspaces
// ---------------------------------------------------------------------------------------------

test("POST /v1/workspaces: fluxo válido responde 201 com o contrato completo", async () => {
  const app = await buildTestApp();
  const response = await app.inject({ method: "POST", url: "/v1/workspaces", headers: authHeader("tenant-a"), payload: { name: "Rumo ao Altar" } });
  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.tenantId, "tenant-a");
  assert.equal(body.data.name, "Rumo ao Altar");
  assert.equal(body.data.status, "active");
  assert.ok(body.data.id);
  assert.ok(body.data.createdAt);
  await app.close();
});

test("POST /v1/workspaces: sem name responde 400 com envelope de erro de validação", async () => {
  const app = await buildTestApp();
  const response = await app.inject({ method: "POST", url: "/v1/workspaces", headers: authHeader("tenant-a"), payload: {} });
  assert.equal(response.statusCode, 400);
  const body = response.json();
  assert.equal(body.ok, false);
  assert.equal(typeof body.error.code, "string");
  await app.close();
});

test("POST /v1/workspaces: sem Authorization responde 401", async () => {
  const app = await buildTestApp();
  const response = await app.inject({ method: "POST", url: "/v1/workspaces", payload: { name: "X" } });
  assert.equal(response.statusCode, 401);
  const body = response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
  await app.close();
});

test("POST /v1/workspaces: tenantId enviado no corpo é ignorado — vem sempre do token", async () => {
  const app = await buildTestApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces",
    headers: authHeader("tenant-a"),
    payload: { name: "X", tenantId: "tenant-hackeado" },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().data.tenantId, "tenant-a");
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// GET /v1/workspaces/:id, PATCH /v1/workspaces/:id
// ---------------------------------------------------------------------------------------------

test("GET /v1/workspaces/:id: 404 com envelope de erro para id inexistente", async () => {
  const app = await buildTestApp();
  const response = await app.inject({ method: "GET", url: "/v1/workspaces/nao-existe", headers: authHeader("tenant-a") });
  assert.equal(response.statusCode, 404);
  const body = response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "NOT_FOUND");
  assert.equal(body.error.stack, undefined);
  await app.close();
});

test("PATCH /v1/workspaces/:id: altera name, mas ignora id/tenantId/createdAt enviados no corpo", async () => {
  const app = await buildTestApp();
  const created = (
    await app.inject({ method: "POST", url: "/v1/workspaces", headers: authHeader("tenant-a"), payload: { name: "Original" } })
  ).json().data;

  const response = await app.inject({
    method: "PATCH",
    url: `/v1/workspaces/${created.id}`,
    headers: authHeader("tenant-a"),
    payload: { name: "Atualizado", id: "outro-id", tenantId: "outro-tenant", createdAt: "2000-01-01T00:00:00.000Z" },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json().data;
  assert.equal(body.id, created.id);
  assert.equal(body.tenantId, "tenant-a");
  assert.equal(body.createdAt, created.createdAt);
  assert.equal(body.name, "Atualizado");
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// Transições — POST /v1/workspaces/:id/activate|deactivate|archive
// ---------------------------------------------------------------------------------------------

test("POST /v1/workspaces/:id/deactivate + /activate: fluxo válido", async () => {
  const app = await buildTestApp();
  const created = (
    await app.inject({ method: "POST", url: "/v1/workspaces", headers: authHeader("tenant-a"), payload: { name: "X" } })
  ).json().data;

  const deactivated = await app.inject({ method: "POST", url: `/v1/workspaces/${created.id}/deactivate`, headers: authHeader("tenant-a") });
  assert.equal(deactivated.statusCode, 200);
  assert.equal(deactivated.json().data.status, "inactive");

  const activated = await app.inject({ method: "POST", url: `/v1/workspaces/${created.id}/activate`, headers: authHeader("tenant-a") });
  assert.equal(activated.statusCode, 200);
  assert.equal(activated.json().data.status, "active");
  await app.close();
});

test("POST /v1/workspaces/:id/activate: transição inválida responde 409 CONFLICT", async () => {
  const app = await buildTestApp();
  const created = (
    await app.inject({ method: "POST", url: "/v1/workspaces", headers: authHeader("tenant-a"), payload: { name: "X" } })
  ).json().data;

  const response = await app.inject({ method: "POST", url: `/v1/workspaces/${created.id}/activate`, headers: authHeader("tenant-a") });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "CONFLICT");
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// Isolamento por tenant
// ---------------------------------------------------------------------------------------------

test("Isolamento por tenant: GET/PATCH/activate de tenant B sobre workspace do tenant A respondem 404", async () => {
  const app = await buildTestApp();
  const created = (
    await app.inject({ method: "POST", url: "/v1/workspaces", headers: authHeader("tenant-a"), payload: { name: "Segredo do A" } })
  ).json().data;

  const get = await app.inject({ method: "GET", url: `/v1/workspaces/${created.id}`, headers: authHeader("tenant-b") });
  assert.equal(get.statusCode, 404);

  const patch = await app.inject({
    method: "PATCH",
    url: `/v1/workspaces/${created.id}`,
    headers: authHeader("tenant-b"),
    payload: { name: "hackeado" },
  });
  assert.equal(patch.statusCode, 404);

  const activate = await app.inject({ method: "POST", url: `/v1/workspaces/${created.id}/deactivate`, headers: authHeader("tenant-b") });
  assert.equal(activate.statusCode, 404);

  const stillIntact = await app.inject({ method: "GET", url: `/v1/workspaces/${created.id}`, headers: authHeader("tenant-a") });
  assert.equal(stillIntact.json().data.name, "Segredo do A");
  assert.equal(stillIntact.json().data.status, "active");
  await app.close();
});

test("Isolamento por tenant: GET /v1/workspaces só lista workspaces do tenant autenticado", async () => {
  const app = await buildTestApp();
  await app.inject({ method: "POST", url: "/v1/workspaces", headers: authHeader("tenant-a"), payload: { name: "A1" } });
  await app.inject({ method: "POST", url: "/v1/workspaces", headers: authHeader("tenant-b"), payload: { name: "B1" } });

  const listA = await app.inject({ method: "GET", url: "/v1/workspaces", headers: authHeader("tenant-a") });
  const bodyA = listA.json().data;
  assert.equal(bodyA.length, 1);
  assert.equal(bodyA[0].name, "A1");
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// Erros globais — nunca vaza stack/detalhe interno
// ---------------------------------------------------------------------------------------------

test("Erro global: envelope de erro nunca contém stack trace", async () => {
  const app = await buildTestApp();
  const response = await app.inject({ method: "GET", url: "/v1/rota-que-nao-existe" });
  assert.equal(response.statusCode, 404);
  const raw = response.payload;
  assert.ok(!raw.includes("at ") && !raw.includes(".js:"), "resposta não deve conter fragmentos de stack trace");
  await app.close();
});
