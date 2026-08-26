import type { Pool } from "pg";
import type { MetaAdEntityStatus } from "../../../application/ports/meta-ad-campaign-repository.port.js";
import type { MetaAdSet, MetaAdSetRepositoryPort, UpsertMetaAdSetInput } from "../../../application/ports/meta-ad-set-repository.port.js";

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  campaign_id: string;
  ad_account_id: string;
  ad_set_id: string;
  name: string;
  status: string;
  effective_status: string | null;
  optimization_goal: string | null;
  billing_event: string | null;
  bid_amount: string | null;
  daily_budget: string | null;
  lifetime_budget: string | null;
  targeting: unknown;
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  reach: string | null;
  insights: unknown;
  start_time: Date | null;
  end_time: Date | null;
  meta_created_time: Date | null;
  last_synced_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: Row): MetaAdSet {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    campaignId: row.campaign_id,
    adAccountId: row.ad_account_id,
    adSetId: row.ad_set_id,
    name: row.name,
    status: row.status as MetaAdEntityStatus,
    effectiveStatus: row.effective_status ?? undefined,
    optimizationGoal: row.optimization_goal ?? undefined,
    billingEvent: row.billing_event ?? undefined,
    bidAmount: row.bid_amount === null ? undefined : Number(row.bid_amount),
    dailyBudget: row.daily_budget === null ? undefined : Number(row.daily_budget),
    lifetimeBudget: row.lifetime_budget === null ? undefined : Number(row.lifetime_budget),
    targeting: row.targeting ?? undefined,
    spend: row.spend === null ? undefined : Number(row.spend),
    impressions: row.impressions === null ? undefined : Number(row.impressions),
    clicks: row.clicks === null ? undefined : Number(row.clicks),
    reach: row.reach === null ? undefined : Number(row.reach),
    insights: row.insights ?? undefined,
    startTime: row.start_time?.toISOString(),
    endTime: row.end_time?.toISOString(),
    metaCreatedTime: row.meta_created_time?.toISOString(),
    lastSyncedAt: row.last_synced_at?.toISOString(),
    deletedAt: row.deleted_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function buildId(adAccountId: string, adSetId: string): string {
  return `mas-${adAccountId}-${adSetId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class PostgresMetaAdSetRepository implements MetaAdSetRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsertAdSet(input: UpsertMetaAdSetInput): Promise<MetaAdSet> {
    const id = input.id ?? buildId(input.adAccountId, input.adSetId);
    const result = await this.pool.query<Row>(
      `insert into meta_ad_sets
         (id, tenant_id, workspace_id, campaign_id, ad_account_id, ad_set_id, name, status, effective_status, optimization_goal, billing_event, bid_amount, daily_budget, lifetime_budget, targeting, spend, impressions, clicks, reach, insights, start_time, end_time, meta_created_time, last_synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23, now())
       on conflict (ad_account_id, ad_set_id) do update
       set name = excluded.name, status = excluded.status, effective_status = excluded.effective_status,
           optimization_goal = excluded.optimization_goal, billing_event = excluded.billing_event, bid_amount = excluded.bid_amount,
           daily_budget = excluded.daily_budget, lifetime_budget = excluded.lifetime_budget, targeting = excluded.targeting,
           spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks, reach = excluded.reach,
           insights = excluded.insights, start_time = excluded.start_time, end_time = excluded.end_time,
           meta_created_time = excluded.meta_created_time, last_synced_at = now(), deleted_at = null, updated_at = now()
       returning *`,
      [
        id, input.tenantId, input.workspaceId, input.campaignId, input.adAccountId, input.adSetId, input.name,
        input.status, input.effectiveStatus ?? null, input.optimizationGoal ?? null, input.billingEvent ?? null, input.bidAmount ?? null,
        input.dailyBudget ?? null, input.lifetimeBudget ?? null,
        input.targeting === undefined ? null : JSON.stringify(input.targeting),
        input.spend ?? null, input.impressions ?? null, input.clicks ?? null, input.reach ?? null,
        input.insights === undefined ? null : JSON.stringify(input.insights),
        input.startTime ?? null, input.endTime ?? null, input.metaCreatedTime ?? null,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; campaignId?: string; adAccountId?: string; includeDeleted?: boolean }): Promise<MetaAdSet[]> {
    const result = await this.pool.query<Row>(
      `select * from meta_ad_sets
       where tenant_id = $1 and workspace_id = $2
         and ($3::text is null or campaign_id = $3)
         and ($4::text is null or ad_account_id = $4)
         and ($5::boolean or deleted_at is null)
       order by created_at desc`,
      [input.tenantId, input.workspaceId, input.campaignId ?? null, input.adAccountId ?? null, input.includeDeleted ?? false],
    );
    return result.rows.map(toDomain);
  }

  async getById(id: string): Promise<MetaAdSet | undefined> {
    const result = await this.pool.query<Row>("select * from meta_ad_sets where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async markDeletedMissing(input: { adAccountId: string; keepAdSetIds: readonly string[] }): Promise<void> {
    await this.pool.query(
      "update meta_ad_sets set deleted_at = now(), updated_at = now() where ad_account_id = $1 and deleted_at is null and not (ad_set_id = any($2::text[]))",
      [input.adAccountId, [...input.keepAdSetIds]],
    );
  }
}
