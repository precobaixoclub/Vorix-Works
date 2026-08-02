import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { PublicationQueuePort } from "./publication-queue.js";
import type { PublicationProviderPort } from "./publication-provider.port.js";

export type PublicationMetrics = {
  queueSize: number;
  queueLatencyMs: number;
  workerUtilization: number;
  publicationThroughput: number;
  deadLetters: number;
  recoveries: number;
  schedulerDelayMs: number;
  lockContention: number;
  outboxPending: number;
  outboxClaimed: number;
  outboxAgeMs: number;
  dispatchSuccess: number;
  dispatchFailure: number;
  unknownOutcomes: number;
  reconciliationPending: number;
  reconciliationSuccess: number;
  receiptMismatch: number;
  leaseExpired: number;
  fencingRejected: number;
  credentialResolutionFailures: number;
};

export async function collectPublicationMetrics(input: { repository: PublicationRepositoryPort; queue: PublicationQueuePort; tenantId: string; workspaceId: string; now?: () => Date }): Promise<PublicationMetrics> {
  const now = input.now?.() ?? new Date();
  const jobs = await input.queue.list();
  const plans = await input.repository.listPlans({ tenantId: input.tenantId, workspaceId: input.workspaceId });
  const deadLetters = await input.repository.listDeadLetters({ tenantId: input.tenantId, workspaceId: input.workspaceId });
  const details = await Promise.all(plans.map((plan) => input.repository.getDetail(plan.id)));
  const outbox = await input.repository.listOutbox({ tenantId: input.tenantId, workspaceId: input.workspaceId });
  const events = details.flatMap((detail) => detail?.events ?? []);
  const reconciliations = await input.repository.listReconciliations({ tenantId: input.tenantId, workspaceId: input.workspaceId });
  const verifications = await input.repository.listReceiptVerifications({ tenantId: input.tenantId, workspaceId: input.workspaceId });
  const queueLatencyMs = jobs.length === 0 ? 0 : Math.max(...jobs.map((job) => now.getTime() - new Date(job.enqueuedAt).getTime()));
  return {
    queueSize: jobs.length,
    queueLatencyMs,
    workerUtilization: jobs.length > 0 ? 1 : 0,
    publicationThroughput: plans.filter((plan) => plan.state === "published").length,
    deadLetters: deadLetters.length,
    recoveries: events.filter((event) => event.eventType === "recovery_enqueued").length,
    schedulerDelayMs: Math.max(0, ...details.flatMap((detail) => detail?.schedules ?? []).filter((schedule) => schedule.status === "scheduled" && schedule.scheduledAt < now.toISOString()).map((schedule) => now.getTime() - new Date(schedule.scheduledAt).getTime()), 0),
    lockContention: events.filter((event) => event.eventType === "lock_contended").length,
    outboxPending: outbox.filter((message) => message.status === "pending").length,
    outboxClaimed: outbox.filter((message) => message.status === "claimed").length,
    outboxAgeMs: outbox.length === 0 ? 0 : Math.max(...outbox.map((message) => now.getTime() - new Date(message.createdAt).getTime())),
    dispatchSuccess: outbox.filter((message) => message.status === "dispatched").length,
    dispatchFailure: outbox.filter((message) => message.status === "failed" || message.status === "dead_lettered").length,
    unknownOutcomes: events.filter((event) => event.eventType === "unknown_outcome").length,
    reconciliationPending: reconciliations.filter((item) => item.status === "pending").length,
    reconciliationSuccess: reconciliations.filter((item) => item.status === "confirmed_published").length,
    receiptMismatch: verifications.filter((item) => item.verificationStatus === "mismatch").length,
    leaseExpired: outbox.filter((message) => message.status === "claimed" && !!message.leaseExpiresAt && message.leaseExpiresAt <= now.toISOString()).length,
    fencingRejected: events.filter((event) => event.eventType === "fencing_rejected").length,
    credentialResolutionFailures: details.flatMap((detail) => detail?.failures ?? []).filter((failure) => failure.code === "CREDENTIAL_RESOLUTION_FAILED").length,
  };
}

export async function collectPublicationHealth(input: { repository: PublicationRepositoryPort; queue: PublicationQueuePort; providers: readonly PublicationProviderPort[]; providerHealth?: readonly { providerId: string; ok: boolean; safeMessage?: string }[]; secretResolverOk?: boolean }): Promise<Record<string, unknown>> {
  return {
    database: { ready: true },
    outbox: { ready: true, pending: (await input.repository.listOutbox({ status: "pending" })).length },
    scheduler: { ready: true },
    queue: { ready: true, size: await input.queue.size() },
    workers: { ready: true },
    publicationProviders: input.providerHealth ?? input.providers.map((provider) => ({ provider: provider.id, ok: true })),
    secretResolver: { ready: input.secretResolverOk ?? true },
    reconciliationService: { ready: true },
    orchestrator: { ready: true, locks: await input.repository.listLocks() },
  };
}
