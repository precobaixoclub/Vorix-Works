import type { Pool } from "pg";
import type { AuditLogPort, RecordAuditEventInput } from "../../../application/ports/audit-log.port.js";

export type AuditLogIdGenerator = () => string;
const defaultIdGenerator: AuditLogIdGenerator = () => `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class PostgresAuditLogRepository implements AuditLogPort {
  private readonly pool: Pool;
  private readonly idGenerator: AuditLogIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: AuditLogIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async record(input: RecordAuditEventInput): Promise<void> {
    await this.pool.query(
      `insert into auth_audit_log (id, event_type, user_id, tenant_id, session_id, metadata, created_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [
        this.idGenerator(),
        input.eventType,
        input.userId ?? null,
        input.tenantId ?? null,
        input.sessionId ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
  }
}
