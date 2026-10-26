import test from "node:test";
import assert from "node:assert/strict";

import { createOfficialSocialProviders } from "../dist/infrastructure/social/social-publishing-module.js";
import { mapOfficialResult } from "../dist/infrastructure/social/official-social-providers.js";
import { SOCIAL_POST_FORMATS, SOCIAL_FEATURES } from "../dist/domain/social/social-publishing.model.js";

/**
 * Contract tests dos providers oficiais: mesma interface lógica, capabilities honestas, conexão
 * OAuth e tradução de resultados. Sem rede: adapters e serviços OAuth são fixtures controladas.
 */

function fakeAdapter(result, status) {
  const calls = { publish: [], status: [] };
  return {
    calls,
    descriptor: { providerId: "fake" },
    publish: async (request) => { calls.publish.push(request); return typeof result === "function" ? result(request) : result; },
    getStatus: async (input) => { calls.status.push(input); return status ?? { kind: "inconclusive", safeMessage: "n/a" }; },
    verifyReceipt: async () => ({ verificationStatus: "not_supported", checksum: "x" }),
    capabilities: () => ({}),
    health: async () => ({ ok: true }),
  };
}

function fakeOAuth(accounts, configured = true) {
  const disconnected = [];
  return {
    disconnected,
    isConfigured: () => configured,
    begin: () => ({ authorizationUrl: "https://provider.example.test/oauth?state=abc" }),
    status: async () => ({ accounts }),
    disconnect: async (input) => { disconnected.push(input); return true; },
  };
}

const PUBLISHED = { kind: "published", providerPublicationId: "media-1", publishedAt: "2026-11-01T12:00:00.000Z", url: "https://social.example.test/media-1" };

function build(overrides = {}) {
  const adapters = { instagram: fakeAdapter(overrides.result ?? PUBLISHED, overrides.status), facebook: fakeAdapter(overrides.result ?? PUBLISHED, overrides.status), tiktok: fakeAdapter(overrides.result ?? PUBLISHED, overrides.status) };
  const metaOAuth = fakeOAuth(overrides.metaAccounts ?? [], overrides.configured);
  const tiktokOAuth = fakeOAuth(overrides.tiktokAccounts ?? [], overrides.configured);
  const [meta, tiktok] = createOfficialSocialProviders({ officialAdapters: adapters, oauth: { meta: () => metaOAuth, tiktok: () => tiktokOAuth } });
  return { meta, tiktok, adapters, metaOAuth, tiktokOAuth };
}

const account = (network, value = { accessToken: "tok", credentialReferenceId: "cred-1" }) => ({ tenantId: "t", workspaceId: "w", socialAccountId: "acc", network, externalAccountId: "ext", metadata: {}, session: { value } });

test("Contrato: descriptor e capabilities honestas dos providers oficiais", () => {
  const { meta, tiktok } = build();
  for (const provider of [meta, tiktok]) {
    assert.equal(provider.descriptor.implemented, true);
    assert.equal(provider.descriptor.official, true);
    assert.equal(provider.descriptor.realPublishingValidated, false, "NOT_REAL_VALIDATED até publicação real comprovada");
    assert.equal(typeof provider.publish, "function");
    assert.equal(typeof provider.healthCheck, "function");
    assert.equal(typeof provider.getPublicationStatus, "function");
    assert.equal(typeof provider.connection.begin, "function");
    assert.equal(provider.searchMusic, undefined, "API oficial usada não oferece música nativa");
    for (const network of provider.descriptor.networks) {
      const capabilities = provider.getCapabilities(network);
      assert.equal(capabilities.network, network);
      assert.equal(capabilities.supportsMusicSearch, false);
      const formats = capabilities.formats.map((format) => format.format);
      assert.equal(new Set(formats).size, formats.length, "formatos únicos");
      for (const format of capabilities.formats) {
        assert.ok(SOCIAL_POST_FORMATS.includes(format.format));
        assert.ok(format.features.every((feature) => SOCIAL_FEATURES.includes(feature)));
        assert.ok(!format.features.includes("nativeMusic"), `${network}/${format.format} não promete música nativa`);
        assert.ok(format.constraints.minItems >= 1 && format.constraints.maxItems >= format.constraints.minItems);
      }
    }
  }
  assert.deepEqual(meta.descriptor.networks, ["instagram", "facebook"]);
  assert.deepEqual(tiktok.descriptor.networks, ["tiktok"]);
  assert.throws(() => meta.getCapabilities("tiktok"), /SOCIAL_NETWORK_UNSUPPORTED/);
  // Só o que os adapters oficiais publicam hoje: Instagram sem feed_video (vídeo sai como Reels).
  assert.deepEqual(meta.getCapabilities("instagram").formats.map((format) => format.format), ["feed_image", "carousel", "reel", "story_image", "story_video"]);
  assert.deepEqual(tiktok.getCapabilities("tiktok").formats.map((format) => format.format), ["short_video", "photo_post"]);
});

test("Contrato: publicação delega ao adapter oficial com payload e credencial corretos", async () => {
  const { meta, tiktok, adapters } = build();
  const reel = await meta.publish({ account: account("instagram"), format: "reel", caption: "Olá", media: [{ url: "https://cdn/v.mp4", kind: "video", coverUrl: "https://cdn/c.jpg" }], idempotencyKey: "idem-1", attemptStartedAt: "2026-11-01T12:00:00.000Z" });
  assert.deepEqual(reel, { ok: true, externalPostId: "media-1", publishedAt: "2026-11-01T12:00:00.000Z", externalUrl: "https://social.example.test/media-1" });
  const sent = adapters.instagram.calls.publish[0];
  assert.deepEqual(sent.content.artifacts[0].payload, { caption: "Olá", placement: "feed", videoUrl: "https://cdn/v.mp4", thumbnailUrl: "https://cdn/c.jpg" });
  assert.deepEqual(sent.secret, { credentialReferenceId: "cred-1", providerId: "instagram", value: { accessToken: "tok" } }, "referência fora do valor do segredo");
  assert.equal(sent.idempotencyKey, "idem-1");
  await meta.publish({ account: account("facebook"), format: "story_image", caption: "", media: [{ url: "https://cdn/s.jpg", kind: "image" }], idempotencyKey: "idem-2", attemptStartedAt: "x" });
  assert.equal(adapters.facebook.calls.publish[0].content.artifacts[0].payload.placement, "story");
  await tiktok.publish({ account: account("tiktok"), format: "photo_post", caption: "Fotos", media: [{ url: "https://cdn/1.jpg", kind: "image" }, { url: "https://cdn/2.jpg", kind: "image" }], idempotencyKey: "idem-3", attemptStartedAt: "x" });
  assert.deepEqual(adapters.tiktok.calls.publish[0].content.artifacts[0].payload, { description: "Fotos", photoUrls: ["https://cdn/1.jpg", "https://cdn/2.jpg"] });
  const missing = await meta.publish({ account: account("instagram", { accessToken: "tok" }), format: "feed_image", caption: "", media: [], idempotencyKey: "i", attemptStartedAt: "x" });
  assert.equal(missing.failure.errorClass, "AUTH_REQUIRED");
});

test("Contrato: resultados oficiais viram as mesmas classes de erro de qualquer provider", () => {
  assert.equal(mapOfficialResult({ kind: "authentication_failure", errorCode: "E", safeMessage: "m" }).failure.errorClass, "AUTH_REQUIRED");
  assert.equal(mapOfficialResult({ kind: "rate_limited", errorCode: "E", safeMessage: "m" }).failure.errorClass, "RATE_LIMITED");
  assert.equal(mapOfficialResult({ kind: "transient_failure", errorCode: "E", safeMessage: "m" }).failure.errorClass, "TEMPORARY_PLATFORM_ERROR");
  assert.equal(mapOfficialResult({ kind: "rejected", errorCode: "E", safeMessage: "m" }).failure.errorClass, "MEDIA_REJECTED");
  assert.equal(mapOfficialResult({ kind: "permanent_failure", errorCode: "E", safeMessage: "m" }).failure.errorClass, "CONTENT_REJECTED");
  assert.deepEqual(mapOfficialResult({ kind: "unknown_outcome", safeMessage: "timeout", providerRequestId: "pub-9" }), { ok: "unknown", detail: "timeout", providerReference: "pub-9" });
  assert.deepEqual(mapOfficialResult({ kind: "unknown_outcome", safeMessage: "timeout" }), { ok: "unknown", detail: "timeout" });
});

test("Contrato: verificação de resultado desconhecido só afirma com identificador consultável", async () => {
  const { meta, tiktok, adapters } = build({ status: { kind: "published", providerPublicationId: "post-7", publishedAt: "2026-11-01T12:00:00.000Z" } });
  // Meta: sem id de mídia não há o que consultar (container não prova publicação).
  assert.equal((await meta.getPublicationStatus({ account: account("instagram"), providerReference: "container-1", caption: "", attemptStartedAt: "x" })).kind, "inconclusive");
  assert.equal(adapters.instagram.calls.status.length, 0);
  assert.equal((await meta.getPublicationStatus({ account: account("instagram"), externalPostId: "media-9", caption: "", attemptStartedAt: "x" })).kind, "published");
  assert.equal(adapters.instagram.calls.status[0].providerPublicationId, "media-9");
  // TikTok: o publish_id da requisição permite consultar.
  const status = await tiktok.getPublicationStatus({ account: account("tiktok"), providerReference: "publish-5", caption: "", attemptStartedAt: "x" });
  assert.equal(status.kind, "published");
  assert.equal(adapters.tiktok.calls.status[0].providerRequestId, "publish-5");
  assert.equal((await tiktok.getPublicationStatus({ account: account("tiktok"), caption: "", attemptStartedAt: "x" })).kind, "inconclusive");
});

test("Contrato: conexão OAuth mapeia contas autorizadas por rede, status e desconexão", async () => {
  const { meta, tiktok, metaOAuth } = build({
    metaAccounts: [
      { credentialReferenceId: "ig-cred", providerId: "instagram", providerSubjectId: "ig-1", displayName: "@loja", avatarUrl: "https://a/x.jpg", status: "active" },
      { credentialReferenceId: "fb-cred", providerId: "facebook", providerSubjectId: "page-1", displayName: "Loja", status: "disabled" },
      { credentialReferenceId: "fb-old", providerId: "facebook", providerSubjectId: "page-2", status: "revoked" },
    ],
    tiktokAccounts: [{ credentialReferenceId: "tt-cred", openId: "open-1", displayName: "Loja TT", status: "active" }],
  });
  assert.deepEqual(await meta.connection.listAccounts({ tenantId: "t", workspaceId: "w", network: "instagram" }), [{ network: "instagram", externalAccountId: "ig-1", credentialReferenceId: "ig-cred", username: "loja", displayName: "@loja", avatarUrl: "https://a/x.jpg", status: "active" }]);
  assert.deepEqual((await meta.connection.listAccounts({ tenantId: "t", workspaceId: "w", network: "facebook" })).map((item) => [item.externalAccountId, item.status]), [["page-1", "expired"], ["page-2", "revoked"]]);
  assert.deepEqual((await tiktok.connection.listAccounts({ tenantId: "t", workspaceId: "w", network: "tiktok" })).map((item) => item.externalAccountId), ["open-1"]);
  assert.deepEqual(await meta.connection.begin({ tenantId: "t", workspaceId: "w", network: "instagram" }), { redirectUrl: "https://provider.example.test/oauth?state=abc" });
  await meta.connection.disconnect({ tenantId: "t", workspaceId: "w", credentialReferenceId: "ig-cred" });
  assert.deepEqual(metaOAuth.disconnected, [{ tenantId: "t", workspaceId: "w", credentialReferenceId: "ig-cred" }]);
  const unconfigured = build({ configured: false });
  assert.equal(unconfigured.meta.connection.isConfigured(), false);
  await assert.rejects(() => unconfigured.meta.connection.begin({ tenantId: "t", workspaceId: "w", network: "instagram" }), /SOCIAL_CONNECTION_UNAVAILABLE/);
});

test("Contrato: health check é leve e não publica", async () => {
  const { meta, adapters } = build();
  assert.deepEqual(await meta.healthCheck(account("instagram")), { healthy: true, externalAccountId: "ext" });
  assert.equal((await meta.healthCheck(account("instagram", { credentialReferenceId: "c" }))).failure.errorClass, "AUTH_REQUIRED");
  assert.equal(adapters.instagram.calls.publish.length, 0);
  const noAdapter = createOfficialSocialProviders({ officialAdapters: {}, oauth: {} })[0];
  assert.equal((await noAdapter.healthCheck(account("instagram"))).failure.code, "OFFICIAL_ADAPTER_NOT_CONFIGURED");
});
