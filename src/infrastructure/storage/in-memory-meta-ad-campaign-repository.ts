import type { MetaAdCampaign, MetaAdCampaignRepositoryPort, UpsertMetaAdCampaignInput } from "../../application/ports/meta-ad-campaign-repository.port.js";

function buildId(adAccountId: string, campaignId: string): string {
  return `mac-${adAccountId}-${campaignId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class InMemoryMetaAdCampaignRepository implements MetaAdCampaignRepositoryPort {
  private readonly campaigns = new Map<string, MetaAdCampaign>();

  async upsertCampaign(input: UpsertMetaAdCampaignInput): Promise<MetaAdCampaign> {
    const id = input.id ?? buildId(input.adAccountId, input.campaignId);
    const now = new Date().toISOString();
    const existing = this.campaigns.get(id);
    const record: MetaAdCampaign = { ...input, id, createdAt: existing?.createdAt ?? now, updatedAt: now, lastSyncedAt: now, deletedAt: undefined };
    this.campaigns.set(id, record);
    return record;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; adAccountId?: string; includeDeleted?: boolean }): Promise<MetaAdCampaign[]> {
    return [...this.campaigns.values()]
      .filter((campaign) => campaign.tenantId === input.tenantId && campaign.workspaceId === input.workspaceId)
      .filter((campaign) => !input.adAccountId || campaign.adAccountId === input.adAccountId)
      .filter((campaign) => input.includeDeleted || !campaign.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getById(id: string): Promise<MetaAdCampaign | undefined> {
    return this.campaigns.get(id);
  }

  async markDeletedMissing(input: { adAccountId: string; keepCampaignIds: readonly string[] }): Promise<void> {
    const keep = new Set(input.keepCampaignIds);
    for (const [id, campaign] of this.campaigns) {
      if (campaign.adAccountId !== input.adAccountId || campaign.deletedAt || keep.has(campaign.campaignId)) continue;
      this.campaigns.set(id, { ...campaign, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
  }
}
