import test from "node:test";
import assert from "node:assert/strict";

import { createPublication, approvePublication } from "../dist/application/publication/publication-engine.js";
import { PublicationDispatchService } from "../dist/application/publication/publication-dispatch-service.js";
import { DryRunPublicationProvider, FakePublicationProvider } from "../dist/application/publication/fake-publication-providers.js";
import { ensurePublicationOutboxIntents } from "../dist/application/publication/publication-outbox-intent.js";
import { PublicationProviderRegistry } from "../dist/application/publication/publication-provider-registry.js";
import { InMemoryPublicationQueue } from "../dist/application/publication/publication-queue.js";
import { rebuildPublicationQueueFromOutbox, PublicationWorker } from "../dist/application/publication/publication-orchestrator.js";
import { PublicationReconciliationService } from "../dist/application/publication/publication-reconciliation-service.js";
import { PublicationProviderPolicy } from "../dist/application/publication/publication-provider-policy.js";
import { FakePublicationSecretResolver, StoredPublicationSecretResolver } from "../dist/application/publication/publication-secret-resolver.js";
import { LocalPublicationSecretStore } from "../dist/application/publication/publication-secret-store.js";
import { collectPublicationMetrics } from "../dist/application/publication/publication-observability.js";
import { ComplianceService } from "../dist/application/credential/compliance-service.js";
import { CredentialGovernanceService } from "../dist/application/credential/credential-governance-service.js";
import { PublicationGovernancePolicy } from "../dist/application/credential/publication-governance-policy.js";
import { MetaPagesOAuthService } from "../dist/infrastructure/publication/meta-pages-oauth-service.js";
import { MetaPagesSandboxProvider } from "../dist/infrastructure/publication/meta-pages-sandbox-provider.js";
import { InMemoryCredentialRepository } from "../dist/infrastructure/storage/in-memory-credential-repository.js";
import { InMemoryOperationalAuditRepository } from "../dist/infrastructure/storage/in-memory-operational-audit-repository.js";
import { InMemoryPublicationRepository } from "../dist/infrastructure/storage/in-memory-publication-repository.js";

let counter = 0;
const nextId = () => `pub-rel-${++counter}`;

function artifact(id = "artifact-rel") {
  return { artifactId: id, artifactType: "document", schemaId: "publication.manifest", schemaVersion: 1, checksum: `checksum-${id}`, payload: { caption: "Oferta", cta: "Comprar" } };
}

function registryWith(...providers) {
  const registry = new PublicationProviderRegistry();
  for (const provider of providers.length ? providers : [new DryRunPublicationProvider(), new FakePublicationProvider()]) registry.register(provider);
  return registry;
}

function deps(input = {}) {
  const repository = new InMemoryPublicationRepository();
  const queue = new InMemoryPublicationQueue();
  const providers = input.providers ?? [new DryRunPublicationProvider(), new FakePublicationProvider()];
  const providerRegistry = registryWith(...providers);
  const secretResolver = new FakePublicationSecretResolver();
  return {
    repository,
    queue,
    providers,
    providerRegistry,
    secretResolver,
    idGenerator: nextId,
    concurrency: { maxWorkers: 2, maxConcurrentPublications: 4, maxPerProvider: 1, maxPerTenant: 1, lockTtlMs: 60_000 },
  };
}

test("Provider Registry: bloqueia desconhecido, desabilitado e capability incompatível", () => {
  const disabled = new FakePublicationProvider({ enabled: false });
  const registry = registryWith(new DryRunPublicationProvider(), disabled);
  assert.ok(registry.list().some((provider) => provider.providerId === "dry_run" && provider.supportsIdempotencyKey));
  assert.equal(new DryRunPublicationProvider().capabilities().supportsStatusLookup, true);
  assert.throws(() => registry.resolve("instagram"), /PUBLICATION_PROVIDER_UNKNOWN/);
  assert.throws(() => registry.resolve("fake"), /PUBLICATION_PROVIDER_DISABLED/);
  assert.throws(() => registryWith(new DryRunPublicationProvider()).validateCapability({ providerId: "dry_run", channel: "tiktok", contentType: "document", mode: "dry_run", payloadBytes: 1, assetCount: 0 }), /CHANNEL_UNSUPPORTED/);
});

test("Provider Policy: Meta sandbox só passa no canário e produção fica bloqueada por padrão", () => {
  const policy = new PublicationProviderPolicy(
    { environment: "sandbox", productionEnabled: false },
    { enabled: true, providerId: "meta_pages_sandbox", tenantIds: ["tenant-canary"], workspaceIds: ["workspace-canary"] },
  );
  assert.equal(policy.shouldFallbackToDryRun({ tenantId: "tenant-canary", workspaceId: "workspace-canary", providerId: "meta_pages_sandbox" }), false);
  assert.equal(policy.shouldFallbackToDryRun({ tenantId: "tenant-canary", workspaceId: "workspace-other", providerId: "meta_pages_sandbox" }), true);
  assert.equal(policy.shouldFallbackToDryRun({ tenantId: "tenant-other", workspaceId: "workspace-canary", providerId: "meta_pages_sandbox" }), true);
  assert.equal(policy.shouldFallbackToDryRun({ tenantId: "tenant-any", workspaceId: "workspace-any", providerId: "fake" }), false);

  const productionPolicy = new PublicationProviderPolicy(
    { environment: "production", productionEnabled: false },
    { enabled: true, providerId: "meta_pages_sandbox", tenantIds: ["tenant-canary"], workspaceIds: ["workspace-canary"] },
  );
  const decision = productionPolicy.decide({ tenantId: "tenant-canary", workspaceId: "workspace-canary", providerId: "meta_pages_sandbox" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "production_blocked");
});

test("Outbox: PublicationAttempt + Event + PayloadReference + Outbox são criados atomicamente", async () => {
  const shared = deps();
  const created = await createPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", idempotencyKey: "rel-idem-1", sourceArtifacts: [artifact("a1")], channels: ["instagram"] });
  await approvePublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id, approvedByUserId: "user-1", reason: "ok" });
  const detail = await ensurePublicationOutboxIntents(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  assert.equal(detail.attempts.length, 1);
  assert.equal(detail.outbox.length, 1);
  assert.equal(detail.payloadReferences.length, 1);
  assert.ok(detail.events.some((event) => event.eventType === "outbox_created"));
  assert.equal(detail.outbox[0].attemptId, detail.attempts[0].id);
});

test("Dispatch durável: worker faz claim, lease/fencing, provider fake publica, receipt e outbox dispatched", async () => {
  const shared = deps();
  const created = await createPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", idempotencyKey: "rel-idem-2", sourceArtifacts: [artifact("a2")], channels: ["instagram"], policy: { requireApproval: false, approvalPolicy: "optional" } });
  await ensurePublicationOutboxIntents(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  await shared.queue.enqueue({ id: "job-1", publicationId: created.plan.id, tenantId: "tenant-1", workspaceId: "workspace-1", kind: "publish", enqueuedAt: "2026-01-01T00:00:00.000Z" });
  const processed = await new PublicationWorker(shared, "worker-1").runUntilIdle();
  assert.equal(processed, 1);
  const detail = await shared.repository.getDetail(created.plan.id);
  assert.equal(detail.plan.state, "published");
  assert.equal(detail.receipts.length, 1);
  assert.equal(detail.outbox[0].status, "dispatched");
});

test("Dispatch durável: valida capability usando o tipo real da mídia", async () => {
  const provider = new FakePublicationProvider();
  provider.descriptor.supportedContentTypes = ["video"];
  const shared = deps({ providers: [provider] });
  const videoArtifact = {
    artifactId: "video-rel",
    artifactType: "video",
    schemaId: "publication.video",
    schemaVersion: 1,
    checksum: "checksum-video-rel",
    payload: { videoUrl: "https://cdn.zuno.local/video.mp4", caption: "Oferta em video" },
  };
  const created = await createPublication(shared, {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    idempotencyKey: "rel-idem-video-capability",
    sourceArtifacts: [videoArtifact],
    channels: ["instagram"],
    provider: "fake",
    policy: { requireApproval: false, approvalPolicy: "optional", allowedProviders: ["fake"] },
  });
  await ensurePublicationOutboxIntents(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  const result = await new PublicationDispatchService({ repository: shared.repository, providerRegistry: shared.providerRegistry, secretResolver: shared.secretResolver, idGenerator: nextId }).dispatchAvailable("worker-video-capability");

  assert.equal(result.dispatched, 1);
  const detail = await shared.repository.getDetail(created.plan.id);
  assert.equal(detail.plan.state, "published");
  assert.equal(detail.outbox[0].status, "dispatched");
});

test("Fencing: worker antigo perde lease e commit tardio é rejeitado", async () => {
  const shared = deps();
  const created = await createPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", idempotencyKey: "rel-idem-3", sourceArtifacts: [artifact("a3")], channels: ["instagram"], policy: { requireApproval: false, approvalPolicy: "optional" } });
  await ensurePublicationOutboxIntents(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 10).toISOString();
  const [claimA] = await shared.repository.claimOutbox({ workerId: "worker-a", now, leaseMs: 1, limit: 1 });
  const [claimB] = await shared.repository.claimOutbox({ workerId: "worker-b", now: later, leaseMs: 60_000, limit: 1 });
  const staleCommit = await shared.repository.completeOutbox({ outboxMessageId: claimA.outboxMessageId, workerId: "worker-a", fencingToken: claimA.fencingToken, now: later });
  assert.equal(staleCommit.committed, false);
  const result = await new PublicationDispatchService({ repository: shared.repository, providerRegistry: shared.providerRegistry, secretResolver: shared.secretResolver, idGenerator: nextId }).dispatchClaimed(claimB, "worker-b");
  assert.equal(result, "dispatched");
  const detail = await shared.repository.getDetail(created.plan.id);
  assert.equal(detail.receipts.length, 1);
});

test("Unknown outcome: não há retry cego; reconciliação confirma status externo e cria receipt", async () => {
  const provider = new FakePublicationProvider();
  const originalPublish = provider.publish.bind(provider);
  let first = true;
  provider.publish = async (request) => {
    if ("secret" in request && first) {
      first = false;
      await originalPublish(request);
      return { kind: "unknown_outcome", providerRequestId: "provider-request-unknown", safeMessage: "Timeout após envio." };
    }
    return originalPublish(request);
  };
  const shared = deps({ providers: [provider] });
  const created = await createPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", idempotencyKey: "rel-idem-4", sourceArtifacts: [artifact("a4")], channels: ["instagram"], provider: "fake", policy: { requireApproval: false, approvalPolicy: "optional", allowedProviders: ["fake"] } });
  await ensurePublicationOutboxIntents(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  const unknown = await new PublicationDispatchService({ repository: shared.repository, providerRegistry: shared.providerRegistry, secretResolver: shared.secretResolver, idGenerator: nextId }).dispatchAvailable("worker-unknown");
  assert.equal(unknown.unknownOutcomes, 1);
  let detail = await shared.repository.getDetail(created.plan.id);
  assert.equal(detail.plan.state, "unknown_outcome");
  assert.equal(detail.receipts.length, 0);
  assert.equal(detail.reconciliations.length, 1);

  const reconciliation = await new PublicationReconciliationService({ repository: shared.repository, providerRegistry: shared.providerRegistry, secretResolver: shared.secretResolver, idGenerator: nextId }).reconcile({ tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  assert.equal(reconciliation.confirmed, 1);
  detail = await shared.repository.getDetail(created.plan.id);
  assert.equal(detail.plan.state, "published");
  assert.equal(detail.receipts.length, 1);
});

test("Unknown outcome: outbox não é reclamada novamente sem reconciliação", async () => {
  const provider = new FakePublicationProvider({ unknownFirstFor: [] });
  provider.publish = async (request) => {
    if ("secret" in request) return { kind: "unknown_outcome", providerRequestId: "provider-request-no-retry", safeMessage: "Resposta ambígua." };
    throw new Error("legacy path não deve ser usado");
  };
  const shared = deps({ providers: [provider] });
  const created = await createPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", idempotencyKey: "rel-idem-no-blind-retry", sourceArtifacts: [artifact("a-no-blind")], channels: ["instagram"], provider: "fake", policy: { requireApproval: false, approvalPolicy: "optional", allowedProviders: ["fake"] } });
  await ensurePublicationOutboxIntents(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  const unknown = await new PublicationDispatchService({ repository: shared.repository, providerRegistry: shared.providerRegistry, secretResolver: shared.secretResolver, idGenerator: nextId }).dispatchAvailable("worker-unknown-no-retry");
  assert.equal(unknown.unknownOutcomes, 1);

  const claimedAgain = await shared.repository.claimOutbox({ workerId: "worker-blind-retry", now: new Date().toISOString(), leaseMs: 60_000, limit: 1 });
  assert.equal(claimedAgain.length, 0);
});

test("Receipt verification registra verified/mismatch sem mutar receipt", async () => {
  const shared = deps();
  const created = await createPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", idempotencyKey: "rel-idem-5", sourceArtifacts: [artifact("a5")], channels: ["instagram"], policy: { requireApproval: false, approvalPolicy: "optional" } });
  await ensurePublicationOutboxIntents(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  await new PublicationDispatchService({ repository: shared.repository, providerRegistry: shared.providerRegistry, secretResolver: shared.secretResolver, idGenerator: nextId }).dispatchAvailable("worker-verify");
  const verified = await new PublicationReconciliationService({ repository: shared.repository, providerRegistry: shared.providerRegistry, secretResolver: shared.secretResolver, idGenerator: nextId }).verifyReceipts({ tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  assert.equal(verified, 1);
  const detail = await shared.repository.getDetail(created.plan.id);
  assert.equal(detail.receiptVerifications[0].verificationStatus, "verified");
});

test("Recovery após restart: fila vazia é reconstruída da outbox sem duplicar publicação", async () => {
  const shared = deps();
  const created = await createPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", idempotencyKey: "rel-idem-6", sourceArtifacts: [artifact("a6")], channels: ["instagram"], policy: { requireApproval: false, approvalPolicy: "optional" } });
  await ensurePublicationOutboxIntents(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  shared.queue = new InMemoryPublicationQueue();
  const rebuilt = await rebuildPublicationQueueFromOutbox(shared, { tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(rebuilt, 1);
  assert.equal(await shared.queue.size(), 1);
  await new PublicationWorker(shared, "worker-restart").runUntilIdle();
  const detail = await shared.repository.getDetail(created.plan.id);
  assert.equal(detail.receipts.length, 1);
  await new PublicationWorker(shared, "worker-restart-2").runUntilIdle();
  assert.equal((await shared.repository.getDetail(created.plan.id)).receipts.length, 1);
});

test("Dead letter: reprocessamento administrativo reabre outbox explicitamente", async () => {
  const provider = new FakePublicationProvider();
  provider.publish = async (request) => {
    if ("secret" in request) return { kind: "permanent_failure", errorCode: "SYNTHETIC_PERMANENT", safeMessage: "Falha permanente sintética." };
    throw new Error("legacy path não deve ser usado");
  };
  const shared = deps({ providers: [provider] });
  const created = await createPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", idempotencyKey: "rel-idem-dead-reprocess", sourceArtifacts: [artifact("a-dead")], channels: ["instagram"], provider: "fake", policy: { requireApproval: false, approvalPolicy: "optional", allowedProviders: ["fake"] } });
  await ensurePublicationOutboxIntents(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  await new PublicationDispatchService({ repository: shared.repository, providerRegistry: shared.providerRegistry, secretResolver: shared.secretResolver, idGenerator: nextId }).dispatchAvailable("worker-dead");

  const [letter] = await shared.repository.listDeadLetters({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(letter.recoveryStatus, "pending");
  const reprocessed = await shared.repository.reprocessDeadLetter({ id: letter.id, tenantId: "tenant-1", workspaceId: "workspace-1", now: new Date().toISOString() });
  assert.equal(reprocessed.recoveryStatus, "reprocessed");
  const detail = await shared.repository.getDetail(created.plan.id);
  assert.equal(detail.outbox[0].status, "pending");
  assert.equal(detail.outbox[0].lastFailureCode, undefined);
});

test("Observabilidade não expõe secrets e contabiliza outbox/reconciliation/fencing", async () => {
  const shared = deps();
  await shared.repository.createCredentialReference({ credentialReferenceId: "cred-1", tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "fake", status: "active" });
  const references = await shared.repository.listCredentialReferences({ tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "fake" });
  assert.equal(JSON.stringify(references).includes("token"), false);
  const metrics = await collectPublicationMetrics({ repository: shared.repository, queue: shared.queue, tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(typeof metrics.outboxPending, "number");
  assert.equal(typeof metrics.credentialResolutionFailures, "number");
});

test("Meta Pages Sandbox Adapter: publica, captura request id e verifica receipt por status externo", async () => {
  const calls = [];
  const httpClient = async (url, init) => {
    calls.push({ url, init });
    if (String(url).endsWith("/page-1/feed")) {
      return jsonResponse({ id: "page-1_post-1", permalink_url: "https://facebook.test/page-1/posts/post-1" }, 200, { "x-fb-trace-id": "trace-meta-1" });
    }
    if (String(url).includes("/page-1_post-1?")) {
      return jsonResponse({ id: "page-1_post-1", permalink_url: "https://facebook.test/page-1/posts/post-1", created_time: "2026-07-01T00:00:00.000Z", message: "Oferta" }, 200);
    }
    return jsonResponse({ error: { message: "not found" } }, 404);
  };
  const provider = new MetaPagesSandboxProvider({ graphBaseUrl: "https://graph.facebook.test/v20.0" }, httpClient);
  const secret = { credentialReferenceId: "cred-1", providerId: "meta_pages_sandbox", value: { pageAccessToken: "page-token", pageId: "page-1" } };
  const request = {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    publicationId: "publication-1",
    targetId: "target-1",
    attemptId: "attempt-1",
    channel: "facebook",
    content: { artifacts: [artifact("meta-a1")] },
    assets: [],
    idempotencyKey: "meta-idem-1",
    correlationId: "corr-1",
    traceId: "trace-1",
    mode: "real",
    credentialReferenceId: "cred-1",
    secret,
  };

  const published = await provider.publish(request);
  assert.equal(published.kind, "published");
  assert.equal(published.providerPublicationId, "page-1_post-1");
  assert.equal(published.providerRequestId, "trace-meta-1");

  const verified = await provider.verifyReceipt({
    id: "receipt-1",
    publicationId: "publication-1",
    targetId: "target-1",
    provider: "meta_pages_sandbox",
    providerPublicationId: "page-1_post-1",
    channel: "facebook",
    publishedAt: "2026-07-01T00:00:00.000Z",
    status: "published",
    url: "https://facebook.test/page-1/posts/post-1",
    checksum: "checksum",
    correlationId: "corr-1",
    traceId: "trace-1",
    idempotencyKey: "meta-idem-1",
    createdAt: "2026-07-01T00:00:00.000Z",
  }, secret);
  assert.equal(verified.verificationStatus, "verified");
  assert.equal(verified.externalStatus, "published");
});

test("Meta Pages Sandbox Adapter: rate limit mapeia falha retentável e retryAfter", async () => {
  const provider = new MetaPagesSandboxProvider(
    { graphBaseUrl: "https://graph.facebook.test/v20.0" },
    async () => jsonResponse({ error: { message: "rate limited", code: 4 } }, 429, { "retry-after": "30", "x-ratelimit-remaining": "0" }),
  );
  const result = await provider.publish({
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    publicationId: "publication-1",
    targetId: "target-1",
    attemptId: "attempt-1",
    channel: "facebook",
    content: { artifacts: [artifact("meta-a2")] },
    assets: [],
    idempotencyKey: "meta-idem-2",
    correlationId: "corr-1",
    traceId: "trace-1",
    mode: "real",
    credentialReferenceId: "cred-1",
    secret: { credentialReferenceId: "cred-1", providerId: "meta_pages_sandbox", value: { pageAccessToken: "page-token", pageId: "page-1" } },
  });
  assert.equal(result.kind, "rate_limited");
  assert.ok(result.retryAfter);
  assert.equal((await provider.health()).ok, true);
});

test("Meta Pages OAuth: callback salva token só no secret store e credential reference só com metadados", async () => {
  const repository = new InMemoryPublicationRepository();
  const secretStore = new LocalPublicationSecretStore();
  const httpClient = async (url) => {
    const href = String(url);
    if (href.includes("/oauth/access_token") && href.includes("code=oauth-code")) {
      return jsonResponse({ access_token: "short-token", expires_in: 3600 }, 200);
    }
    if (href.includes("/oauth/access_token") && href.includes("fb_exchange_token=short-token")) {
      return jsonResponse({ access_token: "long-token", expires_in: 7200 }, 200);
    }
    if (href.includes("/me/accounts")) {
      return jsonResponse({ data: [{ id: "page-1", name: "Sandbox Page", access_token: "page-token" }] }, 200);
    }
    return jsonResponse({ error: { message: "unexpected" } }, 400);
  };
  const service = new MetaPagesOAuthService({
    config: {
      enabled: true,
      appId: "app-1",
      appSecret: "secret-1",
      redirectUri: "https://zuno.test/oauth/callback",
      graphBaseUrl: "https://graph.facebook.test/v20.0",
      scopes: ["pages_manage_posts", "pages_read_engagement"],
    },
    repository,
    secretStore,
    httpClient,
  });

  const begin = service.begin({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.ok(begin.authorizationUrl.includes("state="));
  const completed = await service.complete({ state: begin.state, code: "oauth-code" });
  assert.equal(completed.providerSubjectId, "page-1");

  const references = await repository.listCredentialReferences({ tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "meta_pages_sandbox" });
  assert.equal(references.length, 1);
  assert.equal(references[0].environment, "sandbox");
  assert.equal(references[0].providerSubjectId, "page-1");
  assert.equal(JSON.stringify(references).includes("page-token"), false);
  assert.equal(JSON.stringify(references).includes("long-token"), false);

  const resolved = await new StoredPublicationSecretResolver(secretStore).resolve({
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    providerId: "meta_pages_sandbox",
    credentialReferenceId: references[0].credentialReferenceId,
  });
  assert.equal(resolved.value.pageAccessToken, "page-token");
  assert.equal(resolved.value.pageId, "page-1");
});

test("Credential Governance: OAuth registra domínio independente, health e auditoria sem persistir secrets", async () => {
  const repository = new InMemoryPublicationRepository();
  const credentialRepository = new InMemoryCredentialRepository();
  const auditRepository = new InMemoryOperationalAuditRepository();
  const secretStore = new LocalPublicationSecretStore();
  await secretStore.put({
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    providerId: "meta_pages_sandbox",
    credentialReferenceId: "cred-ref-1",
    value: { accessToken: "long-token", pageAccessToken: "page-token", pageId: "page-1" },
    expiresAt: "2030-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const service = new CredentialGovernanceService({
    credentialRepository,
    auditRepository,
    publicationRepository: repository,
    secretStore,
    idGenerator: nextId,
    requiredScopes: ["pages_manage_posts", "pages_read_engagement"],
  });

  const detail = await service.registerOAuthCredential({
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    providerId: "meta_pages_sandbox",
    environment: "sandbox",
    credentialReferenceId: "cred-ref-1",
    providerSubjectId: "page-1",
    grantedScopes: ["pages_manage_posts", "pages_read_engagement"],
    expiresAt: "2030-01-01T00:00:00.000Z",
    actor: { tenantId: "tenant-1", userId: "owner-1", role: "owner" },
    context: { requestId: "request-1" },
  });

  assert.equal(detail.credential.status, "connected");
  assert.equal(detail.bindings[0].canary, true);
  assert.equal(detail.health.tokenValid, true);
  assert.equal(JSON.stringify(detail).includes("page-token"), false);
  assert.equal(JSON.stringify(detail).includes("long-token"), false);
  assert.equal((await auditRepository.list({ tenantId: "tenant-1", workspaceId: "workspace-1" })).some((event) => event.eventType === "credential.oauth.connected"), true);
  assert.equal((await repository.listCredentialReferences({ tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "meta_pages_sandbox" }))[0].status, "active");
});

test("Credential Governance: rotação preserva histórico, revoga reference antiga e exporta audit append-only", async () => {
  const repository = new InMemoryPublicationRepository();
  const credentialRepository = new InMemoryCredentialRepository();
  const auditRepository = new InMemoryOperationalAuditRepository();
  const secretStore = new LocalPublicationSecretStore();
  const service = new CredentialGovernanceService({
    credentialRepository,
    auditRepository,
    publicationRepository: repository,
    secretStore,
    idGenerator: nextId,
    requiredScopes: ["pages_manage_posts"],
  });
  await secretStore.put({
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    providerId: "meta_pages_sandbox",
    credentialReferenceId: "cred-ref-rotate-old",
    value: { accessToken: "long-token", pageAccessToken: "page-token", pageId: "page-1" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  await service.registerOAuthCredential({
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    providerId: "meta_pages_sandbox",
    environment: "sandbox",
    credentialReferenceId: "cred-ref-rotate-old",
    providerSubjectId: "page-1",
    grantedScopes: ["pages_manage_posts"],
  });

  const rotated = await service.rotate({
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    credentialId: "credential:tenant-1:workspace-1:meta_pages_sandbox",
    actor: { tenantId: "tenant-1", userId: "admin-1", role: "admin" },
    reason: "scheduled policy",
  });
  assert.equal(rotated.references.length, 2);
  assert.equal(rotated.references.find((reference) => reference.id === "cred-ref-rotate-old").status, "revoked");
  assert.notEqual(rotated.credential.activeReferenceId, "cred-ref-rotate-old");
  assert.equal(rotated.rotations[0].status, "completed");

  const newSecret = await secretStore.get({ tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "meta_pages_sandbox", credentialReferenceId: rotated.credential.activeReferenceId });
  assert.equal(newSecret.value.pageAccessToken, "page-token");
  assert.ok(newSecret.value.rotatedAt);
  assert.equal(await secretStore.get({ tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "meta_pages_sandbox", credentialReferenceId: "cred-ref-rotate-old" }) !== undefined, true);

  const auditJson = await auditRepository.export({ tenantId: "tenant-1", workspaceId: "workspace-1", format: "json" });
  assert.equal(auditJson.contentType, "application/json");
  assert.equal(auditJson.body.includes("credential.rotate"), true);
  assert.equal(auditJson.body.includes("page-token"), false);
  const auditCsv = await auditRepository.export({ tenantId: "tenant-1", workspaceId: "workspace-1", format: "csv" });
  assert.equal(auditCsv.contentType, "text/csv");
  assert.equal(auditCsv.body.split("\n")[0], "id,createdAt,tenantId,workspaceId,eventType,actorUserId,resourceType,resourceId,resultStatus,resultCode");
});

test("Credential Governance: escopos ausentes, revogação e compliance report apontam estado operacional", async () => {
  const repository = new InMemoryPublicationRepository();
  const credentialRepository = new InMemoryCredentialRepository();
  const auditRepository = new InMemoryOperationalAuditRepository();
  const secretStore = new LocalPublicationSecretStore();
  const service = new CredentialGovernanceService({
    credentialRepository,
    auditRepository,
    publicationRepository: repository,
    secretStore,
    idGenerator: nextId,
    requiredScopes: ["pages_manage_posts", "pages_read_engagement"],
  });
  await service.registerOAuthCredential({
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    providerId: "meta_pages_sandbox",
    environment: "sandbox",
    credentialReferenceId: "cred-ref-invalid",
    providerSubjectId: "page-1",
    grantedScopes: ["pages_manage_posts"],
    actor: { tenantId: "tenant-1", userId: "admin-1", role: "admin" },
  });
  let detail = await service.get({ tenantId: "tenant-1", workspaceId: "workspace-1", credentialId: "credential:tenant-1:workspace-1:meta_pages_sandbox" });
  assert.equal(detail.credential.status, "invalid");
  assert.deepEqual(detail.credential.missingScopes, ["pages_read_engagement"]);

  detail = await service.revoke({
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    credentialId: detail.credential.id,
    actor: { tenantId: "tenant-1", userId: "admin-1", role: "admin" },
    reason: "incident",
  });
  assert.equal(detail.credential.status, "revoked");
  assert.equal(detail.references[0].status, "revoked");

  const compliance = await new ComplianceService({ credentialRepository, auditRepository, publicationRepository: repository }).report({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(compliance.overallStatus, "pass");
  assert.equal(compliance.checks.some((check) => check.id === "tokens-not-persisted" && check.status === "pass"), true);
});

test("Publication Governance Policy: provider real exige canário, credencial ativa, binding e health válidos", () => {
  const policy = new PublicationGovernancePolicy(
    { environment: "sandbox", productionEnabled: false },
    { enabled: true, providerId: "meta_pages_sandbox", tenantIds: ["tenant-1"], workspaceIds: ["workspace-1"] },
  );
  const base = {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    providerId: "meta_pages_sandbox",
    role: "owner",
    permission: "publication:publish",
    approvalPresent: true,
    approvalRequired: true,
  };
  assert.equal(policy.decide(base).reason, "credential_missing");
  assert.equal(policy.decide({
    ...base,
    credential: { id: "cred", tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "meta_pages_sandbox", environment: "sandbox", status: "connected", requiredScopes: ["pages_manage_posts"], grantedScopes: ["pages_manage_posts"], missingScopes: [], createdAt: "now", updatedAt: "now" },
    binding: { id: "binding", credentialId: "cred", tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "meta_pages_sandbox", environment: "sandbox", canary: true, status: "active", createdAt: "now", updatedAt: "now" },
    health: { credentialId: "cred", tenantId: "tenant-1", workspaceId: "workspace-1", providerId: "meta_pages_sandbox", status: "connected", connected: true, tokenValid: true, expiring: false, expired: false, grantedScopes: ["pages_manage_posts"], requiredScopes: ["pages_manage_posts"], missingScopes: [], checkedAt: "now", safeMessage: "ok" },
  }).allowed, true);

  const productionPolicy = new PublicationGovernancePolicy(
    { environment: "production", productionEnabled: false },
    { enabled: true, providerId: "meta_pages_sandbox", tenantIds: ["tenant-1"], workspaceIds: ["workspace-1"] },
  );
  assert.equal(productionPolicy.decide({ ...base, providerId: "meta_pages_sandbox" }).reason, "production_blocked");
});

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
