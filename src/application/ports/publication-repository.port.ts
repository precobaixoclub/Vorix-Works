import type {
  PublicationApproval,
  PublicationAttempt,
  PublicationCandidate,
  PublicationDeadLetter,
  PublicationDetail,
  PublicationEvent,
  PublicationEventType,
  PublicationFailure,
  PublicationLock,
  PublicationCredentialReference,
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

export type CreatePublicationPlanInput = {
  plan: Omit<PublicationPlan, "createdAt" | "updatedAt" | "version">;
  candidates: readonly Omit<PublicationCandidate, "createdAt">[];
  targets: readonly Omit<PublicationTarget, "createdAt" | "updatedAt">[];
};

export type ListPublicationFilter = {
  tenantId: string;
  workspaceId: string;
  state?: PublicationState;
};

export type CreatePublicationEventInput = {
  id: string;
  publicationId: string;
  eventType: PublicationEventType;
  targetId?: string;
  attemptId?: string;
  receiptId?: string;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  payload?: Record<string, unknown>;
};

export type PublicationRepositoryPort = {
  createPlan(input: CreatePublicationPlanInput): Promise<PublicationDetail>;
  getPlanById(id: string): Promise<PublicationPlan | undefined>;
  getPlanByIdempotency(input: { tenantId: string; workspaceId: string; idempotencyKey: string }): Promise<PublicationPlan | undefined>;
  getDetail(id: string): Promise<PublicationDetail | undefined>;
  listPlans(filter: ListPublicationFilter): Promise<PublicationPlan[]>;
  updatePlanState(input: { id: string; state: PublicationState; expectedVersion?: number; approvedAt?: string; publishedAt?: string; cancelledAt?: string }): Promise<PublicationPlan>;
  updateTargetStatus(input: { id: string; status: PublicationTarget["status"] }): Promise<PublicationTarget>;
  appendApproval(input: Omit<PublicationApproval, "createdAt">): Promise<PublicationApproval>;
  createAttempt(input: Omit<PublicationAttempt, "startedAt" | "state">): Promise<PublicationAttempt>;
  createAttemptWithOutbox(input: {
    attempt: Omit<PublicationAttempt, "startedAt" | "state">;
    event: CreatePublicationEventInput;
    payloadReference: Omit<PublicationPayloadReference, "createdAt">;
    outbox: Omit<PublicationOutboxMessage, "createdAt" | "updatedAt" | "status" | "attemptCount" | "fencingToken">;
  }): Promise<{ attempt: PublicationAttempt; payloadReference: PublicationPayloadReference; outbox: PublicationOutboxMessage; event: PublicationEvent }>;
  finishAttempt(input: { id: string; state: PublicationAttempt["state"]; failure?: PublicationFailure }): Promise<PublicationAttempt>;
  createReceipts(inputs: readonly Omit<PublicationReceipt, "createdAt">[]): Promise<PublicationReceipt[]>;
  findReceiptByIdempotency(input: { publicationId: string; targetId: string; provider: string; idempotencyKey: string }): Promise<PublicationReceipt | undefined>;
  appendFailure(input: { publicationId: string; failure: PublicationFailure }): Promise<PublicationFailure>;
  appendEvent(input: CreatePublicationEventInput): Promise<PublicationEvent>;
  createSchedule(input: Omit<PublicationSchedule, "createdAt" | "updatedAt">): Promise<PublicationSchedule>;
  updateScheduleStatus(input: { id: string; status: PublicationScheduleState }): Promise<PublicationSchedule>;
  listSchedules(filter: { tenantId: string; workspaceId: string; status?: PublicationScheduleState }): Promise<PublicationSchedule[]>;
  listDueSchedules(input: { now: string; limit: number; tenantId?: string; workspaceId?: string }): Promise<PublicationSchedule[]>;
  acquireLock(input: PublicationLock): Promise<boolean>;
  releaseLock(publicationId: string, ownerId: string): Promise<void>;
  listLocks(): Promise<PublicationLock[]>;
  createDeadLetter(input: Omit<PublicationDeadLetter, "createdAt">): Promise<PublicationDeadLetter>;
  listDeadLetters(filter: { tenantId: string; workspaceId: string }): Promise<PublicationDeadLetter[]>;
  reprocessDeadLetter(input: { id: string; tenantId: string; workspaceId: string; now: string }): Promise<PublicationDeadLetter | undefined>;
  getPayloadReference(id: string): Promise<PublicationPayloadReference | undefined>;
  listOutbox(filter?: { tenantId?: string; workspaceId?: string; status?: PublicationOutboxMessage["status"] }): Promise<PublicationOutboxMessage[]>;
  claimOutbox(input: { workerId: string; now: string; leaseMs: number; limit: number; tenantId?: string; workspaceId?: string; publicationId?: string }): Promise<PublicationOutboxMessage[]>;
  completeOutbox(input: { outboxMessageId: string; workerId: string; fencingToken: number; now: string; receipt?: Omit<PublicationReceipt, "id" | "createdAt">; receiptId?: string }): Promise<{ committed: boolean; receipt?: PublicationReceipt }>;
  failOutbox(input: { outboxMessageId: string; workerId: string; fencingToken: number; now: string; failure: PublicationFailure; retryAt?: string; deadLetter?: boolean }): Promise<boolean>;
  markOutboxUnknown(input: { outboxMessageId: string; workerId: string; fencingToken: number; now: string; reconciliationId: string; providerRequestId?: string; safeMessage: string }): Promise<boolean>;
  releaseExpiredOutbox(now: string): Promise<number>;
  createCredentialReference(input: Omit<PublicationCredentialReference, "createdAt" | "updatedAt">): Promise<PublicationCredentialReference>;
  listCredentialReferences(filter: { tenantId: string; workspaceId: string; providerId?: string }): Promise<PublicationCredentialReference[]>;
  createReconciliation(input: Omit<PublicationReconciliation, "createdAt" | "updatedAt">): Promise<PublicationReconciliation>;
  confirmReconciliationPublished(input: { reconciliationId: string; receiptId: string; receipt: Omit<PublicationReceipt, "id" | "createdAt">; now: string }): Promise<boolean>;
  confirmReconciliationNotPublished(input: { reconciliationId: string; now: string; failure: PublicationFailure }): Promise<boolean>;
  updateReconciliationStatus(input: { id: string; status: PublicationReconciliation["status"] }): Promise<PublicationReconciliation>;
  listReconciliations(filter: { tenantId: string; workspaceId: string; status?: PublicationReconciliation["status"] }): Promise<PublicationReconciliation[]>;
  createReceiptVerification(input: Omit<PublicationReceiptVerification, "verifiedAt">): Promise<PublicationReceiptVerification>;
  listReceiptVerifications(filter: { tenantId: string; workspaceId: string; publicationId?: string }): Promise<PublicationReceiptVerification[]>;
};
