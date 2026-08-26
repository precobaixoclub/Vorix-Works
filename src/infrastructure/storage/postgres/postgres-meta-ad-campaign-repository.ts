import type { Pool } from "pg";
import type { MetaAdCampaign, MetaAdCampaignRepositoryPort, MetaAdEntityStatus, UpsertMetaAdCampaignInput } from "../../../application/ports/meta-ad-campaign-repository.port.js";

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  ad_account_id: string;
  campaign_id: string;
  name: string;
  objective: string | null;
  status: string;
  effective_status: string | null;
  buying_type: string | null;
  special_ad_categories: string[] | null;
  daily_budget: string | null;
  lifetime_budget: string | null;
  budget_remaining: string | null;
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  reach: string | null;
  insights: unknown;
  start_time: Date | null;
  stop_time: Date | null;
  meta_created_time: Date | null;
  last_synced_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: Row): MetaAdCampaign {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    adAccountId: row.ad_account_id,
    campaignId: row.campaign_id,
    name: row.name,
    objective: row.objective ?? undefined,
    status: row.status as MetaAdEntityStatus,
    effectiveStatus: row.effective_status ?? undefined,
    buyingType: row.buying_type ?? undefined,
    specialAdCategories: row.special_ad_categories ?? undefined,
    dailyBudget: row.daily_budget === null ? undefined : Number(row.daily_budget),
    lifetimeBudget: row.lifetime_budget === null ? undefined : Number(row.lifetime_budget),
    budgetRemaining: row.budget_remaining === null ? undefined : Number(row.budget_remaining),
    spend: row.spend === null ? undefined : Number(row.spend),
    impressions: row.impressions === null ? undefined : Number(row.impressions),
    clicks: row.clicks === null ? undefined : Number(row.clicks),
    reach: row.reach === null ? undefined : Number(row.reach),
    insights: row.insights ?? undefined,
    startTime: row.start_time?.toISOString(),
    stopTime: row.stop_time?.toISOString(),
    metaCreatedTime: row.meta_created_time?.toISOString(),
    lastSyncedAt: row.last_synced_at?.toISOString(),
    deletedAt: row.deleted_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function buildId(adAccountId: string, campaignId: string): string {
  return `mac-${adAccountId}-${campaignId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class PostgresMetaAdCampaignRepository implements MetaAdCampaignRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsertCampaign(input: UpsertMetaAdCampaignInput): Promise<MetaAdCampaign> {
    const id = input.id ?? buildId(input.adAccountId, input.campaignId);
    const result = await this.pool.query<Row>(
      `insert into meta_ad_campaigns
         (id, tenant_id, workspace_id, ad_account_id, campaign_id, name, objective, status, effective_status, buying_type, special_ad_categories, daily_budget, lifetime_budget, budget_remaining, spend, impressions, clicks, reach, insights, start_time, stop_time, meta_created_time, last_synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22, now())
       on conflict (ad_account_id, campaign_id) do update
       set name = excluded.name, objective = excluded.objective, status = excluded.status, effective_status = excluded.effective_status,
           buying_type = excluded.buying_type, special_ad_categories = excluded.special_ad_categories,
           daily_budget = excluded.daily_budget, lifetime_budget = excluded.lifetime_budget, budget_remaining = excluded.budget_remaining,
           spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks, reach = excluded.reach,
           insights = excluded.insights, start_time = excluded.start_time, stop_time = excluded.stop_time,
           meta_created_time = excluded.meta_created_time, last_synced_at = now(), deleted_at = null, updated_at = now()
       returning *`,
      [
        id, input.tenantId, input.workspaceId, input.adAccountId, input.campaignId, input.name, input.objective ?? null,
        input.status, input.effectiveStatus ?? null, input.buyingType ?? null, input.specialAdCategories ? [...input.specialAdCategories] : null,
        input.dailyBudget ?? null, input.lifetimeBudget ?? null, input.budgetRemaining ?? null,
        input.spend ?? null, input.impressions ?? null, input.clicks ?? null, input.reach ?? null,
        input.insights === undefined ? null : JSON.stringify(input.insights),
        input.startTime ?? null, input.stopTime ?? null, input.metaCreatedTime ?? null,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; adAccountId?: string; includeDeleted?: boolean }): Promise<MetaAdCampaign[]> {
    const result = await this.pool.query<Row>(
      `select * from meta_ad_campaigns
       where tenant_id = $1 and workspace_id = $2
         and ($3::text is null or ad_account_id = $3)
         and ($4::boolean or deleted_at is null)
       order by created_at desc`,
      [input.tenantId, input.workspaceId, input.adAccountId ?? null, input.includeDeleted ?? false],
    );
    return result.rows.map(toDomain);
  }

  async getById(id: string): Promise<MetaAdCampaign | undefined> {
    const result = await this.pool.query<Row>("select * from meta_ad_campaigns where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async markDeletedMissing(input: { adAccountId: string; keepCampaignIds: readonly string[] }): Promise<void> {
    await this.pool.query(
      "update meta_ad_campaigns set deleted_at = now(), updated_at = now() where ad_account_id = $1 and deleted_at is null and not (campaign_id = any($2::text[]))",
      [input.adAccountId, [...input.keepCampaignIds]],
    );
  }
}
