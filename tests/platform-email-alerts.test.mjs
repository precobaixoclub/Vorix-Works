import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresPlatformEmailAlerts } from "../dist/infrastructure/storage/postgres/postgres-platform-email-alerts.js";
import { PlatformEmailAlerts, PLATFORM_EMAIL_EVENTS } from "../dist/application/notification/platform-email-alerts.js";
import { ResendEmailSender } from "../dist/infrastructure/operations/resend-email-sender.js";
import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";

test("admin configures email and confirmed business events are saved and delivered once", async () => {
  const db = await startTestPostgres({ port: 55827 });
  let app;
  try {
    await applyMigrations(db.pool, join(process.cwd(), "db", "migrations"));
    const master = "test-platform-email-master";
    const key = "re_test-platform-email";
    const repository = new PostgresPlatformEmailAlerts(db.pool, master);
    const calls = [];
    const sender = new ResendEmailSender(async (url, request) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(request.headers.Authorization, `Bearer ${key}`);
      calls.push({ key: request.headers["Idempotency-Key"], body: JSON.parse(request.body) });
      if (calls.length === 1) return Response.json({}, { status: 429 });
      return Response.json({ id: `sent-${calls.length}` });
    });
    const alerts = new PlatformEmailAlerts(repository, sender, "https://vorix.example");
    app = await buildApp({ config: loadApiConfig({ AUTH_MODE: "jwt", JWT_SECRET: master, DATABASE_URL: db.connectionString,
      PERSISTENCE_DRIVER: "memory", ZUNO_LOG_LEVEL: "silent" }), container: { platformEmailAlerts: alerts } });
    const password = "test-password-only123";
    const signup = (email, name) => app.inject({ method: "POST", url: "/v1/auth/signup", payload: { email, password, name } });
    const initial = await signup("owner@example.com", "Test Owner");
    assert.equal(initial.statusCode, 201, initial.body);
    const owner = initial.json().data;
    const url = "/v1/admin/email-notifications";
    const auth = token => ({ authorization: `Bearer ${token}` });
    assert.equal((await app.inject({ url })).statusCode, 401);
    assert.equal((await app.inject({ url, headers: auth(owner.accessToken) })).statusCode, 403);
    await db.pool.query("update users set is_platform_admin=true where id=$1", [owner.user.id]);
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: owner.user.email, password } });
    assert.equal(login.statusCode, 200, login.body);
    const headers = auth(login.json().data.accessToken);
    const put = payload => app.inject({ method: "PUT", url, headers, payload });
    assert.equal((await put({ enabled: true, fromEmail: null, recipients: [], events: [] })).statusCode, 400);
    const settings = { enabled: false, fromEmail: "alerts@example.com", recipients: ["Owner@example.com", "owner@example.com"], events: PLATFORM_EMAIL_EVENTS };
    const saved = await put({ ...settings, apiKey: key });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.body.includes(key), false);
    assert.deepEqual(saved.json().data.recipients, ["owner@example.com"]);
    assert.equal(saved.json().data.hasApiKey, true);
    const stored = await db.pool.query("select api_key_encrypted from platform_email_alert_settings");
    assert.notEqual(stored.rows[0].api_key_encrypted, key);
    assert.equal((await app.inject({ method: "POST", url: `${url}/test`, headers })).statusCode, 202);
    await alerts.dispatch();
    assert.equal((await alerts.history())[0].status, "pending");
    await db.pool.query("update platform_email_deliveries set available_at=now() where event_type='test'");
    await alerts.dispatch();
    assert.equal((await alerts.history())[0].status, "accepted");
    assert.equal(calls[0].key, calls[1].key);
    assert.deepEqual(calls[0].body, calls[1].body);

    assert.equal((await put({ ...settings, enabled: true })).statusCode, 200);
    const customerResponse = await signup("customer@example.com", "Test Customer");
    assert.equal(customerResponse.statusCode, 201, customerResponse.body);
    const { tenantId } = customerResponse.json().data;
    const workspaces = await db.pool.query("select id from workspaces where tenant_id=$1", [tenantId]);
    const workspaceId = workspaces.rows[0].id;
    await db.pool.query("insert into subscriptions(id,tenant_id,plan_version_id,status,billing_provider) values ('email-test-sub',$1,'planv-start-1','trial','mercadopago')", [tenantId]);
    await db.pool.query("update subscriptions set status='active',provider_subscription_id='provider-sub' where id='email-test-sub'");
    await db.pool.query("update subscriptions set status='active' where id='email-test-sub'");
    await db.pool.query("update subscriptions set plan_version_id='planv-pro-1' where id='email-test-sub'");
    await db.pool.query("update subscriptions set cancel_at_period_end=true,current_period_end='2027-01-01Z' where id='email-test-sub'");
    await db.pool.query("update subscriptions set status='cancelled' where id='email-test-sub'");
    await db.pool.query("insert into billing_events(id,tenant_id,subscription_id,event_type) values ('payment-failed-test',$1,'email-test-sub','payment_failed')", [tenantId]);
    await db.pool.query(`insert into notifications (id,tenant_id,workspace_id,user_id,title,source_type,source_id)
      values ('reauth-a',$1,$2,'user-a','Reconectar Instagram','social_account_reauth','account-1'),
        ('reauth-b',$1,$2,'user-b','Reconectar Instagram','social_account_reauth','account-1')`, [tenantId, workspaceId]);
    await db.pool.query(`insert into publication_plans (id,tenant_id,workspace_id,state,mode,idempotency_key,source_artifacts,policy,correlation_id,trace_id)
      values ('email-test-post',$1,$2,'failed','real','email-test-post','[]','{}','correlation','trace')`, [tenantId, workspaceId]);
    await db.pool.query(`insert into publication_dead_letters (id,publication_id,tenant_id,workspace_id,reason,last_error,attempts,last_safe_message)
      values ('email-test-failure','email-test-post',$1,$2,'provider unavailable','{}',3,'Falha confirmada pela integração')`, [tenantId, workspaceId]);

    const jobs = await alerts.history();
    assert.deepEqual(jobs.filter(item => item.status === "pending").map(item => item.event).sort(),
      ["account_created", "subscription_started", "plan_changed", "cancellation_requested", "subscription_cancelled", "payment_failed",
        "publication_action_required", "publication_failed"].sort());
    await alerts.dispatch();
    assert.equal(calls.length, 10);
    assert.ok(calls.some(call => call.body.text.includes("Plano anterior: Start\nNovo plano: Pro")));
    assert.ok(calls.some(call => call.body.text.includes("Falha confirmada pela integração")));
    assert.ok(calls.every(call => call.body.to[0] === "owner@example.com"));
    const history = await app.inject({ url: `${url}/history`, headers });
    assert.equal(history.statusCode, 200);
    assert.ok(history.json().data.every(item => item.status === "accepted"));
  } finally {
    await app?.close();
    await db.stop();
  }
});
