import type { Pool } from "pg";
import type { AccessAuditEntry, AccessAuditEventType, AccessAuditLogPort } from "../../../application/ports/access-audit-log.port.js";

const newId = () => `accaudit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string;
  tenant_id: string;
  actor_user_id: string;
  target_user_id: string | null;
  team_id: string | null;
  event_type: string;
  previous_value: unknown;
  new_value: unknown;
  created_at: Date;
};

export class PostgresAccessAuditLog implements AccessAuditLogPort {
  constructor(private readonly pool: Pool) {}

  async record(entry: Omit<AccessAuditEntry, "id" | "createdAt">): Promise<void> {
    await this.pool.query(
      `insert into access_audit_log (id, tenant_id, actor_user_id, target_user_id, team_id, event_type, previous_value, new_value)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        newId(), entry.tenantId, entry.actorUserId, entry.targetUserId ?? null, entry.teamId ?? null, entry.eventType,
        entry.previousValue === undefined ? null : JSON.stringify(entry.previousValue),
        entry.newValue === undefined ? null : JSON.stringify(entry.newValue),
      ],
    );
  }

  async list(input: { tenantId: string; targetUserId?: string; limit?: number }): Promise<AccessAuditEntry[]> {
    const result = await this.pool.query<Row>(
      `select * from access_audit_log where tenant_id = $1 and ($2::text is null or target_user_id = $2)
       order by created_at desc limit $3`,
      [input.tenantId, input.targetUserId ?? null, Math.min(Math.max(input.limit ?? 100, 1), 500)],
    );
    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      actorUserId: row.actor_user_id,
      targetUserId: row.target_user_id ?? undefined,
      teamId: row.team_id ?? undefined,
      eventType: row.event_type as AccessAuditEventType,
      previousValue: row.previous_value ?? undefined,
      newValue: row.new_value ?? undefined,
      createdAt: row.created_at.toISOString(),
    }));
  }
}
