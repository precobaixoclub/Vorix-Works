import type { CalendarEvent, CalendarEventStatus, CalendarEventSyncState, CalendarRelatedEntityType } from "../../domain/calendar/calendar.model.js";

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
  relatedEntityType?: CalendarRelatedEntityType;
  relatedEntityId?: string;
  source: "system" | "google";
  wantsMeetLink?: boolean;
  syncToGoogle?: boolean;
  /** Evento criado por um pull: já nasce sincronizado (sem push de volta — anti-eco). */
  google?: GoogleEventIdentity;
};

/** Identidade/estado do evento no Google. */
export type GoogleEventIdentity = {
  googleAccountId: string;
  googleCalendarId: string;
  googleEventId: string;
  googleEtag?: string;
  googleUpdatedAt?: string;
  googleRecurringEventId?: string;
  googleOriginalStartAt?: string;
  htmlLink?: string;
  meetLink?: string;
  /** Organizador no Google — base da inferência da conta com que a pessoa entra na reunião. */
  organizerEmail?: string;
};

export type CalendarEventContentPatch = {
  title?: string;
  description?: string | null;
  location?: string | null;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  allDay?: boolean;
  attendees?: readonly string[];
  status?: CalendarEventStatus;
  wantsMeetLink?: boolean;
  syncToGoogle?: boolean;
};

export type ListCalendarEventsFilter = {
  tenantId: string;
  workspaceId: string;
  from: string;
  to: string;
  /** `undefined` = todos do workspace; presente = só destes donos. */
  ownerUserIds?: readonly string[];
  statusCategory?: "pending" | "cancelled" | "done" | "all";
};

export type CalendarEventRepositoryPort = {
  list(filter: ListCalendarEventsFilter): Promise<CalendarEvent[]>;
  getById(id: string): Promise<CalendarEvent | undefined>;
  create(input: CreateCalendarEventInput): Promise<CalendarEvent>;
  /** Edição LOCAL: aplica o patch e incrementa `localVersion` (fica pendente de push). */
  applyLocalChange(id: string, patch: CalendarEventContentPatch): Promise<CalendarEvent>;
  /** Mudança vinda do GOOGLE: aplica o patch sem tocar `localVersion` (nunca volta como push). */
  applyRemoteChange(id: string, patch: CalendarEventContentPatch, google: Partial<GoogleEventIdentity> & { googleEtag?: string; googleUpdatedAt?: string }): Promise<CalendarEvent>;
  /** Push concluído para a versão `version`: grava a identidade do Google e marca sincronizado
   * SÓ se ninguém editou no meio (senão continua pendente com a versão nova). */
  markPushed(id: string, version: number, google: Partial<GoogleEventIdentity>): Promise<CalendarEvent>;
  setSyncState(id: string, state: CalendarEventSyncState, error?: string | null, conflictRemote?: Record<string, unknown> | null): Promise<void>;
  findByGoogleEventId(googleAccountId: string, googleEventId: string): Promise<CalendarEvent | undefined>;
  /** Eventos com edição local pendente (local > synced) da conta, incluindo cancelamentos. */
  listPendingPush(input: { tenantId: string; workspaceId: string; ownerUserId: string; limit: number }): Promise<CalendarEvent[]>;
};
