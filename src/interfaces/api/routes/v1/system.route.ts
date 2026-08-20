import type { FastifyInstance } from "fastify";
import type { OperationalAuditRepositoryPort } from "../../../../application/ports/operational-audit-repository.port.js";
import type { OperationalHealthService, BackpressureController, BackupRestorePlanner, OperationalCircuitBreaker, OperationalRateLimiter, ProductionGuard } from "../../../../application/operations/operational-services.js";
import type { PublicationQueueJob, PublicationQueuePort } from "../../../../application/publication/publication-queue.js";
import type { SecretManagerPort } from "../../../../application/ports/secret-manager.port.js";
import type { SchedulingRecoveryService } from "../../../../application/scheduling/scheduling-recovery-service.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { NotFoundError } from "../../http/app-error.js";

const WORKSPACE_QUERY_SCHEMA = {
  type: "object",
  properties: {
    workspaceId: { type: "string" },
    routeGroup: { type: "string" },
    activeOnly: { type: "boolean" },
  },
} as const;

export type SystemRoutesDeps = {
  healthService: OperationalHealthService;
  circuitBreaker: OperationalCircuitBreaker;
  rateLimiter: OperationalRateLimiter;
  backpressure: BackpressureController;
  productionGuard: ProductionGuard;
  secretManager: SecretManagerPort;
  publicationQueue: PublicationQueuePort;
  auditRepository: OperationalAuditRepositoryPort;
  schedulingRecoveryService: SchedulingRecoveryService;
  backupRestorePlanner: BackupRestorePlanner;
  idGenerator: () => string;
};

export async function registerSystemRoutes(app: FastifyInstance, deps: SystemRoutesDeps): Promise<void> {
  app.get("/system/health", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "system:operate");
    const { workspaceId } = request.query as { workspaceId?: string };
    return successEnvelope(await deps.healthService.systemHealth({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.get("/system/readiness", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "system:operate");
    const { workspaceId } = request.query as { workspaceId?: string };
    return successEnvelope(await deps.healthService.readiness({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.get("/system/circuit-breakers", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "system:operate");
    const { workspaceId } = request.query as { workspaceId?: string };
    return successEnvelope(await deps.circuitBreaker.list({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.post("/system/circuit-breakers/:id/reset", { schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string" } } }, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "system:operate");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId?: string };
    const reset = await deps.circuitBreaker.reset(id, { tenantId: principal.tenantId, workspaceId });
    if (!reset) throw new NotFoundError("Circuit breaker nao encontrado.", { id });
    await deps.auditRepository.record({
      id: deps.idGenerator(),
      tenantId: principal.tenantId,
      workspaceId,
      eventType: "system_circuit_breaker_reset",
      actor: principal,
      resource: { type: "system", id },
      context: { requestId: request.id },
      result: { status: "success" },
    });
    return successEnvelope(reset, request.id);
  });

  app.get("/system/rate-limits", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "system:operate");
    const { routeGroup } = request.query as { routeGroup?: string };
    const buckets = await deps.rateLimiter.list({ tenantId: principal.tenantId, routeGroup, limit: 100 });
    return successEnvelope(buckets.map(toSafeRateLimitBucket), request.id);
  });

  app.get("/system/backpressure", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "system:operate");
    const { workspaceId, activeOnly } = request.query as { workspaceId?: string; activeOnly?: boolean };
    return successEnvelope(await deps.backpressure.list({ tenantId: principal.tenantId, workspaceId, activeOnly, limit: 100 }), request.id);
  });

  app.get("/system/queues", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "system:operate");
    const { workspaceId } = request.query as { workspaceId?: string };
    const localJobs = (await deps.publicationQueue.list()).filter((job) => job.tenantId === principal.tenantId && (workspaceId ? job.workspaceId === workspaceId : true));
    return successEnvelope({ publication: { localQueueSize: localJobs.length, localJobs: localJobs.map(toSafeQueueJob) } }, request.id);
  });

  app.get("/system/secrets/health", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    requirePermission(request, "system:operate");
    return successEnvelope(await deps.secretManager.health(), request.id);
  });

  app.get("/system/release-gate", async (request) => {
    requirePermission(request, "system:operate");
    return successEnvelope(deps.productionGuard.snapshot(), request.id);
  });

  app.get("/system/slo", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "system:operate");
    const { workspaceId } = request.query as { workspaceId?: string };
    return successEnvelope((await deps.healthService.systemHealth({ tenantId: principal.tenantId, workspaceId })).slo, request.id);
  });

  app.get("/system/audit", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "system:operate");
    const { workspaceId } = request.query as { workspaceId?: string };
    return successEnvelope(await deps.auditRepository.list({ tenantId: principal.tenantId, workspaceId, limit: 100 }), request.id);
  });

  app.get("/system/backup-restore", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    requirePermission(request, "system:operate");
    return successEnvelope(deps.backupRestorePlanner.describePlan(), request.id);
  });

  app.post("/system/recovery/run", { schema: { body: { type: "object", properties: { workspaceId: { type: "string" } } } } }, async (request) => {
    const principal = requirePermission(request, "system:operate");
    const { workspaceId } = request.body as { workspaceId?: string };
    const scheduling = workspaceId
      ? await deps.schedulingRecoveryService.recover({ tenantId: principal.tenantId, workspaceId, actor: principal, requestId: request.id })
      : undefined;
    await deps.auditRepository.record({
      id: deps.idGenerator(),
      tenantId: principal.tenantId,
      workspaceId,
      eventType: "system_recovery_run",
      actor: principal,
      resource: { type: "system", id: workspaceId ?? "tenant" },
      context: { requestId: request.id },
      result: { status: "success" },
    });
    return successEnvelope({ scheduling, publication: { recoverySource: "durable_outbox", safeMessage: "Publication recovery usa outbox/reconciliation duraveis nos endpoints existentes." } }, request.id);
  });
}

function toSafeRateLimitBucket<T extends { key: string; tenantId?: string; principalId?: string; ip?: string; routeGroup: string; resetAt: string }>(bucket: T, index: number): Omit<T, "key" | "tenantId" | "principalId" | "ip"> & { key: string } {
  const { tenantId: _tenantId, principalId: _principalId, ip: _ip, key: _key, ...safe } = bucket;
  return { ...safe, key: `${bucket.routeGroup}:${index}:${bucket.resetAt}` };
}

function toSafeQueueJob(job: PublicationQueueJob) {
  return {
    id: job.id,
    publicationId: job.publicationId,
    kind: job.kind,
    enqueuedAt: job.enqueuedAt,
    runAfter: job.runAfter,
  };
}
