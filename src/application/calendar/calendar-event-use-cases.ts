import type { CalendarEvent } from "../../domain/calendar/calendar.model.js";
import type { TenantRole } from "../../domain/identity/identity.model.js";
import type { CalendarEventRepositoryPort } from "../ports/calendar-event-repository.port.js";
import { pushSystemEventToGoogle, type CalendarSyncUseCaseDeps } from "./calendar-sync-use-cases.js";

/**
 * CRUD da Agenda (réplica adaptada do CMDesk, pedido explícito do usuário, relatório Parte A seção
 * 1.5). `deps` estende `CalendarSyncUseCaseDeps` — todo create/update/cancel dispara o push pro
 * Google SÍNCRONO (`await`), mas a falha NUNCA derruba a operação local, só marca
 * `syncState:"failed"` e devolve `syncWarning` na resposta (mesmo racional do relatório).
 */
export type CalendarUseCaseDeps = CalendarSyncUseCaseDeps & {
  calendarEventRepository: CalendarEventRepositoryPort;
};

/**
 * Visibilidade (seção 5 do relatório, simplificada ao modelo de papéis do Vorix — owner/admin
 * enxergam tudo do workspace, editor/viewer só o próprio calendário). Vorix não tem o conceito de
 * "gerente com managedUserIds" do CMDesk — fora de escopo replicar aqui.
 */
function resolveVisibleOwnerUserIds(viewerRole: TenantRole, viewerUserId: string): readonly string[] | undefined {
  return viewerRole === "admin" || viewerRole === "owner" ? undefined : [viewerUserId];
}

/** Mutar (editar/cancelar/concluir) um evento de OUTRA pessoa exige admin/owner — mesmo racional
 * de `assertCanMutate` do relatório (seção 1.5), simplificado ao papel de Vorix (sem "gerente"). */
function assertCanMutate(event: CalendarEvent, viewerUserId: string, viewerRole: TenantRole): void {
  if (event.ownerUserId === viewerUserId) return;
  if (viewerRole === "admin" || viewerRole === "owner") return;
  throw new Error("CALENDAR_EVENT_FORBIDDEN: só o responsável pelo evento ou um administrador pode alterá-lo.");
}

async function mustEventBelongToTenantAndWorkspace(deps: CalendarUseCaseDeps, id: string, tenantId: string, workspaceId: string): Promise<CalendarEvent> {
  const event = await deps.calendarEventRepository.getById(id);
  if (!event || event.tenantId !== tenantId || event.workspaceId !== workspaceId) {
    throw new Error(`CALENDAR_EVENT_NOT_FOUND: evento "${id}" não existe.`);
  }
  return event;
}

export type ListCalendarEventsInput = {
  tenantId: string;
  workspaceId: string;
  from: string;
  to: string;
  statusCategory?: "pending" | "cancelled" | "done" | "all";
  viewerUserId: string;
  viewerRole: TenantRole;
};

export async function listCalendarEvents(deps: CalendarUseCaseDeps, input: ListCalendarEventsInput): Promise<CalendarEvent[]> {
  return deps.calendarEventRepository.list({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    from: input.from,
    to: input.to,
    statusCategory: input.statusCategory,
    ownerUserIds: resolveVisibleOwnerUserIds(input.viewerRole, input.viewerUserId),
  });
}

export type CreateCalendarEventInput = {
  tenantId: string;
  workspaceId: string;
  ownerUserId: string;
  title: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay?: boolean;
  attendees?: readonly string[];
  relatedEntityType?: string;
  relatedEntityId?: string;
};

export type CalendarEventMutationResult = { event: CalendarEvent; syncWarning?: string };

export async function createCalendarEvent(deps: CalendarUseCaseDeps, input: CreateCalendarEventInput): Promise<CalendarEventMutationResult> {
  if (!input.title.trim()) throw new Error("CALENDAR_EVENT_TITLE_REQUIRED: título é obrigatório.");
  if (new Date(input.endAt).getTime() <= new Date(input.startAt).getTime()) {
    throw new Error("CALENDAR_EVENT_INVALID_RANGE: o fim precisa ser depois do início.");
  }
  const created = await deps.calendarEventRepository.create({ ...input, source: "system" });
  const push = await pushSystemEventToGoogle(deps, { eventId: created.id, action: "CREATE" });
  const finalEvent = (await deps.calendarEventRepository.getById(created.id)) ?? created;
  return { event: finalEvent, syncWarning: push.ok ? undefined : push.error };
}

export type UpdateCalendarEventInput = {
  tenantId: string;
  workspaceId: string;
  eventId: string;
  viewerUserId: string;
  viewerRole: TenantRole;
  title?: string;
  description?: string;
  location?: string;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  allDay?: boolean;
  attendees?: readonly string[];
  relatedEntityType?: string;
  relatedEntityId?: string;
};

export async function updateCalendarEvent(deps: CalendarUseCaseDeps, input: UpdateCalendarEventInput): Promise<CalendarEventMutationResult> {
  const event = await mustEventBelongToTenantAndWorkspace(deps, input.eventId, input.tenantId, input.workspaceId);
  assertCanMutate(event, input.viewerUserId, input.viewerRole);
  const startAt = input.startAt ?? event.startAt;
  const endAt = input.endAt ?? event.endAt;
  if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
    throw new Error("CALENDAR_EVENT_INVALID_RANGE: o fim precisa ser depois do início.");
  }
  await deps.calendarEventRepository.update(event.id, {
    title: input.title,
    description: input.description,
    location: input.location,
    startAt: input.startAt,
    endAt: input.endAt,
    timezone: input.timezone,
    allDay: input.allDay,
    attendees: input.attendees,
    relatedEntityType: input.relatedEntityType,
    relatedEntityId: input.relatedEntityId,
  });
  const push = await pushSystemEventToGoogle(deps, { eventId: event.id, action: "UPDATE" });
  const finalEvent = (await deps.calendarEventRepository.getById(event.id))!;
  return { event: finalEvent, syncWarning: push.ok ? undefined : push.error };
}

export type CancelCalendarEventInput = { tenantId: string; workspaceId: string; eventId: string; viewerUserId: string; viewerRole: TenantRole };

/** Soft-cancel — nunca hard delete (mesmo racional do relatório, seção 1.1: "não existe
 * hard-delete, tudo é soft-status"). */
export async function cancelCalendarEvent(deps: CalendarUseCaseDeps, input: CancelCalendarEventInput): Promise<CalendarEventMutationResult> {
  const event = await mustEventBelongToTenantAndWorkspace(deps, input.eventId, input.tenantId, input.workspaceId);
  assertCanMutate(event, input.viewerUserId, input.viewerRole);
  await deps.calendarEventRepository.update(event.id, { status: "cancelled" });
  const push = await pushSystemEventToGoogle(deps, { eventId: event.id, action: "DELETE" });
  const finalEvent = (await deps.calendarEventRepository.getById(event.id))!;
  return { event: finalEvent, syncWarning: push.ok ? undefined : push.error };
}

export type CompleteCalendarEventInput = { tenantId: string; workspaceId: string; eventId: string; viewerUserId: string; viewerRole: TenantRole };

/** Marca `DONE`. Nunca dispara push (Google não tem um status "concluído" que fizesse sentido
 * espelhar aqui — o relatório mapeia isto pra dentro do próprio CMDesk, sem tocar o evento no
 * Google, seção 1.5). */
export async function completeCalendarEvent(deps: CalendarUseCaseDeps, input: CompleteCalendarEventInput): Promise<CalendarEvent> {
  const event = await mustEventBelongToTenantAndWorkspace(deps, input.eventId, input.tenantId, input.workspaceId);
  assertCanMutate(event, input.viewerUserId, input.viewerRole);
  return deps.calendarEventRepository.update(event.id, { status: "done" });
}
