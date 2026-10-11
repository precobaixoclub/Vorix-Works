import type { Pool } from "pg";
import type { PublicObject, PublicObjectRepositoryPort } from "../../../application/ports/public-object-repository.port.js";

type Row = { object_key: string; tenant_id: string; workspace_id: string | null; reason: string; published_by: string | null; created_at: Date };

const toDomain = (row: Row): PublicObject => ({
  objectKey: row.object_key,
  tenantId: row.tenant_id,
  ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
  reason: row.reason,
  ...(row.published_by ? { publishedBy: row.published_by } : {}),
  createdAt: row.created_at.toISOString(),
});

/** Adapter Postgres de `PublicObjectRepositoryPort` — `db/migrations/0140_public_objects.sql`. */
export class PostgresPublicObjectRepository implements PublicObjectRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async isPublic(objectKey: string): Promise<boolean> {
    const result = await this.pool.query("select 1 from public_objects where object_key = $1", [objectKey]);
    return result.rows.length > 0;
  }

  async markPublic(input: Omit<PublicObject, "createdAt">): Promise<PublicObject> {
    const result = await this.pool.query<Row>(
      `insert into public_objects (object_key, tenant_id, workspace_id, reason, published_by)
       values ($1, $2, $3, $4, $5)
       on conflict (object_key) do update set reason = excluded.reason, published_by = excluded.published_by
       returning *`,
      [input.objectKey, input.tenantId, input.workspaceId ?? null, input.reason, input.publishedBy ?? null],
    );
    return toDomain(result.rows[0]!);
  }

  async unmarkPublic(objectKey: string): Promise<void> {
    await this.pool.query("delete from public_objects where object_key = $1", [objectKey]);
  }
}
