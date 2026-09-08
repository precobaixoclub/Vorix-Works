import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresPlanVersionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresSubscriptionRepository, PostgresSubscriptionItemRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { BcryptPasswordHasher } from "../dist/infrastructure/auth/bcrypt-password-hasher.js";
import { registerUser } from "../dist/application/identity/index.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** `GET /v1/billing/overview` + `POST /v1/billing/portal` — SaaS Commercialization, Fase 4. Um
 * único endpoint agregado para a tela "Plano e Cobrança", em vez de N chamadas espalhadas. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55712 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function buildTestApp() {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-billing-overview",
    DATABASE_URL: db.connectionString,
    PERSISTENCE_DRIVER: "memory",
    ACCESS_TOKEN_TTL_SECONDS: "900",
    REFRESH_TOKEN_TTL_SECONDS: "2592000",
    ZUNO_LOG_LEVEL: "silent",
  });
  return buildApp({ config });
}

async function seedOwner(tenantId) {
  const userRepository = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const membershipRepository = new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") });
  await registerUser(
    { userRepository, membershipRepository, passwordHasher: new BcryptPasswordHasher() },
    { email: `owner-${tenantId}@example.com`, password: "senha-forte-123", name: "Dona da Conta", tenantId, role: "owner" },
  );
  return { email: `owner-${tenantId}@example.com`, password: "senha-forte-123" };
}

async function loginAndGetToken(app, credentials) {
  const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: credentials });
  assert.equal(response.statusCode, 200);
  return response.json().data.accessToken;
}

test("GET /v1/billing/overview: tenant virtual (sem Subscription real) devolve o FREE com consumo real", async () => {
  const app = await buildTestApp();
  const tenantId = "tenant-overview-1";
  await new PostgresPlatformBillingRepository(db.pool).ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const credentials = await seedOwner(tenantId);
  const token = await loginAndGetToken(app, credentials);

  const response = await app.inject({ method: "GET", url: "/v1/billing/overview", headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200);
  const overview = response.json().data;
  assert.equal(overview.planCode, "FREE");
  assert.equal(overview.virtual, true);
  assert.equal(overview.status, null);
  assert.equal(overview.addons.length, 0);
  assert.ok(overview.consumption.some((c) => c.resource === "users" && c.used === 1), "a dona da conta já conta como 1 usuário");
  await app.close();
});

test("GET /v1/billing/overview: assinante real PRO com add-on mostra plano, add-ons e forma de pagamento sandbox", async () => {
  const app = await buildTestApp();
  const tenantId = "tenant-overview-2";
  await new PostgresPlatformBillingRepository(db.pool).ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const credentials = await seedOwner(tenantId);
  const proVersion = await new PostgresPlanVersionRepository(db.pool).getActiveVersion("PRO");
  const subscription = await new PostgresSubscriptionRepository(db.pool).create({
    tenantId, planVersionId: proVersion.id, status: "active", billingProvider: "sandbox",
    billingInterval: "monthly", providerCustomerId: "cus_overview_2",
  });
  await new PostgresSubscriptionItemRepository(db.pool).create({ subscriptionId: subscription.id, addonCode: "extra_user", quantity: 1, unitPriceUsd: 15, providerItemId: "si_1" });

  const token = await loginAndGetToken(app, credentials);
  const response = await app.inject({ method: "GET", url: "/v1/billing/overview", headers: { authorization: `Bearer ${token}` } });
  const overview = response.json().data;
  assert.equal(overview.planCode, "PRO");
  assert.equal(overview.virtual, false);
  assert.equal(overview.status, "active");
  assert.equal(overview.addons.length, 1);
  assert.equal(overview.addons[0].addonCode, "extra_user");
  assert.ok(overview.paymentMethod, "SandboxBillingProvider sempre devolve um cartão de exemplo");
  assert.ok(!overview.availableAddons.some((a) => a.code === "extra_user"), "add-on já comprado não deveria aparecer nos disponíveis pra comprar de novo");
  assert.ok(overview.availableAddons.some((a) => a.code === "extra_whatsapp_connection"), "add-on permitido no PRO e ainda não comprado deveria aparecer");
  await app.close();
});

test("POST /v1/billing/portal: sem providerCustomerId responde 400 com mensagem clara", async () => {
  const app = await buildTestApp();
  const tenantId = "tenant-overview-3";
  await new PostgresPlatformBillingRepository(db.pool).ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const credentials = await seedOwner(tenantId);
  const token = await loginAndGetToken(app, credentials);

  const response = await app.inject({ method: "POST", url: "/v1/billing/portal", headers: { authorization: `Bearer ${token}` }, payload: {} });
  assert.equal(response.statusCode, 400);
  await app.close();
});
