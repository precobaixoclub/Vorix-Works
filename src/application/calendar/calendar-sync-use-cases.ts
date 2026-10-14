import {
  hasPendingLocalChange,
  utcToZonedDate,
  zonedLocalToUtc,
  type CalendarConnection,
  type CalendarEvent,
} from "../../domain/calendar/calendar.model.js";
import type { CalendarConnectionRepositoryPort } from "../ports/calendar-connection-repository.port.js";
import type { CalendarEventContentPatch, CalendarEventRepositoryPort, GoogleEventIdentity } from "../ports/calendar-event-repository.port.js";

/**
 * Sincronização bidirecional Agenda ↔ Google Calendar, por POLLING periódico (webhook/watch fica
 * para depois, como otimização). Política completa em `calendar.model.ts`; resumo:
 *
 *   lease da conta (Postgres) → token → PULL (incremental; 410 = carga completa) → PUSH das edições
 *   locais pendentes (If-Match) → grava syncToken/próximo sync → libera o lease.
 *
 * Toda decisão (eco ignorado, conflito, erro, reconexão necessária) vai para `calendar_sync_log`.
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
  organizer?: { email?: string; self?: boolean };
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }>; createRequest?: unknown };
  recurringEventId?: string;
  originalStartTime?: { date?: string; dateTime?: string; timeZone?: string };
  etag?: string;
  updated?: string;
  extendedProperties?: { private?: Record<string, string> };
};

export type CalendarSyncApiPort = {
  listEvents(input: { accessToken: string; calendarId: string; syncToken?: string; pageToken?: string; timeMinIso?: string }): Promise<{ items: GoogleCalendarEventPayload[]; nextPageToken?: string; nextSyncToken?: string }>;
  getEvent(input: { accessToken: string; calendarId: string; eventId: string }): Promise<GoogleCalendarEventPayload>;
  insertEvent(input: { accessToken: string; calendarId: string; event: GoogleCalendarEventPayload; createMeet: boolean }): Promise<GoogleCalendarEventPayload>;
  patchEvent(input: { accessToken: string; calendarId: string; eventId: string; event: GoogleCalendarEventPayload; ifMatchEtag?: string }): Promise<GoogleCalendarEventPayload>;
  deleteEvent(input: { accessToken: string; calendarId: string; eventId: string }): Promise<void>;
};

export type AccessTokenResult = { ok: true; accessToken: string } | { ok: false; reason: "not_configured" | "revoked" | "transient"; message: string };

export type CalendarSyncOAuthPort = {
  getAccessToken(input: { tenantId: string; workspaceId: string; userId: string }): Promise<AccessTokenResult>;
};

export type CalendarSyncDeps = {
  events: CalendarEventRepositoryPort;
  connections: CalendarConnectionRepositoryPort;
  oauth: CalendarSyncOAuthPort;
  api: CalendarSyncApiPort;
  now: () => Date;
  /** Intervalo do polling (próximo sync agendado). */
  intervalMs: number;
  /** Duração do lease da conta — maior que um sync normal; vence sozinho se o processo morrer. */
  leaseMs: number;
  /** Janela da carga completa (sem syncToken). */
  fullSyncPastDays: number;
};

export type CalendarSyncReport = {
  status: "synced" | "locked" | "not_connected" | "reconnect_required" | "error";
  pulled: number;
  pushed: number;
  echoes: number;
  conflicts: number;
  errors: number;
  fullResync: boolean;
};

/** Erro com status HTTP (o adapter lança `GoogleCalendarApiError`) — checado por duck typing. */
function httpStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error && typeof (error as { status: unknown }).status === "number" ? (error as { status: number }).status : undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

function meetLinkOf(remote: GoogleCalendarEventPayload): string | undefined {
  return remote.hangoutLink ?? remote.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;
}

function timeOf(value: { date?: string; dateTime?: string } | undefined, timeZone: string): string | undefined {
  if (value?.dateTime) return new Date(value.dateTime).toISOString();
  if (value?.date) return zonedLocalToUtc(value.date, timeZone).toISOString();
  return undefined;
}

/** Conteúdo do evento remoto como patch local (dia inteiro: meia-noite LOCAL no fuso do evento). */
export function remoteToPatch(remote: GoogleCalendarEventPayload, fallbackTimeZone: string): CalendarEventContentPatch | undefined {
  const timeZone = remote.start?.timeZone ?? remote.end?.timeZone ?? fallbackTimeZone;
  const startAt = timeOf(remote.start, timeZone);
  const endAt = timeOf(remote.end, timeZone);
  if (!startAt || !endAt) return undefined;
  return {
    title: remote.summary?.trim() || "(sem título)",
    description: remote.description ?? null,
    location: remote.location ?? null,
    startAt,
    endAt,
    timezone: timeZone,
    allDay: Boolean(remote.start?.date),
    attendees: (remote.attendees ?? []).map((attendee) => attendee.email).filter(Boolean),
  };
}

function identityOf(remote: GoogleCalendarEventPayload, connection: CalendarConnection): Partial<GoogleEventIdentity> {
  const originalTz = remote.originalStartTime?.timeZone ?? remote.start?.timeZone ?? DEFAULT_TIMEZONE;
  const original = timeOf(remote.originalStartTime, originalTz);
  const meetLink = meetLinkOf(remote);
  return {
    googleAccountId: connection.id,
    googleCalendarId: connection.calendarId,
    ...(remote.id ? { googleEventId: remote.id } : {}),
    ...(remote.etag ? { googleEtag: remote.etag } : {}),
    ...(remote.updated ? { googleUpdatedAt: remote.updated } : {}),
    ...(remote.recurringEventId ? { googleRecurringEventId: remote.recurringEventId } : {}),
    ...(original ? { googleOriginalStartAt: original } : {}),
    ...(remote.htmlLink ? { htmlLink: remote.htmlLink } : {}),
    ...(meetLink ? { meetLink } : {}),
    ...(remote.organizer?.email ? { organizerEmail: remote.organizer.email.trim().toLowerCase() } : {}),
  };
}

/** Evento local → corpo do Google. A marca `vorixEventId` reconcilia um insert cuja resposta se
 * perdeu (o próximo pull reconhece o evento como nosso em vez de duplicar). */
export function toGooglePayload(event: CalendarEvent): GoogleCalendarEventPayload {
  const field = (iso: string) => (event.allDay ? { date: utcToZonedDate(new Date(iso), event.timezone) } : { dateTime: iso, timeZone: event.timezone });
  return {
    summary: event.title,
    description: event.description ?? "",
    location: event.location ?? "",
    start: field(event.startAt),
    end: field(event.endAt),
    attendees: event.attendees.map((email) => ({ email })),
    extendedProperties: { private: { vorixEventId: event.id } },
  };
}

export async function syncConnection(deps: CalendarSyncDeps, input: { connectionId: string; owner: string }): Promise<CalendarSyncReport> {
  const report: CalendarSyncReport = { status: "synced", pulled: 0, pushed: 0, echoes: 0, conflicts: 0, errors: 0, fullResync: false };
  const connection = await deps.connections.acquireSyncLease(input.connectionId, input.owner, deps.leaseMs);
  if (!connection) return { ...report, status: "locked" };
  const base = { tenantId: connection.tenantId, workspaceId: connection.workspaceId, connectionId: connection.id };
  try {
    if (connection.status !== "connected") return { ...report, status: "not_connected" };
    const token = await deps.oauth.getAccessToken({ tenantId: connection.tenantId, workspaceId: connection.workspaceId, userId: connection.userId });
    if (!token.ok) {
      if (token.reason === "revoked" || token.reason === "not_configured") {
        await deps.connections.update(connection.id, { status: "error", lastErrorMessage: "Google Calendar precisa ser reconectado.", succeeded: false });
        await deps.connections.log({ ...base, direction: "auth", action: "token_refresh", status: "error", error: token.message });
        return { ...report, status: "reconnect_required" };
      }
      await scheduleRetry(deps, connection, token.message);
      await deps.connections.log({ ...base, direction: "auth", action: "token_refresh", status: "error", error: token.message });
      return { ...report, status: "error", errors: 1 };
    }

    const nextSyncToken = await pull(deps, connection, token.accessToken, report);
    await push(deps, connection, token.accessToken, report);
    await deps.connections.update(connection.id, {
      ...(nextSyncToken ? { syncToken: nextSyncToken } : {}),
      lastSyncedAt: deps.now().toISOString(),
      status: "connected",
      lastErrorMessage: null,
      succeeded: true,
      nextSyncAt: new Date(deps.now().getTime() + deps.intervalMs).toISOString(),
    });
    await deps.connections.log({ ...base, direction: "sync", action: report.fullResync ? "full_sync" : "incremental_sync", status: "ok", error: `pulled=${report.pulled} pushed=${report.pushed} echoes=${report.echoes} conflicts=${report.conflicts} errors=${report.errors}` });
    return report;
  } catch (error) {
    if (httpStatus(error) === 401 || httpStatus(error) === 403) {
      await deps.connections.update(connection.id, { status: "error", lastErrorMessage: "Google Calendar precisa ser reconectado.", succeeded: false });
      await deps.connections.log({ ...base, direction: "sync", action: "sync", status: "error", error: message(error) });
      return { ...report, status: "reconnect_required" };
    }
    await scheduleRetry(deps, connection, message(error));
    await deps.connections.log({ ...base, direction: "sync", action: "sync", status: "error", error: message(error) });
    return { ...report, status: "error", errors: report.errors + 1 };
  } finally {
    await deps.connections.releaseSyncLease(connection.id, input.owner);
  }
}

/** Falha transitória: continua conectada, tenta de novo com backoff (até 30 min). */
async function scheduleRetry(deps: CalendarSyncDeps, connection: CalendarConnection, error: string): Promise<void> {
  const backoff = Math.min(30 * 60_000, deps.intervalMs * 2 ** Math.min(connection.consecutiveFailures, 5));
  await deps.connections.update(connection.id, { lastErrorMessage: error, succeeded: false, nextSyncAt: new Date(deps.now().getTime() + backoff).toISOString() });
}

async function pull(deps: CalendarSyncDeps, connection: CalendarConnection, accessToken: string, report: CalendarSyncReport): Promise<string | undefined> {
  const run = async (syncToken: string | undefined) => {
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    do {
      const page = await deps.api.listEvents({
        accessToken,
        calendarId: connection.calendarId,
        ...(syncToken ? { syncToken } : { timeMinIso: new Date(deps.now().getTime() - deps.fullSyncPastDays * 24 * 60 * 60 * 1000).toISOString() }),
        ...(pageToken ? { pageToken } : {}),
      });
      for (const remote of page.items) await applyRemoteEvent(deps, connection, remote, report);
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    return nextSyncToken;
  };
  if (!connection.syncToken) {
    report.fullResync = true;
    return run(undefined);
  }
  try {
    return await run(connection.syncToken);
  } catch (error) {
    // syncToken expirado/inválido: o Google manda refazer a carga completa.
    if (httpStatus(error) !== 410) throw error;
    await deps.connections.log({ tenantId: connection.tenantId, workspaceId: connection.workspaceId, connectionId: connection.id, direction: "pull", action: "sync_token_expired", status: "ok", error: "410 — refazendo carga completa" });
    await deps.connections.update(connection.id, { syncToken: null });
    report.fullResync = true;
    return run(undefined);
  }
}

async function applyRemoteEvent(deps: CalendarSyncDeps, connection: CalendarConnection, remote: GoogleCalendarEventPayload, report: CalendarSyncReport): Promise<void> {
  if (!remote.id) return;
  const base = { tenantId: connection.tenantId, workspaceId: connection.workspaceId, connectionId: connection.id, googleEventId: remote.id };
  const remoteCancelled = remote.status === "cancelled";
  let local = await deps.events.findByGoogleEventId(connection.id, remote.id);

  // Insert nosso cuja resposta se perdeu: o evento volta do Google com a nossa marca.
  const vorixId = remote.extendedProperties?.private?.vorixEventId;
  if (!local && vorixId) {
    const candidate = await deps.events.getById(vorixId);
    if (candidate && candidate.tenantId === connection.tenantId && candidate.ownerUserId === connection.userId && !candidate.googleEventId) {
      local = await deps.events.markPushed(candidate.id, candidate.localVersion, identityOf(remote, connection));
      report.echoes += 1;
      await deps.connections.log({ ...base, eventId: candidate.id, direction: "pull", action: "relink_own_event", status: "skipped" });
      return;
    }
  }

  if (!local) {
    if (remoteCancelled) return;
    const patch = remoteToPatch(remote, DEFAULT_TIMEZONE);
    if (!patch) return;
    const identity = identityOf(remote, connection);
    const created = await deps.events.create({
      tenantId: connection.tenantId,
      workspaceId: connection.workspaceId,
      ownerUserId: connection.userId,
      title: patch.title!,
      ...(patch.description ? { description: patch.description } : {}),
      ...(patch.location ? { location: patch.location } : {}),
      startAt: patch.startAt!,
      endAt: patch.endAt!,
      timezone: patch.timezone!,
      allDay: patch.allDay ?? false,
      attendees: patch.attendees ?? [],
      source: "google",
      google: { googleAccountId: connection.id, googleCalendarId: connection.calendarId, googleEventId: remote.id, ...identity },
    });
    report.pulled += 1;
    await deps.connections.log({ ...base, eventId: created.id, direction: "pull", action: "create", status: "ok" });
    return;
  }

  // Anti-eco: o mesmo etag que já temos = é o nosso próprio push voltando (ou nada mudou).
  if (local.googleEtag && remote.etag && local.googleEtag === remote.etag) {
    report.echoes += 1;
    return;
  }

  if (hasPendingLocalChange(local)) {
    if (remoteCancelled && local.status === "cancelled") {
      await deps.events.applyRemoteChange(local.id, {}, identityOf(remote, connection));
      await deps.events.markPushed(local.id, local.localVersion, {});
      return;
    }
    // CONFLITO: os dois lados mudaram. Nada é sobrescrito; fica registrado para decisão humana.
    await deps.events.setSyncState(local.id, "conflict", "O evento foi alterado no Google e no Vorix ao mesmo tempo.", remote as Record<string, unknown>);
    report.conflicts += 1;
    await deps.connections.log({ ...base, eventId: local.id, direction: "pull", action: "conflict", status: "conflict", error: "edição local pendente e evento alterado no Google" });
    return;
  }

  const patch: CalendarEventContentPatch = remoteCancelled ? {} : remoteToPatch(remote, local.timezone) ?? {};
  // Estado terminal protegido: concluído nunca volta a "confirmado"; cancelado local não é revertido.
  if (remoteCancelled && local.status === "confirmed") patch.status = "cancelled";
  await deps.events.applyRemoteChange(local.id, patch, identityOf(remote, connection));
  report.pulled += 1;
  await deps.connections.log({ ...base, eventId: local.id, direction: "pull", action: remoteCancelled ? (patch.status ? "cancel" : "cancel_ignored_terminal") : "update", status: "ok" });
}

async function push(deps: CalendarSyncDeps, connection: CalendarConnection, accessToken: string, report: CalendarSyncReport): Promise<void> {
  const pending = await deps.events.listPendingPush({ tenantId: connection.tenantId, workspaceId: connection.workspaceId, ownerUserId: connection.userId, limit: 100 });
  for (const event of pending) {
    const base = { tenantId: connection.tenantId, workspaceId: connection.workspaceId, connectionId: connection.id, eventId: event.id, ...(event.googleEventId ? { googleEventId: event.googleEventId } : {}) };
    const version = event.localVersion;
    try {
      if (event.status === "cancelled") {
        if (event.googleEventId) await deps.api.deleteEvent({ accessToken, calendarId: event.googleCalendarId ?? connection.calendarId, eventId: event.googleEventId });
        await deps.events.markPushed(event.id, version, {});
        report.pushed += 1;
        await deps.connections.log({ ...base, direction: "push", action: "delete", status: "ok" });
        continue;
      }
      if (event.googleEventId) {
        const result = await deps.api.patchEvent({ accessToken, calendarId: event.googleCalendarId ?? connection.calendarId, eventId: event.googleEventId, event: toGooglePayload(event), ...(event.googleEtag ? { ifMatchEtag: event.googleEtag } : {}) });
        await deps.events.markPushed(event.id, version, identityOf(result, connection));
        report.pushed += 1;
        await deps.connections.log({ ...base, direction: "push", action: "update", status: "ok" });
        continue;
      }
      const result = await deps.api.insertEvent({ accessToken, calendarId: connection.calendarId, event: toGooglePayload(event), createMeet: event.wantsMeetLink });
      await deps.events.markPushed(event.id, version, identityOf(result, connection));
      report.pushed += 1;
      await deps.connections.log({ ...base, googleEventId: result.id, direction: "push", action: "create", status: "ok" });
    } catch (error) {
      const status = httpStatus(error);
      if (status === 412 || status === 404 || status === 410) {
        // Mudou (412) ou sumiu (404/410) no Google depois da nossa última leitura: nunca sobrescreve.
        let snapshot: Record<string, unknown> = { status: status === 412 ? "changed" : "deleted_in_google" };
        if (status === 412 && event.googleEventId) {
          snapshot = (await deps.api.getEvent({ accessToken, calendarId: event.googleCalendarId ?? connection.calendarId, eventId: event.googleEventId }).catch(() => snapshot)) as Record<string, unknown>;
        }
        await deps.events.setSyncState(event.id, "conflict", status === 412 ? "O evento mudou no Google desde a última sincronização." : "O evento foi removido no Google.", snapshot);
        report.conflicts += 1;
        await deps.connections.log({ ...base, direction: "push", action: "conflict", status: "conflict", error: `HTTP ${status}` });
        continue;
      }
      if (status === 401 || status === 403) throw error;
      await deps.events.setSyncState(event.id, "failed", message(error));
      report.errors += 1;
      await deps.connections.log({ ...base, direction: "push", action: "push", status: "error", error: message(error) });
    }
  }
}

/** Resolve um conflito por decisão explícita: manter a versão do Vorix (reenvia sobre o etag atual
 * do Google) ou aceitar a do Google (descarta a edição local). */
export async function resolveCalendarConflict(deps: Pick<CalendarSyncDeps, "events">, input: { event: CalendarEvent; keep: "local" | "remote" }): Promise<CalendarEvent> {
  const remote = (input.event.conflictRemote ?? {}) as GoogleCalendarEventPayload;
  if (input.keep === "local") {
    // Removido no Google: a versão local volta a ser criada lá (esquece o id antigo).
    const forget = (remote as { status?: string }).status === "deleted_in_google" ? ({ googleEventId: null, googleEtag: null } as unknown as Partial<GoogleEventIdentity>) : {};
    await deps.events.applyRemoteChange(input.event.id, {}, { ...forget, ...(remote.etag ? { googleEtag: remote.etag } : {}) });
    const bumped = await deps.events.applyLocalChange(input.event.id, {});
    return bumped;
  }
  const patch = remote.id ? remoteToPatch(remote, input.event.timezone) ?? {} : {};
  if (remote.status === "cancelled" && input.event.status === "confirmed") patch.status = "cancelled";
  await deps.events.applyRemoteChange(input.event.id, patch, remote.etag ? { googleEtag: remote.etag, ...(remote.updated ? { googleUpdatedAt: remote.updated } : {}) } : {});
  return deps.events.markPushed(input.event.id, input.event.localVersion, {});
}
