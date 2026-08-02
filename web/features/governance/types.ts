export type CredentialStatus = "pending" | "connected" | "expiring" | "expired" | "revoked" | "invalid" | "disabled" | "rotation_pending";

export type Credential = {
  id: string;
  tenantId: string;
  workspaceId: string;
  providerId: string;
  environment: "sandbox" | "production";
  status: CredentialStatus;
  activeReferenceId?: string;
  providerSubjectId?: string;
  requiredScopes: readonly string[];
  grantedScopes: readonly string[];
  missingScopes: readonly string[];
  expiresAt?: string;
  lastHealthCheckAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CredentialReference = {
  id: string;
  credentialId: string;
  providerId: string;
  environment: "sandbox" | "production";
  status: CredentialStatus;
  providerSubjectId?: string;
  grantedScopes: readonly string[];
  requiredScopes: readonly string[];
  missingScopes: readonly string[];
  expiresAt?: string;
  lastRefreshedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CredentialBinding = {
  id: string;
  credentialId: string;
  providerId: string;
  environment: "sandbox" | "production";
  canary: boolean;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

export type CredentialRotation = {
  id: string;
  credentialId: string;
  providerId: string;
  oldCredentialReferenceId?: string;
  newCredentialReferenceId?: string;
  mode: "manual" | "scheduled";
  status: "scheduled" | "running" | "completed" | "failed" | "cancelled";
  reason?: string;
  actorUserId?: string;
  scheduledFor?: string;
  startedAt?: string;
  completedAt?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
};

export type CredentialHealth = {
  credentialId: string;
  credentialReferenceId?: string;
  providerId: string;
  status: CredentialStatus;
  connected: boolean;
  tokenValid: boolean;
  expiresAt?: string;
  expiring: boolean;
  expired: boolean;
  grantedScopes: readonly string[];
  requiredScopes: readonly string[];
  missingScopes: readonly string[];
  providerSubjectId?: string;
  lastSyncedAt?: string;
  checkedAt: string;
  safeMessage: string;
};

export type CredentialDetail = {
  credential: Credential;
  references: readonly CredentialReference[];
  bindings: readonly CredentialBinding[];
  rotations: readonly CredentialRotation[];
  health?: CredentialHealth;
};

export type AuditEvent = {
  id: string;
  tenantId: string;
  workspaceId?: string;
  eventType: string;
  actor: { userId: string; role: string; sessionId?: string };
  resource: { type: string; id: string; providerId?: string };
  context?: Record<string, unknown>;
  result: { status: "success" | "failure" | "denied"; code?: string; safeMessage?: string };
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type ComplianceCheck = {
  id: string;
  category: string;
  status: "pass" | "warn" | "fail";
  safeMessage: string;
  evidence?: Record<string, unknown>;
};

export type ComplianceReport = {
  tenantId: string;
  workspaceId: string;
  generatedAt: string;
  overallStatus: "pass" | "warn" | "fail";
  checks: readonly ComplianceCheck[];
};

export type ExportResult = { contentType: string; body: string };
