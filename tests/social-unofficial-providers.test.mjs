import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { InstagramUnofficialProvider, FacebookUnofficialProvider, TikTokUnofficialProvider } from "../dist/infrastructure/social/unofficial-social-providers.js";
import { GatewayError } from "../dist/infrastructure/social/gateway/protocol.js";
import { SocialGatewayClient } from "../dist/infrastructure/social/gateway/client.js";
import { EncryptedGatewayStore } from "../dist/infrastructure/social/gateway/encrypted-store.js";
import { SocialGatewayService } from "../dist/infrastructure/social/gateway/service.js";
import { createSocialGatewayServer } from "../dist/interfaces/social-gateway/server.js";
import { allowedBrowserURL, privateAddress } from "../dist/infrastructure/social/gateway/browser-driver.js";
import { SocialProviderRegistry, SocialProviderResolver } from "../dist/application/social/social-provider-resolver.js";
import { InMemorySocialRepository } from "../dist/infrastructure/storage/in-memory-social-repository.js";

const TYPES = [InstagramUnofficialProvider, FacebookUnofficialProvider, TikTokUnofficialProvider];
const scope = { tenantId: "a", workspaceId: "w", network: "instagram" };
const account = network => ({ ...scope, socialAccountId: "account", network, externalAccountId: "123", metadata: {}, session: { value: { credentialReferenceId: "socgw-11111111-1111-4111-8111-111111111111" } } });
const PUBLISHED = { ok: true, externalPostId: "post-1", externalUrl: "https://www.instagram.com/p/one/", publishedAt: "2026-10-26T15:00:00.000Z" };

for (const Type of TYPES) {
  test(`${Type.name}: same provider contract, connection, capabilities, health, publish, music, disconnect`, async () => {
    const calls = [];
    const gateway = { isConfigured: () => true, call: async (operation, input) => {
      calls.push({ operation, input });
      if (operation === "connect") return { flowId: "flow-1" };
      if (operation === "accounts") return [{ network: input.network, externalAccountId: "123", credentialReferenceId: "private-ref", status: "active" }];
      if (operation === "health") return { healthy: true, externalAccountId: "123", disabledFormats: ["story_image"], disabledFeatures: ["nativeMusic"] };
      if (operation === "publish") return PUBLISHED;
      if (operation === "status") return { kind: "published", ...PUBLISHED };
      if (operation === "music") return [{ musicId: "song-1", title: "Available song", available: true, supportsSegment: false }];
    } };
    const provider = new Type(gateway); const network = provider.network; const context = account(network);
    assert.equal(provider.descriptor.official, false);
    assert.equal(provider.descriptor.implemented, true);
    assert.equal(provider.descriptor.realPublishingValidated, false, "fixtures are never real platform validation");
    const resolver = new SocialProviderResolver(new SocialProviderRegistry([provider]), new InMemorySocialRepository());
    assert.equal((await resolver.connectionProviderFor("new-tenant", network)).ok, true);
    const begin = await provider.connection.begin({ ...scope, network, userId: "user" });
    assert.ok(begin.redirectUrl.startsWith("/workspaces/w/social/connect?"));
    assert.equal((await provider.connection.listAccounts({ ...scope, network }))[0].externalAccountId, "123");
    assert.equal((await provider.healthCheck(context)).disabledFeatures[0], "nativeMusic");
    const capability = provider.getCapabilities(network).formats[0];
    const format = network === "tiktok" ? "short_video" : "feed_image";
    const media = [{ kind: network === "tiktok" ? "video" : "image", url: "https://cdn.example.test/media" }];
    assert.deepEqual(provider.validatePost({ network, format, caption: "Hello", media }), []);
    assert.ok(provider.validatePost({ network, format, caption: "x".repeat(6000), media }).length);
    assert.deepEqual(await provider.publish({ account: context, format, caption: "Hello", media, idempotencyKey: "same-key", attemptStartedAt: "now" }), PUBLISHED);
    assert.equal(calls.find(c => c.operation === "publish").input.credentialReferenceId, context.session.value.credentialReferenceId);
    assert.equal(calls.find(c => c.operation === "publish").input.tenantId, "a");
    assert.equal((await provider.getPublicationStatus({ account: context, providerReference: "same-key", caption: "Hello", attemptStartedAt: "now" })).kind, "published");
    assert.equal((await provider.searchMusic({ account: context, query: "song", format, limit: 10 })).tracks[0].musicId, "song-1");
    await provider.connection.disconnect({ ...scope, credentialReferenceId: "private-ref" });
    assert.equal(calls.at(-1).input.network, network);
    await assert.rejects(() => provider.connection.complete({}), /SOCIAL_CONNECTION_UNAVAILABLE/);
    assert.ok(capability.constraints.maxItems >= capability.constraints.minItems);
  });
  test(`${Type.name}: authentication pauses; dispatch timeout remains unknown; no raw details`, async () => {
    let error = new GatewayError("CHECKPOINT_REQUIRED");
    const provider = new Type({ isConfigured: () => true, call: async () => { throw error; } });
    const request = { account: account(provider.network), format: "feed_image", caption: "", media: [], idempotencyKey: "idem", attemptStartedAt: "now" };
    assert.equal((await provider.publish(request)).failure.errorClass, "CHECKPOINT_REQUIRED");
    error = new GatewayError("SESSION_INVALID");
    assert.equal((await provider.healthCheck(request.account)).failure.errorClass, "SESSION_INVALID");
    error = new GatewayError("NETWORK_ERROR");
    assert.deepEqual(await provider.publish(request), { ok: "unknown", detail: "Aguardando confirmação da rede.", providerReference: "idem" });
    assert.equal((await provider.getPublicationStatus({ account: request.account })).kind, "inconclusive");
    error = new Error("password=secret; Cookie: sessionid=secret; Authorization: private");
    assert.ok(!JSON.stringify(await provider.healthCheck(request.account)).includes("secret"));
  });
}

test("gateway AES-GCM: tenant/workspace/network isolation, ciphertext, tamper rejection, revocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "vorix-gateway-test-"));
  try {
    const store = new EncryptedGatewayStore(root, randomBytes(32).toString("base64"));
    await store.put(scope, "credential", { cookies: [{ name: "sessionid", value: "cookie-secret" }] });
    assert.equal((await store.get(scope, "credential")).cookies[0].value, "cookie-secret");
    for (const other of [{ ...scope, tenantId: "b" }, { ...scope, workspaceId: "other" }, { ...scope, network: "facebook" }]) assert.equal(await store.get(other, "credential"), undefined);
    const bucket = (await readdir(root))[0]; const file = join(root, bucket, (await readdir(join(root, bucket)))[0]);
    const raw = await readFile(file, "utf8"); assert.ok(!raw.includes("cookie-secret"));
    const envelope = JSON.parse(raw); envelope.tag = randomBytes(16).toString("base64"); await writeFile(file, JSON.stringify(envelope));
    await assert.rejects(() => store.get(scope, "credential"), /INTEGRITY_FAILED/);
    await store.remove(scope, "credential"); assert.equal(await store.get(scope, "credential"), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "vorix-gateway-service-"));
  const store = new EncryptedGatewayStore(root, randomBytes(32).toString("base64"));
  let submits = 0; let concurrent = 0; let maxConcurrent = 0;
  const cookies = [{ name: "sessionid", value: "private-session", domain: ".instagram.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }];
  const context = { newPage: async () => ({ screenshot: async () => Buffer.from("image"), locator: () => ({}) }), cookies: async () => cookies };
  const driver = { guardNetwork: async () => {}, login: async () => {}, home: async () => {}, securityState: async () => options.security,
    identity: async () => { if (options.security) throw new GatewayError(options.security); return { externalAccountId: options.mismatch ? "wrong" : "123", username: "owner" }; },
    health: async () => ({ healthy: true, externalAccountId: "123", disabledFormats: ["story_image"], disabledFeatures: ["nativeMusic"] }),
    prepare: async () => { concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent); await new Promise(resolve => setTimeout(resolve, 10)); concurrent--; },
    submit: async () => { submits++; if (options.throwOnSubmit) throw new Error("timeout password=secret"); return PUBLISHED; },
  };
  const pool = { open: async () => ({ context, close: async () => {} }), shutdown: async () => {} };
  const service = new SocialGatewayService(store, pool, { mediaOrigins: [], driverFactory: () => driver, flowTtlMs: options.ttl ?? 60_000 });
  t.after(async () => { await service.shutdown(); await rm(root, { recursive: true, force: true }); });
  const user = { ...scope, userId: "user-a" }; const flow = await service.connect(user);
  return { service, store, user, flow, options, submits: () => submits, maxConcurrent: () => maxConcurrent };
}

test("interactive flow belongs to tenant, workspace, network AND initiating user; no account until verified", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.service.accounts(scope), []);
  for (const other of [{ ...f.user, tenantId: "b" }, { ...f.user, userId: "user-b" }, { ...f.user, workspaceId: "other" }, { ...f.user, network: "facebook" }]) {
    await assert.rejects(() => f.service.frame(other, f.flow.flowId), /NOT_FOUND/);
    await assert.rejects(() => f.service.finish(other, f.flow.flowId), /NOT_FOUND/);
  }
  f.options.security = "CHECKPOINT_REQUIRED";
  assert.equal((await f.service.frame(f.user, f.flow.flowId)).status, "CHECKPOINT_REQUIRED");
  await assert.rejects(() => f.service.finish(f.user, f.flow.flowId), /CHECKPOINT_REQUIRED/);
  assert.deepEqual(await f.service.accounts(scope), []);
  f.options.security = undefined;
  const connected = await f.service.finish(f.user, f.flow.flowId);
  assert.equal(connected.externalAccountId, "123");
  assert.ok(!JSON.stringify(connected).includes("private-session"));
  await assert.rejects(() => f.service.finish(f.user, f.flow.flowId), /NOT_FOUND/);
  await assert.rejects(() => f.service.resolve({ ...scope, tenantId: "b", credentialReferenceId: connected.credentialReferenceId }), /SESSION_INVALID/);
});

test("gateway sequential queue + persistent idempotency prevent repeat submissions after timeout and across retries", async t => {
  const f = await fixture(t, { throwOnSubmit: true });
  const connected = await f.service.finish(f.user, f.flow.flowId);
  const request = { ...scope, ...connected, format: "feed_image", media: [], caption: "x", idempotencyKey: "same" };
  assert.equal((await f.service.publish(request)).ok, "unknown");
  assert.equal((await f.service.publish(request)).ok, "unknown");
  assert.equal(f.submits(), 1);
  assert.equal((await f.service.status({ ...request, providerReference: "same" })).kind, "inconclusive");
  f.options.throwOnSubmit = false;
  await f.service.acknowledge({ ...request, outcome: "not_published" });
  assert.equal((await f.service.publish(request)).ok, true, "explicit human confirmation permits a new attempt");
  assert.equal(f.submits(), 2);
  await assert.rejects(() => f.service.acknowledge({ ...request, outcome: "not_published" }), /UNSUPPORTED/, "positive publication proof cannot be cleared");
  await Promise.all([f.service.publish({ ...request, idempotencyKey: "second" }), f.service.publish({ ...request, idempotencyKey: "third" })]);
  assert.equal(f.maxConcurrent(), 1);
  assert.equal((await f.service.status({ ...request, providerReference: "second" })).kind, "published");
  await f.service.disconnect(request);
  assert.equal((await f.service.publish({ ...request, idempotencyKey: "revoked" })).failure.errorClass, "SESSION_INVALID");
  assert.equal((await f.service.accounts(scope))[0].status, "revoked");
});

test("gateway rejects identity mismatch and expired interactive sessions", async t => {
  const f = await fixture(t);
  const connected = await f.service.finish(f.user, f.flow.flowId);
  f.options.mismatch = true;
  assert.equal((await f.service.health({ ...scope, ...connected })).failure.errorClass, "SESSION_INVALID");
  assert.equal(f.submits(), 0);
  const expiring = await fixture(t, { ttl: 1 });
  await new Promise(resolve => setTimeout(resolve, 5));
  await assert.rejects(() => expiring.service.finish(expiring.user, expiring.flow.flowId), /NOT_FOUND/);
});

test("private RPC requires service token, validates input and redacts exceptions", async t => {
  const f = await fixture(t);
  const token = "a".repeat(40); const app = createSocialGatewayServer(f.service, token); t.after(() => app.close());
  assert.equal((await app.inject({ method: "POST", url: "/rpc/accounts", payload: scope })).statusCode, 401);
  const headers = { authorization: `Bearer ${token}` };
  assert.equal((await app.inject({ method: "POST", url: "/rpc/accounts", headers, payload: { ...scope, tenantId: "" } })).statusCode, 400);
  const rejected = await app.inject({ method: "POST", url: "/rpc/interact", headers, payload: { ...f.user, flowId: f.flow.flowId, action: { kind: "script", text: "document.cookie" } } });
  assert.equal(rejected.statusCode, 400);
  assert.ok(!rejected.body.includes("document.cookie"));
  assert.equal((await app.inject({ method: "POST", url: "/rpc/accounts", headers, payload: scope })).statusCode, 200);
});

test("gateway client never propagates raw secret-bearing HTTP errors or redirects", async () => {
  const client = new SocialGatewayClient("http://gateway:3210", "x".repeat(40), async () => new Response(JSON.stringify({ code: "password=secret" }), { status: 500 }));
  await assert.rejects(() => client.call("accounts", scope), error => error.message === "TEMPORARY_PLATFORM_ERROR");
});

test("browser egress is restricted to platform domains; media rejects private destinations", () => {
  assert.equal(allowedBrowserURL("instagram", "https://www.instagram.com/accounts/login/"), true);
  for (const url of ["http://www.instagram.com/", "https://instagram.com.evil.test/", "https://127.0.0.1/", "file:///etc/passwd", "https://user:pass@instagram.com/", "https://instagram.com:8443/"]) assert.equal(allowedBrowserURL("instagram", url), false);
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.2.3", "192.168.1.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fd00::1"]) assert.equal(privateAddress(ip), true);
  assert.equal(privateAddress("1.1.1.1"), false);
});
