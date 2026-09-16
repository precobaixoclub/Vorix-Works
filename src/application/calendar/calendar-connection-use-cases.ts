import type { CalendarConnection } from "../../domain/calendar/calendar.model.js";
import type { CalendarConnectionRepositoryPort } from "../ports/calendar-connection-repository.port.js";
import { pushPendingSystemEventsForConnection, syncFullForConnection, syncIncrementalForConnection, type CalendarSyncApiPort, type CalendarSyncUseCaseDeps } from "./calendar-sync-use-cases.js";

/** OAuth por usuário (seção 2 do relatório) — interface mínima local, mesmo racional de
 * `CalendarSyncOAuthPort`: nunca importa a classe concreta de `infrastructure/`. */
export type CalendarOAuthPort = {
  isConfigured(): boolean;
  begin(input: { tenantId: string; workspaceId: string; userId: string }): { authorizationUrl: string; state: string };
  complete(input: { state: string; code: string }): Promise<CalendarConnection>;
  disconnect(input: { tenantId: string; workspaceId: string; userId: string }): Promise<void>;
  getValidAccessToken(input: { tenantId: string; workspaceId: string; userId: string }): Promise<string | undefined>;
};

export type CalendarConnectionUseCaseDeps = CalendarSyncUseCaseDeps & {
  calendarConnectionRepository?: CalendarConnectionRepositoryPort;
  googleCalendarOAuthService?: CalendarOAuthPort;
  googleCalendarApiClient?: CalendarSyncApiPort;
};

function requireConnectionDeps(deps: CalendarConnectionUseCaseDeps): { calendarConnectionRepository: CalendarConnectionRepositoryPort; googleCalendarOAuthService: CalendarOAuthPort; googleCalendarApiClient: CalendarSyncApiPort } {
  if (!deps.calendarConnectionRepository || !deps.googleCalendarOAuthService || !deps.googleCalendarApiClient) {
    throw new Error("CALENDAR_SYNC_NOT_CONFIGURED: sincronização com Google Calendar não está disponível neste ambiente.");
  }
  return { calendarConnectionRepository: deps.calendarConnectionRepository, googleCalendarOAuthService: deps.googleCalendarOAuthService, googleCalendarApiClient: deps.googleCalendarApiClient };
}

export type BeginCalendarOAuthInput = { tenantId: string; workspaceId: string; userId: string };

export function beginCalendarOAuth(deps: CalendarConnectionUseCaseDeps, input: BeginCalendarOAuthInput): { authorizationUrl: string; state: string } {
  const { googleCalendarOAuthService } = requireConnectionDeps(deps);
  if (!googleCalendarOAuthService.isConfigured()) throw new Error("CALENDAR_OAUTH_NOT_CONFIGURED: integração com Google Calendar não está configurada neste ambiente.");
  return googleCalendarOAuthService.begin(input);
}

export type CompleteCalendarOAuthInput = { state: string; code: string };

/** Pós-callback (seção 2.2 do relatório): carga completa + reenvio de pendências criadas antes da
 * conexão existir — tudo síncrono aqui (o próprio callback HTTP já é best-effort/redirect, sem
 * requisito de latência baixa como um endpoint de UI comum). */
export async function completeCalendarOAuth(deps: CalendarConnectionUseCaseDeps, input: CompleteCalendarOAuthInput): Promise<CalendarConnection> {
  const { googleCalendarOAuthService } = requireConnectionDeps(deps);
  const connection = await googleCalendarOAuthService.complete(input);
  await syncFullForConnection(deps, connection.id).catch(() => undefined);
  await pushPendingSystemEventsForConnection(deps, connection.id).catch(() => undefined);
  return connection;
}

export type GetCalendarConnectionStatusInput = { tenantId: string; workspaceId: string; userId: string };

export type CalendarConnectionStatus = { connected: boolean; configured: boolean; connection?: CalendarConnection };

export async function getCalendarConnectionStatus(deps: CalendarConnectionUseCaseDeps, input: GetCalendarConnectionStatusInput): Promise<CalendarConnectionStatus> {
  const configured = deps.googleCalendarOAuthService?.isConfigured() ?? false;
  if (!deps.calendarConnectionRepository) return { connected: false, configured };
  const connection = await deps.calendarConnectionRepository.getByUser(input);
  return { connected: connection?.status === "connected", configured, connection };
}

export type ListGoogleCalendarsInput = { tenantId: string; workspaceId: string; userId: string };

export async function listGoogleCalendars(deps: CalendarConnectionUseCaseDeps, input: ListGoogleCalendarsInput): Promise<{ id: string; summary: string; primary?: boolean }[]> {
  const { googleCalendarOAuthService, googleCalendarApiClient } = requireConnectionDeps(deps);
  const accessToken = await googleCalendarOAuthService.getValidAccessToken(input);
  if (!accessToken) throw new Error("CALENDAR_NOT_CONNECTED: conecte sua conta Google antes de listar calendários.");
  return googleCalendarApiClient.listCalendars({ accessToken });
}

export type UpdateSelectedCalendarInput = { tenantId: string; workspaceId: string; userId: string; calendarId: string };

/** Trocar o calendário selecionado reseta `syncToken` (seção 2.3 do relatório: obriga uma carga
 * completa do calendário novo, já que o token antigo é escopado ao calendário anterior). */
export async function updateSelectedCalendar(deps: CalendarConnectionUseCaseDeps, input: UpdateSelectedCalendarInput): Promise<CalendarConnection> {
  const { calendarConnectionRepository } = requireConnectionDeps(deps);
  const connection = await calendarConnectionRepository.getByUser(input);
  if (!connection) throw new Error("CALENDAR_NOT_CONNECTED: conecte sua conta Google antes de trocar o calendário.");
  const updated = await calendarConnectionRepository.update(connection.id, { calendarId: input.calendarId, syncToken: null });
  await syncFullForConnection(deps, connection.id).catch(() => undefined);
  return updated;
}

export type SetAutoSyncInput = { tenantId: string; workspaceId: string; userId: string; autoSyncEnabled: boolean };

export async function setCalendarAutoSync(deps: CalendarConnectionUseCaseDeps, input: SetAutoSyncInput): Promise<CalendarConnection> {
  const { calendarConnectionRepository } = requireConnectionDeps(deps);
  const connection = await calendarConnectionRepository.getByUser(input);
  if (!connection) throw new Error("CALENDAR_NOT_CONNECTED: conecte sua conta Google antes de alterar a sincronização automática.");
  return calendarConnectionRepository.update(connection.id, { autoSyncEnabled: input.autoSyncEnabled });
}

export type SyncCalendarNowInput = { tenantId: string; workspaceId: string; userId: string };

export async function syncCalendarNow(deps: CalendarConnectionUseCaseDeps, input: SyncCalendarNowInput): Promise<CalendarConnection> {
  const { calendarConnectionRepository } = requireConnectionDeps(deps);
  const connection = await calendarConnectionRepository.getByUser(input);
  if (!connection) throw new Error("CALENDAR_NOT_CONNECTED: conecte sua conta Google antes de sincronizar.");
  await syncIncrementalForConnection(deps, connection.id);
  await pushPendingSystemEventsForConnection(deps, connection.id).catch(() => undefined);
  return (await calendarConnectionRepository.getById(connection.id))!;
}

export type DisconnectCalendarInput = { tenantId: string; workspaceId: string; userId: string };

/** Nunca apaga `CalendarEvent`s já sincronizados — ficam "congelados" (seção 2.8 do relatório).
 * Novos eventos `system` simplesmente não encontram conta `connected` e ficam só locais. */
export async function disconnectCalendar(deps: CalendarConnectionUseCaseDeps, input: DisconnectCalendarInput): Promise<void> {
  const { googleCalendarOAuthService } = requireConnectionDeps(deps);
  await googleCalendarOAuthService.disconnect(input);
}

/** Chamado pelo worker cron (~2min) — varre contas devidas e sincroniza (seção 2.3 do relatório).
 * Best-effort por conta: uma falha isolada nunca impede as demais. */
export async function runDueCalendarSyncs(deps: CalendarConnectionUseCaseDeps, batchSize: number): Promise<{ checked: number }> {
  const { calendarConnectionRepository } = requireConnectionDeps(deps);
  const due = await calendarConnectionRepository.listDueForSync(batchSize);
  for (const connection of due) {
    await syncIncrementalForConnection(deps, connection.id).catch(() => undefined);
    await pushPendingSystemEventsForConnection(deps, connection.id).catch(() => undefined);
  }
  return { checked: due.length };
}
