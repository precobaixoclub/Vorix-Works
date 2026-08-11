import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { OperationalCircuitBreaker } from "../operations/operational-services.js";
import type { PublicationEngineDeps } from "./publication-engine.js";
import { PublicationDispatchService } from "./publication-dispatch-service.js";
import { createDefaultPublicationProviderRegistry, type PublicationProviderRegistry } from "./publication-provider-registry.js";
import { ensurePublicationOutboxIntents } from "./publication-outbox-intent.js";
import type { PublicationQueuePort } from "./publication-queue.js";
import { InMemoryPublicationSecretResolver, type PublicationSecretResolverPort } from "./publication-secret-resolver.js";
import { isRetryablePublicationFailure } from "./publication-utils.js";
import type { PublicationDeadLetter, PublicationDetail, PublicationFailure } from "../../domain/publication/publication.model.js";

export type PublicationConcurrencyPolicy = {
  maxWorkers: number;
  maxConcurrentPublications: number;
  maxPerProvider: number;
  maxPerTenant: number;
  lockTtlMs: number;
};

export type PublicationOrchestratorDeps = PublicationEngineDeps & {
  repository: PublicationRepositoryPort;
  queue: PublicationQueuePort;
  concurrency: PublicationConcurrencyPolicy;
  providerRegistry?: PublicationProviderRegistry;
  secretResolver?: PublicationSecretResolverPort;
  providerCircuitBreaker?: OperationalCircuitBreaker;
  workerId?: string;
};

export async function schedulePublication(deps: PublicationOrchestratorDeps, input: { tenantId: string; workspaceId: string; publicationId: string; scheduledAt: string; timezone: string }): Promise<PublicationDetail> {
  const detail = await requireOwnedDetail(deps, input);
  const schedule = await deps.repository.createSchedule({ id: deps.idGenerator(), publicationId: input.publicationId, tenantId: input.tenantId, workspaceId: input.workspaceId, scheduledAt: input.scheduledAt, timezone: input.timezone, status: "scheduled" });
  await deps.repository.appendEvent({ id: deps.idGenerator(), publicationId: input.publicationId, eventType: "publication_scheduled", correlationId: detail.plan.correlationId, traceId: detail.plan.traceId, payload: { scheduledAt: schedule.scheduledAt, timezone: schedule.timezone } });
  return requireOwnedDetail(deps, input);
}

export async function enqueuePublication(deps: PublicationOrchestratorDeps, input: { tenantId: string; workspaceId: string; publicationId: string; kind?: "publish" | "retry" | "scheduled"; runAfter?: string }): Promise<void> {
  const detail = await requireOwnedDetail(deps, input);
  if (detail.plan.state !== "cancelled" && detail.plan.state !== "published") {
    await ensurePublicationOutboxIntents(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, publicationId: input.publicationId });
  }
  await deps.queue.enqueue({ id: `${input.publicationId}:${input.kind ?? "publish"}:${input.runAfter ?? "now"}`, publicationId: input.publicationId, tenantId: input.tenantId, workspaceId: input.workspaceId, kind: input.kind ?? "publish", runAfter: input.runAfter, enqueuedAt: new Date().toISOString() });
  await deps.repository.appendEvent({ id: deps.idGenerator(), publicationId: input.publicationId, eventType: "publication_enqueued", correlationId: detail.plan.correlationId, traceId: detail.plan.traceId, payload: { kind: input.kind ?? "publish" } });
}

export async function runDueSchedules(deps: PublicationOrchestratorDeps, now = new Date().toISOString()): Promise<number> {
  await deps.repository.releaseExpiredOutbox(now);
  const due = await deps.repository.listDueSchedules({ now, limit: deps.concurrency.maxConcurrentPublications });
  let enqueued = 0;
  for (const schedule of due) {
    const detail = await deps.repository.getDetail(schedule.publicationId);
    if (!detail) {
      await deps.repository.updateScheduleStatus({ id: schedule.id, status: "failed" });
      continue;
    }
    if (detail.plan.state === "cancelled") {
      await deps.repository.updateScheduleStatus({ id: schedule.id, status: "cancelled" });
      continue;
    }
    if (detail.plan.state === "published") {
      await deps.repository.updateScheduleStatus({ id: schedule.id, status: "completed" });
      continue;
    }
    try {
      await deps.repository.updateScheduleStatus({ id: schedule.id, status: "running" });
      await enqueuePublication(deps, { tenantId: schedule.tenantId, workspaceId: schedule.workspaceId, publicationId: schedule.publicationId, kind: "scheduled" });
      enqueued += 1;
    } catch (error) {
      const failure = failureFromScheduleError(error);
      await deps.repository.appendFailure({ publicationId: schedule.publicationId, failure });
      for (const target of detail.targets.filter((item) => item.status !== "published" && item.status !== "cancelled")) {
        await deps.repository.updateTargetStatus({ id: target.id, status: "failed" });
      }
      await deps.repository.updatePlanState({ id: schedule.publicationId, state: "failed" });
      await deps.repository.updateScheduleStatus({ id: schedule.id, status: "failed" });
      await deps.repository.appendEvent({
        id: deps.idGenerator(),
        publicationId: schedule.publicationId,
        eventType: "publication_failed",
        correlationId: detail.plan.correlationId,
        traceId: detail.plan.traceId,
        payload: { scheduleId: schedule.id, failure },
      });
    }
  }
  return enqueued;
}

export async function rebuildPublicationQueueFromOutbox(deps: PublicationOrchestratorDeps, filter: { tenantId: string; workspaceId: string }, now = new Date().toISOString()): Promise<number> {
  await deps.repository.releaseExpiredOutbox(now);
  const messages = (await deps.repository.listOutbox({ tenantId: filter.tenantId, workspaceId: filter.workspaceId }))
    .filter((message) => (message.status === "pending" || message.status === "failed") && message.lastFailureCode !== "UNKNOWN_OUTCOME" && message.availableAt <= now);
  const publicationIds = new Set(messages.map((message) => message.publicationId));
  for (const publicationId of publicationIds) {
    await deps.queue.enqueue({ id: `${publicationId}:outbox-recovery:${now}`, publicationId, tenantId: filter.tenantId, workspaceId: filter.workspaceId, kind: "retry", enqueuedAt: now });
  }
  return publicationIds.size;
}

export async function executeQueuedPublication(deps: PublicationOrchestratorDeps, workerId = deps.workerId ?? "publication-worker"): Promise<PublicationDetail | undefined> {
  const job = await deps.queue.dequeue();
  if (!job) return undefined;
  const lockOwner = `${workerId}:${job.id}`;
  const current = await deps.repository.getDetail(job.publicationId);
  if (current && (current.plan.state === "cancelled" || current.plan.state === "published")) return current;
  const acquired = await deps.repository.acquireLock({ publicationId: job.publicationId, ownerId: lockOwner, acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + deps.concurrency.lockTtlMs).toISOString() });
  const detail = await deps.repository.getDetail(job.publicationId);
  if (!acquired) {
    if (detail) await deps.repository.appendEvent({ id: deps.idGenerator(), publicationId: job.publicationId, eventType: "lock_contended", correlationId: detail.plan.correlationId, traceId: detail.plan.traceId, payload: { workerId } });
    return detail;
  }
  try {
    if (detail) await deps.repository.appendEvent({ id: deps.idGenerator(), publicationId: job.publicationId, eventType: "worker_started", correlationId: detail.plan.correlationId, traceId: detail.plan.traceId, payload: { workerId, kind: job.kind } });
    const providerRegistry = deps.providerRegistry ?? createDefaultPublicationProviderRegistry(deps.providers as never);
    const secretResolver = deps.secretResolver ?? new InMemoryPublicationSecretResolver();
    await new PublicationDispatchService({ repository: deps.repository, providerRegistry, secretResolver, providerCircuitBreaker: deps.providerCircuitBreaker, idGenerator: deps.idGenerator }).dispatchAvailable(workerId);
    const result = await deps.repository.getDetail(job.publicationId);
    if (result) {
      await finalizeRunningSchedules(deps, result);
      await deps.repository.appendEvent({ id: deps.idGenerator(), publicationId: job.publicationId, eventType: "worker_completed", correlationId: result.plan.correlationId, traceId: result.plan.traceId, payload: { workerId } });
    }
    return result;
  } finally {
    await deps.repository.releaseLock(job.publicationId, lockOwner);
  }
}

export class PublicationWorker {
  private shuttingDown = false;

  constructor(private readonly deps: PublicationOrchestratorDeps, private readonly workerId: string) {}

  shutdown(): void {
    this.shuttingDown = true;
  }

  async runOnce(): Promise<PublicationDetail | undefined> {
    if (this.shuttingDown) return undefined;
    return executeQueuedPublication(this.deps, this.workerId);
  }

  async runUntilIdle(maxJobs = 100): Promise<number> {
    let count = 0;
    while (!this.shuttingDown && count < maxJobs) {
      const result = await this.runOnce();
      if (!result) break;
      count += 1;
    }
    return count;
  }
}

export class PublicationRecoveryService {
  constructor(private readonly deps: PublicationOrchestratorDeps) {}

  async recover(filter: { tenantId: string; workspaceId: string }): Promise<number> {
    const plans = await this.deps.repository.listPlans(filter);
    let recovered = 0;
    for (const plan of plans.filter((candidate) => candidate.state === "publishing" || candidate.state === "failed")) {
      const detail = await this.deps.repository.getDetail(plan.id);
      const lastFailure = detail?.failures.at(-1);
      const attempts = detail?.attempts.length ?? 0;
      if (lastFailure && (!isRetryablePublicationFailure(lastFailure.category) || attempts > plan.policy.maxRetries + 1)) {
        await this.createDeadLetter(plan.id, "Limite de retry excedido ou falha não retentável.", lastFailure, attempts);
        continue;
      }
      await enqueuePublication(this.deps, { tenantId: plan.tenantId, workspaceId: plan.workspaceId, publicationId: plan.id, kind: "retry" });
      await this.deps.repository.appendEvent({ id: this.deps.idGenerator(), publicationId: plan.id, eventType: "recovery_enqueued", correlationId: plan.correlationId, traceId: plan.traceId });
      recovered += 1;
    }
    return recovered;
  }

  private async createDeadLetter(publicationId: string, reason: string, lastError: PublicationDeadLetter["lastError"], attempts: number): Promise<void> {
    const detail = await this.deps.repository.getDetail(publicationId);
    if (!detail) return;
    const letter = await this.deps.repository.createDeadLetter({ id: this.deps.idGenerator(), publicationId, tenantId: detail.plan.tenantId, workspaceId: detail.plan.workspaceId, reason, lastError, attempts });
    await this.deps.repository.appendEvent({ id: this.deps.idGenerator(), publicationId, eventType: "dead_letter_created", correlationId: detail.plan.correlationId, traceId: detail.plan.traceId, payload: { deadLetterId: letter.id, reason } });
  }
}

async function requireOwnedDetail(deps: PublicationOrchestratorDeps, input: { tenantId: string; workspaceId: string; publicationId: string }): Promise<PublicationDetail> {
  const detail = await deps.repository.getDetail(input.publicationId);
  if (!detail || detail.plan.tenantId !== input.tenantId || detail.plan.workspaceId !== input.workspaceId) throw new Error("PUBLICATION_NOT_FOUND: publicação não pertence ao tenant/workspace informado.");
  return detail;
}

async function finalizeRunningSchedules(deps: PublicationOrchestratorDeps, detail: PublicationDetail): Promise<void> {
  const status = detail.plan.state === "published"
    ? "completed"
    : detail.plan.state === "failed"
      ? "failed"
      : detail.plan.state === "cancelled"
        ? "cancelled"
        : undefined;
  if (!status) return;
  for (const schedule of detail.schedules.filter((item) => item.status === "running")) {
    await deps.repository.updateScheduleStatus({ id: schedule.id, status });
  }
}

function failureFromScheduleError(error: unknown): PublicationFailure {
  const message = error instanceof Error ? error.message : String(error);
  const rawCode = message.includes(":") ? message.slice(0, message.indexOf(":")).trim() : "";
  const code = /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : "SCHEDULE_ENQUEUE_FAILED";
  const upper = `${code} ${message}`.toUpperCase();
  const category = upper.includes("CREDENTIAL") || upper.includes("TOKEN") || upper.includes("AUTH") || upper.includes("OAUTH")
    ? "authentication"
    : upper.includes("CONTENT") || upper.includes("PAYLOAD") || upper.includes("MEDIA")
      ? "invalid_content"
      : "internal";
  return { code, message: message.slice(0, 500), category, retryable: false };
}
