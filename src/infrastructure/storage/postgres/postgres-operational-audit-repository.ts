import type { Pool } from "pg";
import type { OperationalAuditRepositoryPort } from "../../../application/ports/operational-audit-repository.port.js";
import type { AuditActor, AuditContext, AuditEvent, AuditResource, AuditResult } from "../../../domain/credential/credential.model.js";

type AuditRow = { id: string; tenant_id: string; workspace_id: string | null; event_type: string; actor: AuditActor; resource: AuditResource; context: AuditContext; result: AuditResult; metadata: Record<string, unknown> | null; created_at: Date };

export class PostgresOperationalAuditRepository implements OperationalAuditRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async record(input: Omit<AuditEvent, "createdAt">): Promise<AuditEvent> {
    const result = await this.pool.query<AuditRow>(
      `insert into operational_audit_events (id, tenant_id, workspace_id, event_type, actor, resource, context, result, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [input.id, input.tenantId, input.workspaceId ?? null, input.eventType, JSON.stringify(input.actor), JSON.stringify(input.resource), JSON.stringify(input.context), JSON.stringify(input.result), input.metadata ? JSON.stringify(input.metadata) : null],
    );
    return toAuditEvent(result.rows[0]);
  }

  async list(filter: { tenantId: string; workspaceId?: string; resourceType?: string; resourceId?: string; eventType?: string; limit?: number }): Promise<AuditEvent[]> {
    const result = await this.pool.query<AuditRow>(
      `select * from operational_audit_events
       where tenant_id = $1
         and ($2::text is null or workspace_id = $2)
         and ($3::text is null or resource->>'type' = $3)
         and ($4::text is null or resource->>'id' = $4)
         and ($5::text is null or event_type = $5)
       order by created_at desc
       limit $6`,
      [filter.tenantId, filter.workspaceId ?? null, filter.resourceType ?? null, filter.resourceId ?? null, filter.eventType ?? null, filter.limit ?? 200],
    );
    return result.rows.map(toAuditEvent);
  }

  async export(input: { tenantId: string; workspaceId?: string; format: "json" | "csv" }): Promise<{ contentType: string; body: string }> {
    const events = await this.list({ tenantId: input.tenantId, workspaceId: input.workspaceId, limit: 10_000 });
    if (input.format === "json") return { contentType: "application/json", body: JSON.stringify(events, null, 2) };
    const header = ["id", "createdAt", "tenantId", "workspaceId", "eventType", "actorUserId", "resourceType", "resourceId", "resultStatus", "resultCode"];
    const rows = events.map((event) => [
      event.id,
      event.createdAt,
      event.tenantId,
      event.workspaceId ?? "",
      event.eventType,
      event.actor.userId,
      event.resource.type,
      event.resource.id,
      event.result.status,
      event.result.code ?? "",
    ].map(csvCell).join(","));
    return { contentType: "text/csv", body: [header.join(","), ...rows].join("\n") };
  }
}

function toAuditEvent(row: AuditRow): AuditEvent {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id ?? undefined, eventType: row.event_type, actor: row.actor, resource: row.resource, context: row.context, result: row.result, metadata: row.metadata ?? undefined, createdAt: row.created_at.toISOString() };
}

function csvCell(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}
