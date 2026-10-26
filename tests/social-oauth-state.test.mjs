import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { InMemoryOAuthStateStore, PostgresOAuthStateStore, hashOAuthState } from "../dist/infrastructure/storage/oauth-state-stores.js";
import { PostgresSocialRepository } from "../dist/infrastructure/storage/postgres/postgres-social-repository.js";
import { safeReturnPath } from "../dist/application/ports/oauth-state-store.port.js";
import { MetaInstagramOAuthService } from "../dist/infrastructure/publication/meta-instagram-oauth-service.js";
import { InMemoryPublicationRepository } from "../dist/infrastructure/storage/in-memory-publication-repository.js";
import { LocalPublicationSecretStore } from "../dist/application/publication/publication-secret-store.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;

before(async () => {
  db = await startTestPostgres({ port: 55471 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

const record = (overrides = {}) => ({ provider: "meta_instagram", tenantId: "tenant-a", workspaceId: "ws-a", userId: "user-a", network: "instagram", returnPath: "/workspaces/ws-a/social/integrations", codeVerifier: "verifier-1", createdAt: "2026-11-01T12:00:00.000Z", expiresAt: "2026-11-01T12:10:00.000Z", ...overrides });
const NOW = "2026-11-01T12:01:00.000Z";

for (const [name, factory] of [["memória", () => new InMemoryOAuthStateStore()], ["Postgres", () => new PostgresOAuthStateStore(db.pool)]]) {
  test(`OAuth state (${name}): uso único, vínculo e devolução do contexto`, async () => {
    const store = factory();
    const state = `state-ok-${name}`;
    await store.create(state, record());
    const consumed = await store.consume({ state, provider: "meta_instagram", now: NOW, tenantId: "tenant-a", userId: "user-a" });
    assert.equal(consumed.ok, true);
    assert.deepEqual({ ...consumed.record }, record());
    const replay = await store.consume({ state, provider: "meta_instagram", now: NOW, tenantId: "tenant-a", userId: "user-a" });
    assert.deepEqual(replay, { ok: false, reason: "ALREADY_CONSUMED" }, "replay recusado");
    assert.deepEqual(await store.consume({ state: "nunca-existiu", provider: "meta_instagram", now: NOW }), { ok: false, reason: "NOT_FOUND" });
  });

  test(`OAuth state (${name}): expirado, outro tenant, outro usuário e outro provider são recusados — e queimam o state`, async () => {
    const store = factory();
    await store.create(`exp-${name}`, record({ expiresAt: "2026-11-01T12:00:30.000Z" }));
    assert.deepEqual(await store.consume({ state: `exp-${name}`, provider: "meta_instagram", now: NOW }), { ok: false, reason: "EXPIRED" });
    assert.deepEqual(await store.consume({ state: `exp-${name}`, provider: "meta_instagram", now: "2026-11-01T12:00:00.000Z" }), { ok: false, reason: "ALREADY_CONSUMED" });

    await store.create(`tenant-${name}`, record());
    assert.deepEqual(await store.consume({ state: `tenant-${name}`, provider: "meta_instagram", now: NOW, tenantId: "tenant-b", userId: "user-a" }), { ok: false, reason: "TENANT_MISMATCH" });
    assert.deepEqual(await store.consume({ state: `tenant-${name}`, provider: "meta_instagram", now: NOW, tenantId: "tenant-a", userId: "user-a" }), { ok: false, reason: "ALREADY_CONSUMED" }, "tentativa de outro tenant queima o state");

    await store.create(`user-${name}`, record());
    assert.deepEqual(await store.consume({ state: `user-${name}`, provider: "meta_instagram", now: NOW, tenantId: "tenant-a", userId: "user-b" }), { ok: false, reason: "USER_MISMATCH" });

    await store.create(`provider-${name}`, record());
    assert.deepEqual(await store.consume({ state: `provider-${name}`, provider: "tiktok", now: NOW }), { ok: false, reason: "PROVIDER_MISMATCH" });
  });

  test(`OAuth state (${name}): limpeza de expirados`, async () => {
    const store = factory();
    await store.create(`old-${name}`, record({ expiresAt: "2026-11-01T11:00:00.000Z" }));
    await store.create(`live-${name}`, record({ expiresAt: "2026-11-01T13:00:00.000Z" }));
    assert.ok((await store.purgeExpired(NOW)) >= 1);
    assert.equal((await store.consume({ state: `live-${name}`, provider: "meta_instagram", now: NOW })).ok, true);
  });
}

test("OAuth state (Postgres): guarda só o hash do state; verificador PKCE apagado no consumo; consumo concorrente vence uma vez", async () => {
  const store = new PostgresOAuthStateStore(db.pool);
  await store.create("segredo-do-state", record());
  const rows = (await db.pool.query("select * from oauth_states where state_hash = $1", [hashOAuthState("segredo-do-state")])).rows;
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify((await db.pool.query("select * from oauth_states")).rows).includes("segredo-do-state"), "state em texto nunca é gravado");
  const results = await Promise.all([1, 2, 3].map(() => store.consume({ state: "segredo-do-state", provider: "meta_instagram", now: NOW })));
  assert.equal(results.filter((result) => result.ok).length, 1, "só um consumo vence");
  const after = (await db.pool.query("select code_verifier, consumed_at from oauth_states where state_hash = $1", [hashOAuthState("segredo-do-state")])).rows[0];
  assert.equal(after.code_verifier, null);
  assert.ok(after.consumed_at);
});

test("OAuth state: sobrevive a 'restart' — outra instância do serviço conclui o callback (store compartilhado)", async () => {
  const store = new PostgresOAuthStateStore(db.pool);
  const http = async (url) => {
    const text = String(url);
    if (text.includes("/oauth/access_token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    if (text.includes("/me/accounts")) return new Response(JSON.stringify({ data: [{ id: "page-1", name: "Loja", access_token: "page-token", instagram_business_account: { id: "ig-1", username: "loja" } }] }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  };
  const make = () => new MetaInstagramOAuthService({ config: { enabled: true, appId: "app", appSecret: "secret", redirectUri: "https://app.test/instagram/callback", scopes: ["pages_show_list"] }, repository: new InMemoryPublicationRepository(), secretStore: new LocalPublicationSecretStore(), httpClient: http, stateStore: store });
  const instanceA = make();
  const begin = await instanceA.begin({ tenantId: "tenant-a", workspaceId: "ws-a", userId: "user-a", network: "instagram", returnPath: "/workspaces/ws-a/social/integrations" });
  const instanceB = make();
  await assert.rejects(() => instanceB.complete({ state: begin.state, code: "c", actor: { tenantId: "tenant-b", userId: "user-a", role: "owner" } }), /META_OAUTH_STATE_INVALID/, "callback de outro tenant é recusado");
  const second = await instanceA.begin({ tenantId: "tenant-a", workspaceId: "ws-a", userId: "user-a", network: "instagram", returnPath: "/workspaces/ws-a/social/integrations" });
  const completed = await instanceB.complete({ state: second.state, code: "c", actor: { tenantId: "tenant-a", userId: "user-a", role: "owner" } });
  assert.deepEqual(completed.flow, { workspaceId: "ws-a", network: "instagram", returnPath: "/workspaces/ws-a/social/integrations" });
  await assert.rejects(() => instanceB.complete({ state: second.state, code: "c", actor: { tenantId: "tenant-a", userId: "user-a", role: "owner" } }), /META_OAUTH_STATE_INVALID/, "callback repetido é recusado");
});

test("OAuth state: caminho de retorno só aceita rota interna", () => {
  assert.equal(safeReturnPath("/workspaces/ws/social/integrations"), "/workspaces/ws/social/integrations");
  for (const bad of ["https://evil.test", "//evil.test", "/\\evil", "workspaces/x", "/a\r\nb"]) assert.equal(safeReturnPath(bad), undefined, bad);
});

test("Migration 0176: repositório social Postgres — conta + conexões por provider, política, destinos e isolamento", async () => {
  const repository = new PostgresSocialRepository(db.pool);
  const account = await repository.createAccount({ id: "acc-pg-1", tenantId: "tenant-a", workspaceId: "ws-a", network: "instagram", providerType: "meta_official", externalAccountId: "ig-1", username: "loja", status: "CONNECTED", accountCapabilities: {}, metadata: {}, consecutiveFailures: 0, createdBy: "user-a" });
  assert.deepEqual(account.connections, []);
  await repository.upsertConnection({ tenantId: "tenant-a", accountId: account.id, connection: { providerType: "meta_official", credentialReferenceId: "cred-1", status: "active" } });
  await repository.upsertConnection({ tenantId: "tenant-a", accountId: account.id, connection: { providerType: "partner_instagram", credentialReferenceId: "cred-2", status: "active" } });
  await repository.upsertConnection({ tenantId: "tenant-a", accountId: account.id, connection: { providerType: "meta_official", credentialReferenceId: "cred-1b", status: "expired" } });
  const loaded = await repository.getAccount({ tenantId: "tenant-a", workspaceId: "ws-a", id: account.id });
  assert.deepEqual(loaded.connections.map((connection) => [connection.providerType, connection.credentialReferenceId, connection.status]), [["meta_official", "cred-1b", "expired"], ["partner_instagram", "cred-2", "active"]]);
  await assert.rejects(() => repository.upsertConnection({ tenantId: "tenant-b", accountId: account.id, connection: { providerType: "meta_official", credentialReferenceId: "x", status: "active" } }), /SOCIAL_ACCOUNT_NOT_FOUND/);
  assert.equal(await repository.getAccount({ tenantId: "tenant-b", workspaceId: "ws-a", id: account.id }), undefined);
  assert.deepEqual((await repository.listAccountsByProvider({ providerType: "partner_instagram" })).map((item) => item.id), [account.id]);
  await repository.removeConnection({ tenantId: "tenant-a", accountId: account.id, providerType: "partner_instagram" });
  assert.equal((await repository.getAccount({ tenantId: "tenant-a", workspaceId: "ws-a", id: account.id })).connections.length, 1);

  const policy = await repository.upsertPolicy({ tenantId: "tenant-a", network: "instagram", publishingEnabled: true, preferredProvider: "meta_official", enabledProviders: ["meta_official"], latePolicy: { toleranceMinutes: 15, whenLate: "SKIP" }, rateLimits: { minimumIntervalSeconds: 300, maxPublicationsPerHour: 3, maxPublicationsPerDay: 10, maxConsecutiveFailures: 2 }, updatedBy: "admin" });
  assert.deepEqual({ ...policy, updatedAt: undefined }, { tenantId: "tenant-a", network: "instagram", publishingEnabled: true, preferredProvider: "meta_official", enabledProviders: ["meta_official"], latePolicy: { toleranceMinutes: 15, whenLate: "SKIP" }, rateLimits: { minimumIntervalSeconds: 300, maxPublicationsPerHour: 3, maxPublicationsPerDay: 10, maxConsecutiveFailures: 2 }, updatedBy: "admin", updatedAt: undefined });
  assert.equal(await repository.getPolicy({ tenantId: "tenant-b", network: "instagram" }), undefined, "sem linha = padrão desligado");
  const flipped = await repository.upsertSwitch({ providerType: "meta_official", enabled: true, approved: false, reason: "teste", updatedBy: "admin" });
  assert.equal(flipped.enabled, true);
  assert.equal(await repository.claimNotification({ tenantId: "tenant-a", dedupeKey: "k", now: NOW, windowMs: 60_000 }), true);
  assert.equal(await repository.claimNotification({ tenantId: "tenant-a", dedupeKey: "k", now: NOW, windowMs: 60_000 }), false, "dedupe atômico");
});
