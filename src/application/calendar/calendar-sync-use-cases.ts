import type { CalendarEvent } from "../../domain/calendar/calendar.model.js";
import type { CalendarConnectionRepositoryPort } from "../ports/calendar-connection-repository.port.js";
import type { CalendarEventRepositoryPort } from "../ports/calendar-event-repository.port.js";

/**
 * Sincronização bidirecional com Google Calendar (réplica adaptada do CMDesk, pedido explícito do
 * usuário, relatório Parte A seção 2). `deps` genérico o bastante para aceitar dublês nos testes —
 * `googleCalendarOAuthService`/`googleCalendarApiClient` são tipados como `unknown`-friendly aqui
 * (interfaces mínimas locais) para nunca criar um import circular entre `application/` e
 * `infrastructure/` (a API real vive em `infrastructure/calendar/`, injetada via DI).
 */
export type CalendarSyncOAuthPort = {
  getValidAccessToken(input: { tenantId: string; workspaceId: string; userId: string }): Promise<string | undefined>;
};

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
};

export type CalendarSyncApiPort = {
  listEvents(input: { accessToken: string; calendarId: string; syncToken?: string; pageToken?: string; timeMinIso?: string }): Promise<{ items: GoogleCalendarEventPayload[]; nextPageToken?: string; nextSyncToken?: string }>;
  insertEvent(input: { accessToken: string; calendarId: string; event: GoogleCalendarEventPayload }): Promise<GoogleCalendarEventPayload>;
  patchEvent(input: { accessToken: string; calendarId: string; eventId: string; event: GoogleCalendarEventPayload }): Promise<GoogleCalendarEventPayload>;
  deleteEvent(input: { accessToken: string; calendarId: string; eventId: string }): Promise<void>;
  listCalendars(input: { accessToken: string }): Promise<{ id: string; summary: string; primary?: boolean }[]>;
};

/** Erro que carrega o status HTTP — o adapter real (`GoogleCalendarApiClient`) lança
 * `GoogleCalendarApiError` com essa mesma forma; checado por duck-typing (`"status" in error`)
 * para nunca importar a classe concreta de `infrastructure/` aqui. */
type HttpStatusError = { status: number; message: string };
function isHttpStatusError(error: unknown): error is HttpStatusError {
  return typeof error === "object" && error !== null && "status" in error && typeof (error as { status: unknown }).status === "number";
}

export type CalendarSyncUseCaseDeps = {
  calendarEventRepository: CalendarEventRepositoryPort;
  calendarConnectionRepository?: CalendarConnectionRepositoryPort;
  googleCalendarOAuthService?: CalendarSyncOAuthPort;
  googleCalendarApiClient?: CalendarSyncApiPort;
};

function requireSyncDeps(deps: CalendarSyncUseCaseDeps): { calendarConnectionRepository: CalendarConnectionRepositoryPort; googleCalendarOAuthService: CalendarSyncOAuthPort; googleCalendarApiClient: CalendarSyncApiPort } {
  if (!deps.calendarConnectionRepository || !deps.googleCalendarOAuthService || !deps.googleCalendarApiClient) {
    throw new Error("CALENDAR_SYNC_NOT_CONFIGURED: sincronização com Google Calendar não está disponível neste ambiente.");
  }
  return { calendarConnectionRepository: deps.calendarConnectionRepository, googleCalendarOAuthService: deps.googleCalendarOAuthService, googleCalendarApiClient: deps.googleCalendarApiClient };
}

function toGooglePayload(event: CalendarEvent): GoogleCalendarEventPayload {
  const field = (iso: string) => (event.allDay ? { date: iso.slice(0, 10) } : { dateTime: iso, timeZone: event.timezone });
  return {
    summary: event.title,
    description: event.description,
    location: event.location,
    start: field(event.startAt),
    end: field(event.endAt),
    attendees: event.attendees.map((email) => ({ email })),
  };
}

export type PushSystemEventInput = { eventId: string; action: "CREATE" | "UPDATE" | "DELETE" };
export type PushSystemEventResult = { ok: boolean; error?: string };

/**
 * Empurra UM evento `source: "system"` pro Google — chamado SÍNCRONO (`await`) logo após
 * create/update/cancel (seção 1.5 do relatório: nunca bloqueia a operação local, só marca
 * `syncState:"failed"` e devolve o aviso pro chamador reportar como `syncWarning`). Sem conta
 * Google conectada, não é uma falha — é "nada a fazer" (`ok: true`, sem tocar `syncState`).
 */
export async function pushSystemEventToGoogle(deps: CalendarSyncUseCaseDeps, input: PushSystemEventInput): Promise<PushSystemEventResult> {
  let syncDeps;
  try {
    syncDeps = requireSyncDeps(deps);
  } catch {
    return { ok: true };
  }
  const event = await deps.calendarEventRepository.getById(input.eventId);
  if (!event) return { ok: false, error: "Evento não encontrado." };

  const connection = await syncDeps.calendarConnectionRepository.getByUser({ tenantId: event.tenantId, workspaceId: event.workspaceId, userId: event.ownerUserId });
  if (!connection || connection.status !== "connected") return { ok: true };

  const accessToken = await syncDeps.googleCalendarOAuthService.getValidAccessToken({ tenantId: event.tenantId, workspaceId: event.workspaceId, userId: event.ownerUserId });
  if (!accessToken) {
    await deps.calendarEventRepository.update(event.id, { syncState: "failed", lastSyncError: "Conta Google desconectada ou token expirado — reconecte em Configurações." });
    return { ok: false, error: "Conta Google desconectada ou token expirado." };
  }

  try {
    if (input.action === "DELETE" || event.status === "cancelled") {
      if (event.googleEventId) await syncDeps.googleCalendarApiClient.deleteEvent({ accessToken, calendarId: connection.calendarId, eventId: event.googleEventId });
      await deps.calendarEventRepository.update(event.id, { syncState: "ok", lastSyncError: null, lastGoogleSyncAt: new Date().toISOString() });
      return { ok: true };
    }

    const payload = toGooglePayload(event);
    const result = event.googleEventId
      ? await syncDeps.googleCalendarApiClient.patchEvent({ accessToken, calendarId: connection.calendarId, eventId: event.googleEventId, event: payload })
      : await syncDeps.googleCalendarApiClient.insertEvent({ accessToken, calendarId: connection.calendarId, event: payload });

    await deps.calendarEventRepository.update(event.id, {
      syncState: "ok",
      lastSyncError: null,
      lastGoogleSyncAt: new Date().toISOString(),
      googleAccountId: connection.id,
      googleCalendarId: connection.calendarId,
      googleEventId: result.id ?? event.googleEventId ?? null,
      googleEtag: result.etag ?? null,
      googleUpdatedAt: result.updated ?? null,
      htmlLink: result.htmlLink ?? null,
      source: "system",
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao sincronizar com o Google Calendar.";
    await deps.calendarEventRepository.update(event.id, { syncState: "failed", lastSyncError: message });
    return { ok: false, error: message };
  }
}

/** Reenvia em lote os eventos `system` pendentes (nunca sincronizados, ou última tentativa
 * `failed`), dentro da janela de lookback — chamado após conectar, trocar calendário, sync manual
 * e a cada ciclo do cron (seção 2.5 do relatório). */
export async function pushPendingSystemEventsForConnection(deps: CalendarSyncUseCaseDeps, connectionId: string, limit = 50): Promise<{ pushed: number }> {
  const syncDeps = requireSyncDeps(deps);
  const connection = await syncDeps.calendarConnectionRepository.getById(connectionId);
  if (!connection) return { pushed: 0 };
  const lookbackFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const pending = await deps.calendarEventRepository.listPendingPush({ tenantId: connection.tenantId, workspaceId: connection.workspaceId, ownerUserId: connection.userId, lookbackFrom, limit });
  for (const event of pending) await pushSystemEventToGoogle(deps, { eventId: event.id, action: "UPDATE" });
  return { pushed: pending.length };
}

async function applyGoogleEventToSystem(deps: CalendarSyncUseCaseDeps, connection: { id: string; tenantId: string; workspaceId: string; userId: string; calendarId: string }, googleEvent: GoogleCalendarEventPayload): Promise<void> {
  if (googleEvent.status === "cancelled") {
    if (!googleEvent.id) return;
    const existing = await deps.calendarEventRepository.findByGoogleEventId(connection.id, googleEvent.id);
    if (existing) await deps.calendarEventRepository.update(existing.id, { status: "cancelled", source: "google" });
    return;
  }
  if (!googleEvent.id) return;
  const startIso = googleEvent.start?.dateTime ?? (googleEvent.start?.date ? `${googleEvent.start.date}T00:00:00.000Z` : undefined);
  const endIso = googleEvent.end?.dateTime ?? (googleEvent.end?.date ? `${googleEvent.end.date}T00:00:00.000Z` : undefined);
  if (!startIso || !endIso) return;

  const attendees = (googleEvent.attendees ?? []).map((attendee) => attendee.email);
  const existing = await deps.calendarEventRepository.findByGoogleEventId(connection.id, googleEvent.id);
  const nowIso = new Date().toISOString();

  if (existing) {
    await deps.calendarEventRepository.update(existing.id, {
      title: googleEvent.summary || "(sem título)",
      description: googleEvent.description,
      location: googleEvent.location,
      startAt: startIso,
      endAt: endIso,
      allDay: Boolean(googleEvent.start?.date),
      attendees,
      status: "confirmed",
      source: "google",
      googleEtag: googleEvent.etag ?? null,
      googleUpdatedAt: googleEvent.updated ?? null,
      htmlLink: googleEvent.htmlLink ?? null,
      lastGoogleSyncAt: nowIso,
    });
    return;
  }

  const created = await deps.calendarEventRepository.create({
    tenantId: connection.tenantId,
    workspaceId: connection.workspaceId,
    ownerUserId: connection.userId,
    title: googleEvent.summary || "(sem título)",
    description: googleEvent.description,
    location: googleEvent.location,
    startAt: startIso,
    endAt: endIso,
    timezone: googleEvent.start?.timeZone ?? "UTC",
    allDay: Boolean(googleEvent.start?.date),
    attendees,
    source: "google",
  });
  await deps.calendarEventRepository.update(created.id, {
    googleAccountId: connection.id,
    googleCalendarId: connection.calendarId,
    googleEventId: googleEvent.id,
    googleEtag: googleEvent.etag ?? null,
    googleUpdatedAt: googleEvent.updated ?? null,
    htmlLink: googleEvent.htmlLink ?? null,
    syncState: "ok",
    lastGoogleSyncAt: nowIso,
  });
}

// Lock em memória — mesma limitação documentada do CMDesk (seção 2.3 do relatório: risco de
// corrida entre réplicas diferentes, não tratado; aqui nem existe webhook concorrendo com o cron,
// só o próprio cron, então o risco real é ainda menor).
const runningConnections = new Set<string>();

export async function syncIncrementalForConnection(deps: CalendarSyncUseCaseDeps, connectionId: string): Promise<void> {
  const syncDeps = requireSyncDeps(deps);
  const connection = await syncDeps.calendarConnectionRepository.getById(connectionId);
  if (!connection || connection.status !== "connected") return;
  if (!connection.syncToken) return syncFullForConnection(deps, connectionId);
  if (runningConnections.has(connectionId)) return;
  runningConnections.add(connectionId);
  try {
    const accessToken = await syncDeps.googleCalendarOAuthService.getValidAccessToken(connection);
    if (!accessToken) {
      await syncDeps.calendarConnectionRepository.update(connectionId, { status: "error", lastErrorMessage: "Token inválido ou expirado." });
      return;
    }
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    do {
      const response = await syncDeps.googleCalendarApiClient.listEvents({ accessToken, calendarId: connection.calendarId, syncToken: connection.syncToken, pageToken });
      for (const item of response.items) await applyGoogleEventToSystem(deps, connection, item);
      pageToken = response.nextPageToken;
      nextSyncToken = response.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    await syncDeps.calendarConnectionRepository.update(connectionId, { syncToken: nextSyncToken ?? connection.syncToken, lastSyncedAt: new Date().toISOString(), status: "connected", lastErrorMessage: null });
  } catch (error) {
    // syncToken expirado/inválido (410/404) — mesmo tratamento explícito do relatório: descarta o
    // token e cai pra carga completa, nunca propaga o erro como falha definitiva.
    if (isHttpStatusError(error) && (error.status === 410 || error.status === 404)) {
      await syncDeps.calendarConnectionRepository.update(connectionId, { syncToken: null });
      await syncFullForConnection(deps, connectionId);
      return;
    }
    await syncDeps.calendarConnectionRepository.update(connectionId, { status: "error", lastErrorMessage: error instanceof Error ? error.message : "Falha ao sincronizar." });
  } finally {
    runningConnections.delete(connectionId);
  }
}

export async function syncFullForConnection(deps: CalendarSyncUseCaseDeps, connectionId: string): Promise<void> {
  const syncDeps = requireSyncDeps(deps);
  const connection = await syncDeps.calendarConnectionRepository.getById(connectionId);
  if (!connection || connection.status !== "connected") return;
  const accessToken = await syncDeps.googleCalendarOAuthService.getValidAccessToken(connection);
  if (!accessToken) {
    await syncDeps.calendarConnectionRepository.update(connectionId, { status: "error", lastErrorMessage: "Token inválido ou expirado." });
    return;
  }
  // Últimos 12 meses (seção 2.3 do relatório) — carga completa nunca varre o histórico inteiro.
  const timeMinIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  try {
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    do {
      const response = await syncDeps.googleCalendarApiClient.listEvents({ accessToken, calendarId: connection.calendarId, timeMinIso, pageToken });
      for (const item of response.items) await applyGoogleEventToSystem(deps, connection, item);
      pageToken = response.nextPageToken;
      nextSyncToken = response.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    await syncDeps.calendarConnectionRepository.update(connectionId, { syncToken: nextSyncToken, lastSyncedAt: new Date().toISOString(), status: "connected", lastErrorMessage: null });
  } catch (error) {
    await syncDeps.calendarConnectionRepository.update(connectionId, { status: "error", lastErrorMessage: error instanceof Error ? error.message : "Falha ao sincronizar." });
  }
}
