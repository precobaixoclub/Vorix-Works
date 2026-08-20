import type {
  CreatePublicationEventInput,
  CreatePublicationPlanInput,
  ListPublicationFilter,
  PublicationRepositoryPort,
} from "../../application/ports/publication-repository.port.js";
import type {
  PublicationApproval,
  PublicationAttempt,
  PublicationCandidate,
  PublicationCredentialReference,
  PublicationDeadLetter,
  PublicationDetail,
  PublicationEvent,
  PublicationFailure,
  PublicationLock,
  PublicationOutboxMessage,
  PublicationPayloadReference,
  PublicationPlan,
  PublicationReceipt,
  PublicationReceiptVerification,
  PublicationReconciliation,
  PublicationSchedule,
  PublicationScheduleState,
  PublicationState,
  PublicationTarget,
} from "../../domain/publication/publication.model.js";

export class InMemoryPublicationRepository implements PublicationRepositoryPort {
  private readonly plans = new Map<string, PublicationPlan>();
  private readonly candidates = new Map<string, PublicationCandidate>();
  private readonly targets = new Map<string, PublicationTarget>();
  private readonly approvals = new Map<string, PublicationApproval>();
  private readonly attempts = new Map<string, PublicationAttempt>();
  private readonly receipts = new Map<string, PublicationReceipt>();
  private readonly events = new Map<string, PublicationEvent>();
  private readonly failures = new Map<string, PublicationFailure[]>();
  private readonly schedules = new Map<string, PublicationSchedule>();
  private readonly locks = new Map<string, PublicationLock>();
  private readonly deadLetters = new Map<string, PublicationDeadLetter>();
  private readonly payloadReferences = new Map<string, PublicationPayloadReference>();
  private readonly outbox = new Map<string, PublicationOutboxMessage>();
  private readonly credentialReferences = new Map<string, PublicationCredentialReference>();
  private readonly reconciliations = new Map<string, PublicationReconciliation>();
  private readonly receiptVerifications = new Map<string, PublicationReceiptVerification>();

  async createPlan(input: CreatePublicationPlanInput): Promise<PublicationDetail> {
    const now = new Date().toISOString();
    const plan: PublicationPlan = { ...input.plan, createdAt: now, updatedAt: now, version: 0 };
    this.plans.set(plan.id, plan);
    for (const candidateInput of input.candidates) this.candidates.set(candidateInput.id, { ...candidateInput, createdAt: now });
    for (const targetInput of input.targets) this.targets.set(targetInput.id, { ...targetInput, createdAt: now, updatedAt: now });
    const detail = await this.getDetail(plan.id);
    if (!detail) throw new Error("PUBLICATION_NOT_FOUND: publicação criada não foi encontrada.");
    return detail;
  }

  async getPlanById(id: string): Promise<PublicationPlan | undefined> {
    return this.plans.get(id);
  }

  async getPlanByIdempotency(input: { tenantId: string; workspaceId: string; idempotencyKey: string }): Promise<PublicationPlan | undefined> {
    return [...this.plans.values()].find((plan) => plan.tenantId === input.tenantId && plan.workspaceId === input.workspaceId && plan.idempotencyKey === input.idempotencyKey);
  }

  async getDetail(id: string): Promise<PublicationDetail | undefined> {
    const plan = this.plans.get(id);
    if (!plan) return undefined;
    return {
      plan,
      candidates: [...this.candidates.values()].filter((item) => item.publicationId === id),
      targets: [...this.targets.values()].filter((item) => item.publicationId === id),
      approvals: [...this.approvals.values()].filter((item) => item.publicationId === id),
      attempts: [...this.attempts.values()].filter((item) => item.publicationId === id),
      receipts: [...this.receipts.values()].filter((item) => item.publicationId === id),
      events: [...this.events.values()].filter((item) => item.publicationId === id),
      failures: this.failures.get(id) ?? [],
      schedules: [...this.schedules.values()].filter((item) => item.publicationId === id),
      deadLetters: [...this.deadLetters.values()].filter((item) => item.publicationId === id),
      outbox: [...this.outbox.values()].filter((item) => item.publicationId === id),
      payloadReferences: [...this.payloadReferences.values()].filter((item) => item.publicationId === id),
      reconciliations: [...this.reconciliations.values()].filter((item) => item.publicationId === id),
      receiptVerifications: [...this.receiptVerifications.values()].filter((item) => item.publicationId === id),
    };
  }

  async listPlans(filter: ListPublicationFilter): Promise<PublicationPlan[]> {
    return [...this.plans.values()].filter((plan) => plan.tenantId === filter.tenantId && plan.workspaceId === filter.workspaceId && (!filter.state || plan.state === filter.state));
  }

  async updatePlanState(input: { id: string; state: PublicationState; expectedVersion?: number; approvedAt?: string; publishedAt?: string; cancelledAt?: string }): Promise<PublicationPlan> {
    const plan = this.requirePlan(input.id);
    if (input.expectedVersion !== undefined && plan.version !== input.expectedVersion) throw new Error("PUBLICATION_OPTIMISTIC_LOCK_CONFLICT: versão divergente.");
    const updated = { ...plan, state: input.state, approvedAt: input.approvedAt ?? plan.approvedAt, publishedAt: input.publishedAt ?? plan.publishedAt, cancelledAt: input.cancelledAt ?? plan.cancelledAt, updatedAt: new Date().toISOString(), version: plan.version + 1 };
    this.plans.set(input.id, updated);
    return updated;
  }

  async updateTargetStatus(input: { id: string; status: PublicationTarget["status"] }): Promise<PublicationTarget> {
    const target = this.targets.get(input.id);
    if (!target) throw new Error(`PUBLICATION_TARGET_NOT_FOUND: target "${input.id}" não existe.`);
    const updated = { ...target, status: input.status, updatedAt: new Date().toISOString() };
    this.targets.set(input.id, updated);
    return updated;
  }

  async appendApproval(input: Omit<PublicationApproval, "createdAt">): Promise<PublicationApproval> {
    const approval = { ...input, createdAt: new Date().toISOString() };
    this.approvals.set(approval.id, approval);
    return approval;
  }

  async createAttempt(input: Omit<PublicationAttempt, "startedAt" | "state">): Promise<PublicationAttempt> {
    const attempt = { ...input, state: "running" as const, startedAt: new Date().toISOString() };
    this.attempts.set(attempt.id, attempt);
    return attempt;
  }

  async createAttemptWithOutbox(input: {
    attempt: Omit<PublicationAttempt, "startedAt" | "state">;
    event: CreatePublicationEventInput;
    payloadReference: Omit<PublicationPayloadReference, "createdAt">;
    outbox: Omit<PublicationOutboxMessage, "createdAt" | "updatedAt" | "status" | "attemptCount" | "fencingToken">;
  }): Promise<{ attempt: PublicationAttempt; payloadReference: PublicationPayloadReference; outbox: PublicationOutboxMessage; event: PublicationEvent }> {
    const attempt = await this.createAttempt(input.attempt);
    const now = new Date().toISOString();
    const payloadReference = { ...input.payloadReference, createdAt: now };
    const outbox = { ...input.outbox, status: "pending" as const, attemptCount: 0, fencingToken: 0, createdAt: now, updatedAt: now };
    const event = await this.appendEvent(input.event);
    this.payloadReferences.set(payloadReference.id, payloadReference);
    this.outbox.set(outbox.outboxMessageId, outbox);
    return { attempt, payloadReference, outbox, event };
  }

  async finishAttempt(input: { id: string; state: PublicationAttempt["state"]; failure?: PublicationFailure }): Promise<PublicationAttempt> {
    const attempt = this.attempts.get(input.id);
    if (!attempt) throw new Error(`PUBLICATION_ATTEMPT_NOT_FOUND: attempt "${input.id}" não existe.`);
    const updated = { ...attempt, state: input.state, failure: input.failure, finishedAt: new Date().toISOString() };
    this.attempts.set(input.id, updated);
    return updated;
  }

  async createReceipts(inputs: readonly Omit<PublicationReceipt, "createdAt">[]): Promise<PublicationReceipt[]> {
    const created: PublicationReceipt[] = [];
    for (const input of inputs) {
      const existing = await this.findReceiptByIdempotency({ publicationId: input.publicationId, targetId: input.targetId, provider: input.provider, idempotencyKey: input.idempotencyKey });
      if (existing) {
        created.push(existing);
        continue;
      }
      const receipt = { ...input, createdAt: new Date().toISOString() };
      this.receipts.set(receipt.id, receipt);
      created.push(receipt);
    }
    return created;
  }

  async findReceiptByIdempotency(input: { publicationId: string; targetId: string; provider: string; idempotencyKey: string }): Promise<PublicationReceipt | undefined> {
    return [...this.receipts.values()].find((receipt) => receipt.publicationId === input.publicationId && receipt.targetId === input.targetId && receipt.provider === input.provider && receipt.idempotencyKey === input.idempotencyKey);
  }

  async appendFailure(input: { publicationId: string; failure: PublicationFailure }): Promise<PublicationFailure> {
    const failures = this.failures.get(input.publicationId) ?? [];
    failures.push(input.failure);
    this.failures.set(input.publicationId, failures);
    return input.failure;
  }

  async appendEvent(input: CreatePublicationEventInput): Promise<PublicationEvent> {
    const event = { ...input, createdAt: new Date().toISOString() };
    this.events.set(event.id, event);
    return event;
  }

  async createSchedule(input: Omit<PublicationSchedule, "createdAt" | "updatedAt">): Promise<PublicationSchedule> {
    const now = new Date().toISOString();
    const schedule = { ...input, createdAt: now, updatedAt: now };
    this.schedules.set(schedule.id, schedule);
    return schedule;
  }

  async updateScheduleStatus(input: { id: string; status: PublicationScheduleState }): Promise<PublicationSchedule> {
    const schedule = this.schedules.get(input.id);
    if (!schedule) throw new Error(`PUBLICATION_SCHEDULE_NOT_FOUND: schedule "${input.id}" não existe.`);
    const updated = { ...schedule, status: input.status, updatedAt: new Date().toISOString() };
    this.schedules.set(input.id, updated);
    return updated;
  }

  async listSchedules(filter: { tenantId: string; workspaceId: string; status?: PublicationScheduleState }): Promise<PublicationSchedule[]> {
    return [...this.schedules.values()].filter((schedule) => schedule.tenantId === filter.tenantId && schedule.workspaceId === filter.workspaceId && (!filter.status || schedule.status === filter.status));
  }

  async listDueSchedules(input: { now: string; limit: number; tenantId?: string; workspaceId?: string }): Promise<PublicationSchedule[]> {
    return [...this.schedules.values()]
      .filter((schedule) =>
        schedule.status === "scheduled"
        && schedule.scheduledAt <= input.now
        && (!input.tenantId || schedule.tenantId === input.tenantId)
        && (!input.workspaceId || schedule.workspaceId === input.workspaceId),
      )
      .slice(0, input.limit);
  }

  async acquireLock(input: PublicationLock): Promise<boolean> {
    const existing = this.locks.get(input.publicationId);
    const now = input.acquiredAt;
    if (existing && existing.expiresAt > now) return false;
    this.locks.set(input.publicationId, input);
    return true;
  }

  async releaseLock(publicationId: string, ownerId: string): Promise<void> {
    const existing = this.locks.get(publicationId);
    if (existing?.ownerId === ownerId) this.locks.delete(publicationId);
  }

  async listLocks(): Promise<PublicationLock[]> {
    return [...this.locks.values()];
  }

  async createDeadLetter(input: Omit<PublicationDeadLetter, "createdAt">): Promise<PublicationDeadLetter> {
    const letter = { ...input, createdAt: new Date().toISOString(), deadLetteredAt: input.deadLetteredAt ?? new Date().toISOString(), recoveryStatus: input.recoveryStatus ?? "pending" as const };
    this.deadLetters.set(letter.id, letter);
    return letter;
  }

  async listDeadLetters(filter: { tenantId: string; workspaceId: string }): Promise<PublicationDeadLetter[]> {
    return [...this.deadLetters.values()].filter((letter) => letter.tenantId === filter.tenantId && letter.workspaceId === filter.workspaceId);
  }

  async reprocessDeadLetter(input: { id: string; tenantId: string; workspaceId: string; now: string }): Promise<PublicationDeadLetter | undefined> {
    const letter = this.deadLetters.get(input.id);
    if (!letter || letter.tenantId !== input.tenantId || letter.workspaceId !== input.workspaceId) return undefined;
    const updatedLetter = { ...letter, recoveryStatus: "reprocessed" as const };
    this.deadLetters.set(input.id, updatedLetter);
    if (letter.outboxMessageId) {
      const message = this.outbox.get(letter.outboxMessageId);
      if (message) {
        this.outbox.set(message.outboxMessageId, { ...message, status: "pending", availableAt: input.now, claimedBy: undefined, claimedAt: undefined, leaseExpiresAt: undefined, lastFailureCode: undefined, retryAfter: undefined, updatedAt: input.now });
      }
    }
    if (letter.targetId) await this.updateTargetStatus({ id: letter.targetId, status: "pending" });
    await this.updatePlanState({ id: letter.publicationId, state: "publishing" });
    return updatedLetter;
  }

  private requirePlan(id: string): PublicationPlan {
    const plan = this.plans.get(id);
    if (!plan) throw new Error(`PUBLICATION_NOT_FOUND: publicação "${id}" não existe.`);
    return plan;
  }

  async getPayloadReference(id: string): Promise<PublicationPayloadReference | undefined> {
    return this.payloadReferences.get(id);
  }

  async listOutbox(filter: { tenantId?: string; workspaceId?: string; status?: PublicationOutboxMessage["status"] } = {}): Promise<PublicationOutboxMessage[]> {
    return [...this.outbox.values()].filter((message) =>
      (!filter.tenantId || message.tenantId === filter.tenantId)
      && (!filter.workspaceId || message.workspaceId === filter.workspaceId)
      && (!filter.status || message.status === filter.status),
    );
  }

  async claimOutbox(input: { workerId: string; now: string; leaseMs: number; limit: number; tenantId?: string; workspaceId?: string; publicationId?: string }): Promise<PublicationOutboxMessage[]> {
    const claimed: PublicationOutboxMessage[] = [];
    for (const message of [...this.outbox.values()].sort((a, b) => a.availableAt.localeCompare(b.availableAt))) {
      if (claimed.length >= input.limit) break;
      if (input.tenantId && message.tenantId !== input.tenantId) continue;
      if (input.workspaceId && message.workspaceId !== input.workspaceId) continue;
      if (input.publicationId && message.publicationId !== input.publicationId) continue;
      const available = message.lastFailureCode !== "UNKNOWN_OUTCOME"
        && (message.status === "pending" || message.status === "failed" || (message.status === "claimed" && (message.leaseExpiresAt ?? "") <= input.now))
        && message.availableAt <= input.now;
      if (!available) continue;
      const updated = {
        ...message,
        status: "claimed" as const,
        claimedBy: input.workerId,
        claimedAt: input.now,
        leaseExpiresAt: new Date(new Date(input.now).getTime() + input.leaseMs).toISOString(),
        fencingToken: message.fencingToken + 1,
        updatedAt: input.now,
      };
      this.outbox.set(message.outboxMessageId, updated);
      claimed.push(updated);
    }
    return claimed;
  }

  async completeOutbox(input: { outboxMessageId: string; workerId: string; fencingToken: number; now: string; receipt?: Omit<PublicationReceipt, "id" | "createdAt">; receiptId?: string }): Promise<{ committed: boolean; receipt?: PublicationReceipt }> {
    const message = this.outbox.get(input.outboxMessageId);
    if (!this.isCurrentClaim(message, input.workerId, input.fencingToken, input.now)) return { committed: false };
    let receipt: PublicationReceipt | undefined;
    if (input.receipt && input.receiptId) {
      [receipt] = await this.createReceipts([{ id: input.receiptId, ...input.receipt }]);
      await this.updateTargetStatus({ id: message!.targetId, status: "published" });
      await this.finishAttempt({ id: message!.attemptId, state: "completed" });
    }
    const updated = { ...message!, status: "dispatched" as const, updatedAt: input.now };
    this.outbox.set(updated.outboxMessageId, updated);
    const detail = await this.getDetail(updated.publicationId);
    if (detail && detail.targets.every((target) => target.status === "published")) {
      await this.updatePlanState({ id: updated.publicationId, state: "published", publishedAt: input.now });
    }
    return { committed: true, receipt };
  }

  async failOutbox(input: { outboxMessageId: string; workerId: string; fencingToken: number; now: string; failure: PublicationFailure; retryAt?: string; deadLetter?: boolean }): Promise<boolean> {
    const message = this.outbox.get(input.outboxMessageId);
    if (!this.isCurrentClaim(message, input.workerId, input.fencingToken, input.now)) return false;
    await this.appendFailure({ publicationId: message!.publicationId, failure: input.failure });
    if (input.deadLetter) {
      await this.finishAttempt({ id: message!.attemptId, state: "failed", failure: input.failure });
      await this.updateTargetStatus({ id: message!.targetId, status: "failed" });
      await this.updatePlanState({ id: message!.publicationId, state: "failed" });
      const updated = { ...message!, status: "dead_lettered" as const, attemptCount: message!.attemptCount + 1, lastFailureCode: input.failure.code, updatedAt: input.now };
      this.outbox.set(updated.outboxMessageId, updated);
      await this.createDeadLetter({
        id: `${message!.outboxMessageId}:dead-letter:${updated.attemptCount}`,
        outboxMessageId: message!.outboxMessageId,
        publicationId: message!.publicationId,
        targetId: message!.targetId,
        providerId: message!.providerId,
        tenantId: message!.tenantId,
        workspaceId: message!.workspaceId,
        reason: input.failure.message,
        lastError: input.failure,
        attempts: updated.attemptCount,
        lastFailureCode: input.failure.code,
        lastSafeMessage: input.failure.message,
      });
      return true;
    }
    const updated = { ...message!, status: "pending" as const, attemptCount: message!.attemptCount + 1, availableAt: input.retryAt ?? input.now, lastFailureCode: input.failure.code, updatedAt: input.now, claimedBy: undefined, claimedAt: undefined, leaseExpiresAt: undefined };
    this.outbox.set(updated.outboxMessageId, updated);
    return true;
  }

  async markOutboxUnknown(input: { outboxMessageId: string; workerId: string; fencingToken: number; now: string; reconciliationId: string; providerRequestId?: string; safeMessage: string }): Promise<boolean> {
    const message = this.outbox.get(input.outboxMessageId);
    if (!this.isCurrentClaim(message, input.workerId, input.fencingToken, input.now)) return false;
    const failure: PublicationFailure = { code: "UNKNOWN_OUTCOME", message: input.safeMessage, category: "provider_unavailable", retryable: false };
    await this.finishAttempt({ id: message!.attemptId, state: "unknown_outcome", failure });
    await this.appendFailure({ publicationId: message!.publicationId, failure });
    await this.updateTargetStatus({ id: message!.targetId, status: "unknown_outcome" });
    await this.updatePlanState({ id: message!.publicationId, state: "unknown_outcome" });
    const updated = { ...message!, status: "failed" as const, lastFailureCode: "UNKNOWN_OUTCOME", retryAfter: undefined, claimedBy: undefined, claimedAt: undefined, leaseExpiresAt: undefined, updatedAt: input.now };
    this.outbox.set(updated.outboxMessageId, updated);
    await this.createReconciliation({ id: input.reconciliationId, publicationId: message!.publicationId, targetId: message!.targetId, attemptId: message!.attemptId, outboxMessageId: message!.outboxMessageId, tenantId: message!.tenantId, workspaceId: message!.workspaceId, providerId: message!.providerId, status: "pending", providerRequestId: input.providerRequestId, idempotencyKey: message!.idempotencyKey });
    return true;
  }

  async releaseExpiredOutbox(now: string): Promise<number> {
    let released = 0;
    for (const message of this.outbox.values()) {
      if (message.status === "claimed" && (message.leaseExpiresAt ?? "") <= now) {
        this.outbox.set(message.outboxMessageId, { ...message, status: "pending", claimedBy: undefined, claimedAt: undefined, leaseExpiresAt: undefined, updatedAt: now });
        released += 1;
      }
    }
    return released;
  }

  async createCredentialReference(input: Omit<PublicationCredentialReference, "createdAt" | "updatedAt">): Promise<PublicationCredentialReference> {
    const now = new Date().toISOString();
    const reference = { ...input, createdAt: now, updatedAt: now };
    this.credentialReferences.set(reference.credentialReferenceId, reference);
    return reference;
  }

  async listCredentialReferences(filter: { tenantId: string; workspaceId: string; providerId?: string }): Promise<PublicationCredentialReference[]> {
    return [...this.credentialReferences.values()].filter((reference) => reference.tenantId === filter.tenantId && reference.workspaceId === filter.workspaceId && (!filter.providerId || reference.providerId === filter.providerId));
  }

  async createReconciliation(input: Omit<PublicationReconciliation, "createdAt" | "updatedAt">): Promise<PublicationReconciliation> {
    const now = new Date().toISOString();
    const reconciliation = { ...input, createdAt: now, updatedAt: now };
    this.reconciliations.set(reconciliation.id, reconciliation);
    return reconciliation;
  }

  async confirmReconciliationPublished(input: { reconciliationId: string; receiptId: string; receipt: Omit<PublicationReceipt, "id" | "createdAt">; now: string }): Promise<boolean> {
    const reconciliation = this.reconciliations.get(input.reconciliationId);
    if (!reconciliation || reconciliation.status !== "pending") return false;
    await this.createReceipts([{ id: input.receiptId, ...input.receipt }]);
    await this.finishAttempt({ id: reconciliation.attemptId, state: "completed" });
    await this.updateTargetStatus({ id: reconciliation.targetId, status: "published" });
    const updated = { ...reconciliation, status: "confirmed_published" as const, updatedAt: input.now };
    this.reconciliations.set(updated.id, updated);
    const detail = await this.getDetail(reconciliation.publicationId);
    if (detail?.targets.every((target) => target.status === "published")) {
      await this.updatePlanState({ id: reconciliation.publicationId, state: "published", publishedAt: input.now });
    }
    return true;
  }

  async confirmReconciliationNotPublished(input: { reconciliationId: string; now: string; failure: PublicationFailure }): Promise<boolean> {
    const reconciliation = this.reconciliations.get(input.reconciliationId);
    if (!reconciliation || reconciliation.status !== "pending") return false;
    await this.finishAttempt({ id: reconciliation.attemptId, state: "failed", failure: input.failure });
    await this.appendFailure({ publicationId: reconciliation.publicationId, failure: input.failure });
    await this.updateTargetStatus({ id: reconciliation.targetId, status: "failed" });
    await this.updatePlanState({ id: reconciliation.publicationId, state: "failed" });
    const updated = { ...reconciliation, status: "confirmed_not_published" as const, updatedAt: input.now };
    this.reconciliations.set(updated.id, updated);
    return true;
  }

  async updateReconciliationStatus(input: { id: string; status: PublicationReconciliation["status"] }): Promise<PublicationReconciliation> {
    const reconciliation = this.reconciliations.get(input.id);
    if (!reconciliation) throw new Error(`PUBLICATION_RECONCILIATION_NOT_FOUND: reconciliation "${input.id}" não existe.`);
    const updated = { ...reconciliation, status: input.status, updatedAt: new Date().toISOString() };
    this.reconciliations.set(updated.id, updated);
    return updated;
  }

  async listReconciliations(filter: { tenantId: string; workspaceId: string; status?: PublicationReconciliation["status"] }): Promise<PublicationReconciliation[]> {
    return [...this.reconciliations.values()].filter((item) => item.tenantId === filter.tenantId && item.workspaceId === filter.workspaceId && (!filter.status || item.status === filter.status));
  }

  async createReceiptVerification(input: Omit<PublicationReceiptVerification, "verifiedAt">): Promise<PublicationReceiptVerification> {
    const verification = { ...input, verifiedAt: new Date().toISOString() };
    this.receiptVerifications.set(verification.id, verification);
    return verification;
  }

  async listReceiptVerifications(filter: { tenantId: string; workspaceId: string; publicationId?: string }): Promise<PublicationReceiptVerification[]> {
    return [...this.receiptVerifications.values()].filter((item) => item.tenantId === filter.tenantId && item.workspaceId === filter.workspaceId && (!filter.publicationId || item.publicationId === filter.publicationId));
  }

  private isCurrentClaim(message: PublicationOutboxMessage | undefined, workerId: string, fencingToken: number, now: string): boolean {
    return !!message && message.status === "claimed" && message.claimedBy === workerId && message.fencingToken === fencingToken && !!message.leaseExpiresAt && message.leaseExpiresAt > now;
  }
}
