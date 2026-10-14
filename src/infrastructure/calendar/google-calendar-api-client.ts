import { randomUUID } from "node:crypto";
import type { CalendarSyncApiPort, GoogleCalendarEventPayload } from "../../application/calendar/calendar-sync-use-cases.js";

/**
 * Cliente HTTP fino sobre a Google Calendar API v3 — sem SDK. Não conhece tokens/OAuth; recebe
 * sempre um `accessToken` já válido. Erros HTTP viram `GoogleCalendarApiError` com o status (o
 * sync decide: 410 = sync token expirado, 412 = conflito de etag, 401 = token inválido).
 */
export class GoogleCalendarApiClient implements CalendarSyncApiPort {
  constructor(private readonly input: { apiBaseUrl?: string; httpClient?: typeof fetch } = {}) {}

  async listEvents(input: { accessToken: string; calendarId: string; syncToken?: string; pageToken?: string; timeMinIso?: string }): Promise<{ items: GoogleCalendarEventPayload[]; nextPageToken?: string; nextSyncToken?: string }> {
    const url = new URL(`${this.baseUrl()}/calendars/${encodeURIComponent(input.calendarId)}/events`);
    // singleEvents=true: o Google expande recorrências em ocorrências com id próprio (ver
    // `calendar.model.ts`, decisão 1). showDeleted=true: cancelamentos chegam no sync incremental.
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("maxResults", "250");
    if (input.syncToken) url.searchParams.set("syncToken", input.syncToken);
    else if (input.timeMinIso) url.searchParams.set("timeMin", input.timeMinIso);
    if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
    const json = await this.request<{ items?: GoogleCalendarEventPayload[]; nextPageToken?: string; nextSyncToken?: string }>(url, { headers: this.auth(input.accessToken) });
    return { items: json.items ?? [], ...(json.nextPageToken ? { nextPageToken: json.nextPageToken } : {}), ...(json.nextSyncToken ? { nextSyncToken: json.nextSyncToken } : {}) };
  }

  async getEvent(input: { accessToken: string; calendarId: string; eventId: string }): Promise<GoogleCalendarEventPayload> {
    const url = new URL(`${this.baseUrl()}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`);
    return this.request(url, { headers: this.auth(input.accessToken) });
  }

  async insertEvent(input: { accessToken: string; calendarId: string; event: GoogleCalendarEventPayload; createMeet: boolean }): Promise<GoogleCalendarEventPayload> {
    const url = new URL(`${this.baseUrl()}/calendars/${encodeURIComponent(input.calendarId)}/events`);
    const event = input.createMeet
      ? { ...input.event, conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }
      : input.event;
    if (input.createMeet) url.searchParams.set("conferenceDataVersion", "1");
    return this.request(url, { method: "POST", headers: { ...this.auth(input.accessToken), "Content-Type": "application/json" }, body: JSON.stringify(event) });
  }

  /** PATCH condicional: `If-Match` com o etag conhecido — se o evento mudou no Google, responde 412. */
  async patchEvent(input: { accessToken: string; calendarId: string; eventId: string; event: GoogleCalendarEventPayload; ifMatchEtag?: string }): Promise<GoogleCalendarEventPayload> {
    const url = new URL(`${this.baseUrl()}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`);
    return this.request(url, {
      method: "PATCH",
      headers: { ...this.auth(input.accessToken), "Content-Type": "application/json", ...(input.ifMatchEtag ? { "If-Match": input.ifMatchEtag } : {}) },
      body: JSON.stringify(input.event),
    });
  }

  /** 404/410 = já não existe no Google → sucesso. */
  async deleteEvent(input: { accessToken: string; calendarId: string; eventId: string }): Promise<void> {
    const url = new URL(`${this.baseUrl()}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`);
    const response = await this.http()(url.toString(), { method: "DELETE", headers: this.auth(input.accessToken) });
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      const json = (await safeJson(response)) as { error?: { message?: string } };
      throw new GoogleCalendarApiError(response.status, json.error?.message ?? `HTTP ${response.status}`);
    }
  }

  private async request<T>(url: URL, init: RequestInit): Promise<T> {
    const response = await this.http()(url.toString(), init);
    const json = (await safeJson(response)) as T & { error?: { message?: string } };
    if (!response.ok) throw new GoogleCalendarApiError(response.status, json.error?.message ?? `HTTP ${response.status}`);
    return json;
  }

  private auth(accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}` };
  }

  private baseUrl(): string {
    return this.input.apiBaseUrl ?? "https://www.googleapis.com/calendar/v3";
  }

  private http(): typeof fetch {
    return this.input.httpClient ?? fetch;
  }
}

export class GoogleCalendarApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`GOOGLE_CALENDAR_API_ERROR: ${message}`);
  }
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const json = await response.json();
    return json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
