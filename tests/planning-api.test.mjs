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
  db = await startTestPostgres({ port: 55580 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function buildTestApp() {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-planning-api",
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

/** Roteiro fixo que leva um Briefing até a confirmação (mesmo script de `briefing-api.test.mjs`/
 * `briefing-conversation-flow.test.mjs`) — a única forma de um Planning existir é passar por aqui,
 * já que não existe (e não pode existir) endpoint de criação (decisão obrigatória 9). */
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
// GET /v1/planning — lista só leitura
// ---------------------------------------------------------------------------------------------

test("GET /v1/planning: vazio antes de qualquer confirmação; populado automaticamente depois de confirmar um Briefing", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "planning-1@example.com", tenantId: "tenant-planning-api-1" });
  const workspace = await createWorkspace(app, accessToken);
  const conversation = await createConversation(app, accessToken, workspace.id);

  const before = await app.inject({
    method: "GET",
    url: `/v1/planning?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(before.statusCode, 200);
  assert.deepEqual(before.json().data, []);

  await confirmACampaign(app, accessToken, workspace.id, conversation.id);

  const after = await app.inject({
    method: "GET",
    url: `/v1/planning?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(after.statusCode, 200);
  assert.equal(after.json().data.length, 1);
  assert.equal(after.json().data[0].status, "ready");
  await app.close();
});

test("GET /v1/planning: sem autenticação responde 401", async () => {
  const app = await buildTestApp();
  const response = await app.inject({ method: "GET", url: "/v1/planning?workspaceId=w" });
  assert.equal(response.statusCode, 401);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// GET /v1/planning/:id — grafo + decisões
// ---------------------------------------------------------------------------------------------

test("GET /v1/planning/:id: devolve {planning, graph, decisions} com o DAG completo, nenhum campo de execução", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "planning-2@example.com", tenantId: "tenant-planning-api-2" });
  const workspace = await createWorkspace(app, accessToken);
  const conversation = await createConversation(app, accessToken, workspace.id);
  await confirmACampaign(app, accessToken, workspace.id, conversation.id);

  const list = await app.inject({ method: "GET", url: `/v1/planning?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${accessToken}` } });
  const planningId = list.json().data[0].id;

  const response = await app.inject({
    method: "GET",
    url: `/v1/planning/${planningId}?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json().data;
  assert.equal(body.planning.id, planningId);
  assert.equal(body.graph.nodes.length, 6);
  assert.equal(body.graph.edges.length, 6);
  assert.equal(body.decisions.length, 3);
  const planningFields = Object.keys(body.planning);
  for (const forbidden of ["executedAt", "executionStatus", "executeStatus", "publishedAt"]) {
    assert.ok(!planningFields.includes(forbidden), `Planning não deveria ter nenhum campo de execução ("${forbidden}") — nada é executado nesta sprint`);
  }
  await app.close();
});

test("GET /v1/planning/:id: cross-tenant responde 404 (nunca 403, mesmo padrão de Conversation/Briefing)", async () => {
  const app = await buildTestApp();
  const tokenA = await seedUserAndLogin(app, { email: "planning-a@example.com", tenantId: "tenant-planning-api-3a" });
  const tokenB = await seedUserAndLogin(app, { email: "planning-b@example.com", tenantId: "tenant-planning-api-3b" });
  const workspaceA = await createWorkspace(app, tokenA);
  const conversationA = await createConversation(app, tokenA, workspaceA.id);
  await confirmACampaign(app, tokenA, workspaceA.id, conversationA.id);

  const list = await app.inject({ method: "GET", url: `/v1/planning?workspaceId=${workspaceA.id}`, headers: { authorization: `Bearer ${tokenA}` } });
  const planningId = list.json().data[0].id;

  const crossTenantGet = await app.inject({
    method: "GET",
    url: `/v1/planning/${planningId}?workspaceId=${workspaceA.id}`,
    headers: { authorization: `Bearer ${tokenB}` },
  });
  assert.equal(crossTenantGet.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// GET /v1/planning/:id/tasks — tarefas + artefatos esperados
// ---------------------------------------------------------------------------------------------

test("GET /v1/planning/:id/tasks: devolve as 6 tarefas planejadas e seus artefatos esperados, todas em status 'planned'", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "planning-4@example.com", tenantId: "tenant-planning-api-4" });
  const workspace = await createWorkspace(app, accessToken);
  const conversation = await createConversation(app, accessToken, workspace.id);
  await confirmACampaign(app, accessToken, workspace.id, conversation.id);

  const list = await app.inject({ method: "GET", url: `/v1/planning?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${accessToken}` } });
  const planningId = list.json().data[0].id;

  const response = await app.inject({
    method: "GET",
    url: `/v1/planning/${planningId}/tasks?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json().data;
  assert.equal(body.tasks.length, 6);
  assert.equal(body.artifacts.length, 6);
  for (const task of body.tasks) assert.equal(task.status, "planned");
  for (const artifact of body.artifacts) assert.equal(artifact.status, "expected");
  await app.close();
});

test("GET /v1/planning/:id/tasks: planning inexistente responde 404", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "planning-5@example.com", tenantId: "tenant-planning-api-5" });
  const workspace = await createWorkspace(app, accessToken);

  const response = await app.inject({
    method: "GET",
    url: `/v1/planning/nao-existe/tasks?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(response.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// Nenhum verbo de escrita/execução existe nesta superfície (decisões obrigatórias 28-33)
// ---------------------------------------------------------------------------------------------

test("Não existe NENHUM endpoint de escrita em /v1/planning — POST/PUT/DELETE respondem 404 (rota inexistente)", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "planning-6@example.com", tenantId: "tenant-planning-api-6" });
  const workspace = await createWorkspace(app, accessToken);

  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const response = await app.inject({
      method,
      url: `/v1/planning?workspaceId=${workspace.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {},
    });
    assert.equal(response.statusCode, 404, `${method} /v1/planning não deveria existir`);
  }
  await app.close();
});
