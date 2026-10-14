/**
 * Bounded context "calendar" — a Agenda do Vorix Meetings (evolução da base 0127; nunca uma
 * segunda Agenda). Sem import de `inbox`/`crm`: a Agenda funciona sem o Vorix Conversas.
 *
 * CalendarEvent ≠ Meeting. O evento é o COMPROMISSO; a reunião (`meetings`) é o registro real e o
 * processamento. Podem existir separados ou vinculados (`meetings.calendar_event_id`, opcional).
 *
 * Decisões que corrigem limitações herdadas do CMDesk:
 *
 * 1. RECORRÊNCIA — o pull pede `singleEvents=true`: cada ocorrência é uma linha própria, com o id
 *    da INSTÂNCIA no Google (`<mestre>_<início>`), `googleRecurringEventId` (o mestre) e
 *    `googleOriginalStartAt`. Nunca reaproveita o id do mestre, então ocorrências não colapsam
 *    numa linha. Criar recorrência a partir do Vorix fica fora desta rodada (só eventos avulsos).
 *
 * 2. CONFLITO — nada de last-write-wins cego. Cada evento tem `localVersion` (edição local) e
 *    `syncedVersion` (o que já foi enviado), além de `googleEtag`/`googleUpdatedAt`:
 *    - remoto com o MESMO etag que o local = eco do nosso próprio push → ignorado (anti-eco);
 *    - remoto mudou e o local NÃO tem edição pendente → aplica o remoto (Google é a fonte);
 *    - remoto mudou E o local tem edição pendente → CONFLITO: nada é sobrescrito; o evento fica
 *      `syncState: conflict` com o snapshot remoto, até alguém escolher qual lado vale;
 *    - push usa `If-Match: <etag>`; 412 do Google = alguém mudou lá → CONFLITO, não sobrescreve.
 *
 * 3. ESTADO TERMINAL — `done` é só do Vorix (o Google não tem "concluído"): nenhum pull rebaixa um
 *    evento concluído para `confirmed`. `cancelled` local também não é revertido por um pull.
 *
 * 4. LOCK — o sync de uma conta exige um lease gravado no próprio registro da conexão (Postgres),
 *    nunca um lock em memória: dois processos nunca sincronizam a mesma conta ao mesmo tempo, e um
 *    processo morto libera a conta quando o lease expira.
 */

export const CALENDAR_EVENT_STATUSES = ["confirmed", "cancelled", "done"] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUSES)[number];

export const CALENDAR_EVENT_SOURCES = ["system", "google"] as const;
export type CalendarEventSource = (typeof CALENDAR_EVENT_SOURCES)[number];

export const CALENDAR_EVENT_SYNC_STATES = ["ok", "failed", "pending", "conflict"] as const;
export type CalendarEventSyncState = (typeof CALENDAR_EVENT_SYNC_STATES)[number];

/** Tipos de entidade relacionada — enum fechado (o CMDesk aceitava texto livre). */
export const CALENDAR_RELATED_ENTITY_TYPES = ["meeting"] as const;
export type CalendarRelatedEntityType = (typeof CALENDAR_RELATED_ENTITY_TYPES)[number];

export type CalendarEvent = {
  id: string;
  tenantId: string;
  workspaceId: string;
  /** 1 responsável único. */
  ownerUserId: string;
  title: string;
  description?: string;
  location?: string;
  /** Instantes em UTC. Para `allDay`, é a meia-noite LOCAL (no `timezone`) convertida para UTC. */
  startAt: string;
  endAt: string;
  /** Fuso IANA do evento — usado para exibir e para o dia de um evento de dia inteiro. */
  timezone: string;
  allDay: boolean;
  /** E-mails livres — convidado nunca precisa ser usuário do tenant. */
  attendees: readonly string[];
  status: CalendarEventStatus;
  source: CalendarEventSource;
  meetLink?: string;
  wantsMeetLink: boolean;
  syncToGoogle: boolean;
  relatedEntityType?: CalendarRelatedEntityType;
  relatedEntityId?: string;
  googleAccountId?: string;
  googleCalendarId?: string;
  googleEventId?: string;
  googleEtag?: string;
  googleUpdatedAt?: string;
  googleRecurringEventId?: string;
  googleOriginalStartAt?: string;
  htmlLink?: string;
  localVersion: number;
  syncedVersion: number;
  syncState?: CalendarEventSyncState;
  conflictRemote?: Record<string, unknown>;
  lastSyncError?: string;
  lastGoogleSyncAt?: string;
  createdAt: string;
  updatedAt: string;
};

export function hasPendingLocalChange(event: Pick<CalendarEvent, "localVersion" | "syncedVersion">): boolean {
  return event.localVersion > event.syncedVersion;
}

export function isTerminalCalendarStatus(status: CalendarEventStatus): boolean {
  return status === "done" || status === "cancelled";
}

export const GOOGLE_CALENDAR_CONNECTION_STATUSES = ["connected", "disconnected", "error"] as const;
export type GoogleCalendarConnectionStatus = (typeof GOOGLE_CALENDAR_CONNECTION_STATUSES)[number];

/** 1 linha por usuário (nunca uma conta corporativa central). */
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
  lastErrorAt?: string;
  consecutiveFailures: number;
  nextSyncAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CalendarSyncLogEntry = {
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  eventId?: string;
  googleEventId?: string;
  direction: "pull" | "push" | "auth" | "sync";
  action: string;
  status: "ok" | "skipped" | "conflict" | "error";
  error?: string;
};

// ---------------------------------------------------------------------------------------------
// Fuso horário — sem dependência externa (Intl).
// ---------------------------------------------------------------------------------------------

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Deslocamento (ms) do fuso em relação a UTC num instante: local = utc + offset. */
export function timeZoneOffsetMs(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** "2026-11-20T14:30" (horário de parede no fuso) → instante UTC. Corrige o salto de horário de verão
 * com uma segunda passada. */
export function zonedLocalToUtc(localDateTime: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(localDateTime);
  if (!match) throw new Error(`CALENDAR_INVALID_LOCAL_DATETIME: "${localDateTime}"`);
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = match;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const first = naive - timeZoneOffsetMs(timeZone, new Date(naive));
  return new Date(naive - timeZoneOffsetMs(timeZone, new Date(first)));
}

/** Data local (YYYY-MM-DD) de um instante num fuso. */
export function utcToZonedDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  return parts;
}
