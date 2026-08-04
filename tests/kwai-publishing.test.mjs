import test from "node:test";
import assert from "node:assert/strict";

import { PublicationGovernancePolicy } from "../dist/application/credential/publication-governance-policy.js";
import { PublicationProviderPolicy } from "../dist/application/publication/publication-provider-policy.js";
import { StoredPublicationSecretResolver } from "../dist/application/publication/publication-secret-resolver.js";
import { LocalPublicationSecretStore } from "../dist/application/publication/publication-secret-store.js";
import { KwaiContentPostingProvider, extractKwaiPost } from "../dist/infrastructure/publication/kwai-content-posting-provider.js";
import { KwaiOAuthService } from "../dist/infrastructure/publication/kwai-oauth-service.js";
import { InMemoryPublicationRepository } from "../dist/infrastructure/storage/in-memory-publication-repository.js";

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function binaryResponse(bytes) {
  return new Response(bytes, { status: 200 });
}

function publishRequest(overrides = {}) {
  return {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    publicationId: "publication-1",
    targetId: "target-1",
    attemptId: "attempt-1",
    channel: "kwai",
    mode: "real",
    idempotencyKey: "kwai-idem-1",
    content: { artifacts: [] },
    assets: [],
    correlationId: "corr-1",
    traceId: "trace-1",
    secret: { credentialReferenceId: "cred-1", providerId: "kwai", value: { accessToken: "act-token" } },
    ...overrides,
  };
}

function postArtifact(caption = "Promo da semana", extra = {}) {
  return { artifactId: "a1", artifactType: "video", schemaId: "inline.kwai.post", schemaVersion: 1, checksum: "inline", payload: { caption, videoUrl: "https://cdn.test/video.mp4", thumbnailUrl: "https://cdn.test/cover.jpg", ...extra } };
}

test("Kwai OAuth: cada workspace conecta a própria conta e o token fica só no secret store", async () => {
  const repository = new InMemoryPublicationRepository();
  const secretStore = new LocalPublicationSecretStore();
  const httpClient = async (url) => {
    const href = String(url);
    if (href.includes("/oauth2/access_token")) {
      assert.ok(href.includes("grant_type=code"));
      assert.ok(href.includes("code=auth-code"));
      return jsonResponse({ result: 1, access_token: "kw-access", refresh_token: "kw-refresh", open_id: "open-123", expires_in: 3600 });
    }
    if (href.includes("/openapi/user_info")) return jsonResponse({ result: 1, user_info: { name: "Loja Vorix", head: "https://cdn.test/a.png" } });
    return jsonResponse({ result: 0, error_msg: "unexpected" }, 400);
  };
  const service = new KwaiOAuthService({
    config: { enabled: true, appId: "app-1", appSecret: "secret-1", redirectUri: "https://app.test/kwai/callback", scopes: ["user_info", "user_video_publish"], environment: "production" },
    repository,
    secretStore,
    httpClient,
  });

  const begin = service.begin({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.ok(begin.authorizationUrl.startsWith("https://open.kuaishou.com/oauth2/authorize"));
  assert.ok(begin.authorizationUrl.includes("response_type=code"));
  assert.ok(begin.authorizationUrl.includes(`state=${encodeURIComponent(begin.state)}`));

  const completed = await service.complete({ state: begin.state, code: "auth-code" });
  assert.equal(completed.providerSubjectId, "open-123");
  assert.equal(completed.displayName, "Loja Vorix");

  const references = await repository.listCredentialReferences({ tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "kwai" });
  assert.equal(references.length, 1);
  assert.equal(references[0].status, "active");
  assert.equal(JSON.stringify(references).includes("kw-access"), false);
  assert.equal(JSON.stringify(references).includes("kw-refresh"), false);

  const resolved = await new StoredPublicationSecretResolver(secretStore).resolve({ tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "kwai", credentialReferenceId: references[0].credentialReferenceId });
  assert.equal(resolved.value.accessToken, "kw-access");

  const status = await service.status({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(status.connected, true);
  assert.equal(status.accounts[0].displayName, "Loja Vorix");

  await assert.rejects(() => service.complete({ state: begin.state, code: "auth-code" }), /KWAI_OAUTH_STATE_INVALID/);
});

test("Kwai OAuth: state expirado é recusado e serviço sem credenciais não inicia fluxo", async () => {
  const secretStore = new LocalPublicationSecretStore();
  const repository = new InMemoryPublicationRepository();
  let now = new Date("2026-01-01T00:00:00.000Z");
  const service = new KwaiOAuthService({
    config: { enabled: true, appId: "app-1", appSecret: "secret-1", redirectUri: "https://app.test/cb", scopes: ["user_video_publish"] },
    repository,
    secretStore,
    httpClient: async () => jsonResponse({ result: 1, access_token: "x", open_id: "o" }),
    now: () => now,
  });
  const begin = service.begin({ tenantId: "t", workspaceId: "w" });
  now = new Date("2026-01-01T00:11:00.000Z");
  await assert.rejects(() => service.complete({ state: begin.state, code: "c" }), /KWAI_OAUTH_STATE_INVALID/);

  const disabled = new KwaiOAuthService({ config: { enabled: false, scopes: [] }, repository, secretStore });
  assert.equal(disabled.isConfigured(), false);
  assert.throws(() => disabled.begin({ tenantId: "t", workspaceId: "w" }), /KWAI_OAUTH_NOT_CONFIGURED/);
});

test("Kwai Provider: publica vídeo pequeno (upload único) e retorna photo_id/play_url", async () => {
  const calls = [];
  const provider = new KwaiContentPostingProvider({ appId: "app-1", apiBaseUrl: "https://open.test" }, async (url, init) => {
    const href = String(url);
    calls.push(href);
    if (href.startsWith("https://cdn.test/video.mp4")) return binaryResponse(new Uint8Array([1, 2, 3, 4]));
    if (href.startsWith("https://cdn.test/cover.jpg")) return binaryResponse(new Uint8Array([9, 9]));
    if (href.includes("/openapi/photo/start_upload")) return jsonResponse({ result: 1, upload_token: "up-1", endpoint: "upload.test" });
    if (href.startsWith("http://upload.test/api/upload") && !href.includes("fragment")) {
      assert.equal(init.headers["Content-Type"], "application/octet-stream");
      return jsonResponse({ result: 1 });
    }
    if (href.includes("/openapi/photo/publish")) {
      assert.ok(href.includes("upload_token=up-1"));
      return jsonResponse({ result: 1, video_info: { photo_id: "photo-1", play_url: "https://kwai.test/v/photo-1" } });
    }
    return jsonResponse({ result: 0, error_msg: "unexpected" }, 400);
  });

  const result = await provider.publish(publishRequest({ content: { artifacts: [postArtifact()] } }));
  assert.equal(result.kind, "published");
  assert.equal(result.providerPublicationId, "photo-1");
  assert.equal(result.url, "https://kwai.test/v/photo-1");
  assert.ok(calls.some((href) => href.includes("start_upload")));
});

test("Kwai Provider: vídeo maior que o limite de fragmento sobe em pedaços", async () => {
  const fragmentCalls = [];
  let completeCalled = false;
  const provider = new KwaiContentPostingProvider({ appId: "app-1", apiBaseUrl: "https://open.test", fragmentSizeBytes: 4 }, async (url, init) => {
    const href = String(url);
    if (href.startsWith("https://cdn.test/video.mp4")) return binaryResponse(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    if (href.startsWith("https://cdn.test/cover.jpg")) return binaryResponse(new Uint8Array([9]));
    if (href.includes("start_upload")) return jsonResponse({ result: 1, upload_token: "up-2", endpoint: "upload.test" });
    if (href.includes("/api/upload/fragment")) {
      fragmentCalls.push(href);
      return jsonResponse({ result: 1 });
    }
    if (href.includes("/api/upload/complete")) {
      completeCalled = true;
      return jsonResponse({ result: 1 });
    }
    if (href.includes("/openapi/photo/publish")) return jsonResponse({ result: 1, video_info: { photo_id: "photo-2", play_url: "https://kwai.test/v/photo-2" } });
    return jsonResponse({ result: 0, error_msg: "unexpected" }, 400);
  });

  const result = await provider.publish(publishRequest({ content: { artifacts: [postArtifact()] } }));
  assert.equal(result.kind, "published");
  assert.equal(fragmentCalls.length, 3); // 10 bytes / 4 = 3 fragments (4,4,2)
  assert.equal(completeCalled, true);
});

test("Kwai Provider: mídia ausente é rejeitada (só vídeo, capa obrigatória)", async () => {
  const provider = new KwaiContentPostingProvider({ appId: "app-1" }, async () => jsonResponse({ result: 1 }));

  const noVideo = await provider.publish(publishRequest({ content: { artifacts: [{ payload: { caption: "sem mídia" } }] } }));
  assert.equal(noVideo.kind, "rejected");
  assert.equal(noVideo.errorCode, "KWAI_MEDIA_MISSING");

  const noCover = await provider.publish(publishRequest({ content: { artifacts: [postArtifact("x", { thumbnailUrl: undefined })] } }));
  assert.equal(noCover.kind, "rejected");
  assert.equal(noCover.errorCode, "KWAI_COVER_REQUIRED");
});

test("Kwai Provider: token expirado renova antes de repetir, e erros mapeiam categorias corretas", async () => {
  let attempt = 0;
  const provider = new KwaiContentPostingProvider({ appId: "app-1", apiBaseUrl: "https://open.test" }, async (url, init) => {
    const href = String(url);
    if (href.startsWith("https://cdn.test/")) return binaryResponse(new Uint8Array([1]));
    if (href.includes("start_upload")) {
      attempt += 1;
      if (attempt === 1) return jsonResponse({ result: 100200108, error_msg: "token expired" });
      const form = init.body;
      assert.ok(form.get("access_token") === "renewed-token");
      return jsonResponse({ result: 1, upload_token: "up-3", endpoint: "upload.test" });
    }
    if (href.includes("/api/upload") && !href.includes("fragment")) return jsonResponse({ result: 1 });
    if (href.includes("publish")) return jsonResponse({ result: 1, video_info: { photo_id: "photo-3", play_url: "https://kwai.test/v/photo-3" } });
    return jsonResponse({ result: 0, error_msg: "unexpected" }, 400);
  }, async () => "renewed-token");

  const result = await provider.publish(publishRequest({ content: { artifacts: [postArtifact()] } }));
  assert.equal(result.kind, "published");
  assert.equal(attempt, 2);

  const rateLimited = new KwaiContentPostingProvider({ appId: "app-1" }, async (url) => {
    const href = String(url);
    if (href.startsWith("https://cdn.test/")) return binaryResponse(new Uint8Array([1]));
    return jsonResponse({ result: 100200410, error_msg: "rate limited" });
  });
  assert.equal((await rateLimited.publish(publishRequest({ content: { artifacts: [postArtifact()] } }))).kind, "rate_limited");

  const transient = new KwaiContentPostingProvider({ appId: "app-1" }, async (url) => {
    const href = String(url);
    if (href.startsWith("https://cdn.test/")) return binaryResponse(new Uint8Array([1]));
    return jsonResponse({ result: 100200500, error_msg: "server error" });
  });
  assert.equal((await transient.publish(publishRequest({ content: { artifacts: [postArtifact()] } }))).kind, "transient_failure");

  const permanent = new KwaiContentPostingProvider({ appId: "app-1" }, async (url) => {
    const href = String(url);
    if (href.startsWith("https://cdn.test/")) return binaryResponse(new Uint8Array([1]));
    return jsonResponse({ result: 100200100, error_msg: "invalid request" });
  });
  assert.equal((await permanent.publish(publishRequest({ content: { artifacts: [postArtifact()] } }))).kind, "permanent_failure");

  const auth = new KwaiContentPostingProvider({ appId: "app-1" }, async (url) => {
    const href = String(url);
    if (href.startsWith("https://cdn.test/")) return binaryResponse(new Uint8Array([1]));
    return jsonResponse({ result: 100200102, error_msg: "access denied" });
  });
  assert.equal((await auth.publish(publishRequest({ content: { artifacts: [postArtifact()] } }))).kind, "authentication_failure");
});

test("Kwai: legenda e mídia são lidas do payload sem quebrar o formulário do painel", () => {
  const post = extractKwaiPost({ artifacts: [{ payload: { caption: "Texto legado", video_url: "https://cdn.test/v.mp4", thumbnail_url: "https://cdn.test/c.jpg" } }] });
  assert.equal(post.caption, "Texto legado");
  assert.equal(post.videoUrl, "https://cdn.test/v.mp4");
  assert.equal(post.thumbnailUrl, "https://cdn.test/c.jpg");
});

test("Kwai: canário multi-provider libera kwai por tenant e produção não exige binding canário", () => {
  const environment = { environment: "production", productionEnabled: true };
  const canary = { enabled: true, providerId: "meta_pages_sandbox", providerIds: ["kwai"], tenantIds: ["*"], workspaceIds: ["*"] };

  const providerPolicy = new PublicationProviderPolicy(environment, canary);
  assert.equal(providerPolicy.decide({ tenantId: "tenant-9", workspaceId: "workspace-9", providerId: "kwai", mode: "real" }).allowed, true);
  assert.equal(providerPolicy.decide({ tenantId: "tenant-9", workspaceId: "workspace-9", providerId: "linkedin", mode: "real" }).allowed, false);

  const governance = new PublicationGovernancePolicy(environment, canary);
  const decision = governance.decide({
    tenantId: "tenant-9",
    workspaceId: "workspace-9",
    providerId: "kwai",
    role: "owner",
    permission: "publication:publish",
    credential: { id: "cred-1", status: "connected" },
    binding: { providerId: "kwai", status: "active", canary: false },
    health: { tokenValid: true, missingScopes: [], expired: false },
    approvalPresent: true,
    approvalRequired: false,
  });
  assert.equal(decision.allowed, true);
});
