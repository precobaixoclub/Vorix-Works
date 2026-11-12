import { randomUUID } from "node:crypto";
import type { CalendarConnection, CalendarSyncLogEntry, GoogleCalendarOption } from "../../domain/calendar/calendar.model.js";
import type { CalendarConnectionRepositoryPort } from "../ports/calendar-connection-repository.port.js";
import type { CalendarEventRepositoryPort } from "../ports/calendar-event-repository.port.js";

/** OAuth do Google Calendar, implementado em `infrastructure/calendar` (injetado via DI). */
export type GoogleCalendarAuthPort = {
  isConfigured(): boolean;
  begin(input: { tenantId: string; workspaceId: string; userId: string }): { authorizationUrl: string };
  verifyState(state: string): { tenantId: string; workspaceId: string; userId: string };
  complete(input: { state: string; code: string }): Promise<CalendarConnection>;
  disconnect(input: { tenantId: string; workspaceId: string; userId: string }): Promise<void>;
  /** Token de acesso do Google da pessoa (renovado quando preciso) — usado também pelo Meetings
   * para ler a transcrição nativa do Google Meet. */
  getAccessToken(input: { tenantId: string; workspaceId: string; userId: string }): Promise<{ ok: true; accessToken: string } | { ok: false; reason: string; message: string }>;
};

/** Lista de agendas da conta Google (implementada em `infrastructure/calendar`). */
export type GoogleCalendarListPort = {
  listCalendars(input: { accessToken: string }): Promise<GoogleCalendarOption[]>;
};

export type CalendarConnectionDeps = {
  connections: CalendarConnectionRepositoryPort;
  auth: GoogleCalendarAuthPort;
  now: () => Date;
  /** Escolha de agenda: sem isso, a conta usa sempre a agenda principal. */
  calendars?: GoogleCalendarListPort;
  events?: Pick<CalendarEventRepositoryPort, "removeImportedFromCalendar">;
};

export type CalendarConnectionActor = { tenantId: string; userId: string };

export type GoogleCalendarStatus = {
  configured: boolean;
  status: "not_connected" | "connected" | "reconnect_required" | "disconnected";
  googleEmail?: string;
  lastSyncedAt?: string;
  lastErrorMessage?: string;
  lastErrorAt?: string;
  nextSyncAt?: string;
};

export async function getGoogleCalendarStatus(deps: CalendarConnectionDeps, actor: CalendarConnectionActor, input: { workspaceId: string }): Promise<GoogleCalendarStatus> {
  const connection = await deps.connections.getByUser({ tenantId: actor.tenantId, workspaceId: input.workspaceId, userId: actor.userId });
  const configured = deps.auth.isConfigured();
  if (!connection) return { configured, status: "not_connected" };
  return {
    configured,
    status: connection.status === "connected" ? "connected" : connection.status === "error" ? "reconnect_required" : "disconnected",
    ...(connection.googleEmail ? { googleEmail: connection.googleEmail } : {}),
    ...(connection.lastSyncedAt ? { lastSyncedAt: connection.lastSyncedAt } : {}),
    ...(connection.lastErrorMessage ? { lastErrorMessage: connection.lastErrorMessage } : {}),
    ...(connection.lastErrorAt ? { lastErrorAt: connection.lastErrorAt } : {}),
    ...(connection.nextSyncAt ? { nextSyncAt: connection.nextSyncAt } : {}),
  };
}

export function beginGoogleCalendarConnect(deps: CalendarConnectionDeps, actor: CalendarConnectionActor, input: { workspaceId: string }): { authorizationUrl: string } {
  return deps.auth.begin({ tenantId: actor.tenantId, workspaceId: input.workspaceId, userId: actor.userId });
}

/** Conclui o OAuth. O `state` assinado precisa ser da MESMA pessoa logada (nunca conecta a conta
 * Google de alguém na Agenda de outra pessoa). */
export async function completeGoogleCalendarConnect(deps: CalendarConnectionDeps, actor: CalendarConnectionActor, input: { state: string; code: string }): Promise<GoogleCalendarStatus> {
  const owner = deps.auth.verifyState(input.state);
  if (owner.tenantId !== actor.tenantId || owner.userId !== actor.userId) throw new Error("CALENDAR_OAUTH_STATE_INVALID: esta autorização foi iniciada por outra conta.");
  const connection = await deps.auth.complete(input);
  await deps.connections.log({ tenantId: connection.tenantId, workspaceId: connection.workspaceId, connectionId: connection.id, direction: "auth", action: "connect", status: "ok" });
  return getGoogleCalendarStatus(deps, actor, { workspaceId: owner.workspaceId });
}

export async function disconnectGoogleCalendar(deps: CalendarConnectionDeps, actor: CalendarConnectionActor, input: { workspaceId: string }): Promise<GoogleCalendarStatus> {
  const owner = { tenantId: actor.tenantId, workspaceId: input.workspaceId, userId: actor.userId };
  const connection = await deps.connections.getByUser(owner);
  await deps.auth.disconnect(owner);
  if (connection) await deps.connections.log({ tenantId: owner.tenantId, workspaceId: owner.workspaceId, connectionId: connection.id, direction: "auth", action: "disconnect", status: "ok" });
  return getGoogleCalendarStatus(deps, actor, input);
}

/** "Sincronizar agora": antecipa o próximo ciclo do worker (não sincroniza dentro da requisição). */
export async function requestGoogleCalendarSync(deps: CalendarConnectionDeps, actor: CalendarConnectionActor, input: { workspaceId: string }): Promise<GoogleCalendarStatus> {
  const connection = await deps.connections.getByUser({ tenantId: actor.tenantId, workspaceId: input.workspaceId, userId: actor.userId });
  if (connection?.status === "connected") await deps.connections.update(connection.id, { nextSyncAt: deps.now().toISOString() });
  return getGoogleCalendarStatus(deps, actor, input);
}

export async function listGoogleCalendarSyncLog(deps: CalendarConnectionDeps, actor: CalendarConnectionActor, input: { workspaceId: string; limit?: number }): Promise<(CalendarSyncLogEntry & { createdAt: string })[]> {
  const connection = await deps.connections.getByUser({ tenantId: actor.tenantId, workspaceId: input.workspaceId, userId: actor.userId });
  if (!connection) return [];
  return deps.connections.listLog({ tenantId: actor.tenantId, connectionId: connection.id, limit: Math.min(Math.max(input.limit ?? 50, 1), 200) });
}

export type GoogleCalendarChoice = { selectedId: string; calendars: GoogleCalendarOption[] };

/** Agendas da conta Google da pessoa em que ela pode criar eventos, com a que está sincronizada. */
export async function listGoogleCalendars(deps: CalendarConnectionDeps, actor: CalendarConnectionActor, input: { workspaceId: string }): Promise<GoogleCalendarChoice> {
  const owner = { tenantId: actor.tenantId, workspaceId: input.workspaceId, userId: actor.userId };
  const connection = await deps.connections.getByUser(owner);
  if (!connection || connection.status !== "connected") throw new Error("CALENDAR_OAUTH_NOT_CONNECTED: conecte o Google Calendar primeiro.");
  return fetchCalendars(deps, owner, connection);
}

/**
 * Troca a agenda sincronizada. Só aceita uma agenda da PRÓPRIA conta em que a pessoa pode criar
 * eventos. A próxima sincronização faz a carga completa da agenda nova; as cópias locais dos eventos
 * importados da anterior saem da Vorix (nada é apagado no Google). Segura o lease do sync durante a
 * troca, para o worker nunca gravar o syncToken da agenda antiga por cima.
 */
export async function selectGoogleCalendar(deps: CalendarConnectionDeps, actor: CalendarConnectionActor, input: { workspaceId: string; calendarId: string }): Promise<GoogleCalendarStatus> {
  const owner = { tenantId: actor.tenantId, workspaceId: input.workspaceId, userId: actor.userId };
  const connection = await deps.connections.getByUser(owner);
  if (!connection || connection.status !== "connected") throw new Error("CALENDAR_OAUTH_NOT_CONNECTED: conecte o Google Calendar primeiro.");
  const { selectedId, calendars } = await fetchCalendars(deps, owner, connection);
  const target = calendars.find((calendar) => calendar.id === input.calendarId);
  if (!target) throw new Error("CALENDAR_OAUTH_CALENDAR_NOT_ALLOWED: escolha uma agenda da sua conta Google em que você pode criar eventos.");
  if (target.id === selectedId) return getGoogleCalendarStatus(deps, actor, input);

  const leaseOwner = `select-calendar:${randomUUID()}`;
  const locked = await deps.connections.acquireSyncLease(connection.id, leaseOwner, 60_000);
  if (!locked) throw new Error("CALENDAR_OAUTH_SYNC_BUSY: a agenda está sincronizando agora — tente de novo em alguns segundos.");
  try {
    await deps.connections.update(connection.id, { calendarId: target.id, syncToken: null, nextSyncAt: deps.now().toISOString() });
    const removed = deps.events ? await deps.events.removeImportedFromCalendar({ googleAccountId: connection.id, googleCalendarId: locked.calendarId }) : 0;
    await deps.connections.log({ tenantId: owner.tenantId, workspaceId: owner.workspaceId, connectionId: connection.id, direction: "auth", action: "select_calendar", status: "ok", ...(removed ? { error: `${removed} evento(s) da agenda anterior retirados da Vorix` } : {}) });
  } finally {
    await deps.connections.releaseSyncLease(connection.id, leaseOwner);
  }
  return getGoogleCalendarStatus(deps, actor, input);
}

async function fetchCalendars(deps: CalendarConnectionDeps, owner: { tenantId: string; workspaceId: string; userId: string }, connection: CalendarConnection): Promise<GoogleCalendarChoice> {
  if (!deps.calendars) throw new Error("CALENDAR_OAUTH_NOT_CONFIGURED: a escolha de agenda não está disponível neste servidor.");
  const token = await deps.auth.getAccessToken(owner);
  if (!token.ok) throw new Error(`CALENDAR_OAUTH_RECONNECT_REQUIRED: ${token.message}`);
  let calendars: GoogleCalendarOption[];
  try {
    calendars = await deps.calendars.listCalendars({ accessToken: token.accessToken });
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    // Conectado antes desta permissão existir: o Google recusa a lista até a pessoa reconectar.
    if (status === 401 || status === 403) throw new Error("CALENDAR_OAUTH_RECONNECT_REQUIRED: reconecte o Google Calendar para permitir escolher a agenda.");
    throw new Error("CALENDAR_OAUTH_GOOGLE_UNAVAILABLE: não foi possível buscar suas agendas no Google agora — tente de novo.");
  }
  const selected = calendars.find((calendar) => calendar.id === connection.calendarId) ?? (connection.calendarId === "primary" ? calendars.find((calendar) => calendar.primary) : undefined);
  return { selectedId: selected?.id ?? connection.calendarId, calendars };
}
