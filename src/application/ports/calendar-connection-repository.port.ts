import type { CalendarConnection, CalendarSyncLogEntry, GoogleCalendarConnectionStatus } from "../../domain/calendar/calendar.model.js";

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
  nextSyncAt?: string | null;
  /** `true` zera falhas consecutivas; `false` soma uma. */
  succeeded?: boolean;
};

export type CalendarConnectionRepositoryPort = {
  getByUser(input: { tenantId: string; workspaceId: string; userId: string }): Promise<CalendarConnection | undefined>;
  getById(id: string): Promise<CalendarConnection | undefined>;
  upsert(input: UpsertCalendarConnectionInput): Promise<CalendarConnection>;
  update(id: string, input: UpdateCalendarConnectionInput): Promise<CalendarConnection>;
  /**
   * Lock distribuído do sync: tenta pegar o lease da conta (atômico, no próprio registro). Só
   * devolve a conexão se ESTE dono conseguiu o lease — outro processo sincronizando = `undefined`.
   */
  acquireSyncLease(connectionId: string, owner: string, leaseMs: number): Promise<CalendarConnection | undefined>;
  releaseSyncLease(connectionId: string, owner: string): Promise<void>;
  /** Contas conectadas cujo próximo sync já venceu e sem lease ativo. */
  listDueForSync(limit: number, now: Date): Promise<CalendarConnection[]>;
  log(entry: CalendarSyncLogEntry): Promise<void>;
  listLog(input: { tenantId: string; connectionId: string; limit: number }): Promise<(CalendarSyncLogEntry & { createdAt: string })[]>;
};
