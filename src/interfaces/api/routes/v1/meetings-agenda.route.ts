import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  cancelCalendarEvent,
  CalendarError,
  completeCalendarEvent,
  createCalendarEvent,
  getCalendarEvent,
  listCalendarEvents,
  resolveEventConflict,
  updateCalendarEvent,
  type CalendarActor,
  type CalendarUseCaseDeps,
} from "../../../../application/calendar/calendar-event-use-cases.js";
import {
  beginGoogleCalendarConnect,
  completeGoogleCalendarConnect,
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  listGoogleCalendarSyncLog,
  requestGoogleCalendarSync,
  type CalendarConnectionDeps,
} from "../../../../application/calendar/calendar-connection-use-cases.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import { hasPermission } from "../../../../domain/identity/identity.model.js";
import { AppError, NotFoundError, ValidationError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { assertWorkspaceBelongsToTenant } from "./workspace-ownership.js";

/**
 * Agenda do Vorix Meetings + conexão Google Calendar. Sob `/v1/meetings/...`: o guarda de solução
 * barra quem não tem `meetings` (a Agenda não depende do Conversas). RBAC: leitura
 * `calendar_event:read`; escrita `calendar_event:write`; "gravar automaticamente" exige também
 * `meeting:create`.
 */
export type MeetingAgendaRoutesDeps = {
  calendar: CalendarUseCaseDeps;
  connection: CalendarConnectionDeps;
  workspaceRepository: WorkspaceRepositoryPort;
};

const WORKSPACE = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const EVENT_PARAMS = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const LIST_QUERY = {
  type: "object",
  required: ["workspaceId", "from", "to"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
    status: { type: "string", enum: ["pending", "cancelled", "done", "all"] },
  },
} as const;
const TIME_FIELDS = {
  allDay: { type: "boolean" },
  start: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2})?)?$" },
  end: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2})?)?$" },
  timezone: { type: "string", minLength: 1, maxLength: 64 },
} as const;
const CREATE_BODY = {
  type: "object",
  required: ["workspaceId", "title", "allDay", "start", "end", "timezone"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 5000 },
    location: { type: "string", maxLength: 500 },
    attendees: { type: "array", maxItems: 100, items: { type: "string", maxLength: 254 } },
    syncToGoogle: { type: "boolean" },
    createMeetLink: { type: "boolean" },
    autoRecord: { type: "boolean" },
    joinBeforeMinutes: { type: "integer", minimum: 0, maximum: 30 },
    joinGraceMinutes: { type: "integer", minimum: 0, maximum: 60 },
    ...TIME_FIELDS,
  },
} as const;
const UPDATE_BODY = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: ["string", "null"], maxLength: 5000 },
    location: { type: ["string", "null"], maxLength: 500 },
    attendees: { type: "array", maxItems: 100, items: { type: "string", maxLength: 254 } },
    ...TIME_FIELDS,
  },
} as const;
const RESOLVE_BODY = { type: "object", required: ["workspaceId", "keep"], additionalProperties: false, properties: { workspaceId: { type: "string", minLength: 1 }, keep: { type: "string", enum: ["local", "remote"] } } } as const;
const CALLBACK_BODY = { type: "object", required: ["state", "code"], additionalProperties: false, properties: { state: { type: "string", minLength: 10, maxLength: 2000 }, code: { type: "string", minLength: 1, maxLength: 2000 } } } as const;

function actorOf(request: FastifyRequest, permission: Parameters<typeof requirePermission>[1]): CalendarActor {
  const principal = requirePermission(request, permission);
  return { tenantId: principal.tenantId, userId: principal.userId, role: principal.role };
}

function translate(error: unknown): never {
  if (error instanceof CalendarError) {
    const text = error.message.slice(error.code.length + 1).trim();
    if (error.code === "CALENDAR_EVENT_NOT_FOUND") throw new NotFoundError(text);
    if (error.code === "CALENDAR_INVALID_INPUT") throw new ValidationError(text);
    throw new AppError({ code: error.code, message: text, statusCode: error.code === "CALENDAR_EVENT_FORBIDDEN" ? 403 : 409, recoverable: false });
  }
  if (error instanceof Error && error.message.startsWith("CALENDAR_OAUTH_")) {
    const [code, ...rest] = error.message.split(":");
    throw new AppError({ code: code!, message: rest.join(":").trim() || "Falha na conexão com o Google.", statusCode: code === "CALENDAR_OAUTH_NOT_CONFIGURED" ? 503 : 400, recoverable: true });
  }
  throw error;
}

async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    translate(error);
  }
}

export async function registerMeetingAgendaRoutes(app: FastifyInstance, deps: MeetingAgendaRoutesDeps): Promise<void> {
  const ownWorkspace = (actor: CalendarActor, workspaceId: string) => assertWorkspaceBelongsToTenant(deps.workspaceRepository, { tenantId: actor.tenantId, workspaceId });

  app.get("/meetings/agenda/events", { schema: { querystring: LIST_QUERY } }, async (request) => {
    const actor = actorOf(request, "calendar_event:read");
    const query = request.query as { workspaceId: string; from: string; to: string; status?: "pending" | "cancelled" | "done" | "all" };
    return successEnvelope(await guard(() => listCalendarEvents(deps.calendar, actor, query)), request.id);
  });

  app.post("/meetings/agenda/events", { schema: { body: CREATE_BODY }, config: { readOnlyGuard: true } }, async (request, reply) => {
    const actor = actorOf(request, "calendar_event:write");
    const body = request.body as Parameters<typeof createCalendarEvent>[2];
    if (body.autoRecord && !hasPermission(actor.role, "meeting:create")) throw new AppError({ code: "IDENTITY_FORBIDDEN", message: "Seu papel não pode preparar gravações.", statusCode: 403, recoverable: false });
    await ownWorkspace(actor, body.workspaceId);
    const event = await guard(() => createCalendarEvent(deps.calendar, actor, body));
    reply.code(201);
    return successEnvelope(event, request.id);
  });

  app.get("/meetings/agenda/events/:id", { schema: { params: EVENT_PARAMS, querystring: WORKSPACE } }, async (request) => {
    const actor = actorOf(request, "calendar_event:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await guard(() => getCalendarEvent(deps.calendar, actor, { workspaceId, eventId: id })), request.id);
  });

  app.patch("/meetings/agenda/events/:id", { schema: { params: EVENT_PARAMS, body: UPDATE_BODY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "calendar_event:write");
    const { id } = request.params as { id: string };
    const body = request.body as Omit<Parameters<typeof updateCalendarEvent>[2], "eventId">;
    return successEnvelope(await guard(() => updateCalendarEvent(deps.calendar, actor, { ...body, eventId: id })), request.id);
  });

  app.post("/meetings/agenda/events/:id/cancel", { schema: { params: EVENT_PARAMS, body: WORKSPACE }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "calendar_event:write");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(await guard(() => cancelCalendarEvent(deps.calendar, actor, { workspaceId, eventId: id })), request.id);
  });

  app.post("/meetings/agenda/events/:id/complete", { schema: { params: EVENT_PARAMS, body: WORKSPACE }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "calendar_event:write");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(await guard(() => completeCalendarEvent(deps.calendar, actor, { workspaceId, eventId: id })), request.id);
  });

  app.post("/meetings/agenda/events/:id/resolve-conflict", { schema: { params: EVENT_PARAMS, body: RESOLVE_BODY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "calendar_event:write");
    const { id } = request.params as { id: string };
    const { workspaceId, keep } = request.body as { workspaceId: string; keep: "local" | "remote" };
    return successEnvelope(await guard(() => resolveEventConflict(deps.calendar, actor, { workspaceId, eventId: id, keep })), request.id);
  });

  // ── Google Calendar (conexão por usuário) ──────────────────────────────────────────────────

  app.get("/meetings/google/status", { schema: { querystring: WORKSPACE } }, async (request) => {
    const actor = actorOf(request, "calendar_event:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await guard(() => getGoogleCalendarStatus(deps.connection, actor, { workspaceId })), request.id);
  });

  app.post("/meetings/google/connect", { schema: { body: WORKSPACE }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "calendar_event:write");
    const { workspaceId } = request.body as { workspaceId: string };
    await ownWorkspace(actor, workspaceId);
    return successEnvelope(await guard(async () => beginGoogleCalendarConnect(deps.connection, actor, { workspaceId })), request.id);
  });

  app.post("/meetings/google/callback", { schema: { body: CALLBACK_BODY }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "calendar_event:write");
    const body = request.body as { state: string; code: string };
    return successEnvelope(await guard(() => completeGoogleCalendarConnect(deps.connection, actor, body)), request.id);
  });

  app.post("/meetings/google/disconnect", { schema: { body: WORKSPACE }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "calendar_event:write");
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(await guard(() => disconnectGoogleCalendar(deps.connection, actor, { workspaceId })), request.id);
  });

  app.post("/meetings/google/sync", { schema: { body: WORKSPACE }, config: { readOnlyGuard: true } }, async (request) => {
    const actor = actorOf(request, "calendar_event:write");
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(await guard(() => requestGoogleCalendarSync(deps.connection, actor, { workspaceId })), request.id);
  });

  app.get("/meetings/google/sync-log", { schema: { querystring: WORKSPACE } }, async (request) => {
    const actor = actorOf(request, "calendar_event:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await guard(() => listGoogleCalendarSyncLog(deps.connection, actor, { workspaceId })), request.id);
  });
}
