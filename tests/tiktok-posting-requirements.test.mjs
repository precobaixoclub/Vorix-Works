import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { TikTokOAuthService, TIKTOK_REQUIRED_SCOPES } from "../dist/infrastructure/publication/tiktok-oauth-service.js";
import { TikTokContentPostingProvider } from "../dist/infrastructure/publication/tiktok-content-posting-provider.js";
import { InMemoryPublicationRepository } from "../dist/infrastructure/storage/in-memory-publication-repository.js";
import { LocalPublicationSecretStore } from "../dist/application/publication/publication-secret-store.js";
import { StoredPublicationSecretResolver } from "../dist/application/publication/publication-secret-resolver.js";
import { PublicationProviderRegistry } from "../dist/application/publication/publication-provider-registry.js";
import { PublicationReconciliationService } from "../dist/application/publication/publication-reconciliation-service.js";
import { registerTikTokRoutes } from "../dist/interfaces/api/routes/v1/tiktok.route.js";
import { registerErrorHandler } from "../dist/interfaces/api/http/error-handler.js";
import { validateTikTokPostChoices } from "../dist/infrastructure/publication/tiktok-posting-requirements.js";
import { InMemoryPublicationQueue } from "../dist/application/publication/publication-queue.js";

const data = { creator_nickname: "Minha loja", creator_username: "minhaloja", privacy_level_options: ["FOLLOWER_OF_CREATOR", "SELF_ONLY"], comment_disabled: true, duet_disabled: true, stitch_disabled: true, max_video_post_duration_sec: 60 };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const creator = () => json({ data, error: { code: "ok" } });
const choices = { privacyLevel: "SELF_ONLY", musicUsageAccepted: true, commercialContent: true, brandOrganic: true };
const request = (payload) => ({ tenantId: "t", workspaceId: "w", publicationId: "p", targetId: "target", attemptId: "a", channel: "tiktok", mode: "real", idempotencyKey: "idem", content: { artifacts: [{ payload }] }, assets: [], correlationId: "p", traceId: "p", secret: { credentialReferenceId: "cred", providerId: "tiktok", value: { accessToken: "private-token" } } });

async function setupOAuth(httpClient) {
  const repository = new InMemoryPublicationRepository(), secretStore = new LocalPublicationSecretStore();
  await repository.createCredentialReference({ credentialReferenceId: "cred", tenantId: "t", workspaceId: "w", providerId: "tiktok", status: "active", scopes: ["video.publish"] });
  await secretStore.put({ credentialReferenceId: "cred", tenantId: "t", workspaceId: "w", providerId: "tiktok", value: { accessToken: "private-token", refreshToken: "private-refresh", openId: "me" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const service = new TikTokOAuthService({ repository, secretStore, config: { enabled: true, clientKey: "sb-example", clientSecret: "private-secret", redirectUri: "https://app.test/cb", scopes: TIKTOK_REQUIRED_SCOPES }, httpClient });
  return { service, repository, secretStore };
}

test("Creator info uses scoped credentials, refreshes safely, returns only current profile/restrictions", async () => {
  let queries = 0;
  const { service, secretStore } = await setupOAuth(async (url, init) => {
    if (String(url).includes("/oauth/token/")) return json({ access_token: "renewed-private", refresh_token: "renewed-refresh", open_id: "me", scope: "user.info.basic,video.publish", expires_in: 86400 });
    queries++;
    if (queries === 1) return json({ error: { code: "access_token_invalid" } }, 401);
    assert.equal(init.headers.Authorization, "Bearer renewed-private");
    return creator();
  });
  const info = await service.creatorInfo({ tenantId: "t", workspaceId: "w", credentialReferenceId: "cred" });
  assert.equal(info.creatorNickname, "Minha loja");
  assert.deepEqual(info.privacyLevelOptions, data.privacy_level_options);
  assert.equal(info.commentDisabled, true);
  assert.equal(info.sandbox, true);
  assert.ok(!JSON.stringify(info).includes("private"));
  assert.equal((await secretStore.get({ tenantId: "t", workspaceId: "w", providerId: "tiktok", credentialReferenceId: "cred" })).value.refreshToken, "renewed-refresh");
  await assert.rejects(service.creatorInfo({ tenantId: "other", workspaceId: "w", credentialReferenceId: "cred" }), /Conecte uma conta/);
  await assert.rejects(service.creatorInfo({ tenantId: "t", workspaceId: "other", credentialReferenceId: "cred" }), /Conecte uma conta/);
  assert.equal(queries, 2);
  assert.deepEqual(TIKTOK_REQUIRED_SCOPES, ["user.info.basic", "video.publish"]);
});

test("Creator info rejects posting limits even when TikTok returns HTTP 200", async () => {
  const { service } = await setupOAuth(async () => json({ error: { code: "spam_risk_too_many_posts" } }));
  await assert.rejects(service.creatorInfo({ tenantId: "t", workspaceId: "w", credentialReferenceId: "cred" }), /limite de publicações/);
});

test("Server rejects missing agreement, commercial disclosure and private paid partnerships before any upload", async () => {
  let calls = 0;
  const provider = new TikTokContentPostingProvider({}, async () => { calls++; return creator(); });
  for (const [patch, code] of [
    [{ privacyLevel: "" }, "TIKTOK_PRIVACY_REQUIRED"],
    [{ musicUsageAccepted: false }, "TIKTOK_MUSIC_CONSENT_REQUIRED"],
    [{ brandOrganic: false }, "TIKTOK_DISCLOSURE_REQUIRED"],
    [{ brandContent: true }, "TIKTOK_BRANDED_PRIVATE"],
  ]) {
    const result = await provider.publish(request({ ...choices, imageUrls: ["https://cdn.test/a.jpg"], ...patch }));
    assert.equal(result.kind, "rejected"); assert.equal(result.errorCode, code);
  }
  assert.equal(calls, 0);
  assert.throws(() => validateTikTokPostChoices({ ...choices, videoUrl: "https://cdn.test/v.mp4" }), /duração/);
});

test("Fresh creator restrictions prevent invalid privacy, overlong videos and disabled interactions", async () => {
  const calls = [];
  const provider = new TikTokContentPostingProvider({ statusPollAttempts: 1 }, async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: JSON.parse(init.body) });
    if (path.endsWith("/creator_info/query/")) return creator();
    if (path.endsWith("/status/fetch/")) return json({ data: { status: "PUBLISH_COMPLETE" }, error: { code: "ok" } });
    return json({ data: { publish_id: "publish-1" }, error: { code: "ok" } });
  });
  const invalid = await provider.publish(request({ ...choices, privacyLevel: "PUBLIC_TO_EVERYONE", imageUrls: ["https://cdn.test/a.jpg"] }));
  assert.equal(invalid.errorCode, "privacy_level_option_mismatch");
  const long = await provider.publish(request({ ...choices, videoUrl: "https://cdn.test/v.mp4", videoDurationSec: 60.1 }));
  assert.equal(long.errorCode, "TIKTOK_VIDEO_TOO_LONG");
  assert.equal(calls.filter(call => call.path.endsWith("/init/")).length, 0);
  const accepted = await provider.publish(request({ ...choices, disableComment: false, imageUrls: ["https://cdn.test/a.jpg"] }));
  assert.equal(accepted.kind, "published");
  const body = calls.find(call => call.path.endsWith("/content/init/")).body;
  assert.equal(body.post_info.brand_organic_toggle, true);
  assert.equal(body.post_info.brand_content_toggle, false);
  assert.equal(body.post_info.disable_comment, true);
  assert.ok(!("disable_duet" in body.post_info));
  assert.ok(!("musicUsageAccepted" in body.post_info));
  const video = await provider.publish(request({ ...choices, privacyLevel: "FOLLOWER_OF_CREATOR", brandContent: true, disableDuet: false, disableStitch: false, videoUrl: "https://cdn.test/v.mp4", videoDurationSec: 1.9 }));
  assert.equal(video.kind, "published");
  const videoBody = calls.find(call => call.path.endsWith("/video/init/")).body;
  assert.equal(videoBody.post_info.brand_content_toggle, true);
  assert.equal(videoBody.post_info.brand_organic_toggle, true);
  assert.equal(videoBody.post_info.disable_duet, true);
  assert.equal(videoBody.post_info.disable_stitch, true);
});

test("Pending TikTok stays unconfirmed and status failures never trigger a second upload", async () => {
  let inits = 0;
  const provider = new TikTokContentPostingProvider({ statusPollAttempts: 1 }, async url => {
    if (String(url).endsWith("/creator_info/query/")) return creator();
    if (String(url).endsWith("/status/fetch/")) throw new Error("network lost after successful init");
    inits++; return json({ data: { publish_id: "tracking-1" }, error: { code: "ok" } });
  });
  const result = await provider.publish(request({ ...choices, imageUrls: ["https://cdn.test/a.jpg"] }));
  assert.equal(result.kind, "unknown_outcome"); assert.equal(result.providerRequestId, "tracking-1"); assert.equal(inits, 1);
});

test("TikTok reconciliation retains pending lookups and uses the original credential reference", async () => {
  let complete = false, receipts = 0;
  const statuses = [], resolved = [];
  const provider = new TikTokContentPostingProvider();
  const registry = new PublicationProviderRegistry();
  registry.register({ ...provider, descriptor: provider.descriptor, getStatus: async () => complete ? { kind: "published", providerPublicationId: "real-post", publishedAt: new Date().toISOString() } : { kind: "inconclusive", safeMessage: "processing" } });
  const service = new PublicationReconciliationService({
    repository: {
      listReconciliations: async () => [{ id: "r", publicationId: "p", targetId: "target", attemptId: "a", outboxMessageId: "outbox", tenantId: "t", workspaceId: "w", providerId: "tiktok", providerRequestId: "tracking", status: "pending" }],
      getDetail: async () => ({ outbox: [{ outboxMessageId: "outbox", credentialReferenceId: "original-account" }], targets: [{ id: "target", channel: "tiktok", mode: "real" }], payloadReferences: [], plan: {} }),
      updateReconciliationStatus: async input => statuses.push(input),
      confirmReconciliationPublished: async () => { receipts++; return true; }, appendEvent: async () => {},
    }, providerRegistry: registry, secretResolver: { resolve: async input => { resolved.push(input); return {}; } }, idGenerator: () => "id",
  });
  assert.equal((await service.reconcile({ tenantId: "t", workspaceId: "w", providerIds: ["tiktok"] })).inconclusive, 1);
  assert.equal(statuses.length, 0); assert.equal(receipts, 0);
  assert.equal(resolved[0].credentialReferenceId, "original-account");
  complete = true;
  assert.equal((await service.reconcile({ tenantId: "t", workspaceId: "w", providerIds: ["tiktok"] })).confirmed, 1);
  assert.equal(receipts, 1);
});

test("TikTok routes expose no tokens and reject invalid submissions before storing publication plans", async t => {
  const { service, repository, secretStore } = await setupOAuth(async () => creator());
  const app = Fastify(); t.after(() => app.close()); registerErrorHandler(app);
  app.addHook("onRequest", async request => { request.zunoContext = { principal: { tenantId: "t", userId: "u", role: "owner" } }; });
  await registerTikTokRoutes(app, { publicationRepository: repository, providers: [], providerRegistry: new PublicationProviderRegistry(), secretResolver: new StoredPublicationSecretResolver(secretStore), tiktokOAuthService: service, idGenerator: () => "id", queue: {}, providerPolicy: {} });
  const response = await app.inject("/tiktok/creator-info?workspaceId=w&credentialReferenceId=cred");
  assert.equal(response.statusCode, 200); assert.equal(response.headers["cache-control"], "no-store"); assert.ok(!response.body.includes("private-token"));
  const foreign = await app.inject("/tiktok/creator-info?workspaceId=other&credentialReferenceId=cred"); assert.equal(foreign.statusCode, 404);
  for (const patch of [{ musicUsageAccepted: false }, { brandOrganic: false }, { brandContent: true }, { privacyLevel: "PUBLIC_TO_EVERYONE" }]) {
    const rejected = await app.inject({ method: "POST", url: "/tiktok/posts", payload: { workspaceId: "w", credentialReferenceId: "cred", description: "Hello", imageUrls: ["https://cdn.test/a.jpg"], ...choices, ...patch } });
    assert.ok(rejected.statusCode >= 400 && rejected.statusCode < 500, rejected.body);
  }
  assert.equal((await repository.listPlans({ tenantId: "t", workspaceId: "w" })).length, 0);
});

test("TikTok HTTP flow persists agreement/disclosure, polls pending status and creates only confirmed receipts", async t => {
  const { service, repository, secretStore } = await setupOAuth(async () => creator());
  let complete = false, uploads = 0, counter = 0;
  const provider = new TikTokContentPostingProvider({ statusPollAttempts: 1 }, async url => {
    if (String(url).endsWith("/creator_info/query/")) return creator();
    if (String(url).endsWith("/status/fetch/")) return json({ data: { status: complete ? "PUBLISH_COMPLETE" : "PROCESSING_UPLOAD", ...(complete ? { publicaly_available_post_id: ["post-id"] } : {}) }, error: { code: "ok" } });
    uploads++; return json({ data: { publish_id: "tracking-1" }, error: { code: "ok" } });
  });
  const registry = new PublicationProviderRegistry(); registry.register(provider);
  const app = Fastify(); t.after(() => app.close()); registerErrorHandler(app);
  app.addHook("onRequest", async request => { request.zunoContext = { principal: { tenantId: "t", userId: "u", role: "owner" } }; });
  await registerTikTokRoutes(app, { publicationRepository: repository, providers: [], providerRegistry: registry, secretResolver: new StoredPublicationSecretResolver(secretStore), tiktokOAuthService: service, idGenerator: () => `id-${++counter}`, queue: new InMemoryPublicationQueue(), providerPolicy: { shouldFallbackToDryRun: () => false } });
  const submitted = await app.inject({ method: "POST", url: "/tiktok/posts", payload: { workspaceId: "w", credentialReferenceId: "cred", description: "Minha marca", imageUrls: ["https://cdn.test/a.jpg"], ...choices } });
  assert.equal(submitted.statusCode, 200, submitted.body);
  assert.equal(submitted.json().data.state, "publishing");
  const id = submitted.json().data.publicationId;
  const detail = await repository.getDetail(id);
  assert.equal(detail.receipts.length, 0);
  assert.ok(detail.plan.sourceArtifacts[0].payload.musicUsageAcceptedAt);
  assert.equal(detail.plan.sourceArtifacts[0].payload.brandOrganic, true);
  const pending = await app.inject("/tiktok/posts?workspaceId=w");
  assert.equal(pending.json().data[0].state, "publishing");
  complete = true;
  const confirmed = await app.inject("/tiktok/posts?workspaceId=w");
  assert.equal(confirmed.json().data[0].state, "published");
  assert.equal((await repository.getDetail(id)).receipts.length, 1);
  await app.inject("/tiktok/posts?workspaceId=w");
  assert.equal(uploads, 1);
  assert.equal((await repository.getDetail(id)).receipts.length, 1);
});
