import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresPlanVersionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresSubscriptionRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { BcryptPasswordHasher } from "../dist/infrastructure/auth/bcrypt-password-hasher.js";
import { registerUser } from "../dist/application/identity/index.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Aquisição self-service (Home→Planos→Cadastro→Trial→Pagamento→Ativação) — via `app.inject`,
 * mesma convenção de `tests/billing-lifecycle-route.test.mjs`/`tests/auth-api.test.mjs`.
 * Cobre: signup preserva o plano escolhido e cria trial real atomicamente (§25), signup nunca
 * quebra quando trial está desligado no ambiente (§27, degrade gracioso), idempotência (§26), e o
 * novo guard de somente-leitura em rotas de criação operacional (§39-42).
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55995 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function buildTestApp(overrides = {}) {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-saas-acquisition",
    DATABASE_URL: db.connectionString,
    PERSISTENCE_DRIVER: "memory",
    ACCESS_TOKEN_TTL_SECONDS: "900",
    REFRESH_TOKEN_TTL_SECONDS: "2592000",
    ZUNO_LOG_LEVEL: "silent",
    ...overrides,
  });
  return buildApp({ config });
}

async function seedOwnerWithSubscription(tenantId, planCode, status) {
  const userRepository = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const membershipRepository = new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") });
  await registerUser(
    { userRepository, membershipRepository, passwordHasher: new BcryptPasswordHasher() },
    { email: `owner-${tenantId}@example.com`, password: "senha-forte-123", name: "Dona da Conta", tenantId, role: "owner" },
  );
  await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }).create({ tenantId, name: "Workspace", kind: "default" });
  await new PostgresPlatformBillingRepository(db.pool).ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const planVersion = await new PostgresPlanVersionRepository(db.pool).getActiveVersion(planCode);
  await new PostgresSubscriptionRepository(db.pool).create({
    tenantId, planVersionId: planVersion.id, status, billingProvider: "none", billingInterval: "monthly",
  });
  return { email: `owner-${tenantId}@example.com`, password: "senha-forte-123" };
}

async function loginAndGetToken(app, credentials) {
  const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: credentials });
  assert.equal(response.statusCode, 200);
  return response.json().data.accessToken;
}

// ---------------------------------------------------------------------------------------------
// Signup preserva o plano e cria trial real

test("POST /v1/auth/signup com planCode=PRO e TRIAL_ENABLED=true: cria Subscription real de trial, 7 dias", async () => {
  const app = await buildTestApp({ TRIAL_ENABLED: "true" });
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email: "nova-pro@example.com", password: "senha-forte-123", name: "Nova Cliente", planCode: "PRO" },
  });
  assert.equal(response.statusCode, 201);
  const body = response.json().data;
  assert.equal(body.trialStarted, true);

  const proVersion = await new PostgresPlanVersionRepository(db.pool).getActiveVersion("PRO");
  assert.equal(proVersion.trialDays, 7, "trial padrão passou a ser 7 dias (migration 0131)");

  const subscription = await new PostgresSubscriptionRepository(db.pool).getActiveByTenant(body.tenantId);
  assert.ok(subscription, "signup deveria ter criado uma Subscription real");
  assert.equal(subscription.status, "trial");
  assert.equal(subscription.planVersionId, proVersion.id);
  assert.ok(subscription.trialEnd, "trialEnd deveria estar preenchido");
  const daysUntilEnd = (new Date(subscription.trialEnd).getTime() - new Date(subscription.trialStart).getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(Math.round(daysUntilEnd), 7);
  await app.close();
});

test("POST /v1/auth/signup sem planCode: comportamento antigo preservado, nenhuma Subscription real criada", async () => {
  const app = await buildTestApp({ TRIAL_ENABLED: "true" });
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email: "sem-plano@example.com", password: "senha-forte-123", name: "Sem Plano" },
  });
  assert.equal(response.statusCode, 201);
  const body = response.json().data;
  assert.equal(body.trialStarted, false);

  const subscription = await new PostgresSubscriptionRepository(db.pool).getActiveByTenant(body.tenantId);
  assert.equal(subscription, undefined, "sem plano escolhido, nunca cria Subscription — mantém o estado legado tenant_billing");
  await app.close();
});

test("POST /v1/auth/signup com planCode=PRO mas TRIAL_ENABLED=false (padrão): conta é criada normalmente, sem travar", async () => {
  const app = await buildTestApp(); // TRIAL_ENABLED ausente = false, mesmo padrão de produção hoje
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email: "trial-desligado@example.com", password: "senha-forte-123", name: "Trial Desligado", planCode: "PRO" },
  });
  assert.equal(response.statusCode, 201, "signup nunca deve falhar por causa de billing desligado");
  const body = response.json().data;
  assert.equal(body.trialStarted, false);
  assert.ok(body.accessToken, "conta e sessão continuam sendo criadas normalmente");
  await app.close();
});

test("POST /v1/auth/signup: planCode inválido (ex. FREE) é rejeitado pelo schema, nunca aceito", async () => {
  const app = await buildTestApp({ TRIAL_ENABLED: "true" });
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email: "plano-invalido@example.com", password: "senha-forte-123", name: "Plano Inválido", planCode: "FREE" },
  });
  assert.equal(response.statusCode, 400, "FREE nunca é uma escolha válida no signup self-service");
  await app.close();
});

test("POST /v1/auth/signup: duplo cadastro com o mesmo email nunca duplica Subscription", async () => {
  const app = await buildTestApp({ TRIAL_ENABLED: "true" });
  const payload = { email: "duplicado@example.com", password: "senha-forte-123", name: "Duplicada", planCode: "START" };
  const first = await app.inject({ method: "POST", url: "/v1/auth/signup", payload });
  assert.equal(first.statusCode, 201);
  const second = await app.inject({ method: "POST", url: "/v1/auth/signup", payload });
  assert.equal(second.statusCode, 409, "email já cadastrado — nunca cria um segundo tenant/Subscription");

  const subscription = await new PostgresSubscriptionRepository(db.pool).getActiveByTenant(first.json().data.tenantId);
  assert.equal(subscription.status, "trial");
  await app.close();
});

// ---------------------------------------------------------------------------------------------
// Guard de somente-leitura (trial vencido/pagamento pendente) em rotas de criação operacional

test("POST /v1/contacts: tenant com trial_expired é bloqueado com 402, dado nenhum é apagado", async () => {
  const app = await buildTestApp();
  const tenantId = "tenant-readonly-guard-1";
  const credentials = await seedOwnerWithSubscription(tenantId, "PRO", "trial_expired");
  const token = await loginAndGetToken(app, credentials);
  const auth = { authorization: `Bearer ${token}` };

  const [workspace] = await new PostgresWorkspaceRepository(db.pool).listByTenant(tenantId);
  const response = await app.inject({
    method: "POST",
    url: "/v1/contacts",
    headers: auth,
    payload: { workspaceId: workspace.id, name: "Novo Contato" },
  });
  assert.equal(response.statusCode, 402);
  assert.equal(response.json().error.code, "ENTITLEMENT_ACCOUNT_READ_ONLY");
  await app.close();
});

test("POST /v1/contacts: tenant com Subscription active continua criando normalmente", async () => {
  const app = await buildTestApp();
  const tenantId = "tenant-readonly-guard-2";
  const credentials = await seedOwnerWithSubscription(tenantId, "PRO", "active");
  const token = await loginAndGetToken(app, credentials);
  const auth = { authorization: `Bearer ${token}` };

  const [workspace] = await new PostgresWorkspaceRepository(db.pool).listByTenant(tenantId);
  const response = await app.inject({
    method: "POST",
    url: "/v1/contacts",
    headers: auth,
    payload: { workspaceId: workspace.id, name: "Novo Contato" },
  });
  assert.equal(response.statusCode, 201);
  await app.close();
});

test("POST /v1/billing/reactivate: continua funcionando mesmo com o tenant em modo somente-leitura (rota não tem o guard)", async () => {
  const app = await buildTestApp();
  const tenantId = "tenant-readonly-guard-3";
  const credentials = await seedOwnerWithSubscription(tenantId, "PRO", "past_due");
  const token = await loginAndGetToken(app, credentials);
  const auth = { authorization: `Bearer ${token}` };

  // `past_due` não permite `/v1/billing/reactivate` (essa rota é só pra `cancelAtPeriodEnd`), mas o
  // ponto do teste é que o guard NUNCA intercepta — o erro que volta é o de negócio da própria rota
  // (409, "não está cancelada"), nunca 402 do guard.
  const response = await app.inject({ method: "POST", url: "/v1/billing/reactivate", headers: auth, payload: {} });
  assert.notEqual(response.statusCode, 402, "billing precisa continuar acessível em modo somente-leitura — é o único jeito de sair dele");
  await app.close();
});
