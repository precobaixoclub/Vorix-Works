import type { MetaAd, MetaAdRepositoryPort, UpsertMetaAdInput } from "../../application/ports/meta-ad-repository.port.js";

function buildId(adAccountId: string, adId: string): string {
  return `ma-${adAccountId}-${adId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class InMemoryMetaAdRepository implements MetaAdRepositoryPort {
  private readonly ads = new Map<string, MetaAd>();

  async upsertAd(input: UpsertMetaAdInput): Promise<MetaAd> {
    const id = input.id ?? buildId(input.adAccountId, input.adId);
    const now = new Date().toISOString();
    const existing = this.ads.get(id);
    const record: MetaAd = { ...input, id, createdAt: existing?.createdAt ?? now, updatedAt: now, lastSyncedAt: now, deletedAt: undefined };
    this.ads.set(id, record);
    return record;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; adSetId?: string; campaignId?: string; adAccountId?: string; includeDeleted?: boolean }): Promise<MetaAd[]> {
    return [...this.ads.values()]
      .filter((ad) => ad.tenantId === input.tenantId && ad.workspaceId === input.workspaceId)
      .filter((ad) => !input.adSetId || ad.adSetId === input.adSetId)
      .filter((ad) => !input.campaignId || ad.campaignId === input.campaignId)
      .filter((ad) => !input.adAccountId || ad.adAccountId === input.adAccountId)
      .filter((ad) => input.includeDeleted || !ad.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getById(id: string): Promise<MetaAd | undefined> {
    return this.ads.get(id);
  }

  async markDeletedMissing(input: { adAccountId: string; keepAdIds: readonly string[] }): Promise<void> {
    const keep = new Set(input.keepAdIds);
    for (const [id, ad] of this.ads) {
      if (ad.adAccountId !== input.adAccountId || ad.deletedAt || keep.has(ad.adId)) continue;
      this.ads.set(id, { ...ad, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
  }
}
