import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { createSocialPublishingModule } from "../dist/infrastructure/social/social-publishing-module.js";
import { YouTubeOAuthService, YOUTUBE_REQUIRED_SCOPES } from "../dist/infrastructure/publication/youtube-oauth-service.js";
import { YouTubeContentPostingProvider } from "../dist/infrastructure/publication/youtube-content-posting-provider.js";
import { InMemoryOAuthStateStore } from "../dist/infrastructure/storage/oauth-state-stores.js";
import { InMemorySocialRepository } from "../dist/infrastructure/storage/in-memory-social-repository.js";
import { InMemoryPublicationRepository } from "../dist/infrastructure/storage/in-memory-publication-repository.js";
import { LocalPublicationSecretStore } from "../dist/application/publication/publication-secret-store.js";
import { StoredPublicationSecretResolver, FakePublicationSecretResolver } from "../dist/application/publication/publication-secret-resolver.js";
import { createDefaultPublicationProviderRegistry } from "../dist/application/publication/publication-provider-registry.js";
import { PublicationDispatchService } from "../dist/application/publication/publication-dispatch-service.js";
import { runDueSchedules } from "../dist/application/publication/publication-orchestrator.js";
import { InMemoryPublicationQueue } from "../dist/application/publication/publication-queue.js";
import { registerSocialRoutes } from "../dist/interfaces/api/routes/v1/social.route.js";

const SCOPE = { tenantId: "tenant-a", workspaceId: "ws-a" };
const ACTOR = { tenantId: "tenant-a", userId: "owner-a", role: "owner" };
const VIDEO = { url: "https://cdn.test/short.mp4", kind: "video", mimeType: "video/mp4", width: 1080, height: 1920, durationSec: 180, sizeBytes: 20 };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

function harness(options = {}) {
  let current = new Date("2026-11-17T12:00:00.000Z");
  let seq = 0;
  const now = () => new Date(current);
  const idGenerator = () => `yt-test-${++seq}`;
  const repository = new InMemoryPublicationRepository();
  const socialRepository = new InMemorySocialRepository();
  const secretStore = new LocalPublicationSecretStore();
  const stateStore = new InMemoryOAuthStateStore();
  const calls = [];
  const httpClient = async (url, init = {}) => {
    const href = String(url);
    calls.push({ href, init });
    if (href.endsWith("/token")) return json({ access_token: String(init.body).includes("grant_type=refresh_token") ? "yt-renewed" : "yt-access", refresh_token: options.noRefresh ? undefined : "yt-refresh", scope: options.scope ?? YOUTUBE_REQUIRED_SCOPES.join(" "), expires_in: 3600 });
    if (href.includes("/channels?")) return json({ items: [{ id: "channel-1", snippet: { title: "Canal Vorix" } }] });
    if (href === VIDEO.url) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "video/mp4" } });
    if (href.includes("/upload/youtube/v3/videos?")) {
      if (options.expiredAccess && init.headers.Authorization === "Bearer yt-access") return json({ error: { message: "Expired access token" } }, 401);
      return json({}, 200, { location: "https://upload.test/session" });
    }
    if (href === "https://upload.test/session") return json({ id: "video-1" });
    if (href.endsWith("/revoke")) return json({});
    throw new Error(`Unexpected HTTP call: ${href}`);
  };
  const oauthInput = { config: { enabled: true, clientId: "client", clientSecret: "secret", redirectUri: "https://app.test/youtube/callback", scopes: YOUTUBE_REQUIRED_SCOPES }, repository, secretStore, stateStore, now, httpClient };
  const oauth = new YouTubeOAuthService(oauthInput);
  const provider = new YouTubeContentPostingProvider({}, httpClient, (input) => oauth.refresh(input));
  const social = createSocialPublishingModule({ repository: socialRepository, publicationRepository: repository, credentials: new StoredPublicationSecretResolver(secretStore), officialAdapters: { youtube: provider }, oauth: { youtube: () => oauth }, platformDefaults: { youtube_official: { enabled: true, approved: true } }, mediaProbe: null, now, idGenerator });
  const dispatcher = new PublicationDispatchService({ repository, providerRegistry: createDefaultPublicationProviderRegistry([social.router]), secretResolver: new FakePublicationSecretResolver(), idGenerator, maxBatch: 10, now });
  const orchestrator = { repository, providers: [], idGenerator, now, queue: new InMemoryPublicationQueue(), concurrency: { maxWorkers: 1, maxConcurrentPublications: 10, maxPerProvider: 1, maxPerTenant: 1, lockTtlMs: 60_000 } };
  async function connect() {
    const started = await social.accounts.beginConnection({ ...SCOPE, network: "youtube", userId: ACTOR.userId, returnPath: "/workspaces/ws-a/social/integrations" });
    return social.accounts.completeConnection({ ...ACTOR, actor: ACTOR, network: "youtube", state: new URL(started.redirectUrl).searchParams.get("state"), code: "code" });
  }
  return { oauth, oauthInput, social, repository, socialRepository, calls, now, connect, dispatcher, orchestrator, advance: (ms) => { current = new Date(current.getTime() + ms); } };
}

test("YouTube OAuth: state compartilhado entre instâncias, PKCE, vínculo de usuário/tenant e uso único", async () => {
  const h = harness();
  const begin = await h.oauth.begin({ ...SCOPE, userId: ACTOR.userId, returnPath: "/workspaces/ws-a/social/integrations" });
  const url = new URL(begin.authorizationUrl);
  const restarted = new YouTubeOAuthService(h.oauthInput);
  const result = await restarted.complete({ state: begin.state, code: "code", actor: ACTOR });
  assert.deepEqual(result.flow, { workspaceId: "ws-a", network: "youtube", returnPath: "/workspaces/ws-a/social/integrations" });
  const fields = new URLSearchParams(h.calls.find((call) => call.href.endsWith("/token")).init.body);
  assert.equal(createHash("sha256").update(fields.get("code_verifier")).digest("base64url"), url.searchParams.get("code_challenge"));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  await assert.rejects(() => h.oauth.complete({ state: begin.state, code: "code", actor: ACTOR }), /YOUTUBE_OAUTH_STATE_INVALID/);
  for (const actor of [{ ...ACTOR, tenantId: "other" }, { ...ACTOR, userId: "other" }]) {
    const pending = await h.oauth.begin({ ...SCOPE, userId: ACTOR.userId });
    await assert.rejects(() => restarted.complete({ state: pending.state, code: "code", actor }), /YOUTUBE_OAUTH_STATE_INVALID/);
  }
  const expired = await h.oauth.begin({ ...SCOPE, userId: ACTOR.userId });
  h.advance(11 * 60_000);
  await assert.rejects(() => restarted.complete({ state: expired.state, code: "code", actor: ACTOR }), /YOUTUBE_OAUTH_STATE_INVALID/);
  assert.equal(h.calls.filter((call) => call.href.endsWith("/token")).length, 1);
});

test("YouTube exige permissões e refresh token para agendamento automático", async () => {
  for (const options of [{ scope: YOUTUBE_REQUIRED_SCOPES[1] }, { noRefresh: true }]) {
    const h = harness(options);
    await assert.rejects(() => h.connect(), /SOCIAL_YOUTUBE_(PERMISSIONS|OFFLINE_ACCESS)_REQUIRED/);
    assert.deepEqual(await h.socialRepository.listAccounts(SCOPE), []);
  }
});

test("YouTube renova token expirado durante o envio e preserva refresh token na reconexão", async () => {
  const options = { expiredAccess: true };
  const h = harness(options);
  await h.connect();
  options.noRefresh = true;
  await h.connect();
  const [account] = await h.socialRepository.listAccounts(SCOPE);
  assert.equal((await h.socialRepository.listAccounts(SCOPE)).length, 1);
  const input = { ...SCOPE, actor: ACTOR, idempotencyKey: "short-renew-token", base: { caption: "Short automático", media: [VIDEO] }, destinations: [{ accountId: account.id, format: "short_video" }], when: { mode: "now" } };
  const post = await h.social.posts.create(input);
  await h.dispatcher.dispatchAvailable("yt-worker");
  assert.equal((await h.social.posts.get({ ...SCOPE, postId: post.id })).state, "PUBLISHED");
  assert.equal(h.calls.filter((call) => call.href.endsWith("/token") && String(call.init.body).includes("grant_type=refresh_token")).length, 1);
  assert.equal(h.calls.filter((call) => call.href === "https://upload.test/session").length, 1);
  const stored = await h.oauthInput.secretStore.get({ ...SCOPE, providerId: "youtube", credentialReferenceId: account.connections[0].credentialReferenceId });
  assert.equal(stored.value.refreshToken, "yt-refresh");
  assert.equal(stored.value.accessToken, "yt-renewed");
});

test("Integrações HTTP: conexão YouTube, callback, canal visível, teste e isolamento de workspace", async () => {
  const h = harness();
  const app = Fastify();
  let principal = { ...ACTOR, permissions: ["marketing:social_read", "marketing:social_connect"] };
  app.addHook("onRequest", async (request) => { request.zunoContext = { principal }; });
  app.setErrorHandler((error, _request, reply) => reply.code(error.statusCode ?? 500).send({ code: error.code, message: error.message }));
  await registerSocialRoutes(app, { social: h.social, workspaceRepository: { getById: async (id) => ({ id, tenantId: id === "ws-a" ? "tenant-a" : "tenant-b" }) }, idGenerator: () => "http-id" });
  try {
    const list = (await app.inject("/social/accounts?workspaceId=ws-a")).json().data;
    assert.equal(list.networks.find((item) => item.network === "youtube").canConnect, true);
    const start = await app.inject({ method: "POST", url: "/social/connections", payload: { workspaceId: "ws-a", network: "youtube", returnPath: "/workspaces/ws-a/social/integrations" } });
    assert.equal(start.statusCode, 201, start.body);
    const state = new URL(start.json().data.redirectUrl).searchParams.get("state");
    const callback = await app.inject({ method: "POST", url: "/social/connections/callback", payload: { network: "youtube", state, code: "code" } });
    assert.equal(callback.statusCode, 200, callback.body);
    assert.equal(callback.json().data.autoConnected, true);
    const connected = await app.inject("/social/accounts?workspaceId=ws-a");
    assert.ok(!connected.body.includes("yt-access") && !connected.body.includes("yt-refresh"));
    const account = connected.json().data.accounts.find((item) => item.network === "youtube");
    assert.equal(account.displayName, "Canal Vorix");
    assert.equal((await app.inject({ method: "POST", url: `/social/accounts/${account.id}/test?workspaceId=ws-a` })).json().data.healthy, true);
    const replay = await app.inject({ method: "POST", url: "/social/connections/callback", payload: { network: "youtube", state, code: "code" } });
    assert.equal(replay.statusCode, 400);
    assert.equal(replay.json().code, "SOCIAL_CONNECTION_EXPIRED");
    assert.equal((await app.inject("/social/accounts?workspaceId=other")).statusCode, 404);
    principal = { ...principal, permissions: ["marketing:social_read"] };
    assert.equal((await app.inject({ method: "POST", url: "/social/connections", payload: { workspaceId: "ws-a", network: "youtube" } })).statusCode, 403);
  } finally { await app.close(); }
});

test("Shorts: validação por capacidade rejeita imagem, horizontal, mais de 3 minutos e metadados ausentes", async () => {
  const h = harness();
  await h.connect();
  const [account] = await h.socialRepository.listAccounts(SCOPE);
  const [option] = await h.social.posts.composerOptions(SCOPE);
  assert.equal(option.network, "youtube");
  assert.deepEqual(option.formats.map((item) => item.format), ["short_video"]);
  assert.equal(option.musicSearch, false);
  for (const [media, code] of [
    [{ ...VIDEO, kind: "image" }, "MEDIA_KIND_UNSUPPORTED"],
    [{ ...VIDEO, width: 1920, height: 1080 }, "MEDIA_ASPECT_RATIO"],
    [{ ...VIDEO, durationSec: 181 }, "MEDIA_DURATION"],
    [{ url: VIDEO.url, kind: "video" }, "YOUTUBE_METADATA_REQUIRED"],
  ]) {
    const [check] = await h.social.posts.validate({ ...SCOPE, base: { caption: "Oferta", media: [media] }, destinations: [{ accountId: account.id, format: "short_video" }] });
    assert.ok(check.issues.some((issue) => issue.code === code), JSON.stringify(check));
  }
  for (const media of [VIDEO, { ...VIDEO, height: 1080 }]) {
    const [check] = await h.social.posts.validate({ ...SCOPE, base: { caption: "Oferta", media: [media] }, destinations: [{ accountId: account.id, format: "short_video" }] });
    assert.deepEqual(check.issues, []);
  }
});

test("Short agendado: fila publica no horário, registra histórico e não duplica; desconexão preserva agendamento", async () => {
  const h = harness();
  await h.connect();
  const [account] = await h.socialRepository.listAccounts(SCOPE);
  const input = { ...SCOPE, actor: ACTOR, idempotencyKey: "short-scheduled-1", base: { caption: "Oferta do dia\nConfira!", hashtags: ["promo"], media: [VIDEO] }, destinations: [{ accountId: account.id, format: "short_video" }], when: { mode: "schedule", localDateTime: "2026-11-17T10:00:00", timezone: "America/Sao_Paulo" } };
  const post = await h.social.posts.create(input);
  assert.equal(post.state, "SCHEDULED");
  assert.equal(post.scheduledAt, "2026-11-17T13:00:00.000Z");
  assert.equal((await h.social.posts.create(input)).id, post.id);
  await runDueSchedules(h.orchestrator, h.now().toISOString());
  await h.dispatcher.dispatchAvailable("yt-worker");
  assert.equal(h.calls.filter((call) => call.href === VIDEO.url).length, 0);
  h.advance(60 * 60_000);
  await runDueSchedules(h.orchestrator, h.now().toISOString());
  await h.dispatcher.dispatchAvailable("yt-worker");
  const published = await h.social.posts.get({ ...SCOPE, postId: post.id });
  assert.equal(published.state, "PUBLISHED", JSON.stringify(published));
  assert.equal(published.destinations[0].externalPostId, "video-1");
  assert.ok(published.history.some((item) => item.kind === "published" && item.network === "youtube"));
  const upload = h.calls.find((call) => call.href.includes("/upload/youtube/v3/videos?"));
  const metadata = JSON.parse(upload.init.body);
  assert.equal(metadata.snippet.title, "Oferta do dia");
  assert.ok(metadata.snippet.description.includes("#promo"));
  assert.equal(metadata.status.privacyStatus, "public");
  await h.dispatcher.dispatchAvailable("yt-worker");
  assert.equal(h.calls.filter((call) => call.href === "https://upload.test/session").length, 1);
  const pending = await h.social.posts.create({ ...input, idempotencyKey: "short-scheduled-2", when: { mode: "schedule", localDateTime: "2026-11-17T11:00:00" } });
  await h.social.accounts.disconnect({ ...SCOPE, accountId: account.id, actor: ACTOR });
  assert.ok(await h.social.posts.get({ ...SCOPE, postId: pending.id }));
  assert.equal((await h.socialRepository.listAccounts(SCOPE))[0].status, "DISCONNECTED");
});

test("Migração 0200 aceita YouTube nas três tabelas e preserva redes existentes", async () => {
  const db = new PGlite();
  try {
    for (const name of ["social_accounts", "social_provider_policies", "social_post_destinations"]) {
      await db.exec(`create table ${name}(network text not null check(network in ('instagram','facebook','tiktok'))); insert into ${name} values('instagram');`);
    }
    const migration = await readFile(new URL("../db/migrations/0200_social_youtube_shorts.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    for (const name of ["social_accounts", "social_provider_policies", "social_post_destinations"]) {
      await db.exec(`insert into ${name} values('youtube');`);
      assert.deepEqual((await db.query(`select network from ${name} order by network`)).rows.map((item) => item.network), ["instagram", "youtube"]);
      await assert.rejects(() => db.exec(`insert into ${name} values('invalid');`));
    }
  } finally { await db.close(); }
});
