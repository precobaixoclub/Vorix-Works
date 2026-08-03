import test from "node:test";
import assert from "node:assert/strict";

import { PublicationGovernancePolicy } from "../dist/application/credential/publication-governance-policy.js";
import { PublicationProviderPolicy } from "../dist/application/publication/publication-provider-policy.js";
import { StoredPublicationSecretResolver } from "../dist/application/publication/publication-secret-resolver.js";
import { LocalPublicationSecretStore } from "../dist/application/publication/publication-secret-store.js";
import { TikTokContentPostingProvider, extractTikTokPost } from "../dist/infrastructure/publication/tiktok-content-posting-provider.js";
import { TikTokOAuthService } from "../dist/infrastructure/publication/tiktok-oauth-service.js";
import { InMemoryPublicationRepository } from "../dist/infrastructure/storage/in-memory-publication-repository.js";

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function publishRequest(overrides = {}) {
  return {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    publicationId: "publication-1",
    targetId: "target-1",
    attemptId: "attempt-1",
    channel: "tiktok",
    mode: "real",
    idempotencyKey: "tiktok-idem-1",
    content: { artifacts: [] },
    assets: [],
    correlationId: "corr-1",
    traceId: "trace-1",
    secret: { credentialReferenceId: "cred-1", providerId: "tiktok", value: { accessToken: "act-token" } },
    ...overrides,
  };
}

function videoArtifact(description = "Promo da semana") {
  return { artifactId: "a1", artifactType: "video", schemaId: "inline.tiktok.post", schemaVersion: 1, checksum: "inline", payload: { description, videoUrl: "https://cdn.test/video.mp4" } };
}

test("TikTok OAuth: cada workspace conecta a própria conta e o token fica só no secret store", async () => {
  const repository = new InMemoryPublicationRepository();
  const secretStore = new LocalPublicationSecretStore();
  const httpClient = async (url, init) => {
    const href = String(url);
    if (href.includes("/v2/oauth/token/")) {
      const body = String(init.body);
      assert.ok(body.includes("grant_type=authorization_code"));
      assert.ok(body.includes("code_verifier="));
      return jsonResponse({ access_token: "tt-access", refresh_token: "tt-refresh", open_id: "open-123", scope: "user.info.basic,video.publish", expires_in: 86400 });
    }
    if (href.includes("/v2/user/info/")) return jsonResponse({ data: { user: { display_name: "Loja Vorix", avatar_url: "https://cdn.test/a.png" } } });
    return jsonResponse({ error: { code: "unexpected" } }, 400);
  };
  const service = new TikTokOAuthService({
    config: { enabled: true, clientKey: "key-1", clientSecret: "secret-1", redirectUri: "https://app.test/tiktok/callback", scopes: ["user.info.basic", "video.publish"], environment: "production" },
    repository,
    secretStore,
    httpClient,
  });

  const begin = service.begin({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.ok(begin.authorizationUrl.startsWith("https://www.tiktok.com/v2/auth/authorize/"));
  assert.ok(begin.authorizationUrl.includes("code_challenge_method=S256"));
  assert.ok(begin.authorizationUrl.includes(`state=${encodeURIComponent(begin.state)}`));

  const completed = await service.complete({ state: begin.state, code: "auth-code" });
  assert.equal(completed.providerSubjectId, "open-123");
  assert.equal(completed.displayName, "Loja Vorix");

  const references = await repository.listCredentialReferences({ tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "tiktok" });
  assert.equal(references.length, 1);
  assert.equal(references[0].status, "active");
  assert.equal(JSON.stringify(references).includes("tt-access"), false);
  assert.equal(JSON.stringify(references).includes("tt-refresh"), false);

  const resolved = await new StoredPublicationSecretResolver(secretStore).resolve({ tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "tiktok", credentialReferenceId: references[0].credentialReferenceId });
  assert.equal(resolved.value.accessToken, "tt-access");

  const status = await service.status({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(status.connected, true);
  assert.equal(status.accounts[0].displayName, "Loja Vorix");

  // State é de uso único: reaproveitar o mesmo callback tem que falhar.
  await assert.rejects(() => service.complete({ state: begin.state, code: "auth-code" }), /TIKTOK_OAUTH_STATE_INVALID/);
});

test("TikTok OAuth: state expirado é recusado e serviço sem credenciais não inicia fluxo", async () => {
  const secretStore = new LocalPublicationSecretStore();
  const repository = new InMemoryPublicationRepository();
  let now = new Date("2026-01-01T00:00:00.000Z");
  const service = new TikTokOAuthService({
    config: { enabled: true, clientKey: "key-1", clientSecret: "secret-1", redirectUri: "https://app.test/cb", scopes: ["video.publish"] },
    repository,
    secretStore,
    httpClient: async () => jsonResponse({ access_token: "x", open_id: "o" }),
    now: () => now,
  });
  const begin = service.begin({ tenantId: "t", workspaceId: "w" });
  now = new Date("2026-01-01T00:11:00.000Z");
  await assert.rejects(() => service.complete({ state: begin.state, code: "c" }), /TIKTOK_OAUTH_STATE_INVALID/);

  const disabled = new TikTokOAuthService({ config: { enabled: false, scopes: [] }, repository, secretStore });
  assert.equal(disabled.isConfigured(), false);
  assert.throws(() => disabled.begin({ tenantId: "t", workspaceId: "w" }), /TIKTOK_OAUTH_NOT_CONFIGURED/);
});

test("TikTok Provider: vídeo com descrição vira DIRECT_POST e receipt confirma post publicado", async () => {
  const calls = [];
  const provider = new TikTokContentPostingProvider({ apiBaseUrl: "https://open.tiktokapis.test", statusPollAttempts: 1 }, async (url, init) => {
    const href = String(url);
    calls.push({ href, body: JSON.parse(String(init.body)) });
    if (href.endsWith("/v2/post/publish/video/init/")) return jsonResponse({ data: { publish_id: "publish-1" }, error: { code: "ok" } });
    if (href.endsWith("/v2/post/publish/status/fetch/")) return jsonResponse({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["7300"] }, error: { code: "ok" } });
    return jsonResponse({ error: { code: "unexpected" } }, 400);
  });

  const result = await provider.publish(publishRequest({ content: { artifacts: [videoArtifact()] } }));
  assert.equal(result.kind, "published");
  assert.equal(result.providerRequestId, "publish-1");
  assert.equal(result.providerPublicationId, "7300");

  const init = calls.find((call) => call.href.endsWith("/v2/post/publish/video/init/"));
  assert.equal(init.body.post_info.title, "Promo da semana");
  assert.equal(init.body.post_info.privacy_level, "PUBLIC_TO_EVERYONE");
  assert.equal(init.body.source_info.source, "PULL_FROM_URL");
  assert.equal(init.body.source_info.video_url, "https://cdn.test/video.mp4");

  const verified = await provider.verifyReceipt(
    { id: "r1", publicationId: "publication-1", targetId: "target-1", provider: "tiktok", providerPublicationId: "publish-1", channel: "tiktok", publishedAt: "2026-07-01T00:00:00.000Z", status: "published", checksum: "checksum", correlationId: "corr-1", traceId: "trace-1", idempotencyKey: "tiktok-idem-1", createdAt: "2026-07-01T00:00:00.000Z" },
    { credentialReferenceId: "cred-1", providerId: "tiktok", value: { accessToken: "act-token" } },
  );
  assert.equal(verified.verificationStatus, "verified");
});

test("TikTok Provider: foto usa content/init com PHOTO e mídia ausente é rejeitada", async () => {
  const calls = [];
  const provider = new TikTokContentPostingProvider({ apiBaseUrl: "https://open.tiktokapis.test", statusPollAttempts: 0 }, async (url, init) => {
    calls.push({ href: String(url), body: JSON.parse(String(init.body)) });
    return jsonResponse({ data: { publish_id: "publish-photo" }, error: { code: "ok" } });
  });

  const photo = { artifactId: "a2", artifactType: "image", schemaId: "inline.tiktok.post", schemaVersion: 1, checksum: "inline", payload: { description: "Novidades", imageUrls: ["https://cdn.test/1.jpg", "https://cdn.test/2.jpg"], photoCoverIndex: 1 } };
  const result = await provider.publish(publishRequest({ content: { artifacts: [photo] } }));
  assert.equal(result.kind, "published");
  assert.equal(calls[0].href.endsWith("/v2/post/publish/content/init/"), true);
  assert.equal(calls[0].body.media_type, "PHOTO");
  assert.equal(calls[0].body.post_mode, "DIRECT_POST");
  assert.equal(calls[0].body.post_info.description, "Novidades");
  assert.deepEqual(calls[0].body.source_info.photo_images, ["https://cdn.test/1.jpg", "https://cdn.test/2.jpg"]);
  assert.equal(calls[0].body.source_info.photo_cover_index, 1);

  const empty = await provider.publish(publishRequest({ content: { artifacts: [{ payload: { description: "sem mídia" } }] } }));
  assert.equal(empty.kind, "rejected");
  assert.equal(empty.errorCode, "TIKTOK_MEDIA_MISSING");
});

test("TikTok Provider: token expirado é renovado uma vez e erros mapeiam categorias corretas", async () => {
  let attempt = 0;
  const provider = new TikTokContentPostingProvider({ apiBaseUrl: "https://open.tiktokapis.test", statusPollAttempts: 0 }, async (url, init) => {
    if (String(url).endsWith("/v2/post/publish/video/init/")) {
      attempt += 1;
      if (attempt === 1) return jsonResponse({ error: { code: "access_token_invalid", message: "expired" } }, 401);
      assert.equal(init.headers.Authorization, "Bearer renewed-token");
      return jsonResponse({ data: { publish_id: "publish-2" }, error: { code: "ok" } });
    }
    return jsonResponse({ error: { code: "unexpected" } }, 400);
  }, async () => "renewed-token");

  const result = await provider.publish(publishRequest({ content: { artifacts: [videoArtifact()] } }));
  assert.equal(result.kind, "published");
  assert.equal(attempt, 2);

  const rateLimited = new TikTokContentPostingProvider({ statusPollAttempts: 0 }, async () => jsonResponse({ error: { code: "spam_risk_too_many_posts", message: "slow down" } }, 429, { "retry-after": "60" }));
  const limited = await rateLimited.publish(publishRequest({ content: { artifacts: [videoArtifact()] } }));
  assert.equal(limited.kind, "rate_limited");
  assert.equal(limited.retryAfter, "60");

  const broken = new TikTokContentPostingProvider({ statusPollAttempts: 0 }, async () => jsonResponse({ error: { code: "internal_error", message: "oops" } }, 500));
  assert.equal((await broken.publish(publishRequest({ content: { artifacts: [videoArtifact()] } }))).kind, "transient_failure");

  const invalid = new TikTokContentPostingProvider({ statusPollAttempts: 0 }, async () => jsonResponse({ error: { code: "url_ownership_unverified", message: "verify domain" } }, 400));
  assert.equal((await invalid.publish(publishRequest({ content: { artifacts: [videoArtifact()] } }))).kind, "permanent_failure");

  const auth = new TikTokContentPostingProvider({ statusPollAttempts: 0 }, async () => jsonResponse({ error: { code: "access_token_invalid", message: "expired" } }, 401));
  assert.equal((await auth.publish(publishRequest({ content: { artifacts: [videoArtifact()] } }))).kind, "authentication_failure");
});

test("TikTok: descrição e mídia são lidas de caption/snake_case sem quebrar o payload do painel", () => {
  const post = extractTikTokPost({ artifacts: [{ payload: { caption: "Texto legado", video_url: "https://cdn.test/v.mp4", disable_comment: true } }] });
  assert.equal(post.description, "Texto legado");
  assert.equal(post.videoUrl, "https://cdn.test/v.mp4");
  assert.equal(post.disableComment, true);
  assert.equal(post.autoAddMusic, true);
});

test("TikTok: canário multi-provider libera tiktok por tenant e produção não exige binding canário", () => {
  const environment = { environment: "production", productionEnabled: true };
  const canary = { enabled: true, providerId: "meta_pages_sandbox", providerIds: ["tiktok"], tenantIds: ["*"], workspaceIds: ["*"] };

  const providerPolicy = new PublicationProviderPolicy(environment, canary);
  assert.equal(providerPolicy.decide({ tenantId: "tenant-9", workspaceId: "workspace-9", providerId: "tiktok", mode: "real" }).allowed, true);
  assert.equal(providerPolicy.decide({ tenantId: "tenant-9", workspaceId: "workspace-9", providerId: "linkedin", mode: "real" }).allowed, false);

  const governance = new PublicationGovernancePolicy(environment, canary);
  const decision = governance.decide({
    tenantId: "tenant-9",
    workspaceId: "workspace-9",
    providerId: "tiktok",
    role: "owner",
    permission: "publication:publish",
    credential: { id: "cred-1", status: "connected" },
    binding: { providerId: "tiktok", status: "active", canary: false },
    health: { tokenValid: true, missingScopes: [], expired: false },
    approvalPresent: true,
    approvalRequired: false,
  });
  assert.equal(decision.allowed, true);
});
