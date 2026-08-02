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
const nextId = (prefix) => `${prefix}-execution-api-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55620 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function buildTestApp() {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-execution-api",
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

async function createWorkspace(app, accessToken) {
  const response = await app.inject({ method: "POST", url: "/v1/workspaces", headers: { authorization: `Bearer ${accessToken}` }, payload: { name: "Workspace Execution" } });
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
  await sendMessage(app, accessToken, workspaceId, conversationId, "sim");
}

test("Execution API: RuntimePlan validated -> ExecutionRun dry_run -> gate aprovado -> completed", async () => {
  const app = await buildTestApp();
  const tenantId = "tenant-execution-api-1";
  const ownerToken = await seedUserAndLogin(app, { email: "execution-owner@example.com", tenantId, role: "owner" });
  const workspace = await createWorkspace(app, ownerToken);
  const conversation = await createConversation(app, ownerToken, workspace.id);
  await confirmACampaign(app, ownerToken, workspace.id, conversation.id);

  const runtimeList = await app.inject({ method: "GET", url: `/v1/runtime?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${ownerToken}` } });
  const runtime = runtimeList.json().data[0];
  assert.equal(runtime.status, "validated");

  const create = await app.inject({
    method: "POST",
    url: "/v1/execution-runs",
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { workspaceId: workspace.id, runtimePlanId: runtime.id, idempotencyKey: "api-idem-1" },
  });
  assert.equal(create.statusCode, 200);
  const run = create.json().data;
  assert.equal(run.mode, "dry_run");
  assert.equal(run.state, "created");

  const createAgain = await app.inject({
    method: "POST",
    url: "/v1/execution-runs",
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { workspaceId: workspace.id, runtimePlanId: runtime.id, idempotencyKey: "api-idem-1" },
  });
  assert.equal(createAgain.json().data.id, run.id);

  const start = await app.inject({ method: "POST", url: `/v1/execution-runs/${run.id}/start`, headers: { authorization: `Bearer ${ownerToken}` }, payload: { workspaceId: workspace.id } });
  assert.equal(start.statusCode, 200);
  assert.equal(start.json().data.state, "waiting_for_approval");

  const waitingDetail = await app.inject({ method: "GET", url: `/v1/execution-runs/${run.id}?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${ownerToken}` } });
  const gate = waitingDetail.json().data.gates[0];
  assert.equal(gate.state, "open");
  assert.equal(waitingDetail.json().data.artifacts.length, 4);

  const approved = await app.inject({
    method: "POST",
    url: `/v1/execution-runs/${run.id}/gates/${gate.id}/decision`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { workspaceId: workspace.id, decision: "approved" },
  });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.json().data.state, "completed");

  const tasks = await app.inject({ method: "GET", url: `/v1/execution-runs/${run.id}/tasks?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${ownerToken}` } });
  assert.equal(tasks.json().data.every((task) => task.state === "completed"), true);

  const events = await app.inject({ method: "GET", url: `/v1/execution-runs/${run.id}/events?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${ownerToken}` } });
  assert.ok(events.json().data.some((event) => event.eventType === "run_completed"));
  assert.ok(events.json().data.every((event) => event.traceId), "eventos de execução devem propagar traceId");

  const traces = await app.inject({ method: "GET", url: `/v1/execution-runs/${run.id}/traces?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${ownerToken}` } });
  assert.equal(traces.statusCode, 200);
  assert.ok(traces.json().data.length >= 4);
  assert.ok(traces.json().data.every((trace) => trace.traceId === run.traceId));

  const contracts = await app.inject({ method: "GET", url: "/v1/execution/contracts", headers: { authorization: `Bearer ${ownerToken}` } });
  assert.equal(contracts.statusCode, 200);
  assert.ok(contracts.json().data.some((contract) => contract.capability === "distribution" && contract.sideEffectPolicy === "publication_preview"));

  const health = await app.inject({ method: "GET", url: "/v1/execution/health", headers: { authorization: `Bearer ${ownerToken}` } });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().data.liveness, "ok");
  assert.equal(health.json().data.checks.contractRegistry.ok, true);

  const metrics = await app.inject({ method: "GET", url: `/v1/execution/metrics?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${ownerToken}` } });
  assert.equal(metrics.statusCode, 200);
  assert.equal(metrics.json().data.runsCompleted, 1);
  assert.ok(metrics.json().data.artifactsProduced >= 6);

  const viewerToken = await seedUserAndLogin(app, { email: "execution-viewer@example.com", tenantId, role: "viewer" });
  const forbidden = await app.inject({
    method: "POST",
    url: "/v1/execution-runs",
    headers: { authorization: `Bearer ${viewerToken}` },
    payload: { workspaceId: workspace.id, runtimePlanId: runtime.id, idempotencyKey: "viewer-forbidden" },
  });
  assert.equal(forbidden.statusCode, 403);

  const viewerList = await app.inject({ method: "GET", url: `/v1/execution-runs?workspaceId=${workspace.id}`, headers: { authorization: `Bearer ${viewerToken}` } });
  assert.equal(viewerList.statusCode, 200);
  assert.equal(viewerList.json().data.length, 1);

  await app.close();
});
