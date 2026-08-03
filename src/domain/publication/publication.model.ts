/**
 * Domínio Publication — governa aprovação operacional, tentativa de publicação e receipts.
 * Não importa Execution, Runtime, Helena, Skills, AI Gateway, SDKs externos ou providers reais.
 */

export const PUBLICATION_STATES = ["draft", "waiting_for_approval", "approved", "publishing", "published", "failed", "cancelled", "superseded", "unknown_outcome"] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

export const PUBLICATION_MODES = ["dry_run", "real"] as const;
export type PublicationMode = (typeof PUBLICATION_MODES)[number];

export const PUBLICATION_CHANNELS = ["instagram", "facebook", "threads", "linkedin", "x", "tiktok", "pinterest", "youtube", "google_business"] as const;
export type PublicationChannel = (typeof PUBLICATION_CHANNELS)[number];

export const PUBLICATION_PROVIDERS = ["dry_run", "fake", "meta_pages_sandbox", "linkedin_sandbox", "x_sandbox", "instagram", "facebook", "linkedin", "x", "tiktok"] as const;
export type PublicationProvider = (typeof PUBLICATION_PROVIDERS)[number];
export type PublicationContentType = "text" | "image" | "carousel" | "video" | "document";
export type PublicationProviderStatus = "enabled" | "disabled" | "sandbox_only" | "degraded";
export type PublicationProviderOAuthType = "none" | "oauth2_auth_code" | "oauth2_pkce" | "oauth1a" | "manual";

export const PUBLICATION_FAILURE_CATEGORIES = [
  "timeout",
  "provider_unavailable",
  "rate_limited",
  "policy_violation",
  "authentication",
  "invalid_content",
  "approval_missing",
  "internal",
] as const;
export type PublicationFailureCategory = (typeof PUBLICATION_FAILURE_CATEGORIES)[number];

export const RETRYABLE_PUBLICATION_FAILURES: readonly PublicationFailureCategory[] = ["timeout", "provider_unavailable", "rate_limited"];

export const PUBLICATION_EVENT_TYPES = [
  "publication_created",
  "publication_approved",
  "publication_started",
  "publication_completed",
  "publication_failed",
  "receipt_created",
  "retry",
  "cancelled",
  "publication_scheduled",
  "publication_enqueued",
  "worker_started",
  "worker_completed",
  "recovery_enqueued",
  "dead_letter_created",
  "lock_contended",
  "outbox_created",
  "outbox_claimed",
  "outbox_dispatched",
  "outbox_failed",
  "fencing_rejected",
  "unknown_outcome",
  "reconciliation_created",
  "reconciliation_completed",
  "receipt_verified",
  "receipt_mismatch",
  "receipt_updated",
  "provider_event_received",
  "publication_sync_completed",
] as const;
export type PublicationEventType = (typeof PUBLICATION_EVENT_TYPES)[number];

export const PUBLICATION_SCHEDULE_STATES = ["scheduled", "running", "completed", "failed", "cancelled"] as const;
export type PublicationScheduleState = (typeof PUBLICATION_SCHEDULE_STATES)[number];

export type PublicationPolicy = {
  allowPublish: boolean;
  requireApproval: boolean;
  allowedChannels: readonly PublicationChannel[];
  allowedProviders: readonly PublicationProvider[];
  publishMode: PublicationMode;
  approvalPolicy: "required" | "optional";
  maxRetries: number;
  rollbackSupported: boolean;
};

export type PublicationProviderDescriptor = {
  providerId: PublicationProvider;
  providerVersion: string;
  displayName: string;
  enabled: boolean;
  status?: PublicationProviderStatus;
  oauthType?: PublicationProviderOAuthType;
  supportedChannels: readonly PublicationChannel[];
  supportedContentTypes: readonly PublicationContentType[];
  capabilities?: PublicationProviderCapabilities;
  supportsIdempotencyKey: boolean;
  supportsStatusLookup: boolean;
  supportsDelete: boolean;
  supportsUpdate: boolean;
  supportsScheduling: boolean;
  supportsReceiptVerification: boolean;
  maxPayloadBytes: number;
  maxAssets: number;
};

export type PublicationProviderCapabilities = {
  publish: boolean;
  image: boolean;
  video: boolean;
  carousel: boolean;
  scheduling: boolean;
  update: boolean;
  delete: boolean;
  status: boolean;
  analytics: boolean;
  webhooks: boolean;
};

export type PublicationCredentialReference = {
  credentialReferenceId: string;
  tenantId: string;
  workspaceId: string;
  providerId: PublicationProvider;
  status: "active" | "disabled" | "revoked";
  environment?: "sandbox" | "production";
  providerSubjectId?: string;
  scopes?: readonly string[];
  expiresAt?: string;
  lastRefreshedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicationSourceArtifact = {
  artifactId: string;
  artifactType: string;
  schemaId: string;
  schemaVersion: number;
  checksum: string;
  outputPort?: string;
  payload?: Record<string, unknown>;
  payloadRef?: string;
};

export type PublicationPlan = {
  id: string;
  tenantId: string;
  workspaceId: string;
  state: PublicationState;
  mode: PublicationMode;
  idempotencyKey: string;
  sourceExecutionRunId?: string;
  sourceArtifacts: readonly PublicationSourceArtifact[];
  policy: PublicationPolicy;
  correlationId: string;
  causationId?: string;
  traceId: string;
  scheduledAt?: string;
  timezone?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  publishedAt?: string;
  cancelledAt?: string;
  version: number;
};

export type PublicationCandidate = {
  id: string;
  publicationId: string;
  tenantId: string;
  workspaceId: string;
  content: Record<string, unknown>;
  assets: readonly PublicationSourceArtifact[];
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type PublicationTarget = {
  id: string;
  publicationId: string;
  candidateId: string;
  tenantId: string;
  workspaceId: string;
  channel: PublicationChannel;
  provider: PublicationProvider;
  mode: PublicationMode;
  status: "pending" | "publishing" | "published" | "failed" | "cancelled" | "unknown_outcome";
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicationApproval = {
  id: string;
  publicationId: string;
  tenantId: string;
  workspaceId: string;
  approvedByUserId: string;
  reason: string;
  notes?: string;
  createdAt: string;
};

export type PublicationFailure = {
  code: string;
  message: string;
  category: PublicationFailureCategory;
  retryable: boolean;
};

export type PublicationAttempt = {
  id: string;
  publicationId: string;
  targetId: string;
  tenantId: string;
  workspaceId: string;
  provider: PublicationProvider;
  channel: PublicationChannel;
  attemptNumber: number;
  state: "running" | "completed" | "failed" | "unknown_outcome";
  idempotencyKey: string;
  startedAt: string;
  finishedAt?: string;
  failure?: PublicationFailure;
};

export type PublicationReceipt = {
  id: string;
  publicationId: string;
  targetId: string;
  attemptId: string;
  tenantId: string;
  workspaceId: string;
  provider: PublicationProvider;
  providerPublicationId: string;
  providerRequestId?: string;
  externalIdentifiers?: Record<string, string>;
  channel: PublicationChannel;
  publishedAt: string;
  status: "published" | "dry_run" | "fake";
  url: string;
  checksum: string;
  correlationId: string;
  traceId: string;
  idempotencyKey: string;
  createdAt: string;
};

export const PUBLICATION_OUTBOX_STATES = ["pending", "claimed", "dispatched", "failed", "dead_lettered"] as const;
export type PublicationOutboxState = (typeof PUBLICATION_OUTBOX_STATES)[number];

export type PublicationPayloadReference = {
  id: string;
  publicationId: string;
  targetId: string;
  tenantId: string;
  workspaceId: string;
  version: number;
  contentChecksum: string;
  payload: Record<string, unknown>;
  assets: readonly PublicationSourceArtifact[];
  sizeBytes: number;
  createdAt: string;
};

export type PublicationOutboxMessage = {
  outboxMessageId: string;
  publicationId: string;
  targetId: string;
  attemptId: string;
  tenantId: string;
  workspaceId: string;
  providerId: PublicationProvider;
  credentialReferenceId?: string;
  idempotencyKey: string;
  payloadReference: string;
  status: PublicationOutboxState;
  attemptCount: number;
  availableAt: string;
  claimedBy?: string;
  claimedAt?: string;
  leaseExpiresAt?: string;
  fencingToken: number;
  lastFailureCode?: string;
  retryAfter?: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicationProviderCallResult =
  | { kind: "published"; providerPublicationId: string; providerRequestId?: string; publishedAt: string; url?: string; statusCode?: number; rawResponseReference?: string }
  | { kind: "rejected"; errorCode: string; safeMessage: string; statusCode?: number; rawResponseReference?: string }
  | { kind: "transient_failure"; errorCode: string; safeMessage: string; retryAfter?: string; statusCode?: number; rawResponseReference?: string }
  | { kind: "permanent_failure"; errorCode: string; safeMessage: string; statusCode?: number; rawResponseReference?: string }
  | { kind: "authentication_failure"; errorCode: string; safeMessage: string; statusCode?: number; rawResponseReference?: string }
  | { kind: "rate_limited"; errorCode: string; safeMessage: string; retryAfter?: string; statusCode?: number; rawResponseReference?: string }
  | { kind: "unknown_outcome"; providerRequestId?: string; errorCode?: string; safeMessage: string; statusCode?: number; rawResponseReference?: string };

export type PublicationReconciliation = {
  id: string;
  publicationId: string;
  targetId: string;
  attemptId: string;
  outboxMessageId: string;
  tenantId: string;
  workspaceId: string;
  providerId: PublicationProvider;
  status: "pending" | "confirmed_published" | "confirmed_not_published" | "inconclusive";
  providerRequestId?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicationReceiptVerification = {
  id: string;
  receiptId: string;
  publicationId: string;
  targetId: string;
  tenantId: string;
  workspaceId: string;
  providerId: PublicationProvider;
  verifiedAt: string;
  verificationStatus: "unverified" | "verified" | "mismatch" | "not_supported";
  externalStatus?: string;
  checksum: string;
  detailsCode?: string;
};

export type PublicationEvent = {
  id: string;
  publicationId: string;
  eventType: PublicationEventType;
  targetId?: string;
  attemptId?: string;
  receiptId?: string;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  createdAt: string;
  payload?: Record<string, unknown>;
};

export type PublicationSchedule = {
  id: string;
  publicationId: string;
  tenantId: string;
  workspaceId: string;
  scheduledAt: string;
  timezone: string;
  status: PublicationScheduleState;
  createdAt: string;
  updatedAt: string;
};

export type PublicationLock = {
  publicationId: string;
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
};

export type PublicationDeadLetter = {
  id: string;
  outboxMessageId?: string;
  publicationId: string;
  targetId?: string;
  providerId?: PublicationProvider;
  tenantId: string;
  workspaceId: string;
  reason: string;
  lastError: PublicationFailure;
  attempts: number;
  lastFailureCode?: string;
  lastSafeMessage?: string;
  deadLetteredAt?: string;
  recoveryStatus?: "pending" | "reprocessed" | "ignored";
  createdAt: string;
};

export type PublicationDetail = {
  plan: PublicationPlan;
  candidates: readonly PublicationCandidate[];
  targets: readonly PublicationTarget[];
  approvals: readonly PublicationApproval[];
  attempts: readonly PublicationAttempt[];
  receipts: readonly PublicationReceipt[];
  events: readonly PublicationEvent[];
  failures: readonly PublicationFailure[];
  schedules: readonly PublicationSchedule[];
  deadLetters: readonly PublicationDeadLetter[];
  outbox: readonly PublicationOutboxMessage[];
  payloadReferences: readonly PublicationPayloadReference[];
  reconciliations: readonly PublicationReconciliation[];
  receiptVerifications: readonly PublicationReceiptVerification[];
};
