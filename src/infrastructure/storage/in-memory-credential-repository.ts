import type { CredentialRepositoryPort } from "../../application/ports/credential-repository.port.js";
import type { Credential, CredentialBinding, CredentialDetail, CredentialHealth, CredentialReference, CredentialRotation, CredentialStatus } from "../../domain/credential/credential.model.js";
import type { PublicationProvider } from "../../domain/publication/publication.model.js";

export class InMemoryCredentialRepository implements CredentialRepositoryPort {
  private readonly credentials = new Map<string, Credential>();
  private readonly references = new Map<string, CredentialReference>();
  private readonly bindings = new Map<string, CredentialBinding>();
  private readonly rotations = new Map<string, CredentialRotation>();
  private readonly health = new Map<string, CredentialHealth>();

  async upsertCredential(input: Omit<Credential, "createdAt" | "updatedAt">): Promise<Credential> {
    const now = new Date().toISOString();
    const existing = this.credentials.get(input.id);
    const credential = { ...input, createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.credentials.set(credential.id, credential);
    return credential;
  }

  async getCredential(input: { tenantId: string; workspaceId: string; credentialId: string }): Promise<CredentialDetail | undefined> {
    const credential = this.credentials.get(input.credentialId);
    if (!credential || credential.tenantId !== input.tenantId || credential.workspaceId !== input.workspaceId) return undefined;
    return this.detail(credential);
  }

  async getCredentialByReference(input: { tenantId: string; workspaceId: string; credentialReferenceId: string }): Promise<CredentialDetail | undefined> {
    const reference = this.references.get(input.credentialReferenceId);
    if (!reference || reference.tenantId !== input.tenantId || reference.workspaceId !== input.workspaceId) return undefined;
    return this.getCredential({ tenantId: input.tenantId, workspaceId: input.workspaceId, credentialId: reference.credentialId });
  }

  async listCredentials(filter: { tenantId: string; workspaceId: string; providerId?: PublicationProvider; status?: CredentialStatus }): Promise<Credential[]> {
    return [...this.credentials.values()].filter((credential) =>
      credential.tenantId === filter.tenantId
      && credential.workspaceId === filter.workspaceId
      && (!filter.providerId || credential.providerId === filter.providerId)
      && (!filter.status || credential.status === filter.status),
    );
  }

  async updateCredentialStatus(input: { tenantId: string; workspaceId: string; credentialId: string; status: CredentialStatus; activeReferenceId?: string; expiresAt?: string; lastHealthCheckAt?: string }): Promise<Credential> {
    const existing = this.credentials.get(input.credentialId);
    if (!existing || existing.tenantId !== input.tenantId || existing.workspaceId !== input.workspaceId) throw new Error("CREDENTIAL_NOT_FOUND: credencial não encontrada.");
    const updated = { ...existing, status: input.status, activeReferenceId: input.activeReferenceId ?? existing.activeReferenceId, expiresAt: input.expiresAt ?? existing.expiresAt, lastHealthCheckAt: input.lastHealthCheckAt ?? existing.lastHealthCheckAt, updatedAt: new Date().toISOString() };
    this.credentials.set(updated.id, updated);
    return updated;
  }

  async upsertReference(input: Omit<CredentialReference, "createdAt" | "updatedAt">): Promise<CredentialReference> {
    const now = new Date().toISOString();
    const existing = this.references.get(input.id);
    const reference = { ...input, createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.references.set(reference.id, reference);
    return reference;
  }

  async listReferences(filter: { tenantId: string; workspaceId: string; credentialId?: string; providerId?: PublicationProvider }): Promise<CredentialReference[]> {
    return [...this.references.values()].filter((reference) =>
      reference.tenantId === filter.tenantId
      && reference.workspaceId === filter.workspaceId
      && (!filter.credentialId || reference.credentialId === filter.credentialId)
      && (!filter.providerId || reference.providerId === filter.providerId),
    );
  }

  async updateReferenceStatus(input: { tenantId: string; workspaceId: string; credentialReferenceId: string; status: CredentialStatus; revokedAt?: string }): Promise<CredentialReference | undefined> {
    const existing = this.references.get(input.credentialReferenceId);
    if (!existing || existing.tenantId !== input.tenantId || existing.workspaceId !== input.workspaceId) return undefined;
    const updated = { ...existing, status: input.status, revokedAt: input.revokedAt ?? existing.revokedAt, updatedAt: new Date().toISOString() };
    this.references.set(updated.id, updated);
    return updated;
  }

  async upsertBinding(input: Omit<CredentialBinding, "createdAt" | "updatedAt">): Promise<CredentialBinding> {
    const now = new Date().toISOString();
    const existing = this.bindings.get(input.id);
    const binding = { ...input, createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.bindings.set(binding.id, binding);
    return binding;
  }

  async listBindings(filter: { tenantId: string; workspaceId: string; credentialId?: string; providerId?: PublicationProvider }): Promise<CredentialBinding[]> {
    return [...this.bindings.values()].filter((binding) =>
      binding.tenantId === filter.tenantId
      && binding.workspaceId === filter.workspaceId
      && (!filter.credentialId || binding.credentialId === filter.credentialId)
      && (!filter.providerId || binding.providerId === filter.providerId),
    );
  }

  async createRotation(input: Omit<CredentialRotation, "createdAt" | "updatedAt">): Promise<CredentialRotation> {
    const now = new Date().toISOString();
    const rotation = { ...input, createdAt: now, updatedAt: now };
    this.rotations.set(rotation.id, rotation);
    return rotation;
  }

  async updateRotation(input: { tenantId: string; workspaceId: string; rotationId: string; status: CredentialRotation["status"]; newCredentialReferenceId?: string; startedAt?: string; completedAt?: string; failureCode?: string }): Promise<CredentialRotation | undefined> {
    const existing = this.rotations.get(input.rotationId);
    if (!existing || existing.tenantId !== input.tenantId || existing.workspaceId !== input.workspaceId) return undefined;
    const updated = { ...existing, status: input.status, newCredentialReferenceId: input.newCredentialReferenceId ?? existing.newCredentialReferenceId, startedAt: input.startedAt ?? existing.startedAt, completedAt: input.completedAt ?? existing.completedAt, failureCode: input.failureCode ?? existing.failureCode, updatedAt: new Date().toISOString() };
    this.rotations.set(updated.id, updated);
    return updated;
  }

  async listRotations(filter: { tenantId: string; workspaceId: string; credentialId?: string }): Promise<CredentialRotation[]> {
    return [...this.rotations.values()].filter((rotation) => rotation.tenantId === filter.tenantId && rotation.workspaceId === filter.workspaceId && (!filter.credentialId || rotation.credentialId === filter.credentialId));
  }

  async recordHealth(input: CredentialHealth): Promise<CredentialHealth> {
    this.health.set(input.credentialId, input);
    return input;
  }

  async getHealth(input: { tenantId: string; workspaceId: string; credentialId: string }): Promise<CredentialHealth | undefined> {
    const health = this.health.get(input.credentialId);
    if (!health || health.tenantId !== input.tenantId || health.workspaceId !== input.workspaceId) return undefined;
    return health;
  }

  private async detail(credential: Credential): Promise<CredentialDetail> {
    return {
      credential,
      references: await this.listReferences({ tenantId: credential.tenantId, workspaceId: credential.workspaceId, credentialId: credential.id }),
      bindings: await this.listBindings({ tenantId: credential.tenantId, workspaceId: credential.workspaceId, credentialId: credential.id }),
      rotations: await this.listRotations({ tenantId: credential.tenantId, workspaceId: credential.workspaceId, credentialId: credential.id }),
      health: await this.getHealth({ tenantId: credential.tenantId, workspaceId: credential.workspaceId, credentialId: credential.id }),
    };
  }
}
