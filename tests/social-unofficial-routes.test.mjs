import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { registerSocialRoutes } from "../dist/interfaces/api/routes/v1/social.route.js";

test("interactive API enforces RBAC + workspace ownership before forwarding any browser operation", async () => {
  let principal = { tenantId: "a", userId: "owner", role: "owner", permissionGrants: [], permissionRevokes: [] };
  const calls = [];
  const social = {
    resolver: { connectionProviderFor: async () => ({ ok: true, providerType: "instagram_unofficial" }) },
    gateway: { call: async (op, input) => { calls.push({ op, input }); return { accepted: true }; } },
  };
  const app = Fastify();
  app.addHook("onRequest", async request => { request.zunoContext = { principal }; });
  app.setErrorHandler((error, _request, reply) => reply.code(error.statusCode ?? 500).send({ code: error.code }));
  await registerSocialRoutes(app, { social, workspaceRepository: { getById: async id => ({ id, tenantId: id === "ws-a" ? "a" : "b" }) }, idGenerator: () => "id" });
  const url = "/social/connections/interactive/11111111-1111-4111-8111-111111111111/interact";
  const payload = { workspaceId: "ws-a", network: "instagram", action: { kind: "text", text: "not-logged" } };
  try {
    principal = { ...principal, permissions: [] };
    assert.equal((await app.inject({ method: "POST", url, payload })).statusCode, 403); assert.equal(calls.length, 0);
    principal = { ...principal, permissions: ["marketing:social_connect"] };
    assert.equal((await app.inject({ method: "POST", url, payload: { ...payload, workspaceId: "ws-b" } })).statusCode, 404); assert.equal(calls.length, 0);
    const accepted = await app.inject({ method: "POST", url, payload });
    assert.equal(accepted.statusCode, 200); assert.equal(accepted.headers["cache-control"], "no-store");
    assert.equal(calls[0].input.tenantId, "a"); assert.equal(calls[0].input.userId, "owner");
    assert.equal((await app.inject({ method: "POST", url, payload: { ...payload, action: { kind: "script", text: "document.cookie" } } })).statusCode, 400);
    assert.equal(calls.length, 1, "arbitrary browser commands are never forwarded");
  } finally { await app.close(); }
});

test("0178 upgrades untouched defaults, preserves explicit policies/official switches, and broadens formats", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table social_provider_switches(provider_type text primary key, enabled boolean, approved boolean, reason text, updated_by text);
      create table social_provider_policies(tenant_id text, network text, publishing_enabled boolean, preferred_provider text, enabled_providers text[], updated_by text, updated_at timestamptz default now());
      create table social_post_destinations(format text constraint social_post_destinations_format_check check(format in ('feed_image')));
      insert into social_provider_switches values('meta_official', false, false, 'preserved', 'admin');
      insert into social_provider_policies values
        ('untouched','instagram',false,'meta_official','{}',null,now()),
        ('disabled-explicitly','instagram',false,'meta_official','{}','admin',now()),
        ('official-explicitly','facebook',true,'meta_official','{meta_official}','admin',now());
    `);
    const sql = await readFile(new URL("../db/migrations/0178_social_unofficial_defaults.sql", import.meta.url), "utf8");
    await db.exec(sql); await db.exec(sql);
    const policies = (await db.query("select * from social_provider_policies order by tenant_id")).rows;
    assert.equal(policies.find(p => p.tenant_id === "untouched").preferred_provider, "instagram_unofficial");
    assert.equal(policies.find(p => p.tenant_id === "untouched").publishing_enabled, true);
    assert.equal(policies.find(p => p.tenant_id === "disabled-explicitly").publishing_enabled, false);
    assert.equal(policies.find(p => p.tenant_id === "official-explicitly").preferred_provider, "meta_official");
    assert.equal((await db.query("select * from social_provider_switches where provider_type='meta_official'")).rows[0].enabled, false);
    assert.equal((await db.query("select * from social_provider_switches where provider_type like '%_unofficial'")).rows.length, 3);
    await db.exec("insert into social_post_destinations values('feed_text'),('feed_image'),('reel')");
  } finally { await db.close(); }
});
