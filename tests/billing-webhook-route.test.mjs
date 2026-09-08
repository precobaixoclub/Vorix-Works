import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresPlanVersionRepository } from "../dist/infrastructure/storage/postgres/postgres-plan-version-repository.js";
import { PostgresSubscriptionRepository } from "../dist/infrastructure/storage/postgres/postgres-subscription-repository.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * `POST /webhooks/billing/:providerId` via `app.inject` (app real, sem porta) — mesma motivação de
 * `instagram-dm-webhook-route.test.mjs`: pega bugs de fiação (path/raw body/registro fora de
 * `/v1`) que um teste de unidade de `processBillingWebhook` isolado nunca pegaria.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;

before(async () => {
  db = await startTestPostgres({ port: 55709 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function buildTestApp() {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-billing-webhook",
    DATABASE_URL: db.connectionString,
    PERSISTENCE_DRIVER: "memory",
    ACCESS_TOKEN_TTL_SECONDS: "900",
    REFRESH_TOKEN_TTL_SECONDS: "2592000",
    ZUNO_LOG_LEVEL: "silent",
  });
  return buildApp({ config });
}

test("POST /webhooks/billing/sandbox: checkout.session.completed ativa a Subscription real; reentrega responde 200 sem reaplicar", async () => {
  const app = await buildTestApp();
  const tenantId = "tenant-webhook-route-1";
  await new PostgresPlatformBillingRepository(db.pool).ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  const proVersion = await new PostgresPlanVersionRepository(db.pool).getActiveVersion("PRO");

  const payload = JSON.stringify({
    id: "evt_route_1",
    type: "checkout.session.completed",
    data: { id: "cs_route_1", customer: "cus_route_1", subscription: "sub_route_1", metadata: { tenantId, planVersionId: proVersion.id, billingInterval: "monthly" } },
  });

  const first = await app.inject({ method: "POST", url: "/webhooks/billing/sandbox", payload, headers: { "content-type": "application/json" } });
  assert.equal(first.statusCode, 200);
  assert.equal(JSON.parse(first.body).outcome, "processed");

  const subscription = await new PostgresSubscriptionRepository(db.pool).getActiveByTenant(tenantId);
  assert.ok(subscription, "assinatura real deveria existir após o webhook via HTTP");
  assert.equal(subscription.providerSubscriptionId, "sub_route_1");

  const second = await app.inject({ method: "POST", url: "/webhooks/billing/sandbox", payload, headers: { "content-type": "application/json" } });
  assert.equal(second.statusCode, 200);
  assert.equal(JSON.parse(second.body).outcome, "duplicate_ignored");

  // Confirma que o processo/servidor continua vivo depois (mesma checagem de regressão do
  // webhook do Instagram DM).
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  await app.close();
});

test("POST /webhooks/billing/sandbox: rota fica FORA do prefixo /v1", async () => {
  const app = await buildTestApp();
  const insideV1 = await app.inject({ method: "POST", url: "/v1/webhooks/billing/sandbox", payload: "{}", headers: { "content-type": "application/json" } });
  assert.equal(insideV1.statusCode, 404);
  await app.close();
});
