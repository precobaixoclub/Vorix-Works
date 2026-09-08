import type { Pool } from "pg";
import type {
  CountByEventNameInput,
  CountDistinctByEventNameInput,
  ProductEventRepositoryPort,
  RecordProductEventInput,
} from "../../../application/ports/product-event-repository.port.js";
import type { ProductEvent, ProductEventName, ProductEventSource } from "../../../domain/product-analytics/product-analytics.model.js";

const productEventId = () => `pevt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

type ProductEventRow = {
  id: string;
  event_name: string;
  occurred_at: Date;
  received_at: Date;
  anonymous_id: string | null;
  user_id: string | null;
  tenant_id: string | null;
  workspace_id: string | null;
  session_id: string | null;
  source: string;
  properties: Record<string, unknown>;
  schema_version: number;
};

function toDomain(row: ProductEventRow): ProductEvent {
  return {
    id: row.id,
    eventName: row.event_name as ProductEventName,
    occurredAt: row.occurred_at.toISOString(),
    receivedAt: row.received_at.toISOString(),
    anonymousId: row.anonymous_id ?? undefined,
    userId: row.user_id ?? undefined,
    tenantId: row.tenant_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    source: row.source as ProductEventSource,
    properties: row.properties ?? {},
    schemaVersion: row.schema_version,
  };
}

const DISTINCT_COLUMN: Record<CountDistinctByEventNameInput["distinctBy"], string> = {
  tenantId: "tenant_id",
  workspaceId: "workspace_id",
  anonymousId: "anonymous_id",
};

export class PostgresProductEventRepository implements ProductEventRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async record(input: RecordProductEventInput): Promise<ProductEvent> {
    const result = await this.pool.query<ProductEventRow>(
      `insert into product_events (id, event_name, occurred_at, anonymous_id, user_id, tenant_id, workspace_id, session_id, source, properties)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       returning *`,
      [
        productEventId(),
        input.eventName,
        input.occurredAt ?? new Date().toISOString(),
        input.anonymousId ?? null,
        input.userId ?? null,
        input.tenantId ?? null,
        input.workspaceId ?? null,
        input.sessionId ?? null,
        input.source,
        JSON.stringify(input.properties ?? {}),
      ],
    );
    return toDomain(result.rows[0]);
  }

  async markFirstOccurrence(input: { tenantId: string; workspaceId: string; eventName: ProductEventName }): Promise<boolean> {
    const result = await this.pool.query(
      `insert into product_event_firsts (tenant_id, workspace_id, event_name)
       values ($1, $2, $3)
       on conflict (workspace_id, event_name) do nothing
       returning workspace_id`,
      [input.tenantId, input.workspaceId, input.eventName],
    );
    return result.rows.length > 0;
  }

  async countByEventName(input: CountByEventNameInput): Promise<number> {
    const conditions = ["event_name = $1"];
    const params: unknown[] = [input.eventName];
    if (input.tenantId) {
      params.push(input.tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }
    if (input.since) {
      params.push(input.since);
      conditions.push(`occurred_at >= $${params.length}`);
    }
    if (input.until) {
      params.push(input.until);
      conditions.push(`occurred_at < $${params.length}`);
    }
    const result = await this.pool.query<{ total: string }>(
      `select count(*)::text as total from product_events where ${conditions.join(" and ")}`,
      params,
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  async countDistinctByEventName(input: CountDistinctByEventNameInput): Promise<number> {
    const column = DISTINCT_COLUMN[input.distinctBy];
    const conditions = ["event_name = $1", `${column} is not null`];
    const params: unknown[] = [input.eventName];
    if (input.tenantId) {
      params.push(input.tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }
    if (input.since) {
      params.push(input.since);
      conditions.push(`occurred_at >= $${params.length}`);
    }
    if (input.until) {
      params.push(input.until);
      conditions.push(`occurred_at < $${params.length}`);
    }
    const result = await this.pool.query<{ total: string }>(
      `select count(distinct ${column})::text as total from product_events where ${conditions.join(" and ")}`,
      params,
    );
    return Number(result.rows[0]?.total ?? 0);
  }
}
