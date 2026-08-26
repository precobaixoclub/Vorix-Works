import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { MetaCapiEventRecord, MetaCapiEventRepositoryPort, RecordMetaCapiEventInput } from "../../../application/ports/meta-capi-event-repository.port.js";

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  meta_pixel_id: string;
  pixel_id: string;
  event_name: string;
  event_time: Date;
  event_id: string | null;
  action_source: string;
  user_data_fields: unknown;
  custom_data: unknown;
  test_event_code: string | null;
  status: string;
  events_received: number | null;
  fbtrace_id: string | null;
  error_message: string | null;
  created_at: Date;
};

function toDomain(row: Row): MetaCapiEventRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    metaPixelId: row.meta_pixel_id,
    pixelId: row.pixel_id,
    eventName: row.event_name,
    eventTime: row.event_time.toISOString(),
    eventId: row.event_id ?? undefined,
    actionSource: row.action_source,
    userDataFields: (row.user_data_fields as string[] | null) ?? [],
    customData: row.custom_data ?? undefined,
    testEventCode: row.test_event_code ?? undefined,
    status: row.status as "sent" | "failed",
    eventsReceived: row.events_received ?? undefined,
    fbtraceId: row.fbtrace_id ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresMetaCapiEventRepository implements MetaCapiEventRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async record(input: RecordMetaCapiEventInput): Promise<MetaCapiEventRecord> {
    const result = await this.pool.query<Row>(
      `insert into meta_capi_events
         (id, tenant_id, workspace_id, meta_pixel_id, pixel_id, event_name, event_time, event_id, action_source, user_data_fields, custom_data, test_event_code, status, events_received, fbtrace_id, error_message)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       returning *`,
      [
        randomUUID(), input.tenantId, input.workspaceId, input.metaPixelId, input.pixelId, input.eventName, input.eventTime,
        input.eventId ?? null, input.actionSource, JSON.stringify(input.userDataFields),
        input.customData === undefined ? null : JSON.stringify(input.customData),
        input.testEventCode ?? null, input.status, input.eventsReceived ?? null, input.fbtraceId ?? null, input.errorMessage ?? null,
      ],
    );
    return toDomain(result.rows[0]);
  }

  async listByPixel(input: { tenantId: string; workspaceId: string; metaPixelId: string; limit?: number }): Promise<MetaCapiEventRecord[]> {
    const result = await this.pool.query<Row>(
      `select * from meta_capi_events where tenant_id = $1 and workspace_id = $2 and meta_pixel_id = $3 order by created_at desc limit $4`,
      [input.tenantId, input.workspaceId, input.metaPixelId, input.limit ?? 50],
    );
    return result.rows.map(toDomain);
  }
}
