import type { Pool } from "pg";
import type {
  CalendarConnectionRepositoryPort,
  UpdateCalendarConnectionInput,
  UpsertCalendarConnectionInput,
} from "../../../application/ports/calendar-connection-repository.port.js";
import type { CalendarConnection, GoogleCalendarConnectionStatus } from "../../../domain/calendar/calendar.model.js";

const idGenerator = () => `calconn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string; tenant_id: string; workspace_id: string; user_id: string; google_email: string | null;
  calendar_id: string; sync_token: string | null; last_synced_at: Date | null;
  auto_sync_enabled: boolean; status: string; last_error_message: string | null;
  created_at: Date; updated_at: Date;
};

export class PostgresCalendarConnectionRepository implements CalendarConnectionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getByUser(input: { tenantId: string; workspaceId: string; userId: string }): Promise<CalendarConnection | undefined> {
    const result = await this.pool.query<Row>(
      "select * from calendar_connections where tenant_id = $1 and workspace_id = $2 and user_id = $3",
      [input.tenantId, input.workspaceId, input.userId],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async getById(id: string): Promise<CalendarConnection | undefined> {
    const result = await this.pool.query<Row>("select * from calendar_connections where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async upsert(input: UpsertCalendarConnectionInput): Promise<CalendarConnection> {
    const result = await this.pool.query<Row>(
      `insert into calendar_connections (id, tenant_id, workspace_id, user_id, google_email, calendar_id, status)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (tenant_id, workspace_id, user_id) do update set
         google_email = excluded.google_email,
         calendar_id = coalesce(excluded.calendar_id, calendar_connections.calendar_id),
         status = excluded.status,
         last_error_message = null,
         updated_at = now()
       returning *`,
      [idGenerator(), input.tenantId, input.workspaceId, input.userId, input.googleEmail ?? null, input.calendarId ?? "primary", input.status],
    );
    return this.toDomain(result.rows[0]);
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
         updated_at = now()
       where id = $1
       returning *`,
      [
        id, input.googleEmail ?? null, input.calendarId ?? null,
        input.syncToken !== undefined, input.syncToken ?? null,
        input.lastSyncedAt ?? null,
        input.autoSyncEnabled ?? null, input.status ?? null,
        input.lastErrorMessage !== undefined, input.lastErrorMessage ?? null,
      ],
    );
    if (!result.rows[0]) throw new Error(`CALENDAR_CONNECTION_NOT_FOUND: conexão "${id}" não existe.`);
    return this.toDomain(result.rows[0]);
  }

  async listDueForSync(limit: number): Promise<CalendarConnection[]> {
    const result = await this.pool.query<Row>(
      "select * from calendar_connections where status = 'connected' and auto_sync_enabled = true order by last_synced_at asc nulls first limit $1",
      [limit],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: Row): CalendarConnection {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      userId: row.user_id,
      googleEmail: row.google_email ?? undefined,
      calendarId: row.calendar_id,
      syncToken: row.sync_token ?? undefined,
      lastSyncedAt: row.last_synced_at?.toISOString(),
      autoSyncEnabled: row.auto_sync_enabled,
      status: row.status as GoogleCalendarConnectionStatus,
      lastErrorMessage: row.last_error_message ?? undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
