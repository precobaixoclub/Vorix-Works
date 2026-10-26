import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSocialPublishingModule } from "../dist/infrastructure/social/social-publishing-module.js";
import { InMemorySocialRepository } from "../dist/infrastructure/storage/in-memory-social-repository.js";
import { InMemoryPublicationRepository } from "../dist/infrastructure/storage/in-memory-publication-repository.js";
import { InMemoryNotificationRepository } from "../dist/infrastructure/storage/in-memory-notification-repository.js";
import { PublicationDispatchService } from "../dist/application/publication/publication-dispatch-service.js";
import { createDefaultPublicationProviderRegistry } from "../dist/application/publication/publication-provider-registry.js";
import { FakePublicationSecretResolver } from "../dist/application/publication/publication-secret-resolver.js";
import { SocialGatewayClient } from "../dist/infrastructure/social/gateway/client.js";
import { SocialGatewayService } from "../dist/infrastructure/social/gateway/service.js";
import { EncryptedGatewayStore } from "../dist/infrastructure/social/gateway/encrypted-store.js";
import { GatewayError } from "../dist/infrastructure/social/gateway/protocol.js";
import { createSocialGatewayServer } from "../dist/interfaces/social-gateway/server.js";

test("default unofficial adapters → private RPC → isolated session → existing multi-network outbox/retry/reauth engine", async () => {
  const root = await mkdtemp(join(tmpdir(), "vorix-unofficial-core-"));
  const store = new EncryptedGatewayStore(root, randomBytes(32).toString("base64"));
  const state = { tiktokFail: true, expired: false }; const counts = { instagram: 0, facebook: 0, tiktok: 0 };
  const service = new SocialGatewayService(store, {
    open: async () => ({ context: { newPage: async () => ({}), cookies: async () => [{ name: "sessionid", value: "private-session" }] }, close: async () => {} }), shutdown: async () => {},
  }, { mediaOrigins: [], driverFactory: network => ({
    guardNetwork: async () => {}, login: async () => {}, home: async () => {},
    identity: async () => { if (state.expired) throw new GatewayError("SESSION_INVALID"); return { externalAccountId: "same-external-profile", username: "test" }; },
    health: async () => ({ healthy: true, externalAccountId: "same-external-profile", disabledFormats: [], disabledFeatures: ["nativeMusic", "musicSegment"] }),
    prepare: async () => { if (network === "tiktok" && state.tiktokFail) throw new GatewayError("UNSUPPORTED"); },
    submit: async () => { counts[network]++; if (network === "instagram" && state.unknownOnce) { state.unknownOnce = false; return { ok: "unknown", detail: "Transport interrupted" }; } return { ok: true, externalPostId: `${network}-${counts[network]}`, publishedAt: new Date().toISOString() }; },
  }) });
  const token = "t".repeat(40); const server = createSocialGatewayServer(service, token);
  const gateway = new SocialGatewayClient("http://gateway", token, async (url, init) => {
    const response = await server.inject({ method: "POST", url: new URL(url).pathname, headers: init.headers, payload: init.body });
    return new Response(response.body, { status: response.statusCode });
  });
  let id = 0; let time = Date.parse("2026-10-26T15:00:00.000Z"); const now = () => new Date(time);
  const repository = new InMemorySocialRepository(); const publicationRepository = new InMemoryPublicationRepository();
  const secretResolver = new FakePublicationSecretResolver(); const owner = { userId: "owner", role: "owner" };
  const social = createSocialPublishingModule({ gateway, repository, publicationRepository, credentials: secretResolver, notification: { notificationRepository: new InMemoryNotificationRepository() }, mediaProbe: null, idGenerator: () => `id-${++id}`, now });
  const registry = createDefaultPublicationProviderRegistry([social.router]);
  const dispatcher = new PublicationDispatchService({ repository: publicationRepository, providerRegistry: registry, secretResolver, idGenerator: () => `id-${++id}`, maxBatch: 1, now });
  const scope = { tenantId: "tenant-a", workspaceId: "workspace-a" };
  async function connect(network, extra = {}) {
    const flow = await gateway.call("connect", { ...scope, network, userId: owner.userId, ...extra });
    await gateway.call("finish", { ...scope, network, userId: owner.userId, ...extra, flowId: flow.flowId });
    await social.accounts.syncConnections({ ...scope, ...extra, network, actor: owner });
  }
  async function drain() { for (let i = 0; i < 12; i++) await dispatcher.dispatchAvailable("test-worker"); }
  try {
    for (const network of ["instagram", "facebook", "tiktok"]) await connect(network);
    const accounts = await repository.listAccounts(scope);
    assert.equal(accounts.length, 3); assert.ok(accounts.every(a => a.providerType.endsWith("_unofficial") && a.status === "HEALTHY"));
    assert.ok(!JSON.stringify(await social.accounts.listAccountViews(scope)).includes("private-session"));
    const post = await social.posts.create({ ...scope, actor: owner, idempotencyKey: "three-networks", base: { caption: "Test", media: [{ kind: "video", url: "https://cdn.example.test/v.mp4", hasAudio: true }] }, destinations: accounts.map(a => ({ accountId: a.id, format: a.network === "instagram" ? "reel" : a.network === "facebook" ? "feed_video" : "short_video", audioMode: "EMBEDDED_AUDIO" })), when: { mode: "now" } });
    await drain();
    const partial = await social.posts.get({ ...scope, postId: post.id });
    assert.equal(partial.state, "PARTIAL_SUCCESS"); assert.deepEqual(counts, { instagram: 1, facebook: 1, tiktok: 0 });
    const failed = partial.destinations.find(d => d.network === "tiktok");
    state.tiktokFail = false; time += 180_000;
    await social.posts.retryDestination({ ...scope, destinationId: failed.id, actor: owner }); await drain();
    assert.equal((await social.posts.get({ ...scope, postId: post.id })).state, "PUBLISHED");
    assert.deepEqual(counts, { instagram: 1, facebook: 1, tiktok: 1 }, "retry never republishes successful destinations");
    await connect("instagram", { tenantId: "tenant-b", workspaceId: "workspace-b" });
    const other = (await repository.listAccounts({ tenantId: "tenant-b", workspaceId: "workspace-b" }))[0];
    const original = accounts.find(a => a.network === "instagram");
    await assert.rejects(() => gateway.call("resolve", { ...scope, network: "instagram", credentialReferenceId: other.connections[0].credentialReferenceId }), /SESSION_INVALID/);
    state.expired = true;
    assert.equal((await social.accounts.testConnection({ ...scope, accountId: original.id })).account.status, "REAUTH_REQUIRED");
    state.expired = false; await connect("instagram");
    assert.equal((await social.accounts.requireAccount({ ...scope, accountId: original.id })).status, "HEALTHY");
    assert.equal((await repository.listAccounts(scope)).length, 3, "reconnection preserves SocialAccount identity");
    time += 180_000; state.unknownOnce = true;
    const uncertain = await social.posts.create({ ...scope, actor: owner, idempotencyKey: "unknown-manual", base: { caption: "Second post", media: [{ kind: "image", url: "https://cdn.example.test/a.jpg" }] }, destinations: [{ accountId: original.id, format: "feed_image" }], when: { mode: "now" } });
    await drain();
    const unknown = await social.posts.get({ ...scope, postId: uncertain.id });
    assert.equal(unknown.state, "RECONCILIATION_REQUIRED");
    await social.posts.resolveUnknown({ ...scope, destinationId: unknown.destinations[0].id, actor: owner, outcome: "not_published" });
    time += 180_000;
    await social.posts.retryDestination({ ...scope, destinationId: unknown.destinations[0].id, actor: owner }); await drain();
    assert.equal((await social.posts.get({ ...scope, postId: uncertain.id })).state, "PUBLISHED", "manual reconciliation reaches the same gateway journal before retry");
    assert.equal(counts.instagram, 3);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});
