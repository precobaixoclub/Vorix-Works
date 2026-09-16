import type { Pool } from "pg";
import type {
  CalendarEventRepositoryPort,
  CreateCalendarEventInput,
  ListCalendarEventsFilter,
  UpdateCalendarEventInput,
} from "../../../application/ports/calendar-event-repository.port.js";
import type { CalendarEvent, CalendarEventSource, CalendarEventStatus, CalendarEventSyncState } from "../../../domain/calendar/calendar.model.js";

const idGenerator = () => `calevt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string; tenant_id: string; workspace_id: string; owner_user_id: string; title: string;
  description: string | null; location: string | null; start_at: Date; end_at: Date; timezone: string;
  all_day: boolean; attendees: string[]; status: string; source: string;
  related_entity_type: string | null; related_entity_id: string | null;
  google_account_id: string | null; google_calendar_id: string | null; google_event_id: string | null;
  google_etag: string | null; google_updated_at: Date | null; html_link: string | null;
  sync_state: string | null; last_sync_error: string | null; last_google_sync_at: Date | null;
  created_at: Date; updated_at: Date;
};

export class PostgresCalendarEventRepository implements CalendarEventRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async list(filter: ListCalendarEventsFilter): Promise<CalendarEvent[]> {
    const conditions = ["tenant_id = $1", "workspace_id = $2", "start_at < $4", "end_at > $3"];
    const params: unknown[] = [filter.tenantId, filter.workspaceId, filter.from, filter.to];

    if (filter.ownerUserIds) {
      params.push(filter.ownerUserIds);
      conditions.push(`owner_user_id = any($${params.length}::text[])`);
    }
    const statusCategory = filter.statusCategory ?? "pending";
    if (statusCategory === "pending") conditions.push("status = 'confirmed'");
    else if (statusCategory === "cancelled") conditions.push("status = 'cancelled'");
    else if (statusCategory === "done") conditions.push("status = 'done'");
    // "all" — sem filtro adicional de status.

    const result = await this.pool.query<Row>(
      `select * from calendar_events where ${conditions.join(" and ")} order by start_at asc`,
      params,
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async getById(id: string): Promise<CalendarEvent | undefined> {
    const result = await this.pool.query<Row>("select * from calendar_events where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async create(input: CreateCalendarEventInput): Promise<CalendarEvent> {
    const result = await this.pool.query<Row>(
      `insert into calendar_events (
         id, tenant_id, workspace_id, owner_user_id, title, description, location, start_at, end_at,
         timezone, all_day, attendees, related_entity_type, related_entity_id, source
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       returning *`,
      [
        idGenerator(), input.tenantId, input.workspaceId, input.ownerUserId, input.title,
        input.description ?? null, input.location ?? null, input.startAt, input.endAt,
        input.timezone, input.allDay ?? false, JSON.stringify(input.attendees ?? []),
        input.relatedEntityType ?? null, input.relatedEntityId ?? null, input.source ?? "system",
      ],
    );
    return this.toDomain(result.rows[0]);
  }

  async update(id: string, input: UpdateCalendarEventInput): Promise<CalendarEvent> {
    const result = await this.pool.query<Row>(
      `update calendar_events set
         title = coalesce($2, title),
         description = coalesce($3, description),
         location = coalesce($4, location),
         start_at = coalesce($5, start_at),
         end_at = coalesce($6, end_at),
         timezone = coalesce($7, timezone),
         all_day = coalesce($8, all_day),
         attendees = coalesce($9, attendees),
         related_entity_type = coalesce($10, related_entity_type),
         related_entity_id = coalesce($11, related_entity_id),
         status = coalesce($12, status),
         source = coalesce($13, source),
         sync_state = coalesce($14, sync_state),
         last_sync_error = case when $15::boolean then $16 else last_sync_error end,
         last_google_sync_at = coalesce($17, last_google_sync_at),
         google_account_id = case when $18::boolean then $19 else google_account_id end,
         google_calendar_id = case when $20::boolean then $21 else google_calendar_id end,
         google_event_id = case when $22::boolean then $23 else google_event_id end,
         google_etag = case when $24::boolean then $25 else google_etag end,
         google_updated_at = case when $26::boolean then $27 else google_updated_at end,
         html_link = case when $28::boolean then $29 else html_link end,
         updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        input.title ?? null, input.description ?? null, input.location ?? null,
        input.startAt ?? null, input.endAt ?? null, input.timezone ?? null, input.allDay ?? null,
        input.attendees ? JSON.stringify(input.attendees) : null,
        input.relatedEntityType ?? null, input.relatedEntityId ?? null,
        input.status ?? null, input.source ?? null, input.syncState ?? null,
        input.lastSyncError !== undefined, input.lastSyncError ?? null,
        input.lastGoogleSyncAt ?? null,
        input.googleAccountId !== undefined, input.googleAccountId ?? null,
        input.googleCalendarId !== undefined, input.googleCalendarId ?? null,
        input.googleEventId !== undefined, input.googleEventId ?? null,
        input.googleEtag !== undefined, input.googleEtag ?? null,
        input.googleUpdatedAt !== undefined, input.googleUpdatedAt ?? null,
        input.htmlLink !== undefined, input.htmlLink ?? null,
      ],
    );
    if (!result.rows[0]) throw new Error(`CALENDAR_EVENT_NOT_FOUND: evento "${id}" não existe.`);
    return this.toDomain(result.rows[0]);
  }

  async findByGoogleEventId(googleAccountId: string, googleEventId: string): Promise<CalendarEvent | undefined> {
    const result = await this.pool.query<Row>(
      "select * from calendar_events where google_account_id = $1 and google_event_id = $2",
      [googleAccountId, googleEventId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listPendingPush(input: { tenantId: string; workspaceId: string; ownerUserId: string; lookbackFrom: string; limit: number }): Promise<CalendarEvent[]> {
    const result = await this.pool.query<Row>(
      `select * from calendar_events
       where tenant_id = $1 and workspace_id = $2 and owner_user_id = $3 and source = 'system'
         and status != 'cancelled'
         and (sync_state is distinct from 'ok')
         and created_at >= $4
       order by created_at asc
       limit $5`,
      [input.tenantId, input.workspaceId, input.ownerUserId, input.lookbackFrom, input.limit],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: Row): CalendarEvent {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      ownerUserId: row.owner_user_id,
      title: row.title,
      description: row.description ?? undefined,
      location: row.location ?? undefined,
      startAt: row.start_at.toISOString(),
      endAt: row.end_at.toISOString(),
      timezone: row.timezone,
      allDay: row.all_day,
      attendees: row.attendees ?? [],
      status: row.status as CalendarEventStatus,
      source: row.source as CalendarEventSource,
      relatedEntityType: row.related_entity_type ?? undefined,
      relatedEntityId: row.related_entity_id ?? undefined,
      googleAccountId: row.google_account_id ?? undefined,
      googleCalendarId: row.google_calendar_id ?? undefined,
      googleEventId: row.google_event_id ?? undefined,
      googleEtag: row.google_etag ?? undefined,
      googleUpdatedAt: row.google_updated_at?.toISOString(),
      htmlLink: row.html_link ?? undefined,
      syncState: (row.sync_state as CalendarEventSyncState | null) ?? undefined,
      lastSyncError: row.last_sync_error ?? undefined,
      lastGoogleSyncAt: row.last_google_sync_at?.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
