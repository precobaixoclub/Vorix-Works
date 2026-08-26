import type { Pool } from "pg";
import type { MetaAdEntityStatus } from "../../../application/ports/meta-ad-campaign-repository.port.js";
import type { MetaAd, MetaAdRepositoryPort, UpsertMetaAdInput } from "../../../application/ports/meta-ad-repository.port.js";

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  ad_set_id: string;
  campaign_id: string;
  ad_account_id: string;
  ad_id: string;
  name: string;
  status: string;
  effective_status: string | null;
  creative: unknown;
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  reach: string | null;
  video_completion_rate: string | null;
  negative_feedback: string | null;
  insights: unknown;
  meta_created_time: Date | null;
  last_synced_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: Row): MetaAd {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    adSetId: row.ad_set_id,
    campaignId: row.campaign_id,
    adAccountId: row.ad_account_id,
    adId: row.ad_id,
    name: row.name,
    status: row.status as MetaAdEntityStatus,
    effectiveStatus: row.effective_status ?? undefined,
    creative: row.creative ?? undefined,
    spend: row.spend === null ? undefined : Number(row.spend),
    impressions: row.impressions === null ? undefined : Number(row.impressions),
    clicks: row.clicks === null ? undefined : Number(row.clicks),
    reach: row.reach === null ? undefined : Number(row.reach),
    videoCompletionRate: row.video_completion_rate === null ? undefined : Number(row.video_completion_rate),
    negativeFeedback: row.negative_feedback === null ? undefined : Number(row.negative_feedback),
    insights: row.insights ?? undefined,
    metaCreatedTime: row.meta_created_time?.toISOString(),
    lastSyncedAt: row.last_synced_at?.toISOString(),
    deletedAt: row.deleted_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function buildId(adAccountId: string, adId: string): string {
  return `ma-${adAccountId}-${adId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class PostgresMetaAdRepository implements MetaAdRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsertAd(input: UpsertMetaAdInput): Promise<MetaAd> {
    const id = input.id ?? buildId(input.adAccountId, input.adId);
    const result = await this.pool.query<Row>(
      `insert into meta_ads
         (id, tenant_id, workspace_id, ad_set_id, campaign_id, ad_account_id, ad_id, name, status, effective_status, creative, spend, impressions, clicks, reach, video_completion_rate, negative_feedback, insights, meta_created_time, last_synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
       on conflict (ad_account_id, ad_id) do update
       set name = excluded.name, status = excluded.status, effective_status = excluded.effective_status, creative = excluded.creative,
           spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks, reach = excluded.reach,
           video_completion_rate = excluded.video_completion_rate, negative_feedback = excluded.negative_feedback,
           insights = excluded.insights, meta_created_time = excluded.meta_created_time, last_synced_at = now(), deleted_at = null, updated_at = now()
       returning *`,
      [
        id, input.tenantId, input.workspaceId, input.adSetId, input.campaignId, input.adAccountId, input.adId, input.name,
        input.status, input.effectiveStatus ?? null,
        input.creative === undefined ? null : JSON.stringify(input.creative),
        input.spend ?? null, input.impressions ?? null, input.clicks ?? null, input.reach ?? null,
        input.videoCompletionRate ?? null, input.negativeFeedback ?? null,
        input.insights === undefined ? null : JSON.stringify(input.insights),
        input.metaCreatedTime ?? null,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; adSetId?: string; campaignId?: string; adAccountId?: string; includeDeleted?: boolean }): Promise<MetaAd[]> {
    const result = await this.pool.query<Row>(
      `select * from meta_ads
       where tenant_id = $1 and workspace_id = $2
         and ($3::text is null or ad_set_id = $3)
         and ($4::text is null or campaign_id = $4)
         and ($5::text is null or ad_account_id = $5)
         and ($6::boolean or deleted_at is null)
       order by created_at desc`,
      [input.tenantId, input.workspaceId, input.adSetId ?? null, input.campaignId ?? null, input.adAccountId ?? null, input.includeDeleted ?? false],
    );
    return result.rows.map(toDomain);
  }

  async getById(id: string): Promise<MetaAd | undefined> {
    const result = await this.pool.query<Row>("select * from meta_ads where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async markDeletedMissing(input: { adAccountId: string; keepAdIds: readonly string[] }): Promise<void> {
    await this.pool.query(
      "update meta_ads set deleted_at = now(), updated_at = now() where ad_account_id = $1 and deleted_at is null and not (ad_id = any($2::text[]))",
      [input.adAccountId, [...input.keepAdIds]],
    );
  }
}
