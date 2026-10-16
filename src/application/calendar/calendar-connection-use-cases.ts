import type { CalendarConnection, CalendarSyncLogEntry } from "../../domain/calendar/calendar.model.js";
import type { CalendarConnectionRepositoryPort } from "../ports/calendar-connection-repository.port.js";

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

export type CalendarConnectionDeps = {
  connections: CalendarConnectionRepositoryPort;
  auth: GoogleCalendarAuthPort;
  now: () => Date;
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
