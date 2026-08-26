import type { Pool } from "pg";
import type { MetaPixel, MetaPixelRepositoryPort, UpsertMetaPixelInput } from "../../../application/ports/meta-pixel-repository.port.js";

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  ad_account_id: string;
  pixel_id: string;
  name: string;
  last_fired_time: Date | null;
  is_active: boolean;
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: Row): MetaPixel {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    adAccountId: row.ad_account_id,
    pixelId: row.pixel_id,
    name: row.name,
    lastFiredTime: row.last_fired_time?.toISOString(),
    isActive: row.is_active,
    lastSyncedAt: row.last_synced_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function buildId(adAccountId: string, pixelId: string): string {
  return `mpx-${adAccountId}-${pixelId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class PostgresMetaPixelRepository implements MetaPixelRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsertPixel(input: UpsertMetaPixelInput): Promise<MetaPixel> {
    const id = input.id ?? buildId(input.adAccountId, input.pixelId);
    const result = await this.pool.query<Row>(
      `insert into meta_pixels (id, tenant_id, workspace_id, ad_account_id, pixel_id, name, last_fired_time, is_active, last_synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8, now())
       on conflict (ad_account_id, pixel_id) do update
       set name = excluded.name, last_fired_time = excluded.last_fired_time, is_active = excluded.is_active,
           last_synced_at = now(), updated_at = now()
       returning *`,
      [id, input.tenantId, input.workspaceId, input.adAccountId, input.pixelId, input.name, input.lastFiredTime ?? null, input.isActive],
    );
    return toDomain(result.rows[0]);
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; adAccountId?: string }): Promise<MetaPixel[]> {
    const result = await this.pool.query<Row>(
      `select * from meta_pixels where tenant_id = $1 and workspace_id = $2 and ($3::text is null or ad_account_id = $3) order by created_at desc`,
      [input.tenantId, input.workspaceId, input.adAccountId ?? null],
    );
    return result.rows.map(toDomain);
  }

  async getById(id: string): Promise<MetaPixel | undefined> {
    const result = await this.pool.query<Row>("select * from meta_pixels where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }
}
