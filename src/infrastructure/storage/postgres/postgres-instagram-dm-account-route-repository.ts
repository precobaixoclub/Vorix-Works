import type { Pool } from "pg";
import type { InstagramDmAccountRoute, InstagramDmAccountRouteRepositoryPort } from "../../../application/ports/instagram-dm-account-route-repository.port.js";

type Row = { instagram_business_account_id: string; tenant_id: string; workspace_id: string; updated_at: Date };

function toDomain(row: Row): InstagramDmAccountRoute {
  return { instagramBusinessAccountId: row.instagram_business_account_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, updatedAt: row.updated_at.toISOString() };
}

export class PostgresInstagramDmAccountRouteRepository implements InstagramDmAccountRouteRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async upsertRoute(input: { instagramBusinessAccountId: string; tenantId: string; workspaceId: string }): Promise<InstagramDmAccountRoute> {
    const result = await this.pool.query<Row>(
      `insert into instagram_dm_account_routes (instagram_business_account_id, tenant_id, workspace_id)
       values ($1, $2, $3)
       on conflict (instagram_business_account_id) do update
       set tenant_id = excluded.tenant_id, workspace_id = excluded.workspace_id, updated_at = now()
       returning *`,
      [input.instagramBusinessAccountId, input.tenantId, input.workspaceId],
    );
    return toDomain(result.rows[0]);
  }

  async findByInstagramBusinessAccountId(instagramBusinessAccountId: string): Promise<InstagramDmAccountRoute | undefined> {
    const result = await this.pool.query<Row>("select * from instagram_dm_account_routes where instagram_business_account_id = $1", [instagramBusinessAccountId]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }
}
