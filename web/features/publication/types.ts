export type PublicationState = "draft" | "waiting_for_approval" | "approved" | "publishing" | "published" | "failed" | "cancelled" | "superseded" | "unknown_outcome";
export type PublicationMode = "dry_run" | "real";

export type PublicationPlan = {
  id: string;
  tenantId: string;
  workspaceId: string;
  state: PublicationState;
  mode: PublicationMode;
  idempotencyKey: string;
  sourceExecutionRunId?: string;
  sourceArtifacts: readonly Record<string, unknown>[];
  policy: Record<string, unknown>;
  correlationId: string;
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

export type PublicationTarget = {
  id: string;
  publicationId: string;
  channel: string;
  provider: string;
  mode: PublicationMode;
  status: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicationReceipt = {
  id: string;
  publicationId: string;
  targetId: string;
  provider: string;
  providerPublicationId: string;
  providerRequestId?: string;
  externalIdentifiers?: Record<string, string>;
  channel: string;
  publishedAt: string;
  status: string;
  url: string;
  checksum: string;
  correlationId: string;
  traceId: string;
  createdAt: string;
};

export type PublicationOutboxMessage = {
  outboxMessageId: string;
  publicationId: string;
  targetId: string;
  providerId: string;
  idempotencyKey: string;
  payloadReference: string;
  status: string;
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

export type PublicationReconciliation = {
  id: string;
  publicationId: string;
  targetId: string;
  providerId: string;
  status: string;
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
  providerId: string;
  verifiedAt: string;
  verificationStatus: string;
  externalStatus?: string;
  checksum: string;
  detailsCode?: string;
};

export type PublicationDeadLetter = {
  id: string;
  outboxMessageId?: string;
  publicationId: string;
  targetId?: string;
  providerId?: string;
  reason: string;
  attempts: number;
  lastFailureCode?: string;
  lastSafeMessage?: string;
  deadLetteredAt?: string;
  recoveryStatus?: string;
  createdAt: string;
};

export type PublicationEvent = {
  id: string;
  publicationId: string;
  eventType: string;
  targetId?: string;
  attemptId?: string;
  receiptId?: string;
  traceId?: string;
  createdAt: string;
  payload?: Record<string, unknown>;
};

export type PublicationDetail = {
  plan: PublicationPlan;
  candidates: readonly Record<string, unknown>[];
  targets: readonly PublicationTarget[];
  approvals: readonly Record<string, unknown>[];
  attempts: readonly Record<string, unknown>[];
  receipts: readonly PublicationReceipt[];
  events: readonly PublicationEvent[];
  failures: readonly Record<string, unknown>[];
  schedules: readonly Record<string, unknown>[];
  deadLetters: readonly PublicationDeadLetter[];
  outbox: readonly PublicationOutboxMessage[];
  payloadReferences: readonly Record<string, unknown>[];
  reconciliations: readonly PublicationReconciliation[];
  receiptVerifications: readonly PublicationReceiptVerification[];
};

export type PublicationQueue = { size: number; jobs: readonly Record<string, unknown>[] };
export type PublicationMetrics = Record<string, number>;
export type PublicationProviderDescriptor = {
  providerId: string;
  providerVersion: string;
  displayName: string;
  enabled: boolean;
  status?: "enabled" | "disabled" | "sandbox_only" | "degraded";
  oauthType?: "none" | "oauth2_auth_code" | "oauth2_pkce" | "oauth1a" | "manual";
  supportedChannels: readonly string[];
  supportedContentTypes: readonly string[];
  capabilities?: {
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
  supportsIdempotencyKey: boolean;
  supportsStatusLookup: boolean;
  supportsDelete: boolean;
  supportsUpdate: boolean;
  supportsScheduling: boolean;
  supportsReceiptVerification: boolean;
  maxPayloadBytes: number;
  maxAssets: number;
};

export type PublicationProviderHealth = {
  providerId: string;
  enabled: boolean;
  ok: boolean;
  safeMessage?: string;
  rateLimit?: {
    limit?: number;
    remaining?: number;
    resetAt?: string;
  };
};

export type PublicationProviderCredentialReference = {
  credentialReferenceId: string;
  providerId: string;
  status: string;
  environment?: "sandbox" | "production";
  providerSubjectId?: string;
  scopes?: readonly string[];
  expiresAt?: string;
  lastRefreshedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type MetaPagesOAuthStatus = {
  connected: boolean;
  providerId: "meta_pages_sandbox";
  credentialReferences: readonly PublicationProviderCredentialReference[];
  telemetry: {
    oauthSuccess: number;
    oauthFailure: number;
    tokenRefreshSuccess: number;
    tokenRefreshFailure: number;
    lastFailureCode?: string;
  };
};

export type MetaPagesOAuthBegin = {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
};

export type MetaPagesOAuthComplete = {
  credentialReferenceId: string;
  providerSubjectId: string;
  expiresAt?: string;
};
