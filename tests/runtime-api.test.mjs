import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { BcryptPasswordHasher } from "../dist/infrastructure/auth/bcrypt-password-hasher.js";
import { registerUser } from "../dist/application/identity/index.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55610 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function buildTestApp() {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-runtime-api",
    DATABASE_URL: db.connectionString,
    PERSISTENCE_DRIVER: "postgres",
    ZUNO_LOG_LEVEL: "silent",
  });
  return buildApp({ config });
}

async function seedUserAndLogin(app, { email, tenantId, role = "owner" }) {
  const userRepository = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const membershipRepository = new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") });
  await registerUser(
    { userRepository, membershipRepository, passwordHasher: new BcryptPasswordHasher() },
    { email, password: "senha-forte-123", name: "Usuária", tenantId, role },
  );
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: "senha-forte-123" } });
  return login.json().data.accessToken;
}

async function createWorkspace(app, accessToken, name = "Workspace de teste") {
  const response = await app.inject({ method: "POST", url: "/v1/workspaces", headers: { authorization: `Bearer ${accessToken}` }, payload: { name } });
  return response.json().data;
}

async function createConversation(app, accessToken, workspaceId) {
  const response = await app.inject({ method: "POST", url: "/v1/conversations", headers: { authorization: `Bearer ${accessToken}` }, payload: { workspaceId } });
  return response.json().data;
}

function sendMessage(app, accessToken, workspaceId, conversationId, content) {
  return app.inject({
    method: "POST",
    url: `/v1/conversations/${conversationId}/messages?workspaceId=${workspaceId}`,
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { content },
  });
}

async function confirmACampaign(app, accessToken, workspaceId, conversationId) {
  await sendMessage(app, accessToken, workspaceId, conversationId, "quero criar uma campanha para vender tênis novo");
  await sendMessage(app, accessToken, workspaceId, conversationId, "tênis de corrida modelo Speed X");
  await sendMessage(app, accessToken, workspaceId, conversationId, "instagram");
  await sendMessage(app, accessToken, workspaceId, conversationId, "jovens de 18 a 25 anos, praticantes de corrida");
  await sendMessage(app, accessToken, workspaceId, conversationId, "carrossel");
  const confirmed = await sendMessage(app, accessToken, workspaceId, conversationId, "sim");
  return confirmed.json().data;
}

// ---------------------------------------------------------------------------------------------
// GET /v1/runtime — lista só leitura
// ---------------------------------------------------------------------------------------------

test("GET /v1/runtime: vazio antes de qualquer confirmação; populado automaticamente depois que o Planning fica ready", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "runtime-1@example.com", tenantId: "tenant-runtime-api-1" });
  const workspace = await createWorkspace(app, accessToken);
  const conversation = await createConversation(app, accessToken, workspace.id);

  const before = await app.inject({ method: "GET", url: `/v1/runtime?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(before.statusCode, 200);
  assert.deepEqual(before.json().data, []);

  await confirmACampaign(app, accessToken, workspace.id, conversation.id);

  const after = await app.inject({ method: "GET", url: `/v1/runtime?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(after.statusCode, 200);
  assert.equal(after.json().data.length, 1);
  assert.equal(after.json().data[0].status, "validated");
  await app.close();
});

test("GET /v1/runtime: sem autenticação responde 401", async () => {
  const app = await buildTestApp();
  const response = await app.inject({ method: "GET", url: "/v1/runtime?workspaceId=w" });
  assert.equal(response.statusCode, 401);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// GET /v1/runtime/:id — detalhe com contexto + relatório de validação
// ---------------------------------------------------------------------------------------------

test("GET /v1/runtime/:id: devolve runtimePlan + sourceContext + validationReport + tasks + artifacts + context, nenhum campo de execução", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "runtime-2@example.com", tenantId: "tenant-runtime-api-2" });
  const workspace = await createWorkspace(app, accessToken);
  const conversation = await createConversation(app, accessToken, workspace.id);
  await confirmACampaign(app, accessToken, workspace.id, conversation.id);

  const list = await app.inject({ method: "GET", url: `/v1/runtime?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${accessToken}` } });
  const runtimeId = list.json().data[0].id;

  const response = await app.inject({ method: "GET", url: `/v1/runtime/${runtimeId}?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(response.statusCode, 200);
  const body = response.json().data;
  assert.equal(body.runtimePlan.id, runtimeId);
  assert.equal(body.validationReport.valid, true);
  assert.equal(body.tasks.length, 6);
  assert.equal(body.artifacts.length, 6);
  assert.equal(body.context.planning.status, "ready");
  assert.equal(body.sourceContext.workspaceId, workspace.id);

  const planFields = Object.keys(body.runtimePlan);
  for (const forbidden of ["executedAt", "executionStatus", "publishedAt"]) {
    assert.ok(!planFields.includes(forbidden), `RuntimePlan não deveria ter nenhum campo de execução ("${forbidden}")`);
  }
  await app.close();
});

test("GET /v1/runtime/:id: cross-tenant responde 404 (nunca 403)", async () => {
  const app = await buildTestApp();
  const tokenA = await seedUserAndLogin(app, { email: "runtime-a@example.com", tenantId: "tenant-runtime-api-3a" });
  const tokenB = await seedUserAndLogin(app, { email: "runtime-b@example.com", tenantId: "tenant-runtime-api-3b" });
  const workspaceA = await createWorkspace(app, tokenA);
  const conversationA = await createConversation(app, tokenA, workspaceA.id);
  await confirmACampaign(app, tokenA, workspaceA.id, conversationA.id);

  const list = await app.inject({ method: "GET", url: `/v1/runtime?workspaceId=${workspaceA.id}`, headers: { authorization: `Bearer ${tokenA}` } });
  const runtimeId = list.json().data[0].id;

  const crossTenantGet = await app.inject({ method: "GET", url: `/v1/runtime/${runtimeId}?workspaceId=${workspaceA.id}`, headers: { authorization: `Bearer ${tokenB}` } });
  assert.equal(crossTenantGet.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// GET /v1/runtime/:id/bindings
// ---------------------------------------------------------------------------------------------

test("GET /v1/runtime/:id/bindings: devolve bindings + inputs + outputs", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "runtime-4@example.com", tenantId: "tenant-runtime-api-4" });
  const workspace = await createWorkspace(app, accessToken);
  const conversation = await createConversation(app, accessToken, workspace.id);
  await confirmACampaign(app, accessToken, workspace.id, conversation.id);

  const list = await app.inject({ method: "GET", url: `/v1/runtime?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${accessToken}` } });
  const runtimeId = list.json().data[0].id;

  const response = await app.inject({ method: "GET", url: `/v1/runtime/${runtimeId}/bindings?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(response.statusCode, 200);
  const body = response.json().data;
  assert.equal(body.bindings.length, 6);
  assert.equal(body.inputs.length, 6);
  assert.equal(body.outputs.length, 6);
  await app.close();
});

test("GET /v1/runtime/:id/bindings: runtime inexistente responde 404", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "runtime-5@example.com", tenantId: "tenant-runtime-api-5" });
  const workspace = await createWorkspace(app, accessToken);

  const response = await app.inject({ method: "GET", url: `/v1/runtime/nao-existe/bindings?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${accessToken}` } });
  assert.equal(response.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// Nenhum verbo de escrita/execução existe nesta superfície (decisões obrigatórias 36/41-47)
// ---------------------------------------------------------------------------------------------

test("Não existe NENHUM endpoint de escrita em /v1/runtime — POST/PUT/DELETE/PATCH respondem 404", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "runtime-6@example.com", tenantId: "tenant-runtime-api-6" });
  const workspace = await createWorkspace(app, accessToken);

  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const response = await app.inject({ method, url: `/v1/runtime?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${accessToken}` }, payload: {} });
    assert.equal(response.statusCode, 404, `${method} /v1/runtime não deveria existir`);
  }
  await app.close();
});
