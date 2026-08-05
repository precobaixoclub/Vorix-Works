import test from "node:test";
import assert from "node:assert/strict";

import { PublicationGovernancePolicy } from "../dist/application/credential/publication-governance-policy.js";
import { PublicationProviderPolicy } from "../dist/application/publication/publication-provider-policy.js";
import { StoredPublicationSecretResolver } from "../dist/application/publication/publication-secret-resolver.js";
import { LocalPublicationSecretStore } from "../dist/application/publication/publication-secret-store.js";
import { MetaContentPostingProvider, extractMetaPost } from "../dist/infrastructure/publication/meta-instagram-content-posting-provider.js";
import { MetaInstagramOAuthService } from "../dist/infrastructure/publication/meta-instagram-oauth-service.js";
import { InMemoryPublicationRepository } from "../dist/infrastructure/storage/in-memory-publication-repository.js";

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function publishRequest(providerId, overrides = {}) {
  return {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    publicationId: "publication-1",
    targetId: "target-1",
    attemptId: "attempt-1",
    channel: providerId,
    mode: "real",
    idempotencyKey: `${providerId}-idem-1`,
    content: { artifacts: [] },
    assets: [],
    correlationId: "corr-1",
    traceId: "trace-1",
    secret: { credentialReferenceId: "cred-1", providerId, value: providerId === "instagram" ? { accessToken: "page-token", instagramBusinessAccountId: "ig-123" } : { accessToken: "page-token", pageId: "page-123" } },
    ...overrides,
  };
}

function captionArtifact(caption, extra = {}) {
  return { artifactId: "a1", artifactType: "image", schemaId: "inline.instagram.post", schemaVersion: 1, checksum: "inline", payload: { caption, ...extra } };
}

test("Meta OAuth: conecta e resolve múltiplas Páginas, cada uma com facebook e (quando houver) instagram vinculado", async () => {
  const repository = new InMemoryPublicationRepository();
  const secretStore = new LocalPublicationSecretStore();
  const httpClient = async (url) => {
    const href = String(url);
    if (href.includes("/oauth/access_token") && href.includes("code=auth-code")) {
      assert.ok(href.includes("code_verifier="));
      return jsonResponse({ access_token: "short-lived", expires_in: 3600 });
    }
    if (href.includes("/oauth/access_token") && href.includes("fb_exchange_token=short-lived")) {
      return jsonResponse({ access_token: "long-lived-user-token", expires_in: 5_184_000 });
    }
    if (href.includes("/me/accounts")) {
      return jsonResponse({
        data: [
          { id: "page-1", name: "Loja Vorix", access_token: "page-1-token", instagram_business_account: { id: "ig-1", username: "loja.vorix", profile_picture_url: "https://cdn.test/ig.png" } },
          { id: "page-2", name: "Loja Vorix Outlet", access_token: "page-2-token" },
        ],
      });
    }
    return jsonResponse({ error: { message: "unexpected" } }, 400);
  };
  const service = new MetaInstagramOAuthService({
    config: { enabled: true, appId: "app-1", appSecret: "secret-1", redirectUri: "https://app.test/instagram/callback", scopes: ["pages_show_list", "instagram_content_publish"] },
    repository,
    secretStore,
    httpClient,
  });

  const begin = service.begin({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.ok(begin.authorizationUrl.startsWith("https://www.facebook.com/v21.0/dialog/oauth"));
  assert.ok(begin.authorizationUrl.includes("code_challenge_method=S256"));

  const completed = await service.complete({ state: begin.state, code: "auth-code" });
  assert.equal(completed.accounts.length, 3); // page-1 (facebook+instagram) + page-2 (facebook only)
  assert.ok(completed.accounts.some((account) => account.providerId === "instagram" && account.providerSubjectId === "ig-1"));
  assert.ok(completed.accounts.some((account) => account.providerId === "facebook" && account.providerSubjectId === "page-1"));
  assert.ok(completed.accounts.some((account) => account.providerId === "facebook" && account.providerSubjectId === "page-2"));
  assert.equal(completed.accounts.filter((account) => account.providerId === "instagram").length, 1); // page-2 não tem IG vinculado

  const igReferences = await repository.listCredentialReferences({ tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "instagram" });
  assert.equal(igReferences.length, 1);
  assert.equal(JSON.stringify(igReferences).includes("page-1-token"), false);

  const resolved = await new StoredPublicationSecretResolver(secretStore).resolve({ tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "instagram", credentialReferenceId: igReferences[0].credentialReferenceId });
  assert.equal(resolved.value.accessToken, "page-1-token");
  assert.equal(resolved.value.instagramBusinessAccountId, "ig-1");

  const status = await service.status({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(status.connected, true);
  assert.equal(status.accounts.length, 3);

  const disconnected = await service.disconnect({ tenantId: "tenant-1", workspaceId: "workspace-1", credentialReferenceId: igReferences[0].credentialReferenceId });
  assert.equal(disconnected, true);
  const afterDisconnect = await service.status({ tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "instagram" });
  assert.equal(afterDisconnect.connected, false);
});

test("Meta OAuth: usa Facebook Login for Business config_id quando configurado", async () => {
  const repository = new InMemoryPublicationRepository();
  const secretStore = new LocalPublicationSecretStore();
  const service = new MetaInstagramOAuthService({
    config: { enabled: true, appId: "app-1", appSecret: "secret-1", redirectUri: "https://app.test/instagram/callback", loginConfigId: "config-1", scopes: ["pages_show_list"] },
    repository,
    secretStore,
  });

  const begin = service.begin({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  const url = new URL(begin.authorizationUrl);
  assert.equal(url.searchParams.get("config_id"), "config-1");
  assert.equal(url.searchParams.has("scope"), false);
});

test("Meta OAuth: sem Página encontrada falha, e state expirado é recusado", async () => {
  const repository = new InMemoryPublicationRepository();
  const secretStore = new LocalPublicationSecretStore();
  let now = new Date("2026-01-01T00:00:00.000Z");
  const service = new MetaInstagramOAuthService({
    config: { enabled: true, appId: "app-1", appSecret: "secret-1", redirectUri: "https://app.test/cb", scopes: ["pages_show_list"] },
    repository,
    secretStore,
    httpClient: async (url) => {
      if (String(url).includes("/me/accounts")) return jsonResponse({ data: [] });
      return jsonResponse({ access_token: "tok" });
    },
    now: () => now,
  });

  const begin = service.begin({ tenantId: "t", workspaceId: "w" });
  await assert.rejects(() => service.complete({ state: begin.state, code: "c" }), /META_NO_PAGES_FOUND/);

  const begin2 = service.begin({ tenantId: "t", workspaceId: "w" });
  now = new Date("2026-01-01T00:11:00.000Z");
  await assert.rejects(() => service.complete({ state: begin2.state, code: "c" }), /META_OAUTH_STATE_INVALID/);

  const disabled = new MetaInstagramOAuthService({ config: { enabled: false, scopes: [] }, repository, secretStore });
  assert.equal(disabled.isConfigured(), false);
  assert.throws(() => disabled.begin({ tenantId: "t", workspaceId: "w" }), /META_OAUTH_NOT_CONFIGURED/);
});

test("Instagram Provider: imagem única publica via media/media_publish e retorna permalink", async () => {
  const calls = [];
  const provider = new MetaContentPostingProvider("instagram", { graphBaseUrl: "https://graph.test/v21.0", containerPollAttempts: 1 }, async (url, init) => {
    const href = String(url);
    calls.push(href);
    if (href.includes("/ig-123/media_publish")) return jsonResponse({ id: "media-1" });
    if (href.includes("/container-1?")) return jsonResponse({ status_code: "FINISHED" });
    if (href.includes("/media-1?")) return jsonResponse({ permalink: "https://instagram.com/p/abc" });
    if (href.includes("/ig-123/media")) return jsonResponse({ id: "container-1" });
    return jsonResponse({ error: { message: "unexpected" } }, 400);
  });

  const result = await provider.publish(publishRequest("instagram", { content: { artifacts: [captionArtifact("Novidade", { imageUrls: ["https://cdn.test/1.jpg"] })] } }));
  assert.equal(result.kind, "published");
  assert.equal(result.providerPublicationId, "media-1");
  assert.equal(result.url, "https://instagram.com/p/abc");
});

test("Instagram Provider: carrossel cria containers filhos + pai, e mídia ausente é rejeitada", async () => {
  const calls = [];
  const provider = new MetaContentPostingProvider("instagram", { graphBaseUrl: "https://graph.test/v21.0", containerPollAttempts: 1 }, async (url, init) => {
    const href = String(url);
    if (init.method === "POST" && href.includes("/ig-123/media") && !href.includes("media_publish")) {
      const body = new URLSearchParams(init.body);
      calls.push(Object.fromEntries(body.entries()));
      return jsonResponse({ id: `container-${calls.length}` });
    }
    if (href.includes("status_code")) return jsonResponse({ status_code: "FINISHED" });
    if (href.includes("media_publish")) return jsonResponse({ id: "media-carousel" });
    if (href.includes("/media-carousel?")) return jsonResponse({ permalink: "https://instagram.com/p/carousel" });
    return jsonResponse({ error: { message: "unexpected" } }, 400);
  });

  const result = await provider.publish(publishRequest("instagram", { content: { artifacts: [captionArtifact("Carrossel", { imageUrls: ["https://cdn.test/1.jpg", "https://cdn.test/2.jpg"] })] } }));
  assert.equal(result.kind, "published");
  assert.equal(calls.length, 3); // 2 filhos + 1 pai
  assert.equal(calls[0].is_carousel_item, "true");
  assert.equal(calls[2].media_type, "CAROUSEL");

  const empty = await provider.publish(publishRequest("instagram", { content: { artifacts: [{ payload: { caption: "sem mídia" } }] } }));
  assert.equal(empty.kind, "rejected");
  assert.equal(empty.errorCode, "META_MEDIA_MISSING");
});

test("Instagram Provider: Story de imagem usa media_type STORIES sem legenda, e carrossel em Story é rejeitado", async () => {
  const calls = [];
  const provider = new MetaContentPostingProvider("instagram", { graphBaseUrl: "https://graph.test/v21.0", containerPollAttempts: 1 }, async (url, init) => {
    const href = String(url);
    if (init.method === "POST" && href.includes("/ig-123/media")) {
      const body = new URLSearchParams(init.body);
      calls.push(Object.fromEntries(body.entries()));
      return jsonResponse({ id: "container-story" });
    }
    if (href.includes("status_code")) return jsonResponse({ status_code: "FINISHED" });
    if (href.includes("media_publish")) return jsonResponse({ id: "media-story" });
    if (href.includes("/media-story?")) return jsonResponse({ permalink: "https://instagram.com/stories/abc" });
    return jsonResponse({ error: { message: "unexpected" } }, 400);
  });

  const result = await provider.publish(publishRequest("instagram", { content: { artifacts: [captionArtifact("Legenda ignorada", { imageUrls: ["https://cdn.test/1.jpg"], placement: "story" })] } }));
  assert.equal(result.kind, "published");
  assert.equal(calls[0].media_type, "STORIES");
  assert.equal(calls[0].caption, undefined);

  const carouselStory = await provider.publish(publishRequest("instagram", { content: { artifacts: [captionArtifact("x", { imageUrls: ["https://cdn.test/1.jpg", "https://cdn.test/2.jpg"], placement: "story" })] } }));
  assert.equal(carouselStory.kind, "rejected");
});

test("Facebook Provider: Story de foto usa photo_stories, e Story de vídeo é rejeitada com erro claro", async () => {
  const provider = new MetaContentPostingProvider("facebook", { graphBaseUrl: "https://graph.test/v21.0" }, async (url, init) => {
    const href = String(url);
    if (href.includes("/page-123/photos")) return jsonResponse({ id: "photo-story-1" });
    if (href.includes("/page-123/photo_stories")) return jsonResponse({ post_id: "page-123_story-1" });
    return jsonResponse({ error: { message: "unexpected" } }, 400);
  });

  const result = await provider.publish(publishRequest("facebook", { content: { artifacts: [captionArtifact("Story da loja", { imageUrls: ["https://cdn.test/1.jpg"], placement: "story" })] } }));
  assert.equal(result.kind, "published");
  assert.equal(result.providerPublicationId, "page-123_story-1");

  const videoStory = await provider.publish(publishRequest("facebook", { content: { artifacts: [captionArtifact("x", { videoUrl: "https://cdn.test/v.mp4", placement: "story" })] } }));
  assert.equal(videoStory.kind, "permanent_failure");
  assert.equal(videoStory.errorCode, "META_FACEBOOK_VIDEO_STORY_UNSUPPORTED");
});

test("Facebook Provider: foto única publica direto na Página, texto-only funciona sem mídia", async () => {
  const provider = new MetaContentPostingProvider("facebook", { graphBaseUrl: "https://graph.test/v21.0" }, async (url, init) => {
    const href = String(url);
    if (href.includes("/page-123/photos")) return jsonResponse({ id: "photo-1", post_id: "page-123_photo-1" });
    if (href.includes("/page-123/feed")) return jsonResponse({ id: "page-123_feed-1" });
    return jsonResponse({ error: { message: "unexpected" } }, 400);
  });

  const photoResult = await provider.publish(publishRequest("facebook", { content: { artifacts: [captionArtifact("Foto da loja", { imageUrls: ["https://cdn.test/1.jpg"] })] } }));
  assert.equal(photoResult.kind, "published");
  assert.equal(photoResult.providerPublicationId, "page-123_photo-1");

  const textResult = await provider.publish(publishRequest("facebook", { content: { artifacts: [captionArtifact("Só texto, sem mídia")] } }));
  assert.equal(textResult.kind, "published");
  assert.equal(textResult.providerPublicationId, "page-123_feed-1");
});

test("Meta Provider: token inválido renova antes de repetir, e erros mapeiam categorias corretas", async () => {
  let attempt = 0;
  const provider = new MetaContentPostingProvider("facebook", { graphBaseUrl: "https://graph.test/v21.0" }, async (url, init) => {
    if (String(url).includes("/page-123/photos")) {
      attempt += 1;
      if (attempt === 1) return jsonResponse({ error: { message: "expired", code: 190 } }, 401);
      const params = new URLSearchParams(init.body);
      assert.equal(params.get("access_token"), "renewed-token");
      return jsonResponse({ id: "photo-2", post_id: "page-123_photo-2" });
    }
    return jsonResponse({ error: { message: "unexpected" } }, 400);
  }, async () => "renewed-token");

  const result = await provider.publish(publishRequest("facebook", { content: { artifacts: [captionArtifact("Retry", { imageUrls: ["https://cdn.test/1.jpg"] })] } }));
  assert.equal(result.kind, "published");
  assert.equal(attempt, 2);

  const rateLimited = new MetaContentPostingProvider("facebook", {}, async () => jsonResponse({ error: { message: "slow down", code: 17 } }, 400));
  assert.equal((await rateLimited.publish(publishRequest("facebook", { content: { artifacts: [captionArtifact("x")] } }))).kind, "rate_limited");

  const transient = new MetaContentPostingProvider("facebook", {}, async () => jsonResponse({ error: { message: "internal", code: 2 } }, 500));
  assert.equal((await transient.publish(publishRequest("facebook", { content: { artifacts: [captionArtifact("x")] } }))).kind, "transient_failure");

  const permanent = new MetaContentPostingProvider("facebook", {}, async () => jsonResponse({ error: { message: "invalid parameter", code: 100 } }, 400));
  assert.equal((await permanent.publish(publishRequest("facebook", { content: { artifacts: [captionArtifact("x")] } }))).kind, "permanent_failure");

  const auth = new MetaContentPostingProvider("facebook", {}, async () => jsonResponse({ error: { message: "bad token", code: 190 } }, 401));
  assert.equal((await auth.publish(publishRequest("facebook", { content: { artifacts: [captionArtifact("x")] } }))).kind, "authentication_failure");
});

test("Meta: legenda e mídia são lidas do payload sem quebrar o formulário do painel", () => {
  const post = extractMetaPost({ artifacts: [{ payload: { caption: "Texto do post", video_url: "https://cdn.test/v.mp4" } }] });
  assert.equal(post.caption, "Texto do post");
  assert.equal(post.videoUrl, "https://cdn.test/v.mp4");
});

test("Meta: canário multi-provider libera instagram/facebook por tenant e produção não exige binding canário", () => {
  const environment = { environment: "production", productionEnabled: true };
  const canary = { enabled: true, providerId: "meta_pages_sandbox", providerIds: ["instagram", "facebook"], tenantIds: ["*"], workspaceIds: ["*"] };

  const providerPolicy = new PublicationProviderPolicy(environment, canary);
  assert.equal(providerPolicy.decide({ tenantId: "tenant-9", workspaceId: "workspace-9", providerId: "instagram", mode: "real" }).allowed, true);
  assert.equal(providerPolicy.decide({ tenantId: "tenant-9", workspaceId: "workspace-9", providerId: "facebook", mode: "real" }).allowed, true);
  assert.equal(providerPolicy.decide({ tenantId: "tenant-9", workspaceId: "workspace-9", providerId: "linkedin", mode: "real" }).allowed, false);

  const governance = new PublicationGovernancePolicy(environment, canary);
  const decision = governance.decide({
    tenantId: "tenant-9",
    workspaceId: "workspace-9",
    providerId: "instagram",
    role: "owner",
    permission: "publication:publish",
    credential: { id: "cred-1", status: "connected" },
    binding: { providerId: "instagram", status: "active", canary: false },
    health: { tokenValid: true, missingScopes: [], expired: false },
    approvalPresent: true,
    approvalRequired: false,
  });
  assert.equal(decision.allowed, true);
});
