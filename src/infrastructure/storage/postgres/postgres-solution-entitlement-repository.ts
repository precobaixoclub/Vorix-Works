import type { Pool } from "pg";
import type { SolutionEntitlementRepositoryPort } from "../../../application/ports/solution-entitlement-repository.port.js";
import { isSolutionKey, type SolutionEntitlement, type SolutionEntitlementSource, type SolutionKey } from "../../../domain/solutions/solution.model.js";

type Row = {
  tenant_id: string;
  solution_key: string;
  enabled: boolean;
  source: SolutionEntitlementSource;
  reason: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
};

const newId = () => `solaudit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export class PostgresSolutionEntitlementRepository implements SolutionEntitlementRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async listByTenant(tenantId: string): Promise<SolutionEntitlement[]> {
    const result = await this.pool.query<Row>(`select * from solution_entitlements where tenant_id = $1`, [tenantId]);
    // Uma linha de solução que este build ainda não conhece é ignorada, nunca um erro.
    return result.rows.filter((row) => isSolutionKey(row.solution_key)).map(toDomain);
  }

  async set(input: { tenantId: string; solutionKey: SolutionKey; enabled: boolean; source: SolutionEntitlementSource; reason?: string; actorUserId?: string }): Promise<SolutionEntitlement> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const previous = await client.query<{ enabled: boolean }>(`select enabled from solution_entitlements where tenant_id = $1 and solution_key = $2 for update`, [input.tenantId, input.solutionKey]);
      const saved = await client.query<Row>(
        `insert into solution_entitlements (tenant_id, solution_key, enabled, source, reason, updated_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (tenant_id, solution_key) do update set
           enabled = excluded.enabled, source = excluded.source, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = now()
         returning *`,
        [input.tenantId, input.solutionKey, input.enabled, input.source, input.reason ?? null, input.actorUserId ?? null],
      );
      await client.query(
        `insert into solution_entitlement_audit_log (id, tenant_id, solution_key, old_enabled, new_enabled, source, actor_user_id, reason)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [newId(), input.tenantId, input.solutionKey, previous.rows[0]?.enabled ?? null, input.enabled, input.source, input.actorUserId ?? null, input.reason ?? null],
      );
      await client.query("commit");
      return toDomain(saved.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

function toDomain(row: Row): SolutionEntitlement {
  return {
    tenantId: row.tenant_id,
    solutionKey: row.solution_key as SolutionKey,
    enabled: row.enabled,
    source: row.source,
    reason: row.reason ?? undefined,
    updatedBy: row.updated_by ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
