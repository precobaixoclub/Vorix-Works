import test from "node:test";
import assert from "node:assert/strict";

import { StoredPublicationSecretResolver } from "../dist/application/publication/publication-secret-resolver.js";
import { LocalPublicationSecretStore } from "../dist/application/publication/publication-secret-store.js";
import { YouTubeContentPostingProvider, extractYouTubeShort } from "../dist/infrastructure/publication/youtube-content-posting-provider.js";
import { YouTubeOAuthService } from "../dist/infrastructure/publication/youtube-oauth-service.js";
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
    channel: "youtube",
    mode: "real",
    idempotencyKey: "youtube-idem-1",
    content: { artifacts: [] },
    assets: [],
    correlationId: "corr-1",
    traceId: "trace-1",
    secret: { credentialReferenceId: "cred-1", providerId: "youtube", value: { accessToken: "yt-access" } },
    ...overrides,
  };
}

function videoArtifact(description = "Promo da semana") {
  return { artifactId: "a1", artifactType: "video", schemaId: "inline.youtube.short", schemaVersion: 1, checksum: "inline", payload: { title: "Promo", description, videoUrl: "https://cdn.test/video.mp4", privacyStatus: "unlisted" } };
}

test("YouTube OAuth: conecta canal e guarda tokens somente no secret store", async () => {
  const repository = new InMemoryPublicationRepository();
  const secretStore = new LocalPublicationSecretStore();
  const httpClient = async (url, init) => {
    const href = String(url);
    if (href.endsWith("/token")) {
      const body = String(init.body);
      assert.ok(body.includes("grant_type=authorization_code"));
      assert.ok(body.includes("client_id=client-1"));
      return jsonResponse({ access_token: "yt-access", refresh_token: "yt-refresh", scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly", expires_in: 3600 });
    }
    if (href.includes("/channels?")) return jsonResponse({ items: [{ id: "channel-123", snippet: { title: "Canal Vorix", thumbnails: { default: { url: "https://cdn.test/avatar.jpg" } } } }] });
    return jsonResponse({ error: { message: "unexpected" } }, 400);
  };
  const service = new YouTubeOAuthService({
    config: {
      enabled: true,
      clientId: "client-1",
      clientSecret: "secret-1",
      redirectUri: "https://app.test/youtube/callback",
      scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"],
      environment: "production",
    },
    repository,
    secretStore,
    httpClient,
  });

  const begin = service.begin({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.ok(begin.authorizationUrl.startsWith("https://accounts.google.com/o/oauth2/v2/auth"));
  assert.ok(begin.authorizationUrl.includes("access_type=offline"));
  assert.ok(begin.authorizationUrl.includes("prompt=consent"));

  const completed = await service.complete({ state: begin.state, code: "auth-code" });
  assert.equal(completed.providerSubjectId, "channel-123");
  assert.equal(completed.displayName, "Canal Vorix");

  const references = await repository.listCredentialReferences({ tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "youtube" });
  assert.equal(references.length, 1);
  assert.equal(JSON.stringify(references).includes("yt-access"), false);
  assert.equal(JSON.stringify(references).includes("yt-refresh"), false);

  const resolved = await new StoredPublicationSecretResolver(secretStore).resolve({ tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "youtube", credentialReferenceId: references[0].credentialReferenceId });
  assert.equal(resolved.value.accessToken, "yt-access");
  assert.equal(resolved.value.refreshToken, "yt-refresh");
});

test("YouTube Provider: faz upload resumable do Short e adiciona hashtag #Shorts", async () => {
  const calls = [];
  const provider = new YouTubeContentPostingProvider(
    { apiBaseUrl: "https://youtube.test/youtube/v3", uploadBaseUrl: "https://youtube-upload.test/upload/youtube/v3" },
    async (url, init = {}) => {
      const href = String(url);
      calls.push({ href, init });
      if (href === "https://cdn.test/video.mp4") return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
      if (href.startsWith("https://youtube-upload.test/upload/youtube/v3/videos?")) return jsonResponse({}, 200, { location: "https://upload-session.test/session-1" });
      if (href === "https://upload-session.test/session-1") return jsonResponse({ id: "video-123" });
      return jsonResponse({ error: { message: "unexpected" } }, 400);
    },
  );

  const result = await provider.publish(publishRequest({ content: { artifacts: [videoArtifact("Confira a oferta")] } }));
  assert.equal(result.kind, "published");
  assert.equal(result.providerPublicationId, "video-123");

  const initCall = calls.find((call) => call.href.startsWith("https://youtube-upload.test/upload/youtube/v3/videos?"));
  const body = JSON.parse(String(initCall.init.body));
  assert.equal(body.snippet.title, "Promo");
  assert.equal(body.snippet.description.includes("#Shorts"), true);
  assert.equal(body.status.privacyStatus, "unlisted");
  assert.equal(initCall.init.headers.Authorization, "Bearer yt-access");

  const uploadCall = calls.find((call) => call.href === "https://upload-session.test/session-1");
  assert.equal(uploadCall.init.method, "PUT");
});

test("YouTube Provider: extrai payload legado e rejeita post sem video", async () => {
  const post = extractYouTubeShort({ artifacts: [{ payload: { caption: "Texto", video_url: "https://cdn.test/v.mp4", privacy_status: "private" } }] });
  assert.equal(post.description, "Texto");
  assert.equal(post.videoUrl, "https://cdn.test/v.mp4");
  assert.equal(post.privacyStatus, "private");

  const provider = new YouTubeContentPostingProvider({}, async () => jsonResponse({}));
  const empty = await provider.publish(publishRequest({ content: { artifacts: [{ payload: { description: "sem video" } }] } }));
  assert.equal(empty.kind, "rejected");
  assert.equal(empty.errorCode, "YOUTUBE_VIDEO_REQUIRED");
});
