import type {
  CreateMetaAdsCredentialReferenceInput,
  MetaAdsCredentialReference,
  MetaAdsCredentialRepositoryPort,
  MetaAdsCredentialStatus,
} from "../../application/ports/meta-ads-credential-repository.port.js";

export class InMemoryMetaAdsCredentialRepository implements MetaAdsCredentialRepositoryPort {
  private readonly references = new Map<string, MetaAdsCredentialReference>();

  async upsertCredentialReference(input: CreateMetaAdsCredentialReferenceInput): Promise<MetaAdsCredentialReference> {
    const now = new Date().toISOString();
    const existing = this.references.get(input.credentialReferenceId);
    const record: MetaAdsCredentialReference = { ...input, createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.references.set(input.credentialReferenceId, record);
    return record;
  }

  async getCredentialReference(credentialReferenceId: string): Promise<MetaAdsCredentialReference | undefined> {
    return this.references.get(credentialReferenceId);
  }

  async listCredentialReferencesByWorkspace(input: { tenantId: string; workspaceId: string }): Promise<MetaAdsCredentialReference[]> {
    return [...this.references.values()]
      .filter((reference) => reference.tenantId === input.tenantId && reference.workspaceId === input.workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateStatus(credentialReferenceId: string, status: MetaAdsCredentialStatus): Promise<void> {
    const existing = this.references.get(credentialReferenceId);
    if (!existing) return;
    this.references.set(credentialReferenceId, {
      ...existing,
      status,
      revokedAt: status === "revoked" ? new Date().toISOString() : existing.revokedAt,
      updatedAt: new Date().toISOString(),
    });
  }

  async touchLastRefreshed(credentialReferenceId: string, expiresAt?: string): Promise<void> {
    const existing = this.references.get(credentialReferenceId);
    if (!existing) return;
    this.references.set(credentialReferenceId, {
      ...existing,
      lastRefreshedAt: new Date().toISOString(),
      expiresAt: expiresAt ?? existing.expiresAt,
      updatedAt: new Date().toISOString(),
    });
  }
}
