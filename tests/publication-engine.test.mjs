import test from "node:test";
import assert from "node:assert/strict";

import { createPublication, approvePublication, publishPublication, cancelPublication } from "../dist/application/publication/publication-engine.js";
import { InMemoryPublicationQueue } from "../dist/application/publication/publication-queue.js";
import { enqueuePublication, executeQueuedPublication, PublicationRecoveryService, PublicationWorker, runDueSchedules, schedulePublication } from "../dist/application/publication/publication-orchestrator.js";
import { collectPublicationMetrics } from "../dist/application/publication/publication-observability.js";
import { DryRunPublicationProvider } from "../dist/application/publication/fake-publication-providers.js";
import { InMemoryPublicationRepository } from "../dist/infrastructure/storage/in-memory-publication-repository.js";

let counter = 0;
const nextId = () => `pub-test-${++counter}`;

function artifact(id = "artifact-1") {
  return { artifactId: id, artifactType: "document", schemaId: "publication.manifest", schemaVersion: 1, checksum: `checksum-${id}`, payload: { caption: "Olá", cta: "Comprar" } };
}

function deps(extra = {}) {
  const repository = new InMemoryPublicationRepository();
  const queue = new InMemoryPublicationQueue();
  return {
    repository,
    queue,
    providers: [new DryRunPublicationProvider(), ...(extra.providers ?? [])],
    idGenerator: nextId,
    concurrency: { maxWorkers: 2, maxConcurrentPublications: 4, maxPerProvider: 1, maxPerTenant: 1, lockTtlMs: 60_000 },
  };
}

test("Publication: cria, aprova, publica dry_run e preserva idempotência de receipt", async () => {
  const shared = deps();
  const created = await createPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", idempotencyKey: "idem-1", sourceExecutionRunId: "run-1", sourceArtifacts: [artifact()], channels: ["instagram"] });
  assert.equal(created.plan.state, "waiting_for_approval");
  assert.equal(created.plan.mode, "dry_run");

  const same = await createPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", idempotencyKey: "idem-1", sourceArtifacts: [artifact()], channels: ["instagram"] });
  assert.equal(same.plan.id, created.plan.id);

  const approved = await approvePublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id, approvedByUserId: "user-1", reason: "ok" });
  assert.equal(approved.plan.state, "approved");

  const published = await publishPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  assert.equal(published.plan.state, "published");
  assert.equal(published.receipts.length, 1);
  assert.equal(published.receipts[0].status, "dry_run");

  const republished = await publishPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  assert.equal(republished.receipts.length, 1);
});

test("Publication Orchestrator: agenda, enfileira, worker executa e lock impede duplicidade", async () => {
  const shared = deps();
  const created = await createPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", idempotencyKey: "idem-2", sourceArtifacts: [artifact("artifact-2")], channels: ["instagram"], policy: { requireApproval: false, approvalPolicy: "optional" } });
  await schedulePublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id, scheduledAt: "2026-01-01T00:00:00.000Z", timezone: "America/Sao_Paulo" });
  assert.equal(await runDueSchedules(shared, "2026-01-01T00:00:01.000Z"), 1);
  assert.equal(await shared.queue.size(), 1);

  assert.equal(await shared.repository.acquireLock({ publicationId: "manual-lock", ownerId: "worker-1", acquiredAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:01:00.000Z" }), true);
  assert.equal(await shared.repository.acquireLock({ publicationId: "manual-lock", ownerId: "worker-2", acquiredAt: "2026-01-01T00:00:01.000Z", expiresAt: "2026-01-01T00:01:00.000Z" }), false);

  const worker = new PublicationWorker(shared, "worker-1");
  assert.equal(await worker.runUntilIdle(), 1);
  const detail = await shared.repository.getDetail(created.plan.id);
  assert.equal(detail.plan.state, "published");
  assert.equal(detail.receipts.length, 1);
});

test("Publication Orchestrator: falha de credencial em uma agenda não bloqueia as demais", async () => {
  const shared = deps();
  const missingCredential = await createPublication(shared, {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    idempotencyKey: "idem-missing-credential",
    sourceArtifacts: [artifact("artifact-missing-credential")],
    channels: ["instagram"],
    mode: "real",
    provider: "instagram",
    policy: { requireApproval: false, approvalPolicy: "optional", allowedChannels: ["instagram"], allowedProviders: ["instagram"] },
  });
  const validDryRun = await createPublication(shared, {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    idempotencyKey: "idem-valid-dry-run",
    sourceArtifacts: [artifact("artifact-valid-dry-run")],
    channels: ["instagram"],
    policy: { requireApproval: false, approvalPolicy: "optional" },
  });
  await schedulePublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: missingCredential.plan.id, scheduledAt: "2026-01-01T00:00:00.000Z", timezone: "America/Sao_Paulo" });
  await schedulePublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: validDryRun.plan.id, scheduledAt: "2026-01-01T00:00:00.000Z", timezone: "America/Sao_Paulo" });

  assert.equal(await runDueSchedules(shared, "2026-01-01T00:00:01.000Z"), 1);
  assert.equal(await shared.queue.size(), 1);

  const failed = await shared.repository.getDetail(missingCredential.plan.id);
  const enqueued = await shared.repository.getDetail(validDryRun.plan.id);
  assert.equal(failed.plan.state, "failed");
  assert.equal(failed.schedules[0].status, "failed");
  assert.equal(enqueued.schedules[0].status, "running");
});

test("Publication: retry automático para falha transitória e recovery/dead letter para falha não retentável", async () => {
  let transientCalls = 0;
  const transientProvider = {
    id: "fake",
    supports: () => true,
    publish: async (request) => {
      transientCalls += 1;
      if (transientCalls === 1) return { ok: false, failure: { code: "TIMEOUT", message: "timeout", category: "timeout", retryable: true } };
      return { ok: true, receipt: { publicationId: request.publicationId, targetId: request.targetId, attemptId: request.attemptId, tenantId: request.tenantId, workspaceId: request.workspaceId, provider: "fake", providerPublicationId: "fake-1", channel: request.channel, publishedAt: "2026-01-01T00:00:00.000Z", status: "fake", url: "https://synthetic.zuno.local/fake", checksum: "checksum", correlationId: request.correlationId, traceId: request.traceId, idempotencyKey: request.idempotencyKey } };
    },
  };
  const shared = deps({ providers: [transientProvider] });
  const created = await createPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", idempotencyKey: "idem-3", sourceArtifacts: [artifact("artifact-3")], channels: ["instagram"], provider: "fake", policy: { requireApproval: false, approvalPolicy: "optional", allowedProviders: ["fake"], maxRetries: 1 } });
  const published = await publishPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  assert.equal(published.plan.state, "published");
  assert.equal(transientCalls, 2);
  assert.ok(published.events.some((event) => event.eventType === "retry"));

  const fatalProvider = { id: "fake", supports: () => true, publish: async () => ({ ok: false, failure: { code: "INVALID", message: "invalid", category: "invalid_content", retryable: false } }) };
  const failedShared = deps({ providers: [fatalProvider] });
  const failedCreated = await createPublication(failedShared, { tenantId: "tenant-1", workspaceId: "workspace-1", idempotencyKey: "idem-4", sourceArtifacts: [artifact("artifact-4")], channels: ["instagram"], provider: "fake", policy: { requireApproval: false, approvalPolicy: "optional", allowedProviders: ["fake"], maxRetries: 1 } });
  const failed = await publishPublication(failedShared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: failedCreated.plan.id });
  assert.equal(failed.plan.state, "failed");
  const recovered = await new PublicationRecoveryService(failedShared).recover({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(recovered, 0);
  const deadLetters = await failedShared.repository.listDeadLetters({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(deadLetters.length, 1);
});

test("Publication: cancelamento antes do provider não cria receipt e métricas são separadas", async () => {
  const shared = deps();
  const created = await createPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", idempotencyKey: "idem-5", sourceArtifacts: [artifact("artifact-5")], channels: ["instagram"] });
  const cancelled = await cancelPublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id });
  assert.equal(cancelled.plan.state, "cancelled");
  assert.equal(cancelled.receipts.length, 0);
  await enqueuePublication(shared, { tenantId: "tenant-1", workspaceId: "workspace-1", publicationId: created.plan.id, kind: "retry" });
  await executeQueuedPublication(shared, "worker-cancelled");
  const metrics = await collectPublicationMetrics({ repository: shared.repository, queue: shared.queue, tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(metrics.queueSize, 0);
  assert.equal(metrics.publicationThroughput, 0);
});
