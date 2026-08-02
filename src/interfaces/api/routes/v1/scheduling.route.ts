import type { FastifyInstance } from "fastify";
import type { SchedulingRepositoryPort } from "../../../../application/ports/scheduling-repository.port.js";
import type { SchedulingUseCases } from "../../../../application/scheduling/schedule-use-cases.js";
import type { SchedulingRecoveryService } from "../../../../application/scheduling/scheduling-recovery-service.js";
import type { SchedulingHealthService } from "../../../../application/scheduling/scheduling-health-service.js";
import type { TemporalDispatcher } from "../../../../application/scheduling/temporal-queue.js";
import type { MissedOccurrencePolicy, ScheduleOccurrenceStatus, ScheduleStatus } from "../../../../domain/scheduling/scheduling.model.js";
import type { PublicationProvider } from "../../../../domain/publication/publication.model.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WORKSPACE_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    status: { type: "string" },
    providerId: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
  },
} as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

export type SchedulingRoutesDeps = {
  schedulingRepository: SchedulingRepositoryPort;
  schedulingUseCases: SchedulingUseCases;
  temporalDispatcher: TemporalDispatcher;
  recoveryService: SchedulingRecoveryService;
  healthService: SchedulingHealthService;
};

export async function registerSchedulingRoutes(app: FastifyInstance, deps: SchedulingRoutesDeps): Promise<void> {
  app.get("/schedules", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "schedule:read");
    const query = request.query as { workspaceId: string; status?: ScheduleStatus; providerId?: PublicationProvider };
    return successEnvelope(await deps.schedulingRepository.listSchedules({ tenantId: principal.tenantId, workspaceId: query.workspaceId, status: query.status, providerId: query.providerId }), request.id);
  });

  app.post("/schedules", { schema: { body: createScheduleBodySchema() }, config: { idempotent: true } }, async (request) => {
    const principal = requirePermission(request, "schedule:create");
    const body = request.body as CreateScheduleBody;
    return successEnvelope(await deps.schedulingUseCases.createSchedule({
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      publicationPlanId: body.publicationPlanId,
      publicationCandidateId: body.publicationCandidateId,
      providerId: body.providerId,
      targetId: body.targetId,
      scheduledAt: body.scheduledAt,
      timezone: body.timezone,
      governancePolicyReference: body.governancePolicyReference,
      credentialReferenceId: body.credentialReferenceId,
      campaignId: body.campaignId,
      contentChecksum: body.contentChecksum,
      missedPolicy: body.missedPolicy,
      allowDegradedProvider: body.allowDegradedProvider,
      maxAttempts: body.maxAttempts,
      recurrence: body.recurrence,
      actor: { userId: principal.userId, role: principal.role, sessionId: principal.sessionId },
      requestId: request.id,
    }), request.id);
  });

  app.get("/schedules/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "schedule:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    const schedule = await deps.schedulingUseCases.getSchedule({ tenantId: principal.tenantId, workspaceId, scheduleId: id });
    const [occurrences, conflicts, events] = await Promise.all([
      deps.schedulingRepository.listOccurrences({ tenantId: principal.tenantId, workspaceId, scheduleId: id, limit: 500 }),
      deps.schedulingRepository.listConflicts({ tenantId: principal.tenantId, workspaceId, scheduleId: id, unresolvedOnly: false }),
      deps.schedulingRepository.listEvents({ tenantId: principal.tenantId, workspaceId, scheduleId: id, limit: 200 }),
    ]);
    return successEnvelope({ schedule, occurrences, conflicts, events }, request.id);
  });

  app.patch("/schedules/:id", { schema: { params: ID_PARAMS_SCHEMA, body: updateScheduleBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "schedule:update");
    const { id } = request.params as { id: string };
    const body = request.body as UpdateScheduleBody;
    const current = await deps.schedulingUseCases.getSchedule({ tenantId: principal.tenantId, workspaceId: body.workspaceId, scheduleId: id });
    return successEnvelope(await deps.schedulingRepository.updateSchedule({
      id,
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      expectedVersion: current.version,
      patch: {
        credentialReferenceId: body.credentialReferenceId,
        governancePolicyReference: body.governancePolicyReference,
        missedPolicy: body.missedPolicy,
        allowDegradedProvider: body.allowDegradedProvider,
        maxAttempts: body.maxAttempts,
      },
    }), request.id);
  });

  app.post("/schedules/:id/pause", { schema: { params: ID_PARAMS_SCHEMA, body: workspaceBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "schedule:pause");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(await deps.schedulingUseCases.pauseSchedule({ tenantId: principal.tenantId, workspaceId, scheduleId: id, actor: { userId: principal.userId, role: principal.role, sessionId: principal.sessionId }, requestId: request.id }), request.id);
  });

  app.post("/schedules/:id/resume", { schema: { params: ID_PARAMS_SCHEMA, body: workspaceBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "schedule:resume");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(await deps.schedulingUseCases.resumeSchedule({ tenantId: principal.tenantId, workspaceId, scheduleId: id, actor: { userId: principal.userId, role: principal.role, sessionId: principal.sessionId }, requestId: request.id }), request.id);
  });

  app.post("/schedules/:id/cancel", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, futureOnly: { type: "boolean" } } } } }, async (request) => {
    const principal = requirePermission(request, "schedule:cancel");
    const { id } = request.params as { id: string };
    const body = request.body as { workspaceId: string; futureOnly?: boolean };
    return successEnvelope(await deps.schedulingUseCases.cancelSchedule({ tenantId: principal.tenantId, workspaceId: body.workspaceId, scheduleId: id, futureOnly: body.futureOnly, actor: { userId: principal.userId, role: principal.role, sessionId: principal.sessionId }, requestId: request.id }), request.id);
  });

  app.post("/schedules/:id/reschedule", { schema: { params: ID_PARAMS_SCHEMA, body: rescheduleBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "schedule:update");
    const { id } = request.params as { id: string };
    const body = request.body as { workspaceId: string; occurrenceId?: string; scheduledAt: string; timezone: string };
    const occurrenceId = body.occurrenceId ?? (await deps.schedulingRepository.listOccurrences({ tenantId: principal.tenantId, workspaceId: body.workspaceId, scheduleId: id, status: "pending", limit: 1 }))[0]?.id;
    if (!occurrenceId) throw new Error("SCHEDULE_OCCURRENCE_NOT_FOUND: nenhuma ocorrência pendente para reagendar.");
    return successEnvelope(await deps.schedulingUseCases.rescheduleOccurrence({ tenantId: principal.tenantId, workspaceId: body.workspaceId, occurrenceId, scheduledAt: body.scheduledAt, timezone: body.timezone, actor: { userId: principal.userId, role: principal.role, sessionId: principal.sessionId }, requestId: request.id }), request.id);
  });

  app.get("/schedules/:id/occurrences", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "schedule:read");
    const { id } = request.params as { id: string };
    const query = request.query as { workspaceId: string; status?: ScheduleOccurrenceStatus };
    return successEnvelope(await deps.schedulingRepository.listOccurrences({ tenantId: principal.tenantId, workspaceId: query.workspaceId, scheduleId: id, status: query.status, limit: 1000 }), request.id);
  });

  app.post("/schedule-occurrences/:id/cancel", { schema: { params: ID_PARAMS_SCHEMA, body: workspaceBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "schedule:cancel");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(await deps.schedulingUseCases.cancelOccurrence({ tenantId: principal.tenantId, workspaceId, occurrenceId: id, actor: { userId: principal.userId, role: principal.role, sessionId: principal.sessionId }, requestId: request.id }), request.id);
  });

  app.post("/schedule-occurrences/:id/reprocess", { schema: { params: ID_PARAMS_SCHEMA, body: workspaceBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "schedule:reprocess");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(await deps.schedulingRepository.markOccurrenceStatus({ occurrenceId: id, tenantId: principal.tenantId, workspaceId, status: "pending", now: new Date().toISOString(), reason: "manual_reprocess" }), request.id);
  });

  app.get("/calendar", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "calendar:read");
    const query = request.query as { workspaceId: string; from?: string; to?: string; providerId?: PublicationProvider; status?: ScheduleOccurrenceStatus };
    const now = new Date();
    const fromUtc = query.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const toUtc = query.to ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    return successEnvelope(await deps.schedulingRepository.calendar({ tenantId: principal.tenantId, workspaceId: query.workspaceId, fromUtc, toUtc, providerId: query.providerId, status: query.status }), request.id);
  });

  app.get("/scheduling/health", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "scheduling:operate");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await deps.healthService.health({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.get("/scheduling/dead-letters", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "scheduling:dead_letter:read");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await deps.schedulingRepository.listDeadLetters({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.post("/scheduling/dead-letters/:id/reprocess", { schema: { params: ID_PARAMS_SCHEMA, body: workspaceBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "scheduling:dead_letter:reprocess");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    const letter = await deps.schedulingRepository.reprocessDeadLetter({ id, tenantId: principal.tenantId, workspaceId, actorUserId: principal.userId, now: new Date().toISOString() });
    if (!letter) throw new Error("SCHEDULE_DEAD_LETTER_NOT_FOUND: dead letter não encontrada.");
    return successEnvelope(letter, request.id);
  });

  app.post("/scheduling/operate/run-due", { schema: { body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, workerId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "scheduling:operate");
    const body = request.body as { workspaceId: string; workerId?: string };
    return successEnvelope(await deps.temporalDispatcher.dispatchDue({ tenantId: principal.tenantId, workspaceId: body.workspaceId, workerId: body.workerId ?? `api-scheduling-worker:${principal.userId}`, actor: { userId: principal.userId, role: principal.role, sessionId: principal.sessionId }, requestId: request.id }), request.id);
  });

  app.post("/scheduling/operate/recover", { schema: { body: workspaceBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "scheduling:operate");
    const { workspaceId } = request.body as { workspaceId: string };
    return successEnvelope(await deps.recoveryService.recover({ tenantId: principal.tenantId, workspaceId, actor: { userId: principal.userId, role: principal.role, sessionId: principal.sessionId }, requestId: request.id }), request.id);
  });
}

type CreateScheduleBody = {
  workspaceId: string;
  publicationPlanId: string;
  publicationCandidateId: string;
  providerId: PublicationProvider;
  targetId: string;
  scheduledAt?: string;
  timezone: string;
  governancePolicyReference?: string;
  credentialReferenceId?: string;
  campaignId?: string;
  contentChecksum?: string;
  missedPolicy?: MissedOccurrencePolicy;
  allowDegradedProvider?: boolean;
  maxAttempts?: number;
  recurrence?: {
    frequency: "daily" | "weekly" | "monthly" | "custom_interval";
    startAt: string;
    endAt?: string;
    count?: number;
    interval?: number;
    daysOfWeek?: readonly number[];
    dayOfMonth?: number;
    windowDays?: number;
    allowOpenRecurrence?: boolean;
  };
};
type UpdateScheduleBody = { workspaceId: string; credentialReferenceId?: string; governancePolicyReference?: string; missedPolicy?: MissedOccurrencePolicy; allowDegradedProvider?: boolean; maxAttempts?: number };

function workspaceBodySchema() {
  return { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
}

function rescheduleBodySchema() {
  return { type: "object", required: ["workspaceId", "scheduledAt", "timezone"], properties: { workspaceId: { type: "string" }, occurrenceId: { type: "string" }, scheduledAt: { type: "string" }, timezone: { type: "string" } } } as const;
}

function updateScheduleBodySchema() {
  return {
    type: "object",
    required: ["workspaceId"],
    properties: {
      workspaceId: { type: "string" },
      credentialReferenceId: { type: "string" },
      governancePolicyReference: { type: "string" },
      missedPolicy: { type: "string" },
      allowDegradedProvider: { type: "boolean" },
      maxAttempts: { type: "number" },
    },
  } as const;
}

function createScheduleBodySchema() {
  return {
    type: "object",
    required: ["workspaceId", "publicationPlanId", "publicationCandidateId", "providerId", "targetId", "timezone"],
    properties: {
      workspaceId: { type: "string" },
      publicationPlanId: { type: "string" },
      publicationCandidateId: { type: "string" },
      providerId: { type: "string" },
      targetId: { type: "string" },
      scheduledAt: { type: "string" },
      timezone: { type: "string" },
      governancePolicyReference: { type: "string" },
      credentialReferenceId: { type: "string" },
      campaignId: { type: "string" },
      contentChecksum: { type: "string" },
      missedPolicy: { type: "string" },
      allowDegradedProvider: { type: "boolean" },
      maxAttempts: { type: "number" },
      recurrence: {
        type: "object",
        properties: {
          frequency: { type: "string" },
          startAt: { type: "string" },
          endAt: { type: "string" },
          count: { type: "number" },
          interval: { type: "number" },
          daysOfWeek: { type: "array", items: { type: "number" } },
          dayOfMonth: { type: "number" },
          windowDays: { type: "number" },
          allowOpenRecurrence: { type: "boolean" },
        },
      },
    },
  } as const;
}
