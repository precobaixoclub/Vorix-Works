import type { Pool } from "pg";
import type {
  CalendarEventContentPatch,
  CalendarEventRepositoryPort,
  CreateCalendarEventInput,
  GoogleEventIdentity,
  ListCalendarEventsFilter,
} from "../../../application/ports/calendar-event-repository.port.js";
import type { CalendarEvent, CalendarEventSource, CalendarEventStatus, CalendarEventSyncState, CalendarRelatedEntityType } from "../../../domain/calendar/calendar.model.js";

const newId = () => `calevt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

type Row = {
  id: string; tenant_id: string; workspace_id: string; owner_user_id: string; title: string;
  description: string | null; location: string | null; start_at: Date; end_at: Date; timezone: string;
  all_day: boolean; attendees: string[]; status: string; source: string;
  related_entity_type: string | null; related_entity_id: string | null;
  google_account_id: string | null; google_calendar_id: string | null; google_event_id: string | null;
  google_etag: string | null; google_updated_at: Date | null; html_link: string | null;
  google_recurring_event_id: string | null; google_original_start_at: Date | null;
  meet_link: string | null; wants_meet_link: boolean; sync_to_google: boolean;
  local_version: number; synced_version: number; conflict_remote: Record<string, unknown> | null;
  sync_state: string | null; last_sync_error: string | null; last_google_sync_at: Date | null;
  created_at: Date; updated_at: Date;
};

/** Colunas de conteúdo que um patch pode tocar (mesmo nome no domínio e no banco). */
const CONTENT_COLUMNS: ReadonlyArray<[keyof CalendarEventContentPatch, string, "json" | "plain"]> = [
  ["title", "title", "plain"],
  ["description", "description", "plain"],
  ["location", "location", "plain"],
  ["startAt", "start_at", "plain"],
  ["endAt", "end_at", "plain"],
  ["timezone", "timezone", "plain"],
  ["allDay", "all_day", "plain"],
  ["attendees", "attendees", "json"],
  ["status", "status", "plain"],
  ["wantsMeetLink", "wants_meet_link", "plain"],
  ["syncToGoogle", "sync_to_google", "plain"],
];

const GOOGLE_COLUMNS: ReadonlyArray<[keyof GoogleEventIdentity, string]> = [
  ["googleAccountId", "google_account_id"],
  ["googleCalendarId", "google_calendar_id"],
  ["googleEventId", "google_event_id"],
  ["googleEtag", "google_etag"],
  ["googleUpdatedAt", "google_updated_at"],
  ["googleRecurringEventId", "google_recurring_event_id"],
  ["googleOriginalStartAt", "google_original_start_at"],
  ["htmlLink", "html_link"],
  ["meetLink", "meet_link"],
];

function buildSets(patch: CalendarEventContentPatch, google: Partial<GoogleEventIdentity> | undefined, params: unknown[]): string[] {
  const sets: string[] = [];
  for (const [key, column, kind] of CONTENT_COLUMNS) {
    if (patch[key] === undefined) continue;
    params.push(kind === "json" ? JSON.stringify(patch[key]) : patch[key]);
    sets.push(`${column} = $${params.length}${kind === "json" ? "::jsonb" : ""}`);
  }
  for (const [key, column] of GOOGLE_COLUMNS) {
    if (!google || google[key] === undefined) continue;
    params.push(google[key]);
    sets.push(`${column} = $${params.length}`);
  }
  return sets;
}

export class PostgresCalendarEventRepository implements CalendarEventRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async list(filter: ListCalendarEventsFilter): Promise<CalendarEvent[]> {
    const conditions = ["tenant_id = $1", "workspace_id = $2", "start_at < $4", "end_at > $3"];
    const params: unknown[] = [filter.tenantId, filter.workspaceId, filter.from, filter.to];
    if (filter.ownerUserIds) {
      params.push(filter.ownerUserIds);
      conditions.push(`owner_user_id = any($${params.length}::text[])`);
    }
    const category = filter.statusCategory ?? "all";
    if (category === "pending") conditions.push("status = 'confirmed'");
    else if (category === "cancelled") conditions.push("status = 'cancelled'");
    else if (category === "done") conditions.push("status = 'done'");
    const result = await this.pool.query<Row>(`select * from calendar_events where ${conditions.join(" and ")} order by start_at asc, id asc`, params);
    return result.rows.map(toDomain);
  }

  async getById(id: string): Promise<CalendarEvent | undefined> {
    const result = await this.pool.query<Row>("select * from calendar_events where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async create(input: CreateCalendarEventInput): Promise<CalendarEvent> {
    const fromGoogle = input.google;
    // Local: nasce com versão 1 pendente de push (se a pessoa sincroniza com o Google). Do Google:
    // nasce sincronizado (versão 0 = 0) — nunca é empurrado de volta.
    const localVersion = fromGoogle ? 0 : 1;
    const result = await this.pool.query<Row>(
      `insert into calendar_events (
         id, tenant_id, workspace_id, owner_user_id, title, description, location, start_at, end_at, timezone, all_day,
         attendees, related_entity_type, related_entity_id, source, wants_meet_link, sync_to_google, local_version, synced_version,
         sync_state, google_account_id, google_calendar_id, google_event_id, google_etag, google_updated_at,
         google_recurring_event_id, google_original_start_at, html_link, meet_link, last_google_sync_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,0,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
       returning *`,
      [
        newId(), input.tenantId, input.workspaceId, input.ownerUserId, input.title, input.description ?? null, input.location ?? null,
        input.startAt, input.endAt, input.timezone, input.allDay ?? false, JSON.stringify(input.attendees ?? []),
        input.relatedEntityType ?? null, input.relatedEntityId ?? null, input.source, input.wantsMeetLink ?? false, input.syncToGoogle ?? true, localVersion,
        fromGoogle ? "ok" : input.syncToGoogle === false ? null : "pending",
        fromGoogle?.googleAccountId ?? null, fromGoogle?.googleCalendarId ?? null, fromGoogle?.googleEventId ?? null, fromGoogle?.googleEtag ?? null,
        fromGoogle?.googleUpdatedAt ?? null, fromGoogle?.googleRecurringEventId ?? null, fromGoogle?.googleOriginalStartAt ?? null,
        fromGoogle?.htmlLink ?? null, fromGoogle?.meetLink ?? null, fromGoogle ? new Date() : null,
      ],
    );
    return toDomain(result.rows[0]!);
  }

  async applyLocalChange(id: string, patch: CalendarEventContentPatch): Promise<CalendarEvent> {
    const params: unknown[] = [id];
    const sets = buildSets(patch, undefined, params);
    const result = await this.pool.query<Row>(
      `update calendar_events set ${[...sets, "local_version = local_version + 1", "sync_state = case when sync_to_google then 'pending' else sync_state end", "updated_at = now()"].join(", ")}
       where id = $1 returning *`,
      params,
    );
    if (!result.rows[0]) throw new Error(`CALENDAR_EVENT_NOT_FOUND: evento "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }

  async applyRemoteChange(id: string, patch: CalendarEventContentPatch, google: Partial<GoogleEventIdentity>): Promise<CalendarEvent> {
    const params: unknown[] = [id];
    const sets = buildSets(patch, google, params);
    const result = await this.pool.query<Row>(
      `update calendar_events set ${[...sets, "sync_state = 'ok'", "conflict_remote = null", "last_sync_error = null", "last_google_sync_at = now()", "updated_at = now()"].join(", ")}
       where id = $1 returning *`,
      params,
    );
    if (!result.rows[0]) throw new Error(`CALENDAR_EVENT_NOT_FOUND: evento "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }

  async markPushed(id: string, version: number, google: Partial<GoogleEventIdentity>): Promise<CalendarEvent> {
    const params: unknown[] = [id];
    const sets = buildSets({}, google, params);
    params.push(version);
    const v = `$${params.length}`;
    const result = await this.pool.query<Row>(
      `update calendar_events set ${[
        ...sets,
        `synced_version = greatest(synced_version, ${v})`,
        `sync_state = case when local_version > ${v} then 'pending' else 'ok' end`,
        "conflict_remote = null",
        "last_sync_error = null",
        "last_google_sync_at = now()",
        "updated_at = now()",
      ].join(", ")} where id = $1 returning *`,
      params,
    );
    if (!result.rows[0]) throw new Error(`CALENDAR_EVENT_NOT_FOUND: evento "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }

  async setSyncState(id: string, state: CalendarEventSyncState, error?: string | null, conflictRemote?: Record<string, unknown> | null): Promise<void> {
    await this.pool.query(
      `update calendar_events set sync_state = $2,
         last_sync_error = case when $3::boolean then $4 else last_sync_error end,
         conflict_remote = case when $5::boolean then $6::jsonb else conflict_remote end,
         updated_at = now()
       where id = $1`,
      [id, state, error !== undefined, error ?? null, conflictRemote !== undefined, conflictRemote ? JSON.stringify(conflictRemote) : null],
    );
  }

  async findByGoogleEventId(googleAccountId: string, googleEventId: string): Promise<CalendarEvent | undefined> {
    const result = await this.pool.query<Row>("select * from calendar_events where google_account_id = $1 and google_event_id = $2", [googleAccountId, googleEventId]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listPendingPush(input: { tenantId: string; workspaceId: string; ownerUserId: string; limit: number }): Promise<CalendarEvent[]> {
    const result = await this.pool.query<Row>(
      `select * from calendar_events
       where tenant_id = $1 and workspace_id = $2 and owner_user_id = $3 and sync_to_google
         and local_version > synced_version and coalesce(sync_state, '') <> 'conflict'
       order by updated_at asc limit $4`,
      [input.tenantId, input.workspaceId, input.ownerUserId, input.limit],
    );
    return result.rows.map(toDomain);
  }
}

function toDomain(row: Row): CalendarEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    ...(row.location ? { location: row.location } : {}),
    startAt: row.start_at.toISOString(),
    endAt: row.end_at.toISOString(),
    timezone: row.timezone,
    allDay: row.all_day,
    attendees: row.attendees ?? [],
    status: row.status as CalendarEventStatus,
    source: row.source as CalendarEventSource,
    ...(row.meet_link ? { meetLink: row.meet_link } : {}),
    wantsMeetLink: row.wants_meet_link,
    syncToGoogle: row.sync_to_google,
    ...(row.related_entity_type ? { relatedEntityType: row.related_entity_type as CalendarRelatedEntityType } : {}),
    ...(row.related_entity_id ? { relatedEntityId: row.related_entity_id } : {}),
    ...(row.google_account_id ? { googleAccountId: row.google_account_id } : {}),
    ...(row.google_calendar_id ? { googleCalendarId: row.google_calendar_id } : {}),
    ...(row.google_event_id ? { googleEventId: row.google_event_id } : {}),
    ...(row.google_etag ? { googleEtag: row.google_etag } : {}),
    ...(row.google_updated_at ? { googleUpdatedAt: row.google_updated_at.toISOString() } : {}),
    ...(row.google_recurring_event_id ? { googleRecurringEventId: row.google_recurring_event_id } : {}),
    ...(row.google_original_start_at ? { googleOriginalStartAt: row.google_original_start_at.toISOString() } : {}),
    ...(row.html_link ? { htmlLink: row.html_link } : {}),
    localVersion: row.local_version,
    syncedVersion: row.synced_version,
    ...(row.sync_state ? { syncState: row.sync_state as CalendarEventSyncState } : {}),
    ...(row.conflict_remote ? { conflictRemote: row.conflict_remote } : {}),
    ...(row.last_sync_error ? { lastSyncError: row.last_sync_error } : {}),
    ...(row.last_google_sync_at ? { lastGoogleSyncAt: row.last_google_sync_at.toISOString() } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
