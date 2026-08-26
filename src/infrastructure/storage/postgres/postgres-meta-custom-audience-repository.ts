import type { Pool } from "pg";
import type {
  MetaCustomAudience,
  MetaCustomAudienceRepositoryPort,
  UpsertMetaCustomAudienceInput,
} from "../../../application/ports/meta-custom-audience-repository.port.js";

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  ad_account_id: string;
  audience_id: string;
  name: string;
  subtype: string;
  description: string | null;
  approximate_count: string | null;
  operation_status: unknown;
  delivery_status: unknown;
  lookalike_origin_audience_id: string | null;
  lookalike_ratio: string | null;
  lookalike_country: string | null;
  last_synced_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: Row): MetaCustomAudience {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    adAccountId: row.ad_account_id,
    audienceId: row.audience_id,
    name: row.name,
    subtype: row.subtype,
    description: row.description ?? undefined,
    approximateCount: row.approximate_count === null ? undefined : Number(row.approximate_count),
    operationStatus: row.operation_status ?? undefined,
    deliveryStatus: row.delivery_status ?? undefined,
    lookalikeOriginAudienceId: row.lookalike_origin_audience_id ?? undefined,
    lookalikeRatio: row.lookalike_ratio === null ? undefined : Number(row.lookalike_ratio),
    lookalikeCountry: row.lookalike_country ?? undefined,
    lastSyncedAt: row.last_synced_at?.toISOString(),
    deletedAt: row.deleted_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function buildId(adAccountId: string, audienceId: string): string {
  return `mca-${adAccountId}-${audienceId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class PostgresMetaCustomAudienceRepository implements MetaCustomAudienceRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsertAudience(input: UpsertMetaCustomAudienceInput): Promise<MetaCustomAudience> {
    const id = input.id ?? buildId(input.adAccountId, input.audienceId);
    const result = await this.pool.query<Row>(
      `insert into meta_custom_audiences
         (id, tenant_id, workspace_id, ad_account_id, audience_id, name, subtype, description, approximate_count, operation_status, delivery_status, lookalike_origin_audience_id, lookalike_ratio, lookalike_country, last_synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
       on conflict (ad_account_id, audience_id) do update
       set name = excluded.name, subtype = excluded.subtype, description = excluded.description,
           approximate_count = excluded.approximate_count, operation_status = excluded.operation_status,
           delivery_status = excluded.delivery_status, lookalike_origin_audience_id = excluded.lookalike_origin_audience_id,
           lookalike_ratio = excluded.lookalike_ratio, lookalike_country = excluded.lookalike_country,
           last_synced_at = now(), deleted_at = null, updated_at = now()
       returning *`,
      [
        id, input.tenantId, input.workspaceId, input.adAccountId, input.audienceId, input.name, input.subtype,
        input.description ?? null, input.approximateCount ?? null,
        input.operationStatus === undefined ? null : JSON.stringify(input.operationStatus),
        input.deliveryStatus === undefined ? null : JSON.stringify(input.deliveryStatus),
        input.lookalikeOriginAudienceId ?? null, input.lookalikeRatio ?? null, input.lookalikeCountry ?? null,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; adAccountId?: string; includeDeleted?: boolean }): Promise<MetaCustomAudience[]> {
    const result = await this.pool.query<Row>(
      `select * from meta_custom_audiences
       where tenant_id = $1 and workspace_id = $2
         and ($3::text is null or ad_account_id = $3)
         and ($4::boolean or deleted_at is null)
       order by created_at desc`,
      [input.tenantId, input.workspaceId, input.adAccountId ?? null, input.includeDeleted ?? false],
    );
    return result.rows.map(toDomain);
  }

  async getById(id: string): Promise<MetaCustomAudience | undefined> {
    const result = await this.pool.query<Row>("select * from meta_custom_audiences where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async markDeletedMissing(input: { adAccountId: string; keepAudienceIds: readonly string[] }): Promise<void> {
    await this.pool.query(
      "update meta_custom_audiences set deleted_at = now(), updated_at = now() where ad_account_id = $1 and deleted_at is null and not (audience_id = any($2::text[]))",
      [input.adAccountId, [...input.keepAudienceIds]],
    );
  }
}
