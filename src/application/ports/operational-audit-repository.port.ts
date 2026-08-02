import type { AuditEvent } from "../../domain/credential/credential.model.js";

export type OperationalAuditRepositoryPort = {
  record(input: Omit<AuditEvent, "createdAt">): Promise<AuditEvent>;
  list(filter: { tenantId: string; workspaceId?: string; resourceType?: string; resourceId?: string; eventType?: string; limit?: number }): Promise<AuditEvent[]>;
  export(input: { tenantId: string; workspaceId?: string; format: "json" | "csv" }): Promise<{ contentType: string; body: string }>;
};
