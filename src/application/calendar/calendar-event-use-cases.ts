import {
  isTerminalCalendarStatus,
  isValidTimeZone,
  zonedLocalToUtc,
  type CalendarEvent,
  type CalendarEventStatus,
} from "../../domain/calendar/calendar.model.js";
import { hasPermission, type TenantRole } from "../../domain/identity/identity.model.js";
import type { CalendarConnectionRepositoryPort } from "../ports/calendar-connection-repository.port.js";
import type { CalendarEventContentPatch, CalendarEventRepositoryPort } from "../ports/calendar-event-repository.port.js";
import { resolveCalendarConflict } from "./calendar-sync-use-cases.js";

/**
 * Agenda do Vorix Meetings — CRUD. A sincronização com o Google NÃO acontece dentro da requisição:
 * a edição local fica pendente (`localVersion`) e o worker de sync envia no próximo ciclo (a
 * requisição só antecipa o próximo sync da conta). Assim a API nunca espera o Google nem disputa
 * o lease da conta com o worker.
 */

/** Ligação com a reunião, implementada pelo Meetings — a Agenda não importa o Meetings. */
export type CalendarMeetingLinkPort = {
  /** "Gravar automaticamente": prepara a reunião agendada vinculada ao evento. */
  createScheduledMeeting(input: { event: CalendarEvent; joinBeforeMinutes?: number; joinGraceMinutes?: number; meetingUrl?: string; humanJoinAccountEmail?: string }): Promise<{ meetingId: string; recordingCapacityWarning?: string; recorderWarning?: { code: string; message: string } }>;
  /** Evento remarcado/editado: a reunião agendada acompanha (só enquanto ainda está agendada). */
  syncScheduledMeeting(event: CalendarEvent): Promise<void>;
  /** Evento cancelado: reunião agendada vinculada é cancelada. */
  cancelScheduledMeeting(event: CalendarEvent): Promise<void>;
  meetingIdsForEvents(input: { tenantId: string; eventIds: readonly string[] }): Promise<Record<string, string>>;
};

export type CalendarUseCaseDeps = {
  events: CalendarEventRepositoryPort;
  connections: CalendarConnectionRepositoryPort;
  meetings: CalendarMeetingLinkPort;
  now: () => Date;
};

export type CalendarActor = { tenantId: string; userId: string; role: TenantRole };

export class CalendarError extends Error {
  constructor(readonly code: "CALENDAR_EVENT_NOT_FOUND" | "CALENDAR_EVENT_FORBIDDEN" | "CALENDAR_INVALID_INPUT" | "CALENDAR_EVENT_TERMINAL" | "CALENDAR_NO_CONFLICT", text: string) {
    super(`${code}: ${text}`);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Gestão (owner/admin) vê a Agenda de todos; as demais pessoas, a própria. */
function seesEveryone(actor: CalendarActor): boolean {
  return hasPermission(actor.role, "meeting:read_all");
}

async function requireEvent(deps: CalendarUseCaseDeps, actor: CalendarActor, workspaceId: string, eventId: string): Promise<CalendarEvent> {
  const event = await deps.events.getById(eventId);
  if (!event || event.tenantId !== actor.tenantId || event.workspaceId !== workspaceId || (!seesEveryone(actor) && event.ownerUserId !== actor.userId)) {
    throw new CalendarError("CALENDAR_EVENT_NOT_FOUND", "Evento não encontrado.");
  }
  return event;
}

function assertCanMutate(event: CalendarEvent, actor: CalendarActor): void {
  if (event.ownerUserId !== actor.userId && !seesEveryone(actor)) throw new CalendarError("CALENDAR_EVENT_FORBIDDEN", "Só o responsável pelo evento ou a gestão pode alterá-lo.");
}

/** Antecipa o sync da conta Google do dono (o worker pega no próximo ciclo). */
async function nudgeSync(deps: CalendarUseCaseDeps, event: CalendarEvent): Promise<void> {
  if (!event.syncToGoogle) return;
  const connection = await deps.connections.getByUser({ tenantId: event.tenantId, workspaceId: event.workspaceId, userId: event.ownerUserId });
  if (connection?.status === "connected") await deps.connections.update(connection.id, { nextSyncAt: deps.now().toISOString() });
}

export type CalendarTimeInput = {
  /** Dia inteiro: datas `YYYY-MM-DD` (fim INCLUSIVO, como a pessoa escolhe na tela). Com horário:
   * horário de parede `YYYY-MM-DDTHH:mm` no `timezone`. */
  allDay: boolean;
  start: string;
  end: string;
  timezone: string;
};

/** Converte o horário digitado (no fuso do evento) para instantes UTC. */
export function resolveEventTimes(input: CalendarTimeInput): { startAt: string; endAt: string } {
  if (!isValidTimeZone(input.timezone)) throw new CalendarError("CALENDAR_INVALID_INPUT", `Fuso horário inválido: ${input.timezone}.`);
  try {
    if (input.allDay) {
      const startAt = zonedLocalToUtc(input.start.slice(0, 10), input.timezone);
      // Fim exclusivo = dia seguinte ao último dia escolhido (convenção do Google para dia inteiro).
      const lastDay = new Date(`${input.end.slice(0, 10)}T00:00:00Z`);
      const nextDay = new Date(lastDay.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const endAt = zonedLocalToUtc(nextDay, input.timezone);
      if (endAt <= startAt) throw new CalendarError("CALENDAR_INVALID_INPUT", "O último dia precisa ser igual ou depois do primeiro.");
      return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
    }
    const startAt = zonedLocalToUtc(input.start, input.timezone);
    const endAt = zonedLocalToUtc(input.end, input.timezone);
    if (endAt <= startAt) throw new CalendarError("CALENDAR_INVALID_INPUT", "O fim precisa ser depois do início.");
    return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
  } catch (error) {
    if (error instanceof CalendarError) throw error;
    throw new CalendarError("CALENDAR_INVALID_INPUT", "Data ou horário inválido.");
  }
}

function cleanAttendees(attendees: readonly string[] | undefined): string[] {
  const list = [...new Set((attendees ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean))];
  const invalid = list.find((email) => !EMAIL.test(email));
  if (invalid) throw new CalendarError("CALENDAR_INVALID_INPUT", `E-mail de participante inválido: ${invalid}.`);
  return list;
}

export type CalendarEventView = CalendarEvent & { meetingId?: string; recordingCapacityWarning?: string; recorderWarning?: { code: string; message: string } };

export async function listCalendarEvents(deps: CalendarUseCaseDeps, actor: CalendarActor, input: { workspaceId: string; from: string; to: string; status?: "pending" | "cancelled" | "done" | "all" }): Promise<CalendarEventView[]> {
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new CalendarError("CALENDAR_INVALID_INPUT", "Período inválido.");
  if (to.getTime() - from.getTime() > 400 * 24 * 60 * 60 * 1000) throw new CalendarError("CALENDAR_INVALID_INPUT", "Período longo demais (máximo de ~13 meses).");
  const events = await deps.events.list({
    tenantId: actor.tenantId,
    workspaceId: input.workspaceId,
    from: from.toISOString(),
    to: to.toISOString(),
    statusCategory: input.status ?? "all",
    ...(seesEveryone(actor) ? {} : { ownerUserIds: [actor.userId] }),
  });
  const links = await deps.meetings.meetingIdsForEvents({ tenantId: actor.tenantId, eventIds: events.map((event) => event.id) });
  return events.map((event) => (links[event.id] ? { ...event, meetingId: links[event.id] } : event));
}

export async function getCalendarEvent(deps: CalendarUseCaseDeps, actor: CalendarActor, input: { workspaceId: string; eventId: string }): Promise<CalendarEventView> {
  const event = await requireEvent(deps, actor, input.workspaceId, input.eventId);
  const links = await deps.meetings.meetingIdsForEvents({ tenantId: actor.tenantId, eventIds: [event.id] });
  return links[event.id] ? { ...event, meetingId: links[event.id] } : event;
}

export type CreateCalendarEventInput = CalendarTimeInput & {
  workspaceId: string;
  title: string;
  description?: string;
  location?: string;
  attendees?: readonly string[];
  /** Enviar para o Google Calendar da pessoa (quando conectado). */
  syncToGoogle?: boolean;
  /** Pedir ao Google um link do Meet na criação. */
  createMeetLink?: boolean;
  /** Preparar a reunião para gravação automática (a gravação real segue desligada). */
  autoRecord?: boolean;
  joinBeforeMinutes?: number;
  joinGraceMinutes?: number;
  /** Conta Google com que a pessoa entrará na reunião (nunca será a conta de gravação). */
  humanJoinAccountEmail?: string;
};

export async function createCalendarEvent(deps: CalendarUseCaseDeps, actor: CalendarActor, input: CreateCalendarEventInput): Promise<CalendarEventView> {
  if (!input.title.trim()) throw new CalendarError("CALENDAR_INVALID_INPUT", "O título é obrigatório.");
  const times = resolveEventTimes(input);
  const event = await deps.events.create({
    tenantId: actor.tenantId,
    workspaceId: input.workspaceId,
    ownerUserId: actor.userId,
    title: input.title.trim().slice(0, 200),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    ...(input.location?.trim() ? { location: input.location.trim() } : {}),
    ...times,
    timezone: input.timezone,
    allDay: input.allDay,
    attendees: cleanAttendees(input.attendees),
    source: "system",
    wantsMeetLink: Boolean(input.createMeetLink) && input.syncToGoogle !== false,
    syncToGoogle: input.syncToGoogle !== false,
  });
  await nudgeSync(deps, event);
  if (!input.autoRecord) return event;
  const { meetingId, recordingCapacityWarning, recorderWarning } = await deps.meetings.createScheduledMeeting({
    event,
    ...(input.humanJoinAccountEmail?.trim() ? { humanJoinAccountEmail: input.humanJoinAccountEmail } : {}),
    ...(input.joinBeforeMinutes !== undefined ? { joinBeforeMinutes: input.joinBeforeMinutes } : {}),
    ...(input.joinGraceMinutes !== undefined ? { joinGraceMinutes: input.joinGraceMinutes } : {}),
  });
  return { ...event, meetingId, ...(recordingCapacityWarning ? { recordingCapacityWarning } : {}), ...(recorderWarning ? { recorderWarning } : {}) };
}

export type UpdateCalendarEventInput = Partial<CalendarTimeInput> & {
  workspaceId: string;
  eventId: string;
  title?: string;
  description?: string | null;
  location?: string | null;
  attendees?: readonly string[];
};

/** Evento concluído ou cancelado é estado terminal: não se edita (reabrir não existe nesta rodada). */
export async function updateCalendarEvent(deps: CalendarUseCaseDeps, actor: CalendarActor, input: UpdateCalendarEventInput): Promise<CalendarEventView> {
  const event = await requireEvent(deps, actor, input.workspaceId, input.eventId);
  assertCanMutate(event, actor);
  if (isTerminalCalendarStatus(event.status)) throw new CalendarError("CALENDAR_EVENT_TERMINAL", "Evento concluído ou cancelado não pode ser editado.");
  const patch: CalendarEventContentPatch = {};
  if (input.title !== undefined) {
    if (!input.title.trim()) throw new CalendarError("CALENDAR_INVALID_INPUT", "O título é obrigatório.");
    patch.title = input.title.trim().slice(0, 200);
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.location !== undefined) patch.location = input.location?.trim() || null;
  if (input.attendees !== undefined) patch.attendees = cleanAttendees(input.attendees);
  if (input.start !== undefined || input.end !== undefined || input.allDay !== undefined || input.timezone !== undefined) {
    if (input.start === undefined || input.end === undefined || input.allDay === undefined || input.timezone === undefined) {
      throw new CalendarError("CALENDAR_INVALID_INPUT", "Para mudar o horário, envie início, fim, dia inteiro e fuso juntos.");
    }
    Object.assign(patch, resolveEventTimes({ allDay: input.allDay, start: input.start, end: input.end, timezone: input.timezone }), { allDay: input.allDay, timezone: input.timezone });
  }
  const updated = await deps.events.applyLocalChange(event.id, patch);
  await nudgeSync(deps, updated);
  await deps.meetings.syncScheduledMeeting(updated);
  return updated;
}

async function setTerminal(deps: CalendarUseCaseDeps, actor: CalendarActor, input: { workspaceId: string; eventId: string }, status: CalendarEventStatus): Promise<CalendarEventView> {
  const event = await requireEvent(deps, actor, input.workspaceId, input.eventId);
  assertCanMutate(event, actor);
  if (event.status === status) return event;
  if (isTerminalCalendarStatus(event.status)) throw new CalendarError("CALENDAR_EVENT_TERMINAL", "Este evento já foi encerrado.");
  const updated = await deps.events.applyLocalChange(event.id, { status });
  await nudgeSync(deps, updated);
  if (status === "cancelled") await deps.meetings.cancelScheduledMeeting(updated);
  return updated;
}

export function cancelCalendarEvent(deps: CalendarUseCaseDeps, actor: CalendarActor, input: { workspaceId: string; eventId: string }): Promise<CalendarEventView> {
  return setTerminal(deps, actor, input, "cancelled");
}

/** Concluir é só do Vorix (o Google não tem "concluído") e nenhum sync desfaz. */
export function completeCalendarEvent(deps: CalendarUseCaseDeps, actor: CalendarActor, input: { workspaceId: string; eventId: string }): Promise<CalendarEventView> {
  return setTerminal(deps, actor, input, "done");
}

export async function resolveEventConflict(deps: CalendarUseCaseDeps, actor: CalendarActor, input: { workspaceId: string; eventId: string; keep: "local" | "remote" }): Promise<CalendarEventView> {
  const event = await requireEvent(deps, actor, input.workspaceId, input.eventId);
  assertCanMutate(event, actor);
  if (event.syncState !== "conflict") throw new CalendarError("CALENDAR_NO_CONFLICT", "Este evento não está em conflito.");
  const resolved = await resolveCalendarConflict(deps, { event, keep: input.keep });
  await nudgeSync(deps, resolved);
  return resolved;
}
