import type { MetaCustomAudience, MetaCustomAudienceRepositoryPort, UpsertMetaCustomAudienceInput } from "../../application/ports/meta-custom-audience-repository.port.js";

function buildId(adAccountId: string, audienceId: string): string {
  return `mca-${adAccountId}-${audienceId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class InMemoryMetaCustomAudienceRepository implements MetaCustomAudienceRepositoryPort {
  private readonly audiences = new Map<string, MetaCustomAudience>();

  async upsertAudience(input: UpsertMetaCustomAudienceInput): Promise<MetaCustomAudience> {
    const id = input.id ?? buildId(input.adAccountId, input.audienceId);
    const now = new Date().toISOString();
    const existing = this.audiences.get(id);
    const record: MetaCustomAudience = { ...input, id, createdAt: existing?.createdAt ?? now, updatedAt: now, lastSyncedAt: now, deletedAt: undefined };
    this.audiences.set(id, record);
    return record;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; adAccountId?: string; includeDeleted?: boolean }): Promise<MetaCustomAudience[]> {
    return [...this.audiences.values()]
      .filter((audience) => audience.tenantId === input.tenantId && audience.workspaceId === input.workspaceId)
      .filter((audience) => !input.adAccountId || audience.adAccountId === input.adAccountId)
      .filter((audience) => input.includeDeleted || !audience.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getById(id: string): Promise<MetaCustomAudience | undefined> {
    return this.audiences.get(id);
  }

  async markDeletedMissing(input: { adAccountId: string; keepAudienceIds: readonly string[] }): Promise<void> {
    const keep = new Set(input.keepAudienceIds);
    for (const [id, audience] of this.audiences) {
      if (audience.adAccountId !== input.adAccountId || audience.deletedAt || keep.has(audience.audienceId)) continue;
      this.audiences.set(id, { ...audience, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
  }
}
