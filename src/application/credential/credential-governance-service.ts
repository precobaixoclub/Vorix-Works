import type { CredentialRepositoryPort } from "../ports/credential-repository.port.js";
import type { OperationalAuditRepositoryPort } from "../ports/operational-audit-repository.port.js";
import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { PublicationSecretStoragePort } from "../publication/publication-secret-store.js";
import type { AuditActor, AuditContext, AuditEvent, Credential, CredentialDetail, CredentialHealth, CredentialReference, CredentialStatus } from "../../domain/credential/credential.model.js";
import type { PublicationProvider } from "../../domain/publication/publication.model.js";

export type CredentialGovernanceActor = AuditActor & { tenantId: string };

export type CredentialGovernanceServiceDeps = {
  credentialRepository: CredentialRepositoryPort;
  auditRepository: OperationalAuditRepositoryPort;
  publicationRepository: PublicationRepositoryPort;
  secretStore: PublicationSecretStoragePort;
  idGenerator: () => string;
  requiredScopes: readonly string[] | Partial<Record<PublicationProvider, readonly string[]>>;
};

export class CredentialGovernanceService {
  constructor(private readonly deps: CredentialGovernanceServiceDeps) {}

  async registerOAuthCredential(input: {
    tenantId: string;
    workspaceId: string;
    providerId: PublicationProvider;
    environment: "sandbox" | "production";
    credentialReferenceId: string;
    providerSubjectId: string;
    grantedScopes: readonly string[];
    expiresAt?: string;
    actor?: CredentialGovernanceActor;
    context?: AuditContext;
  }): Promise<CredentialDetail> {
    const requiredScopes = requiredScopesFor(this.deps.requiredScopes, input.providerId);
    const missingScopes = requiredScopes.filter((scope) => !input.grantedScopes.includes(scope));
    const credentialId = credentialIdFor(input.tenantId, input.workspaceId, input.providerId);
    const status = statusFromExpiry(input.expiresAt, missingScopes);
    await this.deps.credentialRepository.upsertCredential({
      id: credentialId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      environment: input.environment,
      status,
      activeReferenceId: input.credentialReferenceId,
      providerSubjectId: input.providerSubjectId,
      requiredScopes,
      grantedScopes: input.grantedScopes,
      missingScopes,
      expiresAt: input.expiresAt,
    });
    await this.deps.credentialRepository.upsertReference({
      id: input.credentialReferenceId,
      credentialId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      environment: input.environment,
      status,
      providerSubjectId: input.providerSubjectId,
      grantedScopes: input.grantedScopes,
      requiredScopes,
      missingScopes,
      expiresAt: input.expiresAt,
      lastRefreshedAt: new Date().toISOString(),
    });
    await this.deps.credentialRepository.upsertBinding({
      id: `${credentialId}:binding:${input.environment}`,
      credentialId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      environment: input.environment,
      canary: input.environment === "sandbox",
      status: "active",
    });
    await this.mirrorPublicationReference({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: input.providerId, credentialReferenceId: input.credentialReferenceId, status, environment: input.environment, providerSubjectId: input.providerSubjectId, scopes: input.grantedScopes, expiresAt: input.expiresAt });
    await this.forceHealthCheck({ tenantId: input.tenantId, workspaceId: input.workspaceId, credentialId, actor: input.actor, context: input.context, audit: false });
    if (input.actor) {
      await this.audit({ tenantId: input.tenantId, workspaceId: input.workspaceId, eventType: "credential.oauth.connected", actor: input.actor, resource: { type: "credential", id: credentialId, providerId: input.providerId }, context: input.context, result: { status: "success" }, metadata: { credentialReferenceId: input.credentialReferenceId, providerSubjectId: input.providerSubjectId, missingScopes } });
    }
    const detail = await this.deps.credentialRepository.getCredential({ tenantId: input.tenantId, workspaceId: input.workspaceId, credentialId });
    if (!detail) throw new Error("CREDENTIAL_NOT_FOUND: credencial OAuth não foi persistida.");
    return detail;
  }

  async list(input: { tenantId: string; workspaceId: string; providerId?: PublicationProvider }): Promise<Credential[]> {
    return this.deps.credentialRepository.listCredentials(input);
  }

  async get(input: { tenantId: string; workspaceId: string; credentialId: string }): Promise<CredentialDetail> {
    const detail = await this.deps.credentialRepository.getCredential(input);
    if (!detail) throw new Error("CREDENTIAL_NOT_FOUND: credencial não encontrada.");
    return detail;
  }

  async rotate(input: { tenantId: string; workspaceId: string; credentialId: string; actor: CredentialGovernanceActor; reason: string; context?: AuditContext }): Promise<CredentialDetail> {
    const detail = await this.get(input);
    const active = activeReference(detail);
    if (!active) {
      await this.audit({ tenantId: input.tenantId, workspaceId: input.workspaceId, eventType: "credential.rotate", actor: input.actor, resource: { type: "credential", id: input.credentialId, providerId: detail.credential.providerId }, context: input.context, result: { status: "failure", code: "CREDENTIAL_REFERENCE_MISSING", safeMessage: "Credencial sem reference ativa." } });
      throw new Error("CREDENTIAL_REFERENCE_MISSING: credencial sem reference ativa.");
    }
    const rotationId = this.deps.idGenerator();
    await this.deps.credentialRepository.createRotation({ id: rotationId, credentialId: detail.credential.id, tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: detail.credential.providerId, oldCredentialReferenceId: active.id, mode: "manual", status: "running", reason: input.reason, actorUserId: input.actor.userId, startedAt: new Date().toISOString() });
    const secret = await this.deps.secretStore.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: detail.credential.providerId, credentialReferenceId: active.id });
    if (!secret) {
      await this.deps.credentialRepository.updateRotation({ tenantId: input.tenantId, workspaceId: input.workspaceId, rotationId, status: "failed", failureCode: "SECRET_NOT_FOUND", completedAt: new Date().toISOString() });
      await this.audit({ tenantId: input.tenantId, workspaceId: input.workspaceId, eventType: "credential.rotate", actor: input.actor, resource: { type: "credential", id: input.credentialId, providerId: detail.credential.providerId }, context: input.context, result: { status: "failure", code: "SECRET_NOT_FOUND", safeMessage: "Secret store não contém a credencial ativa." }, metadata: { rotationId } });
      throw new Error("SECRET_NOT_FOUND: secret store não contém a credencial ativa.");
    }
    const newReferenceId = `${detail.credential.id}:reference:${Date.now().toString(36)}:${this.deps.idGenerator()}`;
    await this.deps.secretStore.put({ ...secret, tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: newReferenceId, value: { ...secret.value, rotatedAt: new Date().toISOString() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await this.deps.credentialRepository.updateReferenceStatus({ tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: active.id, status: "revoked", revokedAt: new Date().toISOString() });
    await this.mirrorPublicationReference({ ...referenceMirrorInput(active), status: "revoked", revokedAt: new Date().toISOString() });
    await this.deps.credentialRepository.upsertReference({ ...stripReferenceTimestamps(active), id: newReferenceId, status: "connected", lastRefreshedAt: new Date().toISOString(), revokedAt: undefined });
    await this.deps.credentialRepository.updateCredentialStatus({ tenantId: input.tenantId, workspaceId: input.workspaceId, credentialId: detail.credential.id, status: "connected", activeReferenceId: newReferenceId, expiresAt: active.expiresAt });
    await this.mirrorPublicationReference({ ...referenceMirrorInput(active), credentialReferenceId: newReferenceId, status: "connected" });
    await this.deps.credentialRepository.updateRotation({ tenantId: input.tenantId, workspaceId: input.workspaceId, rotationId, status: "completed", newCredentialReferenceId: newReferenceId, completedAt: new Date().toISOString() });
    await this.forceHealthCheck({ tenantId: input.tenantId, workspaceId: input.workspaceId, credentialId: detail.credential.id, actor: input.actor, context: input.context, audit: false });
    await this.audit({ tenantId: input.tenantId, workspaceId: input.workspaceId, eventType: "credential.rotate", actor: input.actor, resource: { type: "credential", id: input.credentialId, providerId: detail.credential.providerId }, context: input.context, result: { status: "success" }, metadata: { rotationId, oldCredentialReferenceId: active.id, newCredentialReferenceId: newReferenceId } });
    return this.get(input);
  }

  async scheduleRotation(input: { tenantId: string; workspaceId: string; credentialId: string; actor: CredentialGovernanceActor; reason: string; scheduledFor: string; context?: AuditContext }): Promise<CredentialDetail> {
    const detail = await this.get(input);
    await this.deps.credentialRepository.createRotation({ id: this.deps.idGenerator(), credentialId: detail.credential.id, tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: detail.credential.providerId, oldCredentialReferenceId: detail.credential.activeReferenceId, mode: "scheduled", status: "scheduled", reason: input.reason, actorUserId: input.actor.userId, scheduledFor: input.scheduledFor });
    await this.deps.credentialRepository.updateCredentialStatus({ tenantId: input.tenantId, workspaceId: input.workspaceId, credentialId: input.credentialId, status: "rotation_pending" });
    await this.audit({ tenantId: input.tenantId, workspaceId: input.workspaceId, eventType: "credential.rotation_scheduled", actor: input.actor, resource: { type: "credential", id: input.credentialId, providerId: detail.credential.providerId }, context: input.context, result: { status: "success" }, metadata: { scheduledFor: input.scheduledFor } });
    return this.get(input);
  }

  async revoke(input: { tenantId: string; workspaceId: string; credentialId: string; actor: CredentialGovernanceActor; reason: string; context?: AuditContext }): Promise<CredentialDetail> {
    return this.setStatusWithReference(input, "revoked", "credential.revoke");
  }

  async disable(input: { tenantId: string; workspaceId: string; credentialId: string; actor: CredentialGovernanceActor; reason: string; context?: AuditContext }): Promise<CredentialDetail> {
    return this.setStatusWithReference(input, "disabled", "credential.disable");
  }

  async enable(input: { tenantId: string; workspaceId: string; credentialId: string; actor: CredentialGovernanceActor; reason: string; context?: AuditContext }): Promise<CredentialDetail> {
    return this.setStatusWithReference(input, "connected", "credential.enable");
  }

  async forceHealthCheck(input: { tenantId: string; workspaceId: string; credentialId: string; actor?: CredentialGovernanceActor; context?: AuditContext; audit?: boolean }): Promise<CredentialHealth> {
    const detail = await this.get(input);
    const active = activeReference(detail);
    const secret = active ? await this.deps.secretStore.get({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: detail.credential.providerId, credentialReferenceId: active.id }) : undefined;
    const now = new Date();
    const expiresAt = active?.expiresAt ?? detail.credential.expiresAt;
    const expired = !!expiresAt && new Date(expiresAt).getTime() <= now.getTime();
    const expiring = !!expiresAt && !expired && new Date(expiresAt).getTime() - now.getTime() <= 7 * 24 * 60 * 60 * 1000;
    const missingScopes = (active?.requiredScopes ?? detail.credential.requiredScopes).filter((scope) => !(active?.grantedScopes ?? detail.credential.grantedScopes).includes(scope));
    const tokenValid = !!secret && !expired && missingScopes.length === 0 && !["revoked", "disabled", "invalid"].includes(detail.credential.status);
    const status: CredentialStatus = detail.credential.status === "revoked" || detail.credential.status === "disabled"
      ? detail.credential.status
      : !secret ? "invalid" : expired ? "expired" : expiring ? "expiring" : missingScopes.length > 0 ? "invalid" : "connected";
    const health = await this.deps.credentialRepository.recordHealth({
      credentialId: detail.credential.id,
      credentialReferenceId: active?.id,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      providerId: detail.credential.providerId,
      status,
      connected: status === "connected" || status === "expiring",
      tokenValid,
      expiresAt,
      expiring,
      expired,
      grantedScopes: active?.grantedScopes ?? detail.credential.grantedScopes,
      requiredScopes: active?.requiredScopes ?? detail.credential.requiredScopes,
      missingScopes,
      providerSubjectId: active?.providerSubjectId ?? detail.credential.providerSubjectId,
      lastSyncedAt: active?.lastRefreshedAt,
      checkedAt: now.toISOString(),
      safeMessage: tokenValid ? "Credencial operacional." : "Credencial requer atenção operacional.",
    });
    await this.deps.credentialRepository.updateCredentialStatus({ tenantId: input.tenantId, workspaceId: input.workspaceId, credentialId: detail.credential.id, status, lastHealthCheckAt: health.checkedAt });
    if (input.actor && input.audit !== false) {
      await this.audit({ tenantId: input.tenantId, workspaceId: input.workspaceId, eventType: "credential.health_check", actor: input.actor, resource: { type: "credential", id: detail.credential.id, providerId: detail.credential.providerId }, context: input.context, result: { status: tokenValid ? "success" : "failure", code: tokenValid ? undefined : "CREDENTIAL_HEALTH_ATTENTION" }, metadata: { missingScopes, expired, expiring } });
    }
    return health;
  }

  async exportHistory(input: { tenantId: string; workspaceId: string; credentialId: string; format: "json" | "csv" }): Promise<{ contentType: string; body: string }> {
    const detail = await this.get(input);
    if (input.format === "json") return { contentType: "application/json", body: JSON.stringify(detail, null, 2) };
    const rows = [
      "kind,id,status,createdAt,updatedAt",
      `credential,${detail.credential.id},${detail.credential.status},${detail.credential.createdAt},${detail.credential.updatedAt}`,
      ...detail.references.map((reference) => `reference,${reference.id},${reference.status},${reference.createdAt},${reference.updatedAt}`),
      ...detail.rotations.map((rotation) => `rotation,${rotation.id},${rotation.status},${rotation.createdAt},${rotation.updatedAt}`),
    ];
    return { contentType: "text/csv", body: rows.join("\n") };
  }

  private async setStatusWithReference(input: { tenantId: string; workspaceId: string; credentialId: string; actor: CredentialGovernanceActor; reason: string; context?: AuditContext }, status: CredentialStatus, eventType: string): Promise<CredentialDetail> {
    const detail = await this.get(input);
    const active = activeReference(detail);
    const revokedAt = status === "revoked" ? new Date().toISOString() : undefined;
    await this.deps.credentialRepository.updateCredentialStatus({ tenantId: input.tenantId, workspaceId: input.workspaceId, credentialId: input.credentialId, status });
    if (active) {
      await this.deps.credentialRepository.updateReferenceStatus({ tenantId: input.tenantId, workspaceId: input.workspaceId, credentialReferenceId: active.id, status, revokedAt });
      await this.mirrorPublicationReference({ ...referenceMirrorInput(active), status, revokedAt });
      if (status === "revoked") await this.deps.secretStore.delete({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: active.providerId, credentialReferenceId: active.id });
    }
    await this.forceHealthCheck({ tenantId: input.tenantId, workspaceId: input.workspaceId, credentialId: input.credentialId, actor: input.actor, context: input.context, audit: false });
    await this.audit({ tenantId: input.tenantId, workspaceId: input.workspaceId, eventType, actor: input.actor, resource: { type: "credential", id: input.credentialId, providerId: detail.credential.providerId }, context: { ...input.context, reason: input.reason }, result: { status: "success" }, metadata: { credentialReferenceId: active?.id } });
    return this.get(input);
  }

  private async mirrorPublicationReference(input: { tenantId: string; workspaceId: string; providerId: PublicationProvider; credentialReferenceId: string; status: CredentialStatus; environment?: "sandbox" | "production"; providerSubjectId?: string; scopes?: readonly string[]; expiresAt?: string; revokedAt?: string }): Promise<void> {
    await this.deps.publicationRepository.createCredentialReference({
      credentialReferenceId: input.credentialReferenceId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      status: publicationReferenceStatus(input.status),
      environment: input.environment,
      providerSubjectId: input.providerSubjectId,
      scopes: input.scopes,
      expiresAt: input.expiresAt,
      lastRefreshedAt: new Date().toISOString(),
      revokedAt: input.revokedAt,
    });
  }

  private async audit(input: Omit<AuditEvent, "id" | "createdAt" | "context"> & { context?: AuditContext }): Promise<void> {
    await this.deps.auditRepository.record({ id: this.deps.idGenerator(), ...input, context: input.context ?? {} });
  }
}

function requiredScopesFor(scopes: readonly string[] | Partial<Record<PublicationProvider, readonly string[]>>, providerId: PublicationProvider): readonly string[] {
  if (Array.isArray(scopes)) return scopes;
  const byProvider = scopes as Partial<Record<PublicationProvider, readonly string[]>>;
  return byProvider[providerId] ?? [];
}

function credentialIdFor(tenantId: string, workspaceId: string, providerId: PublicationProvider): string {
  return `credential:${tenantId}:${workspaceId}:${providerId}`;
}

function statusFromExpiry(expiresAt: string | undefined, missingScopes: readonly string[]): CredentialStatus {
  if (missingScopes.length > 0) return "invalid";
  if (!expiresAt) return "connected";
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return "expired";
  return remaining <= 7 * 24 * 60 * 60 * 1000 ? "expiring" : "connected";
}

function publicationReferenceStatus(status: CredentialStatus): "active" | "disabled" | "revoked" {
  if (status === "revoked" || status === "expired" || status === "invalid") return "revoked";
  if (status === "disabled" || status === "rotation_pending") return "disabled";
  return "active";
}

function activeReference(detail: CredentialDetail): CredentialReference | undefined {
  return detail.references.find((reference) => reference.id === detail.credential.activeReferenceId) ?? detail.references.find((reference) => reference.status === "connected" || reference.status === "expiring");
}

function stripReferenceTimestamps(reference: CredentialReference): Omit<CredentialReference, "createdAt" | "updatedAt"> {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = reference;
  return rest;
}

function referenceMirrorInput(reference: CredentialReference): { tenantId: string; workspaceId: string; providerId: PublicationProvider; credentialReferenceId: string; environment: "sandbox" | "production"; providerSubjectId?: string; scopes: readonly string[]; expiresAt?: string; revokedAt?: string } {
  return { tenantId: reference.tenantId, workspaceId: reference.workspaceId, providerId: reference.providerId, credentialReferenceId: reference.id, environment: reference.environment, providerSubjectId: reference.providerSubjectId, scopes: reference.grantedScopes, expiresAt: reference.expiresAt, revokedAt: reference.revokedAt };
}
