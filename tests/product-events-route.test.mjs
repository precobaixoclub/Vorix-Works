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

/** `POST /v1/product-events` via `app.inject` — funciona sem autenticação (visitante anônimo) e
 * anexa tenantId/userId a partir do JWT quando presente; rejeita eventos "de estado" fora do
 * subconjunto que o cliente pode reportar. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55991 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function buildTestApp(envOverrides = {}) {
  const config = loadApiConfig({
    AUTH_MODE: "jwt",
    JWT_SECRET: "test-secret-product-events",
    DATABASE_URL: db.connectionString,
    PERSISTENCE_DRIVER: "postgres",
    ACCESS_TOKEN_TTL_SECONDS: "900",
    REFRESH_TOKEN_TTL_SECONDS: "2592000",
    ZUNO_LOG_LEVEL: "silent",
    PRODUCT_ANALYTICS_ENABLED: "true",
    ...envOverrides,
  });
  return buildApp({ config });
}

test("POST /v1/product-events: visitante anônimo (sem token) consegue reportar landing_view", async () => {
  const app = await buildTestApp();
  const response = await app.inject({ method: "POST", url: "/v1/product-events", payload: { eventName: "landing_view", anonymousId: "anon-route-1" } });
  assert.equal(response.statusCode, 202);

  const row = await db.pool.query("select tenant_id, user_id from product_events where anonymous_id = 'anon-route-1'");
  assert.equal(row.rows.length, 1);
  assert.equal(row.rows[0].tenant_id, null);
  assert.equal(row.rows[0].user_id, null);
  await app.close();
});

test("POST /v1/product-events: com JWT válido, anexa tenantId/userId do principal — nunca do corpo", async () => {
  const app = await buildTestApp();
  const tenantId = "tenant-pevt-route-1";
  const userRepository = new PostgresUserRepository(db.pool, { idGenerator: () => nextId("user") });
  const membershipRepository = new PostgresTenantMembershipRepository(db.pool, { idGenerator: () => nextId("membership") });
  await registerUser({ userRepository, membershipRepository, passwordHasher: new BcryptPasswordHasher() }, { email: "a@b.com", password: "senha-forte-123", name: "P", tenantId, role: "owner" });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "a@b.com", password: "senha-forte-123" } });
  const token = login.json().data.accessToken;

  const response = await app.inject({
    method: "POST",
    url: "/v1/product-events",
    headers: { authorization: `Bearer ${token}` },
    // tenta reivindicar um tenantId diferente no corpo — deve ser ignorado por completo.
    payload: { eventName: "plan_selected", properties: { planKey: "PRO", tenantId: "tenant-outro-forjado" } },
  });
  assert.equal(response.statusCode, 202);

  const row = await db.pool.query("select tenant_id from product_events where event_name = 'plan_selected' order by received_at desc limit 1");
  assert.equal(row.rows[0].tenant_id, tenantId, "tenantId sempre vem do JWT, nunca do corpo");
  await app.close();
});

test("POST /v1/product-events: rejeita eventos de ESTADO que só o backend pode confirmar (checkout_completed, deal_won, etc.)", async () => {
  const app = await buildTestApp();
  const response = await app.inject({ method: "POST", url: "/v1/product-events", payload: { eventName: "checkout_completed" } });
  assert.equal(response.statusCode, 400, "checkout_completed não está no subconjunto que o navegador pode reportar");
  await app.close();
});

test("POST /v1/product-events: PRODUCT_ANALYTICS_ENABLED=false ainda responde 202 (nunca quebra o chamador), mas não grava nada", async () => {
  const app = await buildTestApp({ PRODUCT_ANALYTICS_ENABLED: "false" });
  const response = await app.inject({ method: "POST", url: "/v1/product-events", payload: { eventName: "landing_view", anonymousId: "anon-disabled-route" } });
  assert.equal(response.statusCode, 202);

  const row = await db.pool.query("select count(*)::int as c from product_events where anonymous_id = 'anon-disabled-route'");
  assert.equal(row.rows[0].c, 0);
  await app.close();
});
