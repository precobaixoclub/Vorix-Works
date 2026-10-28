import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import Fastify from "fastify";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { productSiteContext } from "./helpers/product-site-context.mjs";
import { runMonitor } from "../scripts/operations/monitor.mjs";
import { registerCommerceRoutes } from "../dist/interfaces/api/routes/v1/commerce.route.js";
import { registerMarketplaceRoutes } from "../dist/interfaces/api/routes/v1/marketplaces.route.js";

let db;
before(async () => { db = await startTestPostgres(); await applyMigrations(db.pool, join(process.cwd(), "db/migrations")); });
after(async () => { await db?.stop(); });

test("operations monitor delivers bounded alerts through the existing bell only to active tenant administrators", async () => {
  const a = await productSiteContext(db.pool), b = await productSiteContext(db.pool);
  for (const [context, role] of [[a, "owner"], [b, "editor"]]) {
    await db.pool.query("insert into users(id,email,password_hash,name,status,created_at,updated_at) values($1,$2,'fixture','QA','active',now(),now())", [context.actor.userId, `${context.actor.userId}@qa.invalid`]);
    await db.pool.query("insert into tenant_members(id,user_id,tenant_id,role,created_at,updated_at) values($1,$2,$3,$4,now(),now())", [context.actor.userId, context.actor.userId, context.tenantId, role]);
  }
  const first = await runMonitor(db.pool, { hostFailures: ["marketplaces worker unavailable"] });
  assert.equal(first.notificationsCreated, 1);
  const second = await runMonitor(db.pool, { hostFailures: ["marketplaces worker unavailable"] });
  assert.equal(second.notificationsCreated, 0, "cron repetitions do not flood the recipient");
  const notifications = (await db.pool.query("select tenant_id,user_id,source_type from notifications")).rows;
  assert.deepEqual(notifications, [{ tenant_id: a.tenantId, user_id: a.actor.userId, source_type: "operations_alert" }]);
});

test("payment processing failure returns 503 so the provider can retry instead of losing the webhook", async () => {
  const app = Fastify();
  await registerCommerceRoutes(app, { orders: { paymentByProviderId: async () => { throw Error("temporary database outage"); } } });
  try {
    const r = await app.inject({ method: "POST", url: "/webhooks/commerce/mercado-pago/qa-site", payload: { type: "payment", data: { id: "123" } } });
    assert.equal(r.statusCode, 503);
  } finally { await app.close(); }
});

test("marketplace notification persistence failure returns 503 for both signed providers", async () => {
  const app = Fastify();
  await registerMarketplaceRoutes(app, { service: { providerNotification: async () => { throw Error("temporary storage outage"); } } });
  try {
    for (const provider of ["shopee", "tiktok-shop"]) {
      const r = await app.inject({ method: "POST", url: `/marketplaces/${provider}/notifications`, payload: { event: "qa" } });
      assert.equal(r.statusCode, 503);
    }
  } finally { await app.close(); }
});
