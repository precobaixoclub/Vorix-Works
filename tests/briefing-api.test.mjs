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
  db = await startTestPostgres({ port: 55520 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function buildTestApp() {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-briefing-api",
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

// ---------------------------------------------------------------------------------------------
// POST /v1/conversations/:id/messages — resposta estendida com dados de Briefing
// ---------------------------------------------------------------------------------------------

test("POST /v1/conversations/:id/messages: 'quero criar uma campanha...' inicia um Briefing e devolve nextQuestion/readiness", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "briefing-1@example.com", tenantId: "tenant-briefing-api-1" });
  const workspace = await createWorkspace(app, accessToken);
  const conversation = await createConversation(app, accessToken, workspace.id);

  const response = await sendMessage(app, accessToken, workspace.id, conversation.id, "quero criar uma campanha para vender tênis novo");
  assert.equal(response.statusCode, 200);
  const body = response.json().data;
  assert.equal(body.conversation.state, "collecting_briefing");
  assert.equal(body.confirmationRequired, false);
  assert.ok(body.nextQuestion);
  assert.ok(body.readiness);
  assert.ok(body.briefingSummary);
  await app.close();
});

test("POST /v1/conversations/:id/messages: 'oi' continua respondendo normalmente sem nenhum campo de Briefing (sem regressão)", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "briefing-2@example.com", tenantId: "tenant-briefing-api-2" });
  const workspace = await createWorkspace(app, accessToken);
  const conversation = await createConversation(app, accessToken, workspace.id);

  const response = await sendMessage(app, accessToken, workspace.id, conversation.id, "oi");
  const body = response.json().data;
  assert.equal(body.conversation.state, "resolved");
  assert.equal(body.nextQuestion, undefined);
  assert.equal(body.briefingSummary, undefined);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// GET /v1/conversations/:conversationId/briefings/active
// ---------------------------------------------------------------------------------------------

test("GET .../briefings/active: null quando não há Briefing ativo; populado depois de iniciar um", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "briefing-3@example.com", tenantId: "tenant-briefing-api-3" });
  const workspace = await createWorkspace(app, accessToken);
  const conversation = await createConversation(app, accessToken, workspace.id);

  const before = await app.inject({
    method: "GET",
    url: `/v1/conversations/${conversation.id}/briefings/active?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(before.statusCode, 200);
  assert.equal(before.json().data, null);

  await sendMessage(app, accessToken, workspace.id, conversation.id, "quero criar uma campanha para vender tênis novo");

  const after = await app.inject({
    method: "GET",
    url: `/v1/conversations/${conversation.id}/briefings/active?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(after.statusCode, 200);
  assert.equal(after.json().data.status, "collecting");
  assert.equal(after.json().data.type, "campaign_creation");
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// GET /v1/briefings/:id — isolamento cross-tenant
// ---------------------------------------------------------------------------------------------

test("GET /v1/briefings/:id: cross-tenant responde 404 (nunca 403, mesmo padrão de Conversation)", async () => {
  const app = await buildTestApp();
  const tokenA = await seedUserAndLogin(app, { email: "briefing-a@example.com", tenantId: "tenant-briefing-api-4a" });
  const tokenB = await seedUserAndLogin(app, { email: "briefing-b@example.com", tenantId: "tenant-briefing-api-4b" });
  const workspaceA = await createWorkspace(app, tokenA);
  const conversationA = await createConversation(app, tokenA, workspaceA.id);

  await sendMessage(app, tokenA, workspaceA.id, conversationA.id, "quero criar uma campanha para vender tênis novo");
  const active = await app.inject({
    method: "GET",
    url: `/v1/conversations/${conversationA.id}/briefings/active?workspaceId=${workspaceA.id}`,
    headers: { authorization: `Bearer ${tokenA}` },
  });
  const briefingId = active.json().data.id;

  const crossTenantGet = await app.inject({
    method: "GET",
    url: `/v1/briefings/${briefingId}?workspaceId=${workspaceA.id}`,
    headers: { authorization: `Bearer ${tokenB}` },
  });
  assert.equal(crossTenantGet.statusCode, 404);
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// POST /v1/briefings/:id/cancel
// ---------------------------------------------------------------------------------------------

test("POST /v1/briefings/:id/cancel: cancela e o Briefing deixa de ser o ativo da conversa", async () => {
  const app = await buildTestApp();
  const accessToken = await seedUserAndLogin(app, { email: "briefing-5@example.com", tenantId: "tenant-briefing-api-5" });
  const workspace = await createWorkspace(app, accessToken);
  const conversation = await createConversation(app, accessToken, workspace.id);

  await sendMessage(app, accessToken, workspace.id, conversation.id, "quero criar uma campanha para vender tênis novo");
  const active = await app.inject({
    method: "GET",
    url: `/v1/conversations/${conversation.id}/briefings/active?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const briefingId = active.json().data.id;

  const cancelResponse = await app.inject({
    method: "POST",
    url: `/v1/briefings/${briefingId}/cancel?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(cancelResponse.statusCode, 200);
  assert.equal(cancelResponse.json().data.status, "cancelled");

  const activeAfter = await app.inject({
    method: "GET",
    url: `/v1/conversations/${conversation.id}/briefings/active?workspaceId=${workspace.id}`,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(activeAfter.json().data, null);
  await app.close();
});

test("POST /v1/briefings/:id/cancel: sem autenticação responde 401", async () => {
  const app = await buildTestApp();
  const response = await app.inject({ method: "POST", url: "/v1/briefings/nao-existe/cancel?workspaceId=w" });
  assert.equal(response.statusCode, 401);
  await app.close();
});
