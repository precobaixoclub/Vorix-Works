import type { Pool } from "pg";
import type {
  CalendarConnectionRepositoryPort,
  UpdateCalendarConnectionInput,
  UpsertCalendarConnectionInput,
} from "../../../application/ports/calendar-connection-repository.port.js";
import type { CalendarConnection, CalendarSyncLogEntry, GoogleCalendarConnectionStatus } from "../../../domain/calendar/calendar.model.js";

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

type Row = {
  id: string; tenant_id: string; workspace_id: string; user_id: string; google_email: string | null;
  calendar_id: string; sync_token: string | null; last_synced_at: Date | null;
  auto_sync_enabled: boolean; status: string; last_error_message: string | null;
  last_error_at: Date | null; consecutive_failures: number; next_sync_at: Date | null;
  created_at: Date; updated_at: Date;
};

export class PostgresCalendarConnectionRepository implements CalendarConnectionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getByUser(input: { tenantId: string; workspaceId: string; userId: string }): Promise<CalendarConnection | undefined> {
    const result = await this.pool.query<Row>("select * from calendar_connections where tenant_id = $1 and workspace_id = $2 and user_id = $3", [input.tenantId, input.workspaceId, input.userId]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async getById(id: string): Promise<CalendarConnection | undefined> {
    const result = await this.pool.query<Row>("select * from calendar_connections where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async upsert(input: UpsertCalendarConnectionInput): Promise<CalendarConnection> {
    const result = await this.pool.query<Row>(
      `insert into calendar_connections (id, tenant_id, workspace_id, user_id, google_email, calendar_id, status, next_sync_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (tenant_id, workspace_id, user_id) do update set
         google_email = excluded.google_email,
         calendar_id = coalesce(excluded.calendar_id, calendar_connections.calendar_id),
         status = excluded.status,
         last_error_message = null,
         last_error_at = null,
         consecutive_failures = 0,
         next_sync_at = now(),
         updated_at = now()
       returning *`,
      [newId("calconn"), input.tenantId, input.workspaceId, input.userId, input.googleEmail ?? null, input.calendarId ?? "primary", input.status],
    );
    return toDomain(result.rows[0]!);
  }

  async update(id: string, input: UpdateCalendarConnectionInput): Promise<CalendarConnection> {
    const result = await this.pool.query<Row>(
      `update calendar_connections set
         google_email = coalesce($2, google_email),
         calendar_id = coalesce($3, calendar_id),
         sync_token = case when $4::boolean then $5 else sync_token end,
         last_synced_at = coalesce($6, last_synced_at),
         auto_sync_enabled = coalesce($7, auto_sync_enabled),
         status = coalesce($8, status),
         last_error_message = case when $9::boolean then $10 else last_error_message end,
         last_error_at = case when $9::boolean and $10 is not null then now() when $9::boolean then null else last_error_at end,
         next_sync_at = case when $11::boolean then $12::timestamptz else next_sync_at end,
         consecutive_failures = case when $13::boolean is null then consecutive_failures when $13 then 0 else consecutive_failures + 1 end,
         updated_at = now()
       where id = $1
       returning *`,
      [
        id, input.googleEmail ?? null, input.calendarId ?? null,
        input.syncToken !== undefined, input.syncToken ?? null,
        input.lastSyncedAt ?? null, input.autoSyncEnabled ?? null, input.status ?? null,
        input.lastErrorMessage !== undefined, input.lastErrorMessage ?? null,
        input.nextSyncAt !== undefined, input.nextSyncAt ?? null,
        input.succeeded ?? null,
      ],
    );
    if (!result.rows[0]) throw new Error(`CALENDAR_CONNECTION_NOT_FOUND: conexão "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }

  async acquireSyncLease(connectionId: string, owner: string, leaseMs: number): Promise<CalendarConnection | undefined> {
    // Atômico: só um UPDATE consegue pegar a conta enquanto o lease anterior não expirou.
    const result = await this.pool.query<Row>(
      `update calendar_connections set sync_lease_owner = $2, sync_lease_until = now() + ($3::int * interval '1 millisecond')
       where id = $1 and (sync_lease_until is null or sync_lease_until < now() or sync_lease_owner = $2)
       returning *`,
      [connectionId, owner, leaseMs],
    );
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async releaseSyncLease(connectionId: string, owner: string): Promise<void> {
    await this.pool.query(`update calendar_connections set sync_lease_owner = null, sync_lease_until = null where id = $1 and sync_lease_owner = $2`, [connectionId, owner]);
  }

  async listDueForSync(limit: number, now: Date): Promise<CalendarConnection[]> {
    const result = await this.pool.query<Row>(
      `select * from calendar_connections
       where status = 'connected' and auto_sync_enabled
         and (next_sync_at is null or next_sync_at <= $2)
         and (sync_lease_until is null or sync_lease_until < $2)
       order by next_sync_at asc nulls first limit $1`,
      [limit, now],
    );
    return result.rows.map(toDomain);
  }

  async log(entry: CalendarSyncLogEntry): Promise<void> {
    await this.pool.query(
      `insert into calendar_sync_log (id, tenant_id, workspace_id, connection_id, event_id, google_event_id, direction, action, status, error)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [newId("calsync"), entry.tenantId, entry.workspaceId, entry.connectionId, entry.eventId ?? null, entry.googleEventId ?? null, entry.direction, entry.action, entry.status, entry.error?.slice(0, 1000) ?? null],
    );
  }

  async listLog(input: { tenantId: string; connectionId: string; limit: number }): Promise<(CalendarSyncLogEntry & { createdAt: string })[]> {
    const result = await this.pool.query<{ tenant_id: string; workspace_id: string; connection_id: string; event_id: string | null; google_event_id: string | null; direction: CalendarSyncLogEntry["direction"]; action: string; status: CalendarSyncLogEntry["status"]; error: string | null; created_at: Date }>(
      `select * from calendar_sync_log where tenant_id = $1 and connection_id = $2 order by created_at desc, id desc limit $3`,
      [input.tenantId, input.connectionId, input.limit],
    );
    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      connectionId: row.connection_id,
      ...(row.event_id ? { eventId: row.event_id } : {}),
      ...(row.google_event_id ? { googleEventId: row.google_event_id } : {}),
      direction: row.direction,
      action: row.action,
      status: row.status,
      ...(row.error ? { error: row.error } : {}),
      createdAt: row.created_at.toISOString(),
    }));
  }
}

function toDomain(row: Row): CalendarConnection {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    ...(row.google_email ? { googleEmail: row.google_email } : {}),
    calendarId: row.calendar_id,
    ...(row.sync_token ? { syncToken: row.sync_token } : {}),
    ...(row.last_synced_at ? { lastSyncedAt: row.last_synced_at.toISOString() } : {}),
    autoSyncEnabled: row.auto_sync_enabled,
    status: row.status as GoogleCalendarConnectionStatus,
    ...(row.last_error_message ? { lastErrorMessage: row.last_error_message } : {}),
    ...(row.last_error_at ? { lastErrorAt: row.last_error_at.toISOString() } : {}),
    consecutiveFailures: row.consecutive_failures ?? 0,
    ...(row.next_sync_at ? { nextSyncAt: row.next_sync_at.toISOString() } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
