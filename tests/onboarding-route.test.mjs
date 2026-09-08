import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { BcryptPasswordHasher } from "../dist/infrastructure/auth/bcrypt-password-hasher.js";
import { registerUser } from "../dist/application/identity/index.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** `/v1/onboarding/*` via `app.inject` — fiação real: autenticação, RBAC (mesma permissão da ação
 * real subjacente), tradução de erro. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55952 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function buildTestApp(envOverrides = {}) {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-onboarding",
    DATABASE_URL: db.connectionString,
    PERSISTENCE_DRIVER: "postgres",
    ACCESS_TOKEN_TTL_SECONDS: "900",
    REFRESH_TOKEN_TTL_SECONDS: "2592000",
    ZUNO_LOG_LEVEL: "silent",
    ...envOverrides,
  });
  return buildApp({ config });
}

async function seedTenant(tenantId, role) {
  const userRepository = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const membershipRepository = new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") });
  const email = `${role}-${tenantId}@example.com`;
  await registerUser({ userRepository, membershipRepository, passwordHasher: new BcryptPasswordHasher() }, { email, password: "senha-forte-123", name: "Pessoa", tenantId, role });
  await new PostgresPlatformBillingRepository(db.pool).ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const workspace = await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }).create({ tenantId, name: "Workspace de Teste" });
  return { email, password: "senha-forte-123", workspaceId: workspace.id };
}

async function loginAndGetToken(app, credentials) {
  const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: credentials.email, password: credentials.password } });
  assert.equal(response.statusCode, 200);
  return response.json().data.accessToken;
}

test("POST /v1/onboarding/start + GET /v1/onboarding: ciclo básico via HTTP", async () => {
  const app = await buildTestApp();
  const seed = await seedTenant("tenant-onb-route-1", "owner");
  const token = await loginAndGetToken(app, seed);
  const auth = { authorization: `Bearer ${token}` };

  const start = await app.inject({ method: "POST", url: "/v1/onboarding/start", headers: auth, payload: { workspaceId: seed.workspaceId } });
  assert.equal(start.statusCode, 201);
  assert.equal(start.json().data.currentStep, "company");

  const read = await app.inject({ method: "GET", url: `/v1/onboarding?workspaceId=${seed.workspaceId}`, headers: auth });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().data.status, "in_progress");
  await app.close();
});

test("GET /v1/onboarding: workspace nunca iniciado devolve null, nunca inventa progresso vazio", async () => {
  const app = await buildTestApp();
  const seed = await seedTenant("tenant-onb-route-2", "owner");
  const token = await loginAndGetToken(app, seed);

  const read = await app.inject({ method: "GET", url: `/v1/onboarding?workspaceId=${seed.workspaceId}`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().data, null);
  await app.close();
});

test("RBAC: viewer não pode iniciar/avançar onboarding (403), mas PODE ler o progresso", async () => {
  const app = await buildTestApp();
  const seed = await seedTenant("tenant-onb-route-3", "viewer");
  const token = await loginAndGetToken(app, seed);
  const auth = { authorization: `Bearer ${token}` };

  const start = await app.inject({ method: "POST", url: "/v1/onboarding/start", headers: auth, payload: { workspaceId: seed.workspaceId } });
  assert.equal(start.statusCode, 403);

  const read = await app.inject({ method: "GET", url: `/v1/onboarding?workspaceId=${seed.workspaceId}`, headers: auth });
  assert.equal(read.statusCode, 200, "leitura do progresso nunca deveria ficar bloqueada pra quem já está no workspace");
  await app.close();
});

test("RBAC: editor pode avançar etapas (workspace:update) mas NÃO pode convidar nem conectar canal (admin-only)", async () => {
  const app = await buildTestApp();
  const seed = await seedTenant("tenant-onb-route-4", "editor");
  const token = await loginAndGetToken(app, seed);
  const auth = { authorization: `Bearer ${token}` };

  await app.inject({ method: "POST", url: "/v1/onboarding/start", headers: auth, payload: { workspaceId: seed.workspaceId } });
  const company = await app.inject({ method: "PATCH", url: "/v1/onboarding/company", headers: auth, payload: { workspaceId: seed.workspaceId, segment: "agencia" } });
  assert.equal(company.statusCode, 200);

  const invite = await app.inject({ method: "POST", url: "/v1/onboarding/invite-team-member", headers: auth, payload: { workspaceId: seed.workspaceId, email: "a@b.com", role: "editor" } });
  assert.equal(invite.statusCode, 403, "convidar durante onboarding exige a MESMA permissão de /tenant-members/invites (admin/owner)");

  const connect = await app.inject({ method: "POST", url: "/v1/onboarding/connect-channel", headers: auth, payload: { workspaceId: seed.workspaceId, displayName: "WhatsApp" } });
  assert.equal(connect.statusCode, 403, "conectar canal exige a MESMA permissão de /inbox/connections (admin/owner)");
  await app.close();
});

test("POST /v1/onboarding/complete + GET /v1/onboarding: completar de propósito, e depois refletir status completed", async () => {
  const app = await buildTestApp();
  const seed = await seedTenant("tenant-onb-route-5", "owner");
  const token = await loginAndGetToken(app, seed);
  const auth = { authorization: `Bearer ${token}` };

  await app.inject({ method: "POST", url: "/v1/onboarding/start", headers: auth, payload: { workspaceId: seed.workspaceId } });
  const complete = await app.inject({ method: "POST", url: "/v1/onboarding/complete", headers: auth, payload: { workspaceId: seed.workspaceId } });
  assert.equal(complete.statusCode, 200);
  assert.equal(complete.json().data.status, "completed");

  const read = await app.inject({ method: "GET", url: `/v1/onboarding?workspaceId=${seed.workspaceId}`, headers: auth });
  assert.equal(read.json().data.status, "completed");
  await app.close();
});

test("POST /v1/onboarding/connect-channel: módulo Conversas desligado responde 409 e nunca cria a conexão (CONVERSATIONS_MODULE_ENABLED ausente = desligado por padrão)", async () => {
  const app = await buildTestApp();
  const seed = await seedTenant("tenant-onb-route-6", "owner");
  const token = await loginAndGetToken(app, seed);
  const auth = { authorization: `Bearer ${token}` };

  await app.inject({ method: "POST", url: "/v1/onboarding/start", headers: auth, payload: { workspaceId: seed.workspaceId } });
  const connect = await app.inject({ method: "POST", url: "/v1/onboarding/connect-channel", headers: auth, payload: { workspaceId: seed.workspaceId, displayName: "WhatsApp" } });
  assert.equal(connect.statusCode, 409);
  assert.match(connect.json().error.message, /ONBOARDING_CHANNEL_MODULE_DISABLED/);

  const count = await db.pool.query("select count(*)::int as c from messaging_connections where workspace_id = $1", [seed.workspaceId]);
  assert.equal(count.rows[0].c, 0);
  await app.close();
});

test("GET /v1/onboarding: channelModuleEnabled reflete CONVERSATIONS_MODULE_ENABLED; conectar funciona quando ligado", async () => {
  const app = await buildTestApp({ CONVERSATIONS_MODULE_ENABLED: "true" });
  const seed = await seedTenant("tenant-onb-route-7", "owner");
  const token = await loginAndGetToken(app, seed);
  const auth = { authorization: `Bearer ${token}` };

  const start = await app.inject({ method: "POST", url: "/v1/onboarding/start", headers: auth, payload: { workspaceId: seed.workspaceId } });
  assert.equal(start.json().data.channelModuleEnabled, true);

  const connect = await app.inject({ method: "POST", url: "/v1/onboarding/connect-channel", headers: auth, payload: { workspaceId: seed.workspaceId, displayName: "WhatsApp" } });
  assert.equal(connect.statusCode, 201);
  await app.close();
});
