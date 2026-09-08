import type { Pool } from "pg";
import type { UsageCounterRepositoryPort } from "../../../application/ports/usage-counter-repository.port.js";
import type { PlanLimitResource } from "../../../domain/platform-billing/plan-entitlements.model.js";
import type { UsageCounter } from "../../../domain/platform-billing/usage-counter.model.js";

type Row = { tenant_id: string; workspace_id: string | null; resource: string; period: string; used: string; updated_at: Date };

function toDomain(row: Row): UsageCounter {
  return {
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id ?? undefined,
    resource: row.resource as PlanLimitResource,
    period: row.period,
    used: Number(row.used),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PostgresUsageCounterRepository implements UsageCounterRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async get(input: { tenantId: string; resource: PlanLimitResource; period: string }): Promise<UsageCounter | undefined> {
    const result = await this.pool.query<Row>(
      "select * from usage_counters where tenant_id = $1 and resource = $2 and period = $3",
      [input.tenantId, input.resource, input.period],
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async increment(input: { tenantId: string; workspaceId?: string; resource: PlanLimitResource; period: string; delta: number }): Promise<UsageCounter> {
    const result = await this.pool.query<Row>(
      `insert into usage_counters (tenant_id, workspace_id, resource, period, used)
       values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, resource, period) do update set used = usage_counters.used + excluded.used, updated_at = now()
       returning *`,
      [input.tenantId, input.workspaceId ?? null, input.resource, input.period, input.delta],
    );
    return toDomain(result.rows[0]);
  }
}
