import type { Pool } from "pg";
import type { RecordTimelineEventInput, TimelineEventRepositoryPort } from "../../../application/ports/timeline-event-repository.port.js";
import type { TimelineActorType, TimelineEntityType, TimelineEvent } from "../../../domain/crm/crm.model.js";

const idGenerator = () => `timeline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type TimelineRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date;
};

export class PostgresTimelineEventRepository implements TimelineEventRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async record(input: RecordTimelineEventInput): Promise<TimelineEvent> {
    const result = await this.pool.query<TimelineRow>(
      `insert into timeline_events (id, tenant_id, workspace_id, entity_type, entity_id, event_type, actor_type, actor_id, payload, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10, now()))
       returning *`,
      [
        idGenerator(), input.tenantId, input.workspaceId, input.entityType, input.entityId,
        input.eventType, input.actorType, input.actorId ?? null,
        JSON.stringify(input.payload ?? {}), input.occurredAt ?? null,
      ],
    );
    return this.toDomain(result.rows[0]);
  }

  async listByEntity(input: { entityType: TimelineEntityType; entityId: string; limit?: number }): Promise<TimelineEvent[]> {
    const result = await this.pool.query<TimelineRow>(
      "select * from timeline_events where entity_type = $1 and entity_id = $2 order by occurred_at desc limit $3",
      [input.entityType, input.entityId, input.limit ?? 100],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: TimelineRow): TimelineEvent {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      entityType: row.entity_type as TimelineEntityType,
      entityId: row.entity_id,
      eventType: row.event_type,
      actorType: row.actor_type as TimelineActorType,
      actorId: row.actor_id ?? undefined,
      payload: row.payload ?? {},
      occurredAt: row.occurred_at.toISOString(),
    };
  }
}
