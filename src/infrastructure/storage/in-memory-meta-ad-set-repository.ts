import type { MetaAdSet, MetaAdSetRepositoryPort, UpsertMetaAdSetInput } from "../../application/ports/meta-ad-set-repository.port.js";

function buildId(adAccountId: string, adSetId: string): string {
  return `mas-${adAccountId}-${adSetId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class InMemoryMetaAdSetRepository implements MetaAdSetRepositoryPort {
  private readonly adSets = new Map<string, MetaAdSet>();

  async upsertAdSet(input: UpsertMetaAdSetInput): Promise<MetaAdSet> {
    const id = input.id ?? buildId(input.adAccountId, input.adSetId);
    const now = new Date().toISOString();
    const existing = this.adSets.get(id);
    const record: MetaAdSet = { ...input, id, createdAt: existing?.createdAt ?? now, updatedAt: now, lastSyncedAt: now, deletedAt: undefined };
    this.adSets.set(id, record);
    return record;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; campaignId?: string; adAccountId?: string; includeDeleted?: boolean }): Promise<MetaAdSet[]> {
    return [...this.adSets.values()]
      .filter((adSet) => adSet.tenantId === input.tenantId && adSet.workspaceId === input.workspaceId)
      .filter((adSet) => !input.campaignId || adSet.campaignId === input.campaignId)
      .filter((adSet) => !input.adAccountId || adSet.adAccountId === input.adAccountId)
      .filter((adSet) => input.includeDeleted || !adSet.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getById(id: string): Promise<MetaAdSet | undefined> {
    return this.adSets.get(id);
  }

  async markDeletedMissing(input: { adAccountId: string; keepAdSetIds: readonly string[] }): Promise<void> {
    const keep = new Set(input.keepAdSetIds);
    for (const [id, adSet] of this.adSets) {
      if (adSet.adAccountId !== input.adAccountId || adSet.deletedAt || keep.has(adSet.adSetId)) continue;
      this.adSets.set(id, { ...adSet, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
  }
}
