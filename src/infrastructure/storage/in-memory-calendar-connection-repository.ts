import type {
  CalendarConnectionRepositoryPort,
  UpdateCalendarConnectionInput,
  UpsertCalendarConnectionInput,
} from "../../application/ports/calendar-connection-repository.port.js";
import type { CalendarConnection } from "../../domain/calendar/calendar.model.js";

const idGenerator = () => `calconn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryCalendarConnectionRepository implements CalendarConnectionRepositoryPort {
  private readonly rows = new Map<string, CalendarConnection>();

  async getByUser(input: { tenantId: string; workspaceId: string; userId: string }): Promise<CalendarConnection | undefined> {
    return [...this.rows.values()].find((row) => row.tenantId === input.tenantId && row.workspaceId === input.workspaceId && row.userId === input.userId);
  }

  async getById(id: string): Promise<CalendarConnection | undefined> {
    return this.rows.get(id);
  }

  async upsert(input: UpsertCalendarConnectionInput): Promise<CalendarConnection> {
    const existing = await this.getByUser(input);
    const now = new Date().toISOString();
    const row: CalendarConnection = {
      id: existing?.id ?? idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      googleEmail: input.googleEmail,
      calendarId: input.calendarId ?? existing?.calendarId ?? "primary",
      syncToken: existing?.syncToken,
      lastSyncedAt: existing?.lastSyncedAt,
      autoSyncEnabled: existing?.autoSyncEnabled ?? true,
      status: input.status,
      lastErrorMessage: undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async update(id: string, input: UpdateCalendarConnectionInput): Promise<CalendarConnection> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`CALENDAR_CONNECTION_NOT_FOUND: conexão "${id}" não existe.`);
    const updated: CalendarConnection = {
      ...existing,
      ...(input.googleEmail !== undefined ? { googleEmail: input.googleEmail } : {}),
      ...(input.calendarId !== undefined ? { calendarId: input.calendarId } : {}),
      ...(input.syncToken !== undefined ? { syncToken: input.syncToken ?? undefined } : {}),
      ...(input.lastSyncedAt !== undefined ? { lastSyncedAt: input.lastSyncedAt } : {}),
      ...(input.autoSyncEnabled !== undefined ? { autoSyncEnabled: input.autoSyncEnabled } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.lastErrorMessage !== undefined ? { lastErrorMessage: input.lastErrorMessage ?? undefined } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(id, updated);
    return updated;
  }

  async listDueForSync(limit: number): Promise<CalendarConnection[]> {
    return [...this.rows.values()].filter((row) => row.status === "connected" && row.autoSyncEnabled).slice(0, limit);
  }
}
