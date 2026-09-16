/**
 * Cliente HTTP fino sobre a Google Calendar API v3 — sem SDK, mesmo racional dos outros
 * providers OAuth do projeto (YouTube/TikTok/Meta). Não conhece tokens/OAuth (isso é
 * `GoogleCalendarOAuthService`); recebe sempre um `accessToken` já válido.
 */
export type GoogleCalendarEventPayload = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  attendees?: Array<{ email: string }>;
  htmlLink?: string;
  etag?: string;
  updated?: string;
  extendedProperties?: { private?: Record<string, string> };
};

export type GoogleCalendarListEventsResult = {
  items: GoogleCalendarEventPayload[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

export type GoogleCalendarListEntry = { id: string; summary: string; primary?: boolean };

export class GoogleCalendarApiClient {
  constructor(private readonly input: { apiBaseUrl?: string; httpClient?: typeof fetch }) {}

  async listEvents(input: { accessToken: string; calendarId: string; syncToken?: string; pageToken?: string; timeMinIso?: string }): Promise<GoogleCalendarListEventsResult> {
    const url = new URL(`${this.baseUrl()}/calendars/${encodeURIComponent(input.calendarId)}/events`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("maxResults", "250");
    if (input.syncToken) url.searchParams.set("syncToken", input.syncToken);
    else if (input.timeMinIso) url.searchParams.set("timeMin", input.timeMinIso);
    if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);

    const response = await this.http()(url.toString(), { headers: { Authorization: `Bearer ${input.accessToken}` } });
    const json = (await safeJson(response)) as { items?: GoogleCalendarEventPayload[]; nextPageToken?: string; nextSyncToken?: string; error?: { code?: number; message?: string } };
    if (!response.ok) throw new GoogleCalendarApiError(response.status, json.error?.message ?? `HTTP ${response.status}`);
    return { items: json.items ?? [], nextPageToken: json.nextPageToken, nextSyncToken: json.nextSyncToken };
  }

  async insertEvent(input: { accessToken: string; calendarId: string; event: GoogleCalendarEventPayload }): Promise<GoogleCalendarEventPayload> {
    const url = new URL(`${this.baseUrl()}/calendars/${encodeURIComponent(input.calendarId)}/events`);
    const response = await this.http()(url.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(input.event),
    });
    const json = (await safeJson(response)) as GoogleCalendarEventPayload & { error?: { message?: string } };
    if (!response.ok) throw new GoogleCalendarApiError(response.status, (json as { error?: { message?: string } }).error?.message ?? `HTTP ${response.status}`);
    return json;
  }

  async patchEvent(input: { accessToken: string; calendarId: string; eventId: string; event: GoogleCalendarEventPayload }): Promise<GoogleCalendarEventPayload> {
    const url = new URL(`${this.baseUrl()}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`);
    const response = await this.http()(url.toString(), {
      method: "PATCH",
      headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(input.event),
    });
    const json = (await safeJson(response)) as GoogleCalendarEventPayload & { error?: { message?: string } };
    if (!response.ok) throw new GoogleCalendarApiError(response.status, (json as { error?: { message?: string } }).error?.message ?? `HTTP ${response.status}`);
    return json;
  }

  /** Tolera 404/410 como sucesso (mesmo racional do CMDesk — evento já não existe do lado do
   * Google, nunca um erro pro chamador). */
  async deleteEvent(input: { accessToken: string; calendarId: string; eventId: string }): Promise<void> {
    const url = new URL(`${this.baseUrl()}/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`);
    const response = await this.http()(url.toString(), { method: "DELETE", headers: { Authorization: `Bearer ${input.accessToken}` } });
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      const json = (await safeJson(response)) as { error?: { message?: string } };
      throw new GoogleCalendarApiError(response.status, json.error?.message ?? `HTTP ${response.status}`);
    }
  }

  async listCalendars(input: { accessToken: string }): Promise<GoogleCalendarListEntry[]> {
    const url = new URL(`${this.baseUrl()}/users/me/calendarList`);
    const response = await this.http()(url.toString(), { headers: { Authorization: `Bearer ${input.accessToken}` } });
    const json = (await safeJson(response)) as { items?: Array<{ id: string; summary: string; primary?: boolean }>; error?: { message?: string } };
    if (!response.ok) throw new GoogleCalendarApiError(response.status, json.error?.message ?? `HTTP ${response.status}`);
    return (json.items ?? []).map((item) => ({ id: item.id, summary: item.summary, primary: item.primary }));
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
