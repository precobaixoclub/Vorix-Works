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
import { PostgresSubscriptionRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { BcryptPasswordHasher } from "../dist/infrastructure/auth/bcrypt-password-hasher.js";
import { registerUser } from "../dist/application/identity/index.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** `/v1/billing/*` via `app.inject` — confirma que a fiação real (autenticação, rotas fora/dentro
 * do container `identity`, tradução de erro para HTTP) funciona de ponta a ponta. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55711 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function buildTestApp() {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-billing-lifecycle",
    DATABASE_URL: db.connectionString,
    PERSISTENCE_DRIVER: "memory",
    ACCESS_TOKEN_TTL_SECONDS: "900",
    REFRESH_TOKEN_TTL_SECONDS: "2592000",
    ZUNO_LOG_LEVEL: "silent",
  });
  return buildApp({ config });
}

async function seedOwnerWithProSubscription(tenantId) {
  const userRepository = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const membershipRepository = new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") });
  await registerUser(
    { userRepository, membershipRepository, passwordHasher: new BcryptPasswordHasher() },
    { email: `owner-${tenantId}@example.com`, password: "senha-forte-123", name: "Dona da Conta", tenantId, role: "owner" },
  );
  await new PostgresPlatformBillingRepository(db.pool).ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const proVersion = await new PostgresPlanVersionRepository(db.pool).getActiveVersion("PRO");
  await new PostgresSubscriptionRepository(db.pool).create({
    tenantId, planVersionId: proVersion.id, status: "active", billingProvider: "sandbox",
    billingInterval: "monthly", providerCustomerId: "cus_route", providerSubscriptionId: `sub-route-${tenantId}`,
  });
  return { email: `owner-${tenantId}@example.com`, password: "senha-forte-123" };
}

async function loginAndGetToken(app, credentials) {
  const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: credentials });
  assert.equal(response.statusCode, 200);
  return response.json().data.accessToken;
}

test("POST /v1/billing/cancel + /v1/billing/reactivate: ciclo completo via HTTP", async () => {
  const app = await buildTestApp();
  const tenantId = "tenant-lifecycle-route-1";
  const credentials = await seedOwnerWithProSubscription(tenantId);
  const token = await loginAndGetToken(app, credentials);
  const auth = { authorization: `Bearer ${token}` };

  const cancel = await app.inject({ method: "POST", url: "/v1/billing/cancel", headers: auth, payload: { reason: "teste" } });
  assert.equal(cancel.statusCode, 200);
  assert.equal(cancel.json().data.cancelAtPeriodEnd, true);

  const reactivate = await app.inject({ method: "POST", url: "/v1/billing/reactivate", headers: auth, payload: {} });
  assert.equal(reactivate.statusCode, 200);
  assert.equal(reactivate.json().data.reactivated, true);

  const reactivateAgain = await app.inject({ method: "POST", url: "/v1/billing/reactivate", headers: auth, payload: {} });
  assert.equal(reactivateAgain.statusCode, 409, "não pode reativar de novo sem estar cancelada");
  await app.close();
});

test("GET /v1/billing/downgrade-preview + POST /v1/billing/change-plan: downgrade com overage responde 409 com detalhe", async () => {
  const app = await buildTestApp();
  const tenantId = "tenant-lifecycle-route-2";
  const credentials = await seedOwnerWithProSubscription(tenantId);
  const token = await loginAndGetToken(app, credentials);
  const auth = { authorization: `Bearer ${token}` };

  // PRO -> FREE é seguro pra um tenant novo (sem uso real ainda).
  const preview = await app.inject({ method: "GET", url: "/v1/billing/downgrade-preview?newPlanCode=FREE", headers: auth });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().data.safeToChange, true);

  const changePlan = await app.inject({ method: "POST", url: "/v1/billing/change-plan", headers: auth, payload: { newPlanCode: "FREE", billingInterval: "monthly" } });
  assert.equal(changePlan.statusCode, 200);
  assert.equal(changePlan.json().data.changed, true);
  await app.close();
});

test("POST /v1/billing/addons: compra e remove um add-on via HTTP", async () => {
  const app = await buildTestApp();
  const tenantId = "tenant-lifecycle-route-3";
  const credentials = await seedOwnerWithProSubscription(tenantId);
  const token = await loginAndGetToken(app, credentials);
  const auth = { authorization: `Bearer ${token}` };

  const purchase = await app.inject({ method: "POST", url: "/v1/billing/addons", headers: auth, payload: { addonCode: "extra_user", quantity: 1, billingInterval: "monthly" } });
  assert.equal(purchase.statusCode, 201);

  const entitlements = await app.inject({ method: "GET", url: "/v1/entitlements", headers: auth });
  assert.equal(entitlements.json().data.limits.find((l) => l.resource === "users").max, 9, "8 do PRO + 1 do addon");
  await app.close();
});
