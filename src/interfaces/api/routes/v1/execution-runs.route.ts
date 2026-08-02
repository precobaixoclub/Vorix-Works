import type { FastifyInstance } from "fastify";
import {
  cancelExecution,
  createExecution,
  decideExecutionGateUseCase,
  getExecutionRun,
  listExecutionEvents,
  listExecutionRuns,
  listExecutionTasks,
  startExecution,
  type ExecutionUseCaseDeps,
} from "../../../../application/execution/execution-use-cases.js";
import type { ExecutionRepositoryPort } from "../../../../application/ports/execution-repository.port.js";
import type { ExecutionContractRegistry } from "../../../../application/execution/execution-contract-registry.js";
import { collectExecutionHealth, collectExecutionMetrics } from "../../../../application/execution/execution-observability.js";
import type { ExecutionFeatureFlags } from "../../../../application/execution/feature-flags.js";
import { serializeExecutionFeatureFlags } from "../../../../application/execution/feature-flags.js";
import type { ExecutionEnvironmentPolicy } from "../../../../application/execution/execution-operational-policy.js";
import type { HandlerCircuitBreakerPort } from "../../../../application/execution/handler-circuit-breaker.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { translateExecutionError } from "./execution-error-translator.js";

const WORKSPACE_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 }, runtimePlanId: { type: "string", minLength: 1 } },
} as const;

const ID_PARAMS_SCHEMA = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", minLength: 1 } },
} as const;

const CREATE_SCHEMA = {
  type: "object",
  required: ["workspaceId", "runtimePlanId", "idempotencyKey"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    runtimePlanId: { type: "string", minLength: 1 },
    idempotencyKey: { type: "string", minLength: 1 },
    executionMode: { type: "string", enum: ["dry_run", "real"] },
  },
} as const;

const GATE_PARAMS_SCHEMA = {
  type: "object",
  required: ["runId", "gateId"],
  properties: { runId: { type: "string", minLength: 1 }, gateId: { type: "string", minLength: 1 } },
} as const;

const GATE_DECISION_SCHEMA = {
  type: "object",
  required: ["workspaceId", "decision"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    decision: { type: "string", enum: ["approved", "rejected"] },
  },
} as const;

export async function registerExecutionRunRoutes(app: FastifyInstance, deps: ExecutionUseCaseDeps & {
  executionRepository: ExecutionRepositoryPort;
  contractRegistry: ExecutionContractRegistry;
  executionFeatureFlags: ExecutionFeatureFlags;
  executionEnvironmentPolicy: ExecutionEnvironmentPolicy;
  circuitBreaker: HandlerCircuitBreakerPort;
}): Promise<void> {
  app.get("/execution/contracts", async (request) => {
    requirePermission(request, "execution:read");
    return successEnvelope(
      deps.contractRegistry.list().map((contract) => ({
        schemaId: contract.schemaId,
        schemaVersion: contract.schemaVersion,
        capability: contract.capability,
        taskType: contract.taskType,
        inputPort: contract.inputPort,
        outputPort: contract.outputPort,
        artifactType: contract.artifactType,
        cardinality: contract.cardinality,
        acceptedArtifactTypes: contract.acceptedArtifactTypes,
        requiredFields: contract.requiredFields,
        optionalFields: contract.optionalFields,
        limits: contract.limits,
        sideEffectPolicy: contract.sideEffectPolicy,
        skillCapabilities: contract.skillCapabilities,
      })),
      request.id,
    );
  });

  app.get("/execution/health", async (request) => {
    requirePermission(request, "execution:read");
    return successEnvelope(
      collectExecutionHealth({
        handlerCount: deps.handlers.length + deps.circuitBreaker.list().length,
        contractCount: deps.contractRegistry.list().length,
        featureFlags: serializeExecutionFeatureFlags(deps.executionFeatureFlags),
        circuitBreakers: deps.circuitBreaker.list(),
      }),
      request.id,
    );
  });

  app.get("/execution/metrics", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "execution:read");
    const query = request.query as { workspaceId: string };
    return successEnvelope(await collectExecutionMetrics(deps.executionRepository, { tenantId: principal.tenantId, workspaceId: query.workspaceId }), request.id);
  });

  app.post("/execution-runs", { schema: { body: CREATE_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "execution:create");
    const body = request.body as { workspaceId: string; runtimePlanId: string; idempotencyKey: string; executionMode?: "dry_run" | "real" };
    const run = await createExecution(deps, { tenantId: principal.tenantId, ...body }).catch(translateExecutionError);
    return successEnvelope(run, request.id);
  });

  app.get("/execution-runs", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "execution:read");
    const query = request.query as { workspaceId: string; runtimePlanId?: string };
    const runs = await listExecutionRuns(deps.executionRepository, { tenantId: principal.tenantId, ...query });
    return successEnvelope(runs, request.id);
  });

  app.get("/execution-runs/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "execution:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    const detail = await getExecutionRun(deps.executionRepository, { tenantId: principal.tenantId, workspaceId, id }).catch(translateExecutionError);
    return successEnvelope(detail, request.id);
  });

  app.get("/execution-runs/:id/tasks", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "execution:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    const tasks = await listExecutionTasks(deps.executionRepository, { tenantId: principal.tenantId, workspaceId, id }).catch(translateExecutionError);
    return successEnvelope(tasks, request.id);
  });

  app.get("/execution-runs/:id/events", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "execution:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    const events = await listExecutionEvents(deps.executionRepository, { tenantId: principal.tenantId, workspaceId, id }).catch(translateExecutionError);
    return successEnvelope(events, request.id);
  });

  app.get("/execution-runs/:id/traces", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "execution:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    const detail = await getExecutionRun(deps.executionRepository, { tenantId: principal.tenantId, workspaceId, id }).catch(translateExecutionError);
    return successEnvelope(detail.traces, request.id);
  });

  app.post("/execution-runs/:id/start", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } } }, async (request) => {
    const principal = requirePermission(request, "execution:start");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    const run = await startExecution(deps, { tenantId: principal.tenantId, workspaceId, id }).catch(translateExecutionError);
    return successEnvelope(run, request.id);
  });

  app.post("/execution-runs/:id/cancel", { schema: { params: ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } } }, async (request) => {
    const principal = requirePermission(request, "execution:cancel");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    const run = await cancelExecution(deps, { tenantId: principal.tenantId, workspaceId, id }).catch(translateExecutionError);
    return successEnvelope(run, request.id);
  });

  app.post("/execution-runs/:runId/gates/:gateId/decision", { schema: { params: GATE_PARAMS_SCHEMA, body: GATE_DECISION_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "execution:approve");
    const { runId, gateId } = request.params as { runId: string; gateId: string };
    const { workspaceId, decision } = request.body as { workspaceId: string; decision: "approved" | "rejected" };
    const run = await decideExecutionGateUseCase(deps, { tenantId: principal.tenantId, workspaceId, runId, gateId, decision, decidedByUserId: principal.userId }).catch(translateExecutionError);
    return successEnvelope(run, request.id);
  });
}
