import type { CalendarEvent, CalendarEventStatus } from "../../domain/calendar/calendar.model.js";

export type CreateCalendarEventInput = {
  tenantId: string;
  workspaceId: string;
  ownerUserId: string;
  title: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay?: boolean;
  attendees?: readonly string[];
  relatedEntityType?: string;
  relatedEntityId?: string;
  source?: "system" | "google";
};

export type UpdateCalendarEventInput = Partial<Omit<CreateCalendarEventInput, "tenantId" | "workspaceId" | "ownerUserId">> & {
  status?: CalendarEventStatus;
  syncState?: "ok" | "failed";
  lastSyncError?: string | null;
  lastGoogleSyncAt?: string;
  googleAccountId?: string | null;
  googleCalendarId?: string | null;
  googleEventId?: string | null;
  googleEtag?: string | null;
  googleUpdatedAt?: string | null;
  htmlLink?: string | null;
  source?: "system" | "google";
};

export type ListCalendarEventsFilter = {
  tenantId: string;
  workspaceId: string;
  from: string;
  to: string;
  /** `undefined` = sem filtro de dono (visibilidade já decidida pelo caller — ver
   * `calendar-event-use-cases.ts`); presente = só os eventos desse(s) dono(s). */
  ownerUserIds?: readonly string[];
  statusCategory?: "pending" | "cancelled" | "done" | "all";
};

export type CalendarEventRepositoryPort = {
  list(filter: ListCalendarEventsFilter): Promise<CalendarEvent[]>;
  getById(id: string): Promise<CalendarEvent | undefined>;
  create(input: CreateCalendarEventInput): Promise<CalendarEvent>;
  update(id: string, input: UpdateCalendarEventInput): Promise<CalendarEvent>;
  /** Dedupe do pull — `(googleAccountId, googleEventId)` é único (ver migration). */
  findByGoogleEventId(googleAccountId: string, googleEventId: string): Promise<CalendarEvent | undefined>;
  /** Eventos `source: "system"` que ainda não sincronizaram OU tiveram a última tentativa
   * `FAILED`, dentro da janela de lookback — usado por `pushPendingSystemEventsForConnection`. */
  listPendingPush(input: { tenantId: string; workspaceId: string; ownerUserId: string; lookbackFrom: string; limit: number }): Promise<CalendarEvent[]>;
};
