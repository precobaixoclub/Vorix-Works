import useSWR from "swr";
import { apiClient } from "@/lib/api-client";

/** Agenda do Vorix Meetings — espelha `src/domain/calendar/calendar.model.ts`. */

export type CalendarEventStatus = "confirmed" | "cancelled" | "done";
export type CalendarSyncState = "ok" | "failed" | "pending" | "conflict";

export type CalendarEvent = {
  id: string;
  ownerUserId: string;
  title: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  attendees: string[];
  status: CalendarEventStatus;
  source: "system" | "google";
  meetLink?: string;
  wantsMeetLink: boolean;
  syncToGoogle: boolean;
  googleEventId?: string;
  googleRecurringEventId?: string;
  htmlLink?: string;
  syncState?: CalendarSyncState;
  conflictRemote?: { summary?: string; start?: { dateTime?: string; date?: string }; status?: string };
  lastSyncError?: string;
  meetingId?: string;
  recordingCapacityWarning?: string;
};

export type GoogleCalendarStatus = {
  configured: boolean;
  status: "not_connected" | "connected" | "reconnect_required" | "disconnected";
  googleEmail?: string;
  lastSyncedAt?: string;
  lastErrorMessage?: string;
  lastErrorAt?: string;
  nextSyncAt?: string;
};

export type CalendarSyncLogEntry = { direction: string; action: string; status: "ok" | "skipped" | "conflict" | "error"; error?: string; eventId?: string; createdAt: string };

export type EventTimeInput = { allDay: boolean; start: string; end: string; timezone: string };

export type CreateEventInput = EventTimeInput & {
  workspaceId: string;
  title: string;
  description?: string;
  location?: string;
  attendees?: string[];
  syncToGoogle?: boolean;
  createMeetLink?: boolean;
  autoRecord?: boolean;
  joinBeforeMinutes?: number;
  joinGraceMinutes?: number;
};

const q = encodeURIComponent;

export function listAgendaEvents(workspaceId: string, from: string, to: string) {
  return apiClient.get<CalendarEvent[]>(`/v1/meetings/agenda/events?workspaceId=${q(workspaceId)}&from=${q(from)}&to=${q(to)}&status=all`);
}
export function createAgendaEvent(input: CreateEventInput) {
  return apiClient.post<CalendarEvent>("/v1/meetings/agenda/events", input);
}
export function updateAgendaEvent(eventId: string, input: Partial<EventTimeInput> & { workspaceId: string; title?: string; description?: string | null; location?: string | null; attendees?: string[] }) {
  return apiClient.patch<CalendarEvent>(`/v1/meetings/agenda/events/${q(eventId)}`, input);
}
export function cancelAgendaEvent(workspaceId: string, eventId: string) {
  return apiClient.post<CalendarEvent>(`/v1/meetings/agenda/events/${q(eventId)}/cancel`, { workspaceId });
}
export function completeAgendaEvent(workspaceId: string, eventId: string) {
  return apiClient.post<CalendarEvent>(`/v1/meetings/agenda/events/${q(eventId)}/complete`, { workspaceId });
}
export function resolveAgendaConflict(workspaceId: string, eventId: string, keep: "local" | "remote") {
  return apiClient.post<CalendarEvent>(`/v1/meetings/agenda/events/${q(eventId)}/resolve-conflict`, { workspaceId, keep });
}

export function getGoogleCalendarStatus(workspaceId: string) {
  return apiClient.get<GoogleCalendarStatus>(`/v1/meetings/google/status?workspaceId=${q(workspaceId)}`);
}
export function connectGoogleCalendar(workspaceId: string) {
  return apiClient.post<{ authorizationUrl: string }>("/v1/meetings/google/connect", { workspaceId });
}
export function completeGoogleCalendar(state: string, code: string) {
  return apiClient.post<GoogleCalendarStatus>("/v1/meetings/google/callback", { state, code });
}
export function disconnectGoogleCalendar(workspaceId: string) {
  return apiClient.post<GoogleCalendarStatus>("/v1/meetings/google/disconnect", { workspaceId });
}
export function syncGoogleCalendar(workspaceId: string) {
  return apiClient.post<GoogleCalendarStatus>("/v1/meetings/google/sync", { workspaceId });
}
export function getGoogleSyncLog(workspaceId: string) {
  return apiClient.get<CalendarSyncLogEntry[]>(`/v1/meetings/google/sync-log?workspaceId=${q(workspaceId)}`);
}

export function useAgendaEvents(workspaceId: string, from: string, to: string) {
  return useSWR(["meeting-agenda", workspaceId, from, to], () => listAgendaEvents(workspaceId, from, to), {
    keepPreviousData: true,
    // Edições locais pendentes de envio ao Google: a tela acompanha até sincronizar.
    refreshInterval: (data) => (data?.some((event) => event.syncState === "pending") ? 10_000 : 0),
  });
}

export function useGoogleCalendarStatus(workspaceId: string) {
  return useSWR(["meeting-google-status", workspaceId], () => getGoogleCalendarStatus(workspaceId));
}

export function useGoogleSyncLog(workspaceId: string, enabled: boolean) {
  return useSWR(enabled ? ["meeting-google-log", workspaceId] : null, () => getGoogleSyncLog(workspaceId));
}

/** Retorno do OAuth do Google: guarda para onde voltar (workspace). */
export const GOOGLE_CALENDAR_RETURN_KEY = "vorix:google-calendar-return";
