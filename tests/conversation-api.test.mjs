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
  db = await startTestPostgres({ port: 55490 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function buildTestApp() {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-conversation-api",
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
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspaces",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { name },
  });
  return response.json().data;
}

// ---------------------------------------------------------------------------------------------
// POST /v1/conversations, GET /v1/conversations
// ---------------------------------------------------------------------------------------------

test("POST /v1/conversations: cria uma conversa no workspace informado", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "conv-1@example.com", tenantId: "tenant-conv-api-1" });
  const workspace = await createWorkspace(app, accessToken);

  const response = await app.inject({
    method: "POST",
    url: "/v1/conversations",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { workspaceId: workspace.id, title: "Primeira conversa" },
  });
  assert.equal(response.statusCode, 201);
  const body = response.json().data;
  assert.equal(body.workspaceId, workspace.id);
  assert.equal(body.state, "idle");
  await app.close();
});

test("POST /v1/conversations: sem autenticação responde 401", async () => {
  const app = await buildTestApp();
  const response = await app.inject({ method: "POST", url: "/v1/conversations", payload: { workspaceId: "workspace-x" } });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("GET /v1/conversations: lista só as conversas do workspace pedido", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "conv-2@example.com", tenantId: "tenant-conv-api-2" });
  const workspaceA = await createWorkspace(app, accessToken, "A");
  const workspaceB = await createWorkspace(app, accessToken, "B");

  await app.inject({ method: "POST", url: "/v1/conversations", headers: { authorization: `Bearer ${accessToken}` }, payload: { workspaceId: workspaceA.id } });
  await app.inject({ method: "POST", url: "/v1/conversations", headers: { authorization: `Bearer ${accessToken}` }, payload: { workspaceId: workspaceB.id } });

  const response = await app.inject({
    method: "GET",
    url: `/v1/conversations?workspaceId=${workspaceA.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.length, 1);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// Isolamento cross-tenant
// ---------------------------------------------------------------------------------------------

test("Isolamento cross-tenant: usuário do tenant B não vê conversa criada pelo tenant A", async () => {
  const app = await buildTestApp();
  const tokenA = await seedUserAndLogin(app, { email: "conv-a@example.com", tenantId: "tenant-conv-api-3a" });
  const tokenB = await seedUserAndLogin(app, { email: "conv-b@example.com", tenantId: "tenant-conv-api-3b" });
  const workspaceA = await createWorkspace(app, tokenA);

  const created = await app.inject({
    method: "POST",
    url: "/v1/conversations",
    headers: { authorization: `Bearer ${tokenA}` },
    payload: { workspaceId: workspaceA.id },
  });
  const conversationId = created.json().data.id;

  const crossTenantGet = await app.inject({
    method: "GET",
    url: `/v1/conversations/${conversationId}?workspaceId=${workspaceA.id}`,
    headers: { authorization: `Bearer ${tokenB}` },
  });
  assert.equal(crossTenantGet.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// POST /v1/conversations/:id/messages — integração com Arthur
// ---------------------------------------------------------------------------------------------

test("POST /v1/conversations/:id/messages: 'oi' resolve o turno com a decisão do Arthur visível", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "conv-4@example.com", tenantId: "tenant-conv-api-4" });
  const workspace = await createWorkspace(app, accessToken);
  const created = await app.inject({
    method: "POST",
    url: "/v1/conversations",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { workspaceId: workspace.id },
  });
  const conversationId = created.json().data.id;

  const response = await app.inject({
    method: "POST",
    url: `/v1/conversations/${conversationId}/messages?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { content: "oi" },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json().data;
  assert.equal(body.intent.type, "free_chat");
  assert.equal(body.decision.action, "respond");
  assert.equal(body.decision.executed, false);
  assert.equal(body.systemMessageText, "Arthur decidiu responder diretamente.");
  assert.equal(body.conversation.state, "resolved");
  await app.close();
});

test("POST /v1/conversations/:id/messages: segundo turno de Knowledge mostra 'Arthur decidiu consultar Knowledge.'", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "conv-5@example.com", tenantId: "tenant-conv-api-5" });
  const workspace = await createWorkspace(app, accessToken);
  const created = await app.inject({
    method: "POST",
    url: "/v1/conversations",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { workspaceId: workspace.id },
  });
  const conversationId = created.json().data.id;
  const url = `/v1/conversations/${conversationId}/messages?workspaceId=${workspace.id}`;

  await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${accessToken}` }, payload: { content: "oi, tudo bem?" } });
  const response = await app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { content: "qual é o nosso público-alvo?" },
  });
  const body = response.json().data;
  assert.equal(body.decision.action, "call_clara");
  assert.equal(body.systemMessageText, "Arthur decidiu consultar Knowledge.");
  assert.equal(body.conversation.state, "waiting_action");
  await app.close();
});

test("POST /v1/conversations/:id/messages: content vazio responde 400", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "conv-6@example.com", tenantId: "tenant-conv-api-6" });
  const workspace = await createWorkspace(app, accessToken);
  const created = await app.inject({
    method: "POST",
    url: "/v1/conversations",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { workspaceId: workspace.id },
  });
  const conversationId = created.json().data.id;

  const response = await app.inject({
    method: "POST",
    url: `/v1/conversations/${conversationId}/messages?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { content: "" },
  });
  assert.equal(response.statusCode, 400);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// GET /v1/conversations/:id/history
// ---------------------------------------------------------------------------------------------

test("GET /v1/conversations/:id/history: devolve os 6 eventos do turno em ordem", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "conv-7@example.com", tenantId: "tenant-conv-api-7" });
  const workspace = await createWorkspace(app, accessToken);
  const created = await app.inject({
    method: "POST",
    url: "/v1/conversations",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { workspaceId: workspace.id },
  });
  const conversationId = created.json().data.id;

  await app.inject({
    method: "POST",
    url: `/v1/conversations/${conversationId}/messages?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { content: "oi" },
  });

  const response = await app.inject({
    method: "GET",
    url: `/v1/conversations/${conversationId}/history?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(response.statusCode, 200);
  const events = response.json().data;
  assert.deepEqual(
    events.map((e) => e.type),
    ["user_message", "intent_classified", "context_updated", "decision_made", "system_message", "state_changed"],
  );
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// RBAC — Conversation é liberado para os 4 papéis (diferente de Workspace)
// ---------------------------------------------------------------------------------------------

test("RBAC: viewer consegue criar conversa e enviar mensagem (Conversation é liberado para todos os papéis)", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "conv-viewer@example.com", tenantId: "tenant-conv-api-8", role: "owner" });
  const workspace = await createWorkspace(app, accessToken);

  // Membership separada com papel viewer, mesmo tenant.
  const viewerToken = await seedUserAndLogin(app, { email: "conv-viewer-2@example.com", tenantId: "tenant-conv-api-8", role: "viewer" });

  const created = await app.inject({
    method: "POST",
    url: "/v1/conversations",
    headers: { authorization: `Bearer ${viewerToken}` },
    payload: { workspaceId: workspace.id },
  });
  assert.equal(created.statusCode, 201);

  const conversationId = created.json().data.id;
  const message = await app.inject({
    method: "POST",
    url: `/v1/conversations/${conversationId}/messages?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${viewerToken}` },
    payload: { content: "oi" },
  });
  assert.equal(message.statusCode, 200);
  await app.close();
});
