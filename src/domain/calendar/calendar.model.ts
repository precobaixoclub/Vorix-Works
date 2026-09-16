/**
 * Bounded context "calendar" — Agenda + sincronização bidirecional com Google Calendar, réplica
 * adaptada do CMDesk (pedido explícito do usuário, relatório "Agenda e Central de Notificações no
 * CMDesk", Parte A). Deliberadamente SEM import de `inbox`/`crm`/nenhum outro bounded context —
 * `relatedEntityType`/`relatedEntityId` (seção 1.1 do relatório) ficam como campos livres, sem
 * resolução/join automática nesta rodada (fora de escopo: CMDesk resolve contra checklist de
 * projeto/serviço, entidades que o Vorix não tem — ver `enrichRelatedStatuses` no relatório).
 *
 * Escopo trimado deliberadamente em relação ao original (comunicado ao usuário no relatório
 * final desta rodada):
 * - Sem expansão de recorrência (RRULE) — só eventos avulsos. O relatório documenta um bug real
 *   do CMDesk nessa área (seção 1.2: reciclar o "id do sistema" faz todas as instâncias
 *   recorrentes colapsarem numa única linha local) — a forma mais segura de não herdar esse bug
 *   é não implementar recorrência agora, não tentar consertá-la às pressas.
 * - Sem geração automática de Google Meet (conferenceData) — evento simples por enquanto.
 * - Sem lembretes internos (nem um worker de lembrete nem repasse de reminders ao Google) — o
 *   relatório já documenta que nem o CMDesk tem lembrete de verdade sem depender do Google
 *   (seção 1.3); aqui nem repassamos o campo, então não há lembrete nenhum ainda.
 * - Sem webhook/watch channel do Google (push em tempo real) — só o cron periódico (~2min). O
 *   próprio relatório documenta que os dois mecanismos convergem pro MESMO método de sync
 *   (`syncIncrementalForAccount`); webhook é só uma otimização de latência, nunca um requisito de
 *   corretude. Cortar isso evita expor um endpoint público novo + verificação HMAC + renovação de
 *   canal só para ganhar "quase tempo real" em vez de "até ~2 min de atraso".
 */

export const CALENDAR_EVENT_STATUSES = ["confirmed", "cancelled", "done"] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

export const CALENDAR_EVENT_SOURCES = ["system", "google"] as const;
export type CalendarEventSource = (typeof CALENDAR_EVENT_SOURCES)[number];

export const CALENDAR_EVENT_SYNC_STATES = ["ok", "failed"] as const;
export type CalendarEventSyncState = (typeof CALENDAR_EVENT_SYNC_STATES)[number];

export type CalendarEvent = {
  id: string;
  tenantId: string;
  workspaceId: string;
  /** 1 responsável único — nunca múltiplos donos (mesmo racional do CMDesk, seção 1.1/1.4). */
  ownerUserId: string;
  title: string;
  description?: string;
  location?: string;
  /** UTC — a exibição/edição no fuso local é responsabilidade do frontend (`timezone` abaixo é só
   * informativo/repassado ao Google, nunca usado para converter `startAt`/`endAt`). */
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  /** E-mails livres, sem vínculo com `User` (mesmo racional do CMDesk — convidado nunca precisa
   * ser um usuário do tenant). */
  attendees: readonly string[];
  status: CalendarEventStatus;
  /** `system` = criado no Vorix, deve ser empurrado pro Google; `google` = espelho de um evento
   * criado direto no Google Calendar. */
  source: CalendarEventSource;
  relatedEntityType?: string;
  relatedEntityId?: string;
  googleAccountId?: string;
  googleCalendarId?: string;
  googleEventId?: string;
  googleEtag?: string;
  googleUpdatedAt?: string;
  htmlLink?: string;
  syncState?: CalendarEventSyncState;
  lastSyncError?: string;
  lastGoogleSyncAt?: string;
  createdAt: string;
  updatedAt: string;
};

export const GOOGLE_CALENDAR_CONNECTION_STATUSES = ["connected", "disconnected", "error"] as const;
export type GoogleCalendarConnectionStatus = (typeof GOOGLE_CALENDAR_CONNECTION_STATUSES)[number];

/** 1 linha por usuário (nunca uma conta corporativa central — mesmo racional do CMDesk, seção 0). */
export type CalendarConnection = {
  id: string;
  tenantId: string;
  workspaceId: string;
  userId: string;
  googleEmail?: string;
  calendarId: string;
  syncToken?: string;
  lastSyncedAt?: string;
  autoSyncEnabled: boolean;
  status: GoogleCalendarConnectionStatus;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
};
