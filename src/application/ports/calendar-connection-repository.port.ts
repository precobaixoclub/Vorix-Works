import type { CalendarConnection, GoogleCalendarConnectionStatus } from "../../domain/calendar/calendar.model.js";

export type UpsertCalendarConnectionInput = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  googleEmail?: string;
  calendarId?: string;
  status: GoogleCalendarConnectionStatus;
};

export type UpdateCalendarConnectionInput = {
  googleEmail?: string;
  calendarId?: string;
  syncToken?: string | null;
  lastSyncedAt?: string;
  autoSyncEnabled?: boolean;
  status?: GoogleCalendarConnectionStatus;
  lastErrorMessage?: string | null;
};

export type CalendarConnectionRepositoryPort = {
  getByUser(input: { tenantId: string; workspaceId: string; userId: string }): Promise<CalendarConnection | undefined>;
  getById(id: string): Promise<CalendarConnection | undefined>;
  /** 1 linha por `(tenantId, workspaceId, userId)` — chave de upsert. */
  upsert(input: UpsertCalendarConnectionInput): Promise<CalendarConnection>;
  update(id: string, input: UpdateCalendarConnectionInput): Promise<CalendarConnection>;
  /** Contas `CONNECTED` + `autoSyncEnabled`, para o worker de sync periódico (~2min, ver
   * `calendar.model.ts` sobre a decisão de nunca ter webhook/watch nesta rodada). */
  listDueForSync(limit: number): Promise<CalendarConnection[]>;
};
