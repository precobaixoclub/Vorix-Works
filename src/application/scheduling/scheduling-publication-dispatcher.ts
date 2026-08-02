import type { CredentialRepositoryPort } from "../ports/credential-repository.port.js";
import type { OperationalAuditRepositoryPort } from "../ports/operational-audit-repository.port.js";
import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { PublicationProviderRegistry } from "../publication/publication-provider-registry.js";
import type { PublicationQueuePort } from "../publication/publication-queue.js";
import type { PublicationSecretResolverPort } from "../publication/publication-secret-resolver.js";
import type { PublicationGovernancePolicy } from "../credential/publication-governance-policy.js";
import type { PublicationProviderPolicy } from "../publication/publication-provider-policy.js";
import type { PublicationProviderPort } from "../publication/publication-provider.port.js";
import { ensurePublicationOutboxIntents } from "../publication/publication-outbox-intent.js";
import { enqueuePublication, PublicationWorker, type PublicationConcurrencyPolicy } from "../publication/publication-orchestrator.js";
import type { ScheduledPublicationDispatcherPort, ScheduledPublicationDispatchInput, ScheduledPublicationDispatchResult } from "./scheduled-publication-dispatcher.port.js";

export type SchedulingPublicationDispatcherDeps = {
  publicationRepository: PublicationRepositoryPort;
  credentialRepository: CredentialRepositoryPort;
  auditRepository: OperationalAuditRepositoryPort;
  providerRegistry: PublicationProviderRegistry;
  providerPolicy: PublicationProviderPolicy;
  publicationGovernancePolicy: PublicationGovernancePolicy;
  secretResolver: PublicationSecretResolverPort;
  queue: PublicationQueuePort;
  providers: readonly PublicationProviderPort[];
  idGenerator: () => string;
  now?: () => Date;
  concurrency?: PublicationConcurrencyPolicy;
};

export class SchedulingPublicationDispatcher implements ScheduledPublicationDispatcherPort {
  constructor(private readonly deps: SchedulingPublicationDispatcherDeps) {}

  async dispatch(input: ScheduledPublicationDispatchInput): Promise<ScheduledPublicationDispatchResult> {
    const occurrence = input.occurrence;
    const detail = await this.deps.publicationRepository.getDetail(occurrence.publicationPlanId);
    if (!detail || detail.plan.tenantId !== occurrence.tenantId || detail.plan.workspaceId !== occurrence.workspaceId) {
      return { dispatched: false, category: "dispatch", code: "PUBLICATION_NOT_FOUND", safeMessage: "PublicationPlan do schedule não foi encontrado.", deadLetter: true };
    }
    if (detail.plan.state === "cancelled" || detail.plan.state === "published") {
      return { dispatched: false, category: "policy", code: "PUBLICATION_TERMINAL", safeMessage: "PublicationPlan está em estado terminal.", deadLetter: true };
    }
    const target = detail.targets.find((item) => item.id === occurrence.targetId);
    if (!target) return { dispatched: false, category: "dispatch", code: "PUBLICATION_TARGET_NOT_FOUND", safeMessage: "Target da ocorrência não foi encontrado.", deadLetter: true };
    if (this.deps.providerPolicy.shouldFallbackToDryRun({ tenantId: occurrence.tenantId, workspaceId: occurrence.workspaceId, providerId: occurrence.providerId }) && occurrence.providerId !== "dry_run" && occurrence.providerId !== "fake") {
      await this.auditDenied(input, "schedule.policy_denied", "PROVIDER_CANARY_BLOCKED", "Canário de provider externo não permite dispatch agendado.");
      return { dispatched: false, category: "policy", code: "PROVIDER_CANARY_BLOCKED", safeMessage: "Canário de provider externo não permite dispatch agendado.", deadLetter: true };
    }

    const credential = await this.resolveCredential(occurrence);
    const credentialDetail = credential ? await this.deps.credentialRepository.getCredential({ tenantId: occurrence.tenantId, workspaceId: occurrence.workspaceId, credentialId: credential.id }) : undefined;
    const health = credential ? await this.deps.credentialRepository.getHealth({ tenantId: occurrence.tenantId, workspaceId: occurrence.workspaceId, credentialId: credential.id }) : undefined;
    const decision = this.deps.publicationGovernancePolicy.decide({
      tenantId: occurrence.tenantId,
      workspaceId: occurrence.workspaceId,
      providerId: occurrence.providerId,
      role: input.actor.role,
      permission: "publication:publish",
      credential,
      binding: credentialDetail?.bindings.find((binding) => binding.status === "active" && binding.providerId === occurrence.providerId),
      health,
      approvalPresent: detail.approvals.length > 0,
      approvalRequired: detail.plan.policy.requireApproval,
    });
    if (!decision.allowed) {
      await this.auditDenied(input, decision.reason === "credential_missing" || decision.reason === "credential_inactive" || decision.reason === "scope_mismatch" ? "schedule.credential_invalid" : "schedule.policy_denied", decision.reason, decision.safeMessage);
      return { dispatched: false, category: decision.reason.startsWith("credential") || decision.reason === "scope_mismatch" ? "credential" : "policy", code: decision.reason, safeMessage: decision.safeMessage, deadLetter: true };
    }

    const providerHealth = await this.deps.providerRegistry.health(occurrence.providerId);
    if (!providerHealth.ok) {
      return { dispatched: false, category: "provider", code: "PROVIDER_UNAVAILABLE", safeMessage: providerHealth.safeMessage ?? "Provider indisponível.", retryAtUtc: new Date(this.now().getTime() + 10 * 60_000).toISOString() };
    }

    await ensurePublicationOutboxIntents(
      { repository: this.deps.publicationRepository, idGenerator: this.deps.idGenerator, now: this.deps.now },
      { tenantId: occurrence.tenantId, workspaceId: occurrence.workspaceId, publicationId: occurrence.publicationPlanId, causationId: occurrence.id },
    );
    await enqueuePublication(this.orchestratorDeps(), { tenantId: occurrence.tenantId, workspaceId: occurrence.workspaceId, publicationId: occurrence.publicationPlanId, kind: "scheduled" });
    await new PublicationWorker(this.orchestratorDeps(), `schedule-worker:${input.actor.userId}`).runUntilIdle(1);
    const after = await this.deps.publicationRepository.getDetail(occurrence.publicationPlanId);
    const outbox = after?.outbox.find((message) => message.targetId === occurrence.targetId && message.idempotencyKey === target.idempotencyKey);
    const attempt = after?.attempts.find((candidate) => candidate.targetId === occurrence.targetId && candidate.id === outbox?.attemptId);
    await this.deps.auditRepository.record({
      id: this.deps.idGenerator(),
      tenantId: occurrence.tenantId,
      workspaceId: occurrence.workspaceId,
      eventType: "schedule.occurrence_dispatched",
      actor: input.actor,
      resource: { type: "schedule_occurrence", id: occurrence.id, providerId: occurrence.providerId },
      context: { requestId: input.requestId },
      result: { status: "success" },
      metadata: { scheduleId: occurrence.scheduleId, publicationId: occurrence.publicationPlanId, outboxMessageId: outbox?.outboxMessageId, attemptId: attempt?.id },
    });
    return {
      dispatched: true,
      executionReference: { publicationId: occurrence.publicationPlanId, targetId: occurrence.targetId, outboxMessageId: outbox?.outboxMessageId, attemptId: attempt?.id, dispatchedAt: this.now().toISOString() },
      safeMessage: "Ocorrência enviada para Publication Outbox.",
    };
  }

  private async resolveCredential(occurrence: ScheduledPublicationDispatchInput["occurrence"]) {
    if (occurrence.providerId === "dry_run" || occurrence.providerId === "fake") return undefined;
    const credentials = await this.deps.credentialRepository.listCredentials({ tenantId: occurrence.tenantId, workspaceId: occurrence.workspaceId, providerId: occurrence.providerId });
    return credentials.find((credential) => credential.activeReferenceId === occurrence.credentialReferenceId)
      ?? credentials.find((credential) => credential.status === "connected" || credential.status === "expiring")
      ?? credentials[0];
  }

  private orchestratorDeps() {
    return {
      repository: this.deps.publicationRepository,
      providers: this.deps.providers,
      queue: this.deps.queue,
      providerRegistry: this.deps.providerRegistry,
      secretResolver: this.deps.secretResolver,
      idGenerator: this.deps.idGenerator,
      concurrency: this.deps.concurrency ?? { maxWorkers: 2, maxConcurrentPublications: 4, maxPerProvider: 2, maxPerTenant: 2, lockTtlMs: 60_000 },
    };
  }

  private async auditDenied(input: ScheduledPublicationDispatchInput, eventType: string, code: string, safeMessage: string): Promise<void> {
    await this.deps.auditRepository.record({
      id: this.deps.idGenerator(),
      tenantId: input.occurrence.tenantId,
      workspaceId: input.occurrence.workspaceId,
      eventType,
      actor: input.actor,
      resource: { type: "schedule_occurrence", id: input.occurrence.id, providerId: input.occurrence.providerId },
      context: { requestId: input.requestId },
      result: { status: "denied", code, safeMessage },
      metadata: { scheduleId: input.occurrence.scheduleId, publicationId: input.occurrence.publicationPlanId },
    });
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }
}
