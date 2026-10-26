import test from "node:test";
import assert from "node:assert/strict";

import { createSocialPublishingModule } from "../dist/infrastructure/social/social-publishing-module.js";
import { InMemorySocialRepository } from "../dist/infrastructure/storage/in-memory-social-repository.js";
import { InMemoryPublicationRepository } from "../dist/infrastructure/storage/in-memory-publication-repository.js";
import { InMemoryNotificationRepository } from "../dist/infrastructure/storage/in-memory-notification-repository.js";
import { InMemoryOperationalAuditRepository } from "../dist/infrastructure/storage/in-memory-operational-audit-repository.js";
import { PublicationDispatchService } from "../dist/application/publication/publication-dispatch-service.js";
import { createDefaultPublicationProviderRegistry } from "../dist/application/publication/publication-provider-registry.js";
import { FakePublicationSecretResolver } from "../dist/application/publication/publication-secret-resolver.js";
import { InMemoryPublicationQueue } from "../dist/application/publication/publication-queue.js";
import { runDueSchedules } from "../dist/application/publication/publication-orchestrator.js";
import { PublicationReconciliationService } from "../dist/application/publication/publication-reconciliation-service.js";
import { SocialAuditLog } from "../dist/application/social/social-audit.js";
import { hasPermission, ROLE_PERMISSIONS } from "../dist/domain/identity/identity.model.js";
import { deriveDestinationState, derivePostState, defaultSocialProviderPolicy } from "../dist/domain/social/social-publishing.model.js";
import { solutionForApiPath } from "../dist/domain/solutions/solution.model.js";

const IMAGE = { url: "https://cdn.example.test/a.jpg", kind: "image", mimeType: "image/jpeg", width: 1080, height: 1080, sizeBytes: 200_000 };
const IMAGE_STORY = { url: "https://cdn.example.test/s.jpg", kind: "image", mimeType: "image/jpeg", width: 1080, height: 1920, sizeBytes: 200_000 };
const VIDEO = { url: "https://cdn.example.test/v.mp4", kind: "video", mimeType: "video/mp4", width: 1080, height: 1920, durationSec: 20, sizeBytes: 5_000_000, hasAudio: true };

const FORMAT = (format, kinds, extra = {}) => ({ format, maxCaptionLength: format.startsWith("story") ? 0 : 2_200, features: extra.features ?? ["caption", "hashtags"], constraints: { kinds, minItems: extra.minItems ?? 1, maxItems: extra.maxItems ?? 1, ...(extra.constraints ?? {}) } });

/**
 * Provider roteirizado que cumpre o MESMO contrato dos oficiais (publicação + conexão OAuth
 * simulada). Nenhuma chamada externa: valida só a infraestrutura genérica.
 */
class ScriptedProvider {
  constructor(type, networks, options = {}) {
    this.descriptor = { type, networks, official: options.official ?? true, implemented: true, realPublishingValidated: false };
    this.calls = [];
    this.results = [];
    this.health = () => undefined;
    this.statusResult = undefined;
    this.statusCalls = [];
    this.authorized = [];
    this.disconnected = [];
    this.formats = options.formats ?? [
      FORMAT("feed_image", ["image"]),
      FORMAT("carousel", ["image"], { minItems: 2, maxItems: 10 }),
      FORMAT("reel", ["video"], { features: ["caption", "hashtags", "embeddedAudio", ...(options.music ? ["nativeMusic", "musicSegment"] : [])], constraints: { maxDurationSec: 90 } }),
      FORMAT("story_image", ["image"]),
      FORMAT("short_video", ["video"], { features: ["caption", "embeddedAudio"] }),
      FORMAT("photo_post", ["image"], { maxItems: 35 }),
    ];
    const self = this;
    this.connection = {
      isConfigured: () => options.configured ?? true,
      begin: async ({ network }) => ({ redirectUrl: `https://auth.example.test/${type}/${network}` }),
      listAccounts: async ({ tenantId, workspaceId, network }) => self.authorized.filter((item) => item.tenantId === tenantId && item.workspaceId === workspaceId && item.network === network).map(({ tenantId: _t, workspaceId: _w, ...account }) => account),
      disconnect: async (input) => { self.disconnected.push(input); },
    };
    if (options.music) this.searchMusic = async ({ query }) => ({ ok: true, tracks: options.music.filter((track) => track.title.toLowerCase().includes(query.toLowerCase())) });
  }
  getCapabilities(network) {
    return { network, formats: this.formats, supportsMusicSearch: typeof this.searchMusic === "function", supportsStatusLookup: true, supportsDelete: false };
  }
  validatePost() {
    return [];
  }
  async healthCheck(account) {
    const forced = this.health(account);
    if (forced) return forced;
    return { healthy: true, externalAccountId: account.externalAccountId };
  }
  async publish(request) {
    this.calls.push(request);
    const next = this.results.shift();
    if (typeof next === "function") return next(request);
    return next ?? { ok: true, externalPostId: `${this.descriptor.type}-post-${this.calls.length}`, externalUrl: `https://social.example.test/p/${this.calls.length}`, publishedAt: new Date().toISOString() };
  }
  async getPublicationStatus(input) {
    this.statusCalls.push(input);
    return this.statusResult ?? { kind: "inconclusive", detail: "n/a" };
  }
}

/** Cofre central simulado: credencial só resolve no tenant/workspace dono. */
class ScopedCredentials {
  constructor() { this.values = new Map(); }
  put(tenantId, workspaceId, credentialReferenceId, value) { this.values.set(`${tenantId}:${workspaceId}:${credentialReferenceId}`, value); }
  async health() { return { ok: true }; }
  async resolve(input) {
    const value = this.values.get(`${input.tenantId}:${input.workspaceId}:${input.credentialReferenceId}`);
    return value ? { credentialReferenceId: input.credentialReferenceId, providerId: input.providerId, value: { ...value } } : undefined;
  }
}

let seq = 0;
const nextId = () => `t${++seq}`;
const PLATFORM_ADMIN = { userId: "platform-admin", role: "owner" };

function harness(options = {}) {
  const clock = { now: new Date(options.now ?? "2026-11-01T12:00:00.000Z") };
  const now = () => new Date(clock.now);
  const publicationRepository = new InMemoryPublicationRepository();
  const repository = new InMemorySocialRepository();
  const credentials = new ScopedCredentials();
  const notificationRepository = new InMemoryNotificationRepository();
  const auditRepository = new InMemoryOperationalAuditRepository();
  const members = [
    { userId: "owner-a", tenantId: "tenant-a", role: "owner", permissionGrants: [], permissionRevokes: [], status: "active" },
    { userId: "editor-a", tenantId: "tenant-a", role: "editor", permissionGrants: [], permissionRevokes: [], status: "active" },
    { userId: "owner-b", tenantId: "tenant-b", role: "owner", permissionGrants: [], permissionRevokes: [], status: "active" },
  ];
  const providers = {
    meta_official: new ScriptedProvider("meta_official", ["instagram", "facebook"]),
    tiktok_official: new ScriptedProvider("tiktok_official", ["tiktok"]),
    // Provider futuro hipotético (outro transporte para o Instagram), para provar troca de provider.
    partner_instagram: new ScriptedProvider("partner_instagram", ["instagram"], { official: false, music: options.music }),
  };
  const social = createSocialPublishingModule({
    repository,
    publicationRepository,
    credentials,
    providers: Object.values(providers),
    mediaProbe: null,
    memberships: { listByTenant: async (tenantId) => members.filter((member) => member.tenantId === tenantId) },
    notification: { notificationRepository },
    auditRepository,
    idGenerator: nextId,
    now,
  });
  const registry = createDefaultPublicationProviderRegistry([social.router]);
  const dispatcher = new PublicationDispatchService({ repository: publicationRepository, providerRegistry: registry, secretResolver: new FakePublicationSecretResolver(), idGenerator: nextId, maxBatch: 1, now });
  const orchestratorDeps = { repository: publicationRepository, providers: [], idGenerator: nextId, queue: new InMemoryPublicationQueue(), concurrency: { maxWorkers: 1, maxConcurrentPublications: 10, maxPerProvider: 1, maxPerTenant: 1, lockTtlMs: 60_000 } };
  const owner = { userId: "owner-a", role: "owner" };

  /** Liberação explícita: kill switch + homologação (plataforma) + política do tenant. */
  async function enable(network, enabledProviders, extra = {}) {
    for (const providerType of enabledProviders) await social.admin.setSwitch({ providerType, enabled: true, approved: true, actor: PLATFORM_ADMIN });
    await social.admin.setTenantPolicy({ tenantId: extra.tenantId ?? "tenant-a", network, publishingEnabled: true, enabledProviders, preferredProvider: extra.preferredProvider ?? enabledProviders[0], actor: PLATFORM_ADMIN });
  }

  /** Cliente autorizou no provider (OAuth) → credencial no cofre → sync cria/atualiza a conta. */
  async function connect(input = {}) {
    const providerType = input.providerType ?? "meta_official";
    const network = input.network ?? "instagram";
    const tenantId = input.tenantId ?? "tenant-a";
    const workspaceId = input.workspaceId ?? "ws-a";
    const externalAccountId = input.externalAccountId ?? `ext-${network}`;
    const credentialReferenceId = input.credentialReferenceId ?? `${providerType}:${tenantId}:${network}:${externalAccountId}`;
    credentials.put(tenantId, workspaceId, credentialReferenceId, { accessToken: `token-${credentialReferenceId}` });
    const provider = providers[providerType];
    provider.authorized = provider.authorized.filter((item) => !(item.tenantId === tenantId && item.workspaceId === workspaceId && item.externalAccountId === externalAccountId && item.network === network));
    provider.authorized.push({ tenantId, workspaceId, network, externalAccountId, credentialReferenceId, username: input.username ?? "loja", status: input.status ?? "active" });
    await social.accounts.syncConnections({ tenantId, workspaceId, actor: owner });
    return repository.findAccountByExternalId({ tenantId, workspaceId, network, externalAccountId });
  }

  async function compose(destinations, extra = {}) {
    return social.posts.create({
      tenantId: extra.tenantId ?? "tenant-a",
      workspaceId: extra.workspaceId ?? "ws-a",
      actor: owner,
      idempotencyKey: extra.idempotencyKey ?? `key-${nextId()}`,
      base: { caption: extra.caption ?? "Oferta da semana", hashtags: ["promo"], media: extra.media ?? [IMAGE] },
      destinations,
      when: extra.when ?? { mode: "now" },
      ...(extra.requireApproval !== undefined ? { requireApproval: extra.requireApproval } : {}),
    });
  }

  const runDue = () => runDueSchedules(orchestratorDeps, now().toISOString());

  /** Drena o outbox como o scheduler da API faria; para quando nada está disponível agora. */
  async function drain(max = 20) {
    for (let index = 0; index < max; index += 1) {
      await dispatcher.dispatchAvailable("worker-1");
      const available = (await publicationRepository.listOutbox()).filter((message) => (message.status === "pending" || message.status === "failed") && message.availableAt <= now().toISOString() && message.lastFailureCode !== "UNKNOWN_OUTCOME");
      if (available.length === 0) break;
    }
  }

  const reconcile = () => new PublicationReconciliationService({ repository: publicationRepository, providerRegistry: registry, secretResolver: new FakePublicationSecretResolver(), idGenerator: nextId }).reconcile({ tenantId: "tenant-a", workspaceId: "ws-a", providerIds: ["social"] });
  const get = (postId) => social.posts.get({ tenantId: "tenant-a", workspaceId: "ws-a", postId });
  const advance = (ms) => { clock.now = new Date(clock.now.getTime() + ms); };
  const notifications = async (userId = "owner-a") => notificationRepository.listActive({ tenantId: "tenant-a", workspaceId: "ws-a", userId, limit: 100 });
  return { social, providers, credentials, publicationRepository, repository, auditRepository, enable, connect, compose, runDue, drain, reconcile, get, advance, now, notifications, owner };
}

// ---------------------------------------------------------------------------------------------

test("Padrão: publicação social DESLIGADA para todo tenant; camadas de disponibilidade separadas", async () => {
  const h = harness();
  for (const network of ["instagram", "facebook", "tiktok"]) {
    const policy = await h.social.resolver.policyFor("tenant-novo", network);
    assert.equal(policy.publishingEnabled, false);
    assert.deepEqual(policy.enabledProviders, []);
    const resolution = await h.social.resolver.connectionProviderFor("tenant-novo", network);
    assert.equal(resolution.ok, false);
    assert.equal(resolution.reason, "PUBLISHING_NOT_ENABLED");
    await assert.rejects(() => h.social.accounts.beginConnection({ tenantId: "tenant-novo", workspaceId: "ws", network }), /SOCIAL_PUBLISHING_NOT_ENABLED/);
  }
  for (const [network, type] of [["instagram", "meta_official"], ["facebook", "meta_official"], ["tiktok", "tiktok_official"]]) {
    const availability = await h.social.resolver.availability({ tenantId: "tenant-novo", network, providerType: type });
    // implementado ≠ configurado ≠ ligado ≠ homologado ≠ liberado ao tenant ≠ validado de verdade.
    assert.deepEqual(availability, { providerType: type, implemented: true, configured: true, enabled: false, approved: false, tenantEnabled: false, realPublishingValidated: false });
  }
  assert.equal((await h.social.resolver.switchFor("meta_official")).enabled, false);
  assert.equal((await h.social.resolver.switchFor("tiktok_official")).enabled, false);
  assert.equal(defaultSocialProviderPolicy("x", "tiktok").preferredProvider, "tiktok_official");
});

test("Liberação explícita: provider só é habilitado ao tenant depois de homologado; tenant por tenant; auditado", async () => {
  const h = harness();
  await assert.rejects(() => h.social.admin.setTenantPolicy({ tenantId: "tenant-a", network: "instagram", publishingEnabled: true, enabledProviders: ["meta_official"], actor: PLATFORM_ADMIN }), /SOCIAL_PROVIDER_NOT_APPROVED/);
  await assert.rejects(() => h.social.admin.setTenantPolicy({ tenantId: "tenant-a", network: "instagram", enabledProviders: ["tiktok_official"], actor: PLATFORM_ADMIN }), /SOCIAL_POLICY_INVALID/, "TikTok não atende Instagram");
  await assert.rejects(() => h.social.admin.setSwitch({ providerType: "nao_existe", enabled: true, actor: PLATFORM_ADMIN }), /SOCIAL_PROVIDER_NOT_IMPLEMENTED/);
  await h.enable("instagram", ["meta_official"]);
  assert.equal((await h.social.resolver.connectionProviderFor("tenant-a", "instagram")).providerType, "meta_official");
  assert.equal((await h.social.resolver.connectionProviderFor("tenant-b", "instagram")).ok, false, "outro tenant continua desligado");
  assert.equal((await h.social.resolver.connectionProviderFor("tenant-a", "facebook")).ok, false, "liberação é por rede");
  const { redirectUrl } = await h.social.accounts.beginConnection({ tenantId: "tenant-a", workspaceId: "ws-a", network: "instagram" });
  assert.equal(redirectUrl, "https://auth.example.test/meta_official/instagram");
  const events = (await h.auditRepository.list({ tenantId: "tenant-a" })).map((event) => event.eventType);
  assert.ok(events.includes("PROVIDER_ENABLED_FOR_TENANT"));
  assert.ok(events.includes("PROVIDER_POLICY_CHANGED"));
  // Provider não configurado (sem app OAuth) não oferece conexão.
  h.providers.tiktok_official.connection.isConfigured = () => false;
  await h.enable("tiktok", ["tiktok_official"]);
  assert.equal((await h.social.resolver.connectionProviderFor("tenant-a", "tiktok")).reason, "PROVIDER_NOT_CONFIGURED");
});

test("Conexão: sync cria a conta com referência da credencial; reconexão e revogação não duplicam a conta", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  assert.equal(account.status, "HEALTHY");
  assert.deepEqual(account.connections.map((connection) => [connection.providerType, connection.status]), [["meta_official", "active"]]);
  // A conta guarda só a referência; o token mora no cofre.
  assert.ok(!JSON.stringify(account).includes("token-"));
  const [view] = await h.social.accounts.listAccountViews({ tenantId: "tenant-a", workspaceId: "ws-a" });
  assert.ok(!("connections" in view) && !("providerType" in view), "visão do cliente sem detalhes técnicos");
  assert.equal(view.statusLabel, "Conectada");
  // Revogada no provider → reconexão necessária (sem apagar a conta).
  await h.connect({ status: "revoked" });
  let current = await h.social.accounts.requireAccount({ tenantId: "tenant-a", workspaceId: "ws-a", accountId: account.id });
  assert.equal(current.status, "REAUTH_REQUIRED");
  await h.connect();
  current = await h.social.accounts.requireAccount({ tenantId: "tenant-a", workspaceId: "ws-a", accountId: account.id });
  assert.equal(current.status, "HEALTHY");
  assert.equal((await h.repository.listAccounts({ tenantId: "tenant-a", workspaceId: "ws-a" })).length, 1);
  const events = (await h.auditRepository.list({ tenantId: "tenant-a" })).map((event) => event.eventType);
  assert.ok(events.includes("SOCIAL_ACCOUNT_CONNECTED") && events.includes("SOCIAL_ACCOUNT_RECONNECTED"));
  // Desconectar: chama o provider, remove a conexão, preserva a conta.
  await h.social.accounts.disconnect({ tenantId: "tenant-a", workspaceId: "ws-a", accountId: account.id, actor: h.owner });
  current = await h.social.accounts.requireAccount({ tenantId: "tenant-a", workspaceId: "ws-a", accountId: account.id });
  assert.equal(current.status, "DISCONNECTED");
  assert.deepEqual(current.connections, []);
  assert.equal(h.providers.meta_official.disconnected.length, 1);
});

test("Isolamento: tenant B não lista, não publica, não lê credencial e não altera conexão/provider de A", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  await h.enable("instagram", ["meta_official"], { tenantId: "tenant-b" });
  const account = await h.connect();
  assert.equal(await h.repository.getAccount({ tenantId: "tenant-b", workspaceId: "ws-b", id: account.id }), undefined);
  assert.deepEqual(await h.social.accounts.listAccountViews({ tenantId: "tenant-b", workspaceId: "ws-b" }), []);
  await assert.rejects(() => h.compose([{ accountId: account.id, format: "feed_image" }], { tenantId: "tenant-b", workspaceId: "ws-b" }), /SOCIAL_VALIDATION_FAILED|SOCIAL_ACCOUNT_NOT_FOUND/);
  await assert.rejects(() => h.social.accounts.testConnection({ tenantId: "tenant-b", workspaceId: "ws-b", accountId: account.id }), /SOCIAL_ACCOUNT_NOT_FOUND/);
  await assert.rejects(() => h.social.accounts.disconnect({ tenantId: "tenant-b", workspaceId: "ws-b", accountId: account.id, actor: { userId: "owner-b", role: "owner" } }), /SOCIAL_ACCOUNT_NOT_FOUND/);
  await assert.rejects(() => h.repository.upsertConnection({ tenantId: "tenant-b", accountId: account.id, connection: { providerType: "meta_official", credentialReferenceId: "b-cred", status: "active" } }), /SOCIAL_ACCOUNT_NOT_FOUND/);
  // Credencial de A nunca resolve no escopo de B, mesmo com referência copiada.
  const forged = { ...account, tenantId: "tenant-b", workspaceId: "ws-b" };
  assert.equal(await h.social.vault.load(forged, "meta_official"), undefined);
  // Política de A não muda com operação de B (configuração operacional é por tenant).
  await h.social.admin.setTenantOperationalPolicy({ tenantId: "tenant-b", network: "instagram", latePolicy: { whenLate: "SKIP" }, actor: { userId: "owner-b", role: "owner" } });
  assert.equal((await h.social.resolver.policyFor("tenant-a", "instagram")).latePolicy.whenLate, "ASK_CONFIRMATION");
  assert.equal(h.providers.meta_official.calls.length, 0);
});

test("Agendar no fuso do tenant → scheduler existente → outbox → publicado com resultado persistido", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  const post = await h.compose([{ accountId: account.id, format: "feed_image" }], { when: { mode: "schedule", localDateTime: "2026-11-01T10:00", timezone: "America/Sao_Paulo" } });
  assert.equal(post.scheduledAt, "2026-11-01T13:00:00.000Z", "10:00 em São Paulo = 13:00Z");
  assert.equal(post.state, "SCHEDULED");
  assert.equal(await h.runDue(), 0);
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 0, "antes da hora nada sai");
  h.advance(60 * 60_000 + 1_000);
  assert.equal(await h.runDue(), 1);
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 1);
  assert.equal(h.providers.meta_official.calls[0].caption, "Oferta da semana\n\n#promo");
  assert.equal(h.providers.meta_official.calls[0].account.session.value.accessToken, "token-meta_official:tenant-a:instagram:ext-instagram", "credencial entregue só ao provider");
  const done = await h.get(post.id);
  assert.equal(done.state, "PUBLISHED");
  assert.equal(done.destinations[0].externalPostId, "meta_official-post-1");
  assert.equal(done.destinations[0].externalUrl, "https://social.example.test/p/1");
  assert.ok((await h.notifications()).some((item) => item.sourceType === "social_publication_published"));
});

test("Idempotência: mesma chave não cria post duplicado; destino publicado nunca é republicado", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  const first = await h.compose([{ accountId: account.id, format: "feed_image" }], { idempotencyKey: "same-key-123" });
  const second = await h.compose([{ accountId: account.id, format: "feed_image" }], { idempotencyKey: "same-key-123" });
  assert.equal(first.id, second.id);
  await h.drain();
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 1);
  await assert.rejects(() => h.social.posts.retryDestination({ tenantId: "tenant-a", workspaceId: "ws-a", destinationId: first.destinations[0].id, actor: h.owner }), /SOCIAL_DESTINATION_NOT_RETRYABLE/);
});

test("MULTI_NETWORK: Instagram e Facebook publicam, TikTok falha → PARTIAL_SUCCESS; retry só no TikTok, respeitando o intervalo da conta", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  await h.enable("facebook", ["meta_official"]);
  await h.enable("tiktok", ["tiktok_official"]);
  const ig = await h.connect({ network: "instagram" });
  const fb = await h.connect({ network: "facebook" });
  const tt = await h.connect({ network: "tiktok", providerType: "tiktok_official" });
  h.providers.tiktok_official.results.push({ ok: false, failure: { errorClass: "MEDIA_REJECTED", code: "TT_MEDIA_REJECTED" } });
  const post = await h.compose([
    { accountId: ig.id, format: "reel" },
    { accountId: fb.id, format: "reel", caption: "Legenda do Facebook" },
    { accountId: tt.id, format: "short_video", caption: "Legenda TikTok", hashtags: ["tiktok"] },
  ], { media: [VIDEO] });
  await h.drain();
  let view = await h.get(post.id);
  assert.equal(view.state, "PARTIAL_SUCCESS");
  const byNetwork = Object.fromEntries(view.destinations.map((destination) => [destination.network, destination]));
  assert.equal(byNetwork.instagram.state, "PUBLISHED");
  assert.equal(byNetwork.facebook.state, "PUBLISHED");
  assert.equal(byNetwork.tiktok.state, "FAILED");
  assert.match(byNetwork.tiktok.problem, /TikTok rejeitou esta mídia/);
  assert.ok(!/TT_|HTTP|token|OAuth/i.test(byNetwork.tiktok.problem), "erro traduzido, sem detalhe técnico");
  assert.deepEqual(byNetwork.tiktok.actions, ["retry"]);
  // Personalização por rede chegou a cada destino; Instagram e Facebook dividem o provider sem misturar.
  const metaCaptions = h.providers.meta_official.calls.map((call) => `${call.account.network}:${call.caption}`).sort();
  assert.deepEqual(metaCaptions, ["facebook:Legenda do Facebook\n\n#promo", "instagram:Oferta da semana\n\n#promo"]);
  assert.equal(h.providers.tiktok_official.calls[0].caption, "Legenda TikTok\n\n#tiktok");

  // Causa raiz do teste antigo: o retry imediato cai no intervalo mínimo da conta (a tentativa que
  // falhou também conta como ação na conta) — fica na fila, sem consumir tentativa, e sai depois.
  await h.social.posts.retryDestination({ tenantId: "tenant-a", workspaceId: "ws-a", destinationId: byNetwork.tiktok.id, actor: h.owner });
  await h.drain();
  assert.equal(h.providers.tiktok_official.calls.length, 1, "retry não fura o intervalo mínimo da conta");
  view = await h.get(post.id);
  assert.equal(view.destinations.find((destination) => destination.network === "tiktok").state, "PUBLISHING");
  h.advance(121_000);
  await h.drain();
  view = await h.get(post.id);
  assert.equal(view.state, "PUBLISHED");
  assert.equal(h.providers.meta_official.calls.length, 2, "Instagram e Facebook não republicam");
  assert.equal(h.providers.tiktok_official.calls.length, 2);
});

test("UNKNOWN_RESULT: timeout após envio → RECONCILIATION_REQUIRED; verifica no MESMO provider; nunca republica às cegas", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  h.providers.meta_official.results.push({ ok: "unknown", detail: "timeout após envio", providerReference: "req-77" });
  h.providers.meta_official.statusResult = { kind: "published", externalPostId: "found-99", externalUrl: "https://social.example.test/p/found", publishedAt: h.now().toISOString() };
  const post = await h.compose([{ accountId: account.id, format: "feed_image" }]);
  await h.drain();
  let view = await h.get(post.id);
  assert.equal(view.state, "RECONCILIATION_REQUIRED");
  assert.equal(view.destinations[0].state, "RECONCILIATION_REQUIRED");
  h.advance(30 * 60_000);
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 1, "nenhuma nova tentativa sem verificação");
  const result = await h.reconcile();
  assert.equal(result.confirmed, 1);
  assert.equal(h.providers.meta_official.statusCalls[0].providerReference, "req-77", "verificação usa a referência devolvida pelo provider");
  view = await h.get(post.id);
  assert.equal(view.state, "PUBLISHED");
  assert.equal(view.destinations[0].externalPostId, "found-99");
  assert.equal(h.providers.meta_official.calls.length, 1);
});

test("UNKNOWN_RESULT: confirmado como NÃO publicado → retry manual publica (sem duplicar o que não saiu)", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  h.providers.meta_official.results.push({ ok: "unknown", detail: "timeout" });
  h.providers.meta_official.statusResult = { kind: "not_found" };
  const post = await h.compose([{ accountId: account.id, format: "feed_image" }]);
  await h.drain();
  await h.reconcile();
  let view = await h.get(post.id);
  assert.equal(view.destinations[0].state, "FAILED");
  // Causa raiz do teste antigo: a mensagem antiga (resultado desconhecido) bloqueava o novo intent
  // e, com horário empatado, a visão lia a mensagem aposentada como estado ("DRAFT").
  await h.social.posts.retryDestination({ tenantId: "tenant-a", workspaceId: "ws-a", destinationId: view.destinations[0].id, actor: h.owner });
  view = await h.get(post.id);
  assert.notEqual(view.destinations[0].state, "DRAFT");
  h.advance(121_000);
  await h.drain();
  view = await h.get(post.id);
  assert.equal(view.state, "PUBLISHED");
  assert.equal(h.providers.meta_official.calls.length, 2);
});

test("UNKNOWN_RESULT: API não permite verificar → fica aguardando; cliente confirma e o Vorix registra sem republicar", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  h.providers.meta_official.results.push({ ok: "unknown", detail: "timeout sem identificador" });
  const post = await h.compose([{ accountId: account.id, format: "feed_image" }]);
  await h.drain();
  const result = await h.reconcile();
  assert.equal(result.inconclusive, 1);
  let view = await h.get(post.id);
  assert.equal(view.destinations[0].state, "RECONCILIATION_REQUIRED");
  assert.deepEqual(view.destinations[0].actions, ["resolve_unknown"]);
  view = await h.social.posts.resolveUnknown({ tenantId: "tenant-a", workspaceId: "ws-a", destinationId: view.destinations[0].id, outcome: "published", externalUrl: "https://social.example.test/p/manual", actor: h.owner });
  assert.equal(view.state, "PUBLISHED");
  assert.equal(view.destinations[0].externalUrl, "https://social.example.test/p/manual");
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 1);
});

test("PROVIDER_SWITCH: a MESMA conta passa a outro provider sem perder agendamento, rascunho, histórico ou mapeamento externo", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  const history = await h.compose([{ accountId: account.id, format: "feed_image" }]);
  await h.drain();
  const scheduled = await h.compose([{ accountId: account.id, format: "feed_image" }], { when: { mode: "schedule", localDateTime: "2026-11-02T10:00", timezone: "America/Sao_Paulo" } });
  const draft = await h.compose([{ accountId: account.id, format: "feed_image" }], { requireApproval: true });

  // Novo provider homologado e liberado SÓ para este tenant/rede; cliente autoriza a mesma conta nele.
  await h.enable("instagram", ["partner_instagram", "meta_official"], { preferredProvider: "partner_instagram" });
  const migrated = await h.connect({ providerType: "partner_instagram" });
  assert.equal(migrated.id, account.id, "mesma conta (rede + id externo)");
  assert.equal(migrated.externalAccountId, account.externalAccountId);
  assert.deepEqual(migrated.connections.map((connection) => connection.providerType).sort(), ["meta_official", "partner_instagram"]);
  assert.equal((await h.repository.listAccounts({ tenantId: "tenant-a", workspaceId: "ws-a" })).length, 1, "não duplica a conta");
  await h.social.admin.migrateAccounts("tenant-a", "instagram", PLATFORM_ADMIN);
  assert.equal((await h.social.accounts.requireAccount({ tenantId: "tenant-a", workspaceId: "ws-a", accountId: account.id })).providerType, "partner_instagram");

  // 10:00 em São Paulo de 02/11 = 13:00Z; o relógio parte de 01/11 12:00Z → avança até depois disso.
  h.advance(25 * 3_600_000 + 60_000);
  await h.runDue();
  await h.drain();
  assert.equal(h.providers.partner_instagram.calls.length, 1, "agendamento antigo sai pelo provider novo");
  assert.equal(h.providers.meta_official.calls.length, 1, "só o post antigo saiu pelo provider anterior");
  const views = await h.social.posts.calendar({ tenantId: "tenant-a", workspaceId: "ws-a" });
  assert.deepEqual(new Set(views.map((view) => view.id)), new Set([history.id, scheduled.id, draft.id]));
  const historyView = views.find((view) => view.id === history.id);
  assert.equal(historyView.state, "PUBLISHED");
  assert.equal(historyView.destinations[0].externalPostId, "meta_official-post-1", "histórico preserva o resultado do provider antigo");
  assert.equal(views.find((view) => view.id === scheduled.id).state, "PUBLISHED");
  assert.equal(views.find((view) => view.id === draft.id).state, "AWAITING_APPROVAL");
  assert.ok((await h.auditRepository.list({ tenantId: "tenant-a" })).some((event) => event.eventType === "PROVIDER_CHANGED"));
});

test("PROVIDER_SWITCH: erro de autenticação no provider preferido NUNCA cai silenciosamente para outro", async () => {
  const h = harness();
  await h.enable("instagram", ["partner_instagram", "meta_official"], { preferredProvider: "partner_instagram" });
  const account = await h.connect({ providerType: "partner_instagram" });
  await h.connect({ providerType: "meta_official" });
  h.providers.partner_instagram.results.push({ ok: false, failure: { errorClass: "AUTH_REQUIRED", code: "TOKEN_REVOKED" } });
  await h.compose([{ accountId: account.id, format: "feed_image" }]);
  await h.drain();
  assert.equal(h.providers.partner_instagram.calls.length, 1);
  assert.equal(h.providers.meta_official.calls.length, 0, "sem fallback em erro de autenticação");
  assert.equal((await h.social.accounts.requireAccount({ tenantId: "tenant-a", workspaceId: "ws-a", accountId: account.id })).status, "REAUTH_REQUIRED");
});

test("Reauth: credencial expirada pausa a fila da conta, preserva horário, notifica agrupado e retoma ao reconectar", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  h.providers.meta_official.results.push({ ok: false, failure: { errorClass: "AUTH_REQUIRED", code: "META_TOKEN_EXPIRED" } });
  const first = await h.compose([{ accountId: account.id, format: "feed_image" }], { when: { mode: "schedule", localDateTime: "2026-11-01T09:10", timezone: "America/Sao_Paulo" } });
  const second = await h.compose([{ accountId: account.id, format: "feed_image" }], { when: { mode: "schedule", localDateTime: "2026-11-01T11:00", timezone: "America/Sao_Paulo" } });
  h.advance(11 * 60_000);
  await h.runDue();
  await h.drain();
  assert.equal((await h.social.accounts.requireAccount({ tenantId: "tenant-a", workspaceId: "ws-a", accountId: account.id })).status, "REAUTH_REQUIRED");
  let view = await h.get(first.id);
  assert.equal(view.destinations[0].state, "WAITING_REAUTH");
  assert.equal(view.destinations[0].scheduledAt, "2026-11-01T12:10:00.000Z", "horário original preservado");
  assert.ok(view.destinations[0].actions.includes("reconnect"));
  const outbox = (await h.publicationRepository.listOutbox()).filter((message) => message.publicationId === first.id);
  assert.equal(outbox[0].status, "pending", "adiado, não dead-letter");
  assert.equal(outbox[0].attemptCount, 0, "espera não consome tentativa");
  assert.equal((await h.get(second.id)).destinations[0].state, "WAITING_REAUTH", "demais agendamentos da conta também aguardam");
  const alerts = (await h.notifications()).filter((item) => item.sourceType === "social_account_reauth");
  assert.equal(alerts.length, 1, "um alerta agrupado");
  assert.match(alerts[0].title, /Instagram precisa ser reconectada/);
  assert.match(alerts[0].body, /Existem 2 publicações aguardando/);
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 1, "não insiste na rede com a credencial inválida");

  h.advance(5 * 60_000);
  await h.connect({ credentialReferenceId: "meta-cred-renovada" });
  await h.drain();
  view = await h.get(first.id);
  assert.equal(view.destinations[0].state, "PUBLISHED", "dentro da tolerância publica ao reconectar");
  assert.equal((await h.get(second.id)).destinations[0].state, "SCHEDULED", "o de 11:00 volta para o horário dele");
});

test("LATE_PUBLICATION_POLICY: além da tolerância pede confirmação; confirmar publica, pular cancela só aquele destino", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  await h.social.admin.setTenantOperationalPolicy({ tenantId: "tenant-a", network: "instagram", latePolicy: { toleranceMinutes: 10, whenLate: "ASK_CONFIRMATION" }, actor: h.owner });
  await h.connect({ status: "expired" });
  const a = await h.compose([{ accountId: account.id, format: "feed_image" }], { when: { mode: "schedule", localDateTime: "2026-11-01T09:05", timezone: "America/Sao_Paulo" } });
  const b = await h.compose([{ accountId: account.id, format: "feed_image" }], { when: { mode: "schedule", localDateTime: "2026-11-01T09:06", timezone: "America/Sao_Paulo" } });
  assert.equal(a.destinations[0].state, "WAITING_REAUTH", "agendar em conta com problema avisa e fica bloqueado");
  h.advance(2 * 3_600_000);
  await h.runDue();
  await h.drain();
  await h.connect();
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 0, "atrasadas além da tolerância não disparam às cegas");
  const viewA = await h.get(a.id);
  assert.equal(viewA.destinations[0].state, "AWAITING_CONFIRMATION");
  assert.ok((await h.notifications()).some((item) => item.sourceType === "social_publication_late"));
  await h.social.accounts.decideLate({ tenantId: "tenant-a", workspaceId: "ws-a", destinationId: viewA.destinations[0].id, decision: "publish", actor: h.owner });
  await h.social.accounts.decideLate({ tenantId: "tenant-a", workspaceId: "ws-a", destinationId: b.destinations[0].id, decision: "skip", actor: h.owner });
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 1);
  assert.equal((await h.get(a.id)).state, "PUBLISHED");
  const viewB = await h.get(b.id);
  assert.equal(viewB.destinations[0].state, "SKIPPED");
  assert.equal(viewB.state, "CANCELLED");
});

test("LATE_PUBLICATION_POLICY: SKIP_IF_TOO_LATE e PUBLISH_WHEN_RECONNECTED; fila atrasada sai escalonada", async () => {
  for (const [whenLate, expected] of [["SKIP", "SKIPPED"], ["PUBLISH_ON_RECONNECT", "PUBLISHED"]]) {
    const h = harness();
    await h.enable("instagram", ["meta_official"]);
    const account = await h.connect();
    await h.social.admin.setTenantOperationalPolicy({ tenantId: "tenant-a", network: "instagram", latePolicy: { toleranceMinutes: 0, whenLate }, actor: h.owner });
    await h.social.accounts.disconnect({ tenantId: "tenant-a", workspaceId: "ws-a", accountId: account.id, actor: h.owner });
    const posts = [];
    for (const minute of ["30", "31", "32"]) posts.push(await h.compose([{ accountId: account.id, format: "feed_image" }], { when: { mode: "schedule", localDateTime: `2026-11-01T09:${minute}`, timezone: "America/Sao_Paulo" } }));
    h.advance(4 * 3_600_000);
    await h.runDue();
    await h.drain();
    await h.connect();
    await h.drain();
    if (whenLate === "PUBLISH_ON_RECONNECT") {
      assert.equal(h.providers.meta_official.calls.length, 1, "não dispara as 3 atrasadas de uma vez");
      for (let round = 0; round < 3; round += 1) { h.advance(121_000); await h.drain(); }
    }
    for (const post of posts) assert.equal((await h.get(post.id)).destinations[0].state, expected, whenLate);
  }
});

test("QUEUE: nunca duas publicações simultâneas na mesma conta; limites por hora adiam sem descartar", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  const p1 = await h.compose([{ accountId: account.id, format: "feed_image" }]);
  const p2 = await h.compose([{ accountId: account.id, format: "feed_image" }]);
  await h.publicationRepository.acquireLock({ publicationId: `social-account:${account.id}`, ownerId: "outra-execucao", acquiredAt: h.now().toISOString(), expiresAt: new Date(h.now().getTime() + 60_000).toISOString() });
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 0, "conta ocupada adia");
  await h.publicationRepository.releaseLock(`social-account:${account.id}`, "outra-execucao");
  h.advance(31_000);
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 1, "uma por vez");
  assert.deepEqual((await Promise.all([p1, p2].map((post) => h.get(post.id)))).map((view) => view.state).sort(), ["PUBLISHED", "PUBLISHING"]);
  h.advance(121_000);
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 2);

  const limited = harness();
  await limited.enable("instagram", ["meta_official"]);
  const acc = await limited.connect();
  await limited.social.admin.setTenantOperationalPolicy({ tenantId: "tenant-a", network: "instagram", rateLimits: { maxPublicationsPerHour: 1, minimumIntervalSeconds: 60 }, actor: limited.owner });
  await limited.compose([{ accountId: acc.id, format: "feed_image" }]);
  const late = await limited.compose([{ accountId: acc.id, format: "feed_image" }]);
  assert.ok((await limited.repository.listPublishLog({ since: "2026-01-01T00:00:00.000Z" })).every((entry) => (entry.durationMs ?? 0) >= 0), "duração nunca negativa");
  await limited.drain();
  limited.advance(5 * 60_000);
  await limited.drain();
  assert.equal(limited.providers.meta_official.calls.length, 1);
  assert.equal((await limited.get(late.id)).destinations[0].state, "PUBLISHING");
  limited.advance(60 * 60_000);
  await limited.drain();
  assert.equal(limited.providers.meta_official.calls.length, 2);
});

test("RETRY: erro transitório tem retry controlado; sem retry infinito", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  h.providers.meta_official.results.push({ ok: false, failure: { errorClass: "NETWORK_ERROR", code: "NET" } }, { ok: false, failure: { errorClass: "TEMPORARY_PLATFORM_ERROR", code: "HTTP_502" } });
  const post = await h.compose([{ accountId: account.id, format: "feed_image" }]);
  for (let round = 0; round < 6; round += 1) { await h.drain(); h.advance(10 * 60_000); }
  assert.equal(h.providers.meta_official.calls.length, 3);
  assert.equal((await h.get(post.id)).state, "PUBLISHED");

  const always = harness();
  await always.enable("instagram", ["meta_official"]);
  const acc = await always.connect();
  for (let index = 0; index < 10; index += 1) always.providers.meta_official.results.push({ ok: false, failure: { errorClass: "TIMEOUT", code: "TIMEOUT" } });
  const failing = await always.compose([{ accountId: acc.id, format: "feed_image" }]);
  for (let round = 0; round < 10; round += 1) { await always.drain(); always.advance(10 * 60_000); }
  assert.ok(always.providers.meta_official.calls.length <= 4, `tentativas limitadas (${always.providers.meta_official.calls.length})`);
  assert.equal((await always.get(failing.id)).state, "FAILED");
});

test("RESTART_RECOVERY: job de executor que morreu é retomado por outro; o antigo não grava resultado (fencing)", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  const post = await h.compose([{ accountId: account.id, format: "feed_image" }]);
  const [claimed] = await h.publicationRepository.claimOutbox({ workerId: "dead-worker", now: h.now().toISOString(), leaseMs: 60_000, limit: 1 });
  assert.ok(claimed);
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 0, "lease vigente: ninguém mais publica");
  h.advance(61_000);
  assert.equal(await h.publicationRepository.releaseExpiredOutbox(h.now().toISOString()), 1);
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 1);
  const late = await h.publicationRepository.completeOutbox({ outboxMessageId: claimed.outboxMessageId, workerId: "dead-worker", fencingToken: claimed.fencingToken, now: h.now().toISOString() });
  assert.equal(late.committed, false);
  assert.equal((await h.get(post.id)).state, "PUBLISHED");
});

test("Kill switch: desligar provider pausa novos jobs, preserva agendamentos, informa e retoma ao religar", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  const post = await h.compose([{ accountId: account.id, format: "feed_image" }], { when: { mode: "schedule", localDateTime: "2026-11-01T09:05", timezone: "America/Sao_Paulo" } });
  await h.social.admin.setSwitch({ providerType: "meta_official", enabled: false, reason: "instável", actor: PLATFORM_ADMIN });
  assert.ok((await h.notifications()).some((item) => item.sourceType === "social_provider_paused"));
  h.advance(10 * 60_000);
  await h.runDue();
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 0);
  let view = await h.get(post.id);
  assert.equal(view.destinations[0].state, "PAUSED");
  const [option] = await h.social.posts.composerOptions({ tenantId: "tenant-a", workspaceId: "ws-a" });
  assert.equal(option.publishable, false);
  assert.match(option.warning, /pausadas/);
  await h.social.admin.setSwitch({ providerType: "meta_official", enabled: true, actor: PLATFORM_ADMIN });
  await h.drain();
  view = await h.get(post.id);
  assert.equal(view.state, "PUBLISHED");
});

test("Capabilities reais controlam o composer: formato desligado some; música nativa só onde o provider oferece", async () => {
  const music = [
    { musicId: "m1", title: "Verão Total", artist: "Banda", durationSec: 30, available: true, supportsSegment: true },
    { musicId: "m2", title: "Verão Bloqueado", available: false, supportsSegment: false },
  ];
  const h = harness({ music });
  await h.enable("instagram", ["meta_official"]);
  await h.enable("tiktok", ["tiktok_official"]);
  h.providers.tiktok_official.health = (account) => ({ healthy: true, externalAccountId: account.externalAccountId, disabledFormats: ["photo_post"] });
  const ig = await h.connect();
  const tt = await h.connect({ network: "tiktok", providerType: "tiktok_official" });
  const options = await h.social.posts.composerOptions({ tenantId: "tenant-a", workspaceId: "ws-a" });
  assert.ok(!options.find((item) => item.accountId === tt.id).formats.some((format) => format.format === "photo_post"));
  assert.equal(options.find((item) => item.accountId === ig.id).musicSearch, false, "provider oficial sem música nativa não promete o recurso");
  assert.equal((await h.social.posts.searchMusic({ tenantId: "tenant-a", workspaceId: "ws-a", accountId: ig.id, query: "verão", format: "reel" })).available, false);
  await assert.rejects(() => h.compose([{ accountId: tt.id, format: "photo_post" }]), /SOCIAL_VALIDATION_FAILED/);
  await assert.rejects(() => h.compose([{ accountId: ig.id, format: "reel", music: { musicId: "m1", title: "Verão Total" } }], { media: [VIDEO] }), /SOCIAL_VALIDATION_FAILED/, "música simulada é recusada");
  const checks = await h.social.posts.validate({ tenantId: "tenant-a", workspaceId: "ws-a", base: { caption: "texto ignorado em story", media: [IMAGE] }, destinations: [{ accountId: ig.id, format: "reel" }, { accountId: ig.id, format: "story_image", media: [IMAGE_STORY] }, { accountId: ig.id, format: "reel", media: [{ ...VIDEO, durationSec: 600 }] }] });
  assert.equal(checks[0].issues[0].code, "MEDIA_KIND_UNSUPPORTED");
  assert.deepEqual(checks[1].issues, [], "story sem legenda não é erro");
  assert.equal(checks[2].issues[0].code, "MEDIA_DURATION");
  // Áudio embutido no vídeo continua possível sem música nativa.
  const embedded = await h.compose([{ accountId: tt.id, format: "short_video" }], { media: [VIDEO] });
  assert.equal(embedded.destinations[0].audioMode, "EMBEDDED_AUDIO");
});

test("Modelo de música preparado para provider futuro: busca só o disponível e a seleção chega ao provider", async () => {
  const music = [
    { musicId: "m1", title: "Verão Total", artist: "Banda", durationSec: 30, available: true, supportsSegment: true, providerData: { trackRef: "x1" } },
    { musicId: "m2", title: "Verão Bloqueado", available: false, supportsSegment: false },
  ];
  const h = harness({ music });
  await h.enable("instagram", ["partner_instagram"]);
  const account = await h.connect({ providerType: "partner_instagram" });
  const found = await h.social.posts.searchMusic({ tenantId: "tenant-a", workspaceId: "ws-a", accountId: account.id, query: "verão", format: "reel" });
  assert.deepEqual(found.tracks.map((track) => track.musicId), ["m1"], "indisponível não aparece");
  const selection = { musicId: "m1", title: "Verão Total", artist: "Banda", segmentStartSec: 5, segmentDurationSec: 15, providerData: { trackRef: "x1" } };
  h.providers.partner_instagram.results.push({ ok: false, failure: { errorClass: "MUSIC_UNAVAILABLE", code: "MUSIC_GONE" } });
  const post = await h.compose([{ accountId: account.id, format: "reel", music: selection }], { media: [VIDEO] });
  assert.equal(post.destinations[0].audioMode, "NATIVE_PLATFORM_MUSIC");
  await h.drain();
  assert.deepEqual(h.providers.partner_instagram.calls[0].music, selection);
  const view = await h.get(post.id);
  assert.equal(view.destinations[0].state, "FAILED");
  assert.match(view.destinations[0].problem, /música escolhida não está mais disponível/);
  assert.ok((await h.auditRepository.list({ tenantId: "tenant-a" })).some((event) => event.eventType === "MUSIC_SELECTED"));
});

test("Aprovação, cancelamento e reagendamento", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  const awaiting = await h.compose([{ accountId: account.id, format: "feed_image" }], { requireApproval: true });
  assert.equal(awaiting.state, "AWAITING_APPROVAL");
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 0);
  await h.social.posts.approve({ tenantId: "tenant-a", workspaceId: "ws-a", postId: awaiting.id, actor: h.owner });
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 1);

  const post = await h.compose([{ accountId: account.id, format: "feed_image" }], { when: { mode: "schedule", localDateTime: "2026-11-01T15:00", timezone: "America/Sao_Paulo" } });
  const moved = await h.social.posts.reschedule({ tenantId: "tenant-a", workspaceId: "ws-a", postId: post.id, localDateTime: "2026-11-01T16:30", actor: h.owner });
  assert.equal(moved.destinations[0].scheduledAt, "2026-11-01T19:30:00.000Z");
  h.advance(7 * 3_600_000);
  await h.runDue();
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 1, "não sai no horário antigo");
  const other = await h.compose([{ accountId: account.id, format: "feed_image" }], { when: { mode: "schedule", localDateTime: "2026-11-01T20:00", timezone: "America/Sao_Paulo" } });
  assert.equal((await h.social.posts.cancel({ tenantId: "tenant-a", workspaceId: "ws-a", postId: other.id, actor: h.owner })).state, "CANCELLED");
  h.advance(4 * 3_600_000);
  await h.runDue();
  await h.drain();
  assert.equal(h.providers.meta_official.calls.length, 2, "só o reagendado saiu");
  await assert.rejects(() => h.social.posts.reschedule({ tenantId: "tenant-a", workspaceId: "ws-a", postId: post.id, localDateTime: "2026-11-03T10:00", actor: h.owner }), /SOCIAL_POST_ALREADY_STARTED/);
});

test("Health check periódico detecta credencial inválida antes do horário; credencial de outro perfil é recusada", async () => {
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  const account = await h.connect();
  h.advance(7 * 3_600_000);
  h.providers.meta_official.health = () => ({ healthy: false, failure: { errorClass: "AUTH_REQUIRED", code: "TOKEN_EXPIRED" } });
  assert.deepEqual(await h.social.accounts.runHealthChecks({ olderThanMs: 6 * 3_600_000, limit: 10 }), { checked: 1, unhealthy: 1 });
  assert.equal((await h.social.accounts.requireAccount({ tenantId: "tenant-a", workspaceId: "ws-a", accountId: account.id })).status, "REAUTH_REQUIRED");
  h.providers.meta_official.health = () => ({ healthy: true, externalAccountId: "perfil-diferente" });
  await h.social.accounts.testConnection({ tenantId: "tenant-a", workspaceId: "ws-a", accountId: account.id });
  assert.equal((await h.social.accounts.requireAccount({ tenantId: "tenant-a", workspaceId: "ws-a", accountId: account.id })).lastErrorCode, "SESSION_ACCOUNT_MISMATCH");
});

test("Auditoria nunca grava token, segredo, cookie ou sessão", async () => {
  const audit = [];
  const log = new SocialAuditLog({ record: async (event) => { audit.push(event); return event; } }, nextId);
  await log.record({ tenantId: "t", event: "SOCIAL_ACCOUNT_CONNECTED", actor: { userId: "u", role: "owner" }, resource: { type: "social_account", id: "a" }, metadata: { network: "instagram", password: "x", sessionState: "y", cookie: "z", accessToken: "w", refreshToken: "r", authorization: "b", username: "loja" } });
  assert.deepEqual(audit[0].metadata, { network: "instagram", username: "loja" });
  const h = harness();
  await h.enable("instagram", ["meta_official"]);
  await h.connect();
  assert.ok(!JSON.stringify(await h.auditRepository.list({ tenantId: "tenant-a" })).includes("token-"));
});

test("RBAC: permissões marketing:social_* por perfil; rotas sociais pertencem à solução Marketing", () => {
  assert.ok(hasPermission("viewer", "marketing:social_read"));
  assert.ok(!hasPermission("viewer", "marketing:social_publish"));
  assert.ok(hasPermission("editor", "marketing:social_publish") && hasPermission("editor", "marketing:social_schedule"));
  assert.ok(!hasPermission("editor", "marketing:social_connect") && !hasPermission("editor", "marketing:social_manage_accounts"));
  for (const permission of ["marketing:social_connect", "marketing:social_manage_accounts", "marketing:social_manage_provider"]) {
    assert.ok(ROLE_PERMISSIONS.owner.includes(permission), permission);
    assert.ok(ROLE_PERMISSIONS.admin.includes(permission), `gerente: ${permission}`);
  }
  assert.equal(solutionForApiPath("/v1/social/posts"), "marketing");
  assert.equal(solutionForApiPath("/v1/admin/social-providers"), undefined);
});

test("Estados derivados por destino e do post agregado", () => {
  assert.equal(deriveDestinationState({ planState: "approved", targetStatus: "pending", hasSchedule: true, skipped: false }), "SCHEDULED");
  assert.equal(deriveDestinationState({ planState: "approved", targetStatus: "pending", hasSchedule: false, skipped: false }), "PUBLISHING");
  assert.equal(deriveDestinationState({ planState: "draft", targetStatus: "pending", hasSchedule: false, skipped: false }), "DRAFT");
  assert.equal(deriveDestinationState({ planState: "publishing", targetStatus: "pending", hasSchedule: false, outboxStatus: "dead_lettered", skipped: false }), "PUBLISHING");
  assert.equal(deriveDestinationState({ planState: "unknown_outcome", targetStatus: "unknown_outcome", hasSchedule: false, skipped: false }), "RECONCILIATION_REQUIRED");
  assert.equal(deriveDestinationState({ planState: "cancelled", targetStatus: "published", hasSchedule: false, skipped: false }), "PUBLISHED");
  assert.equal(derivePostState(["PUBLISHED", "PUBLISHED", "FAILED"]), "PARTIAL_SUCCESS");
  assert.equal(derivePostState(["PUBLISHED", "RECONCILIATION_REQUIRED"]), "RECONCILIATION_REQUIRED");
  assert.equal(derivePostState(["FAILED", "FAILED"]), "FAILED");
  assert.equal(derivePostState(["SCHEDULED", "WAITING_REAUTH"]), "WAITING_REAUTH");
  assert.equal(derivePostState(["CANCELLED", "SKIPPED"]), "CANCELLED");
});
