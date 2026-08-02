import type { PublicationProvider } from "../publication/publication.model.js";
import type { TenantRole } from "../identity/identity.model.js";

export const CREDENTIAL_STATUSES = ["pending", "connected", "expiring", "expired", "revoked", "invalid", "disabled", "rotation_pending"] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export type CredentialEnvironment = "sandbox" | "production";

export type Credential = {
  id: string;
  tenantId: string;
  workspaceId: string;
  providerId: PublicationProvider;
  environment: CredentialEnvironment;
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
  tenantId: string;
  workspaceId: string;
  providerId: PublicationProvider;
  environment: CredentialEnvironment;
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
  tenantId: string;
  workspaceId: string;
  providerId: PublicationProvider;
  environment: CredentialEnvironment;
  canary: boolean;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

export type CredentialRotation = {
  id: string;
  credentialId: string;
  tenantId: string;
  workspaceId: string;
  providerId: PublicationProvider;
  oldCredentialReferenceId?: string;
  newCredentialReferenceId?: string;
  mode: "manual" | "scheduled";
  status: "scheduled" | "running" | "completed" | "failed" | "cancelled";
  reason: string;
  actorUserId: string;
  scheduledFor?: string;
  startedAt?: string;
  completedAt?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
};

export type CredentialPolicy = {
  credentialId: string;
  requiredScopes: readonly string[];
  maxAgeDays?: number;
  rotationIntervalDays?: number;
  allowProduction: boolean;
};

export type CredentialHealth = {
  credentialId: string;
  credentialReferenceId?: string;
  tenantId: string;
  workspaceId: string;
  providerId: PublicationProvider;
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
  safeMessage?: string;
};

export type CredentialDetail = {
  credential: Credential;
  references: readonly CredentialReference[];
  bindings: readonly CredentialBinding[];
  rotations: readonly CredentialRotation[];
  health?: CredentialHealth;
};

export type AuditActor = {
  userId: string;
  role: TenantRole;
  sessionId?: string;
};

export type AuditResource = {
  type: "credential" | "credential_reference" | "publication" | "provider" | "policy" | "canary" | "audit" | "compliance" | "rbac" | "schedule" | "schedule_occurrence" | "schedule_dead_letter" | "scheduling" | "analytics" | "analytics_export" | "analytics_snapshot" | "analytics_alert" | "analytics_dead_letter" | "system";
  id: string;
  providerId?: PublicationProvider;
};

export type AuditContext = {
  requestId?: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
};

export type AuditResult = {
  status: "success" | "failure" | "denied";
  code?: string;
  safeMessage?: string;
};

export type AuditEvent = {
  id: string;
  tenantId: string;
  workspaceId?: string;
  eventType: string;
  actor: AuditActor;
  resource: AuditResource;
  context: AuditContext;
  result: AuditResult;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type ComplianceCheck = {
  id: string;
  status: "pass" | "warn" | "fail";
  category: "lgpd" | "retention" | "anonymization" | "secrets" | "logs" | "payloads" | "tokens";
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
