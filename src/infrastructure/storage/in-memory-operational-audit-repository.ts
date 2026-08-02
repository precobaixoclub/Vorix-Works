import type { OperationalAuditRepositoryPort } from "../../application/ports/operational-audit-repository.port.js";
import type { AuditEvent } from "../../domain/credential/credential.model.js";

export class InMemoryOperationalAuditRepository implements OperationalAuditRepositoryPort {
  private readonly events: AuditEvent[] = [];

  async record(input: Omit<AuditEvent, "createdAt">): Promise<AuditEvent> {
    const event = { ...input, createdAt: new Date().toISOString() };
    this.events.push(event);
    return event;
  }

  async list(filter: { tenantId: string; workspaceId?: string; resourceType?: string; resourceId?: string; eventType?: string; limit?: number }): Promise<AuditEvent[]> {
    const events = this.events
      .filter((event) =>
        event.tenantId === filter.tenantId
        && (!filter.workspaceId || event.workspaceId === filter.workspaceId)
        && (!filter.resourceType || event.resource.type === filter.resourceType)
        && (!filter.resourceId || event.resource.id === filter.resourceId)
        && (!filter.eventType || event.eventType === filter.eventType),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return events.slice(0, filter.limit ?? 200);
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

function csvCell(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}
