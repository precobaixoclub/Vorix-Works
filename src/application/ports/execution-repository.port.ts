import type {
  ExecutionArtifact,
  ExecutionAttempt,
  ExecutionAttemptState,
  ExecutionEvent,
  ExecutionEventType,
  ExecutionFailure,
  ExecutionGate,
  ExecutionGateDecision,
  HandlerResolutionEvent,
  ExecutionTrace,
  ExecutionRun,
  ExecutionRunState,
  ExecutionTaskRun,
  ExecutionTaskRunState,
} from "../../domain/execution/execution.model.js";
import type { RuntimeDetails } from "./runtime-repository.port.js";
import type { RuntimeTask } from "../../domain/runtime/runtime.model.js";

export type CreateExecutionRunInput = {
  run: Omit<ExecutionRun, "createdAt" | "updatedAt" | "version">;
  runtimeTasks: readonly RuntimeTask[];
  runtimeDetails: RuntimeDetails;
};

export type ExecutionRunDetail = {
  run: ExecutionRun;
  taskRuns: readonly ExecutionTaskRun[];
  attempts: readonly ExecutionAttempt[];
  artifacts: readonly ExecutionArtifact[];
  events: readonly ExecutionEvent[];
  gates: readonly ExecutionGate[];
  runtimeDetails: RuntimeDetails;
  handlerResolution: readonly HandlerResolutionEvent[];
  traces: readonly ExecutionTrace[];
};

export type ListExecutionRunsFilter = {
  tenantId: string;
  workspaceId: string;
  runtimePlanId?: string;
};

export type CreateExecutionAttemptInput = {
  id: string;
  executionRunId: string;
  taskRunId: string;
  attemptNumber: number;
  idempotencyKey: string;
  correlationId: string;
  causationId?: string;
  traceId: string;
};

export type CreateExecutionArtifactInput = Omit<ExecutionArtifact, "createdAt">;

export type CreateExecutionEventInput = {
  id: string;
  executionRunId: string;
  eventType: ExecutionEventType;
  taskRunId?: string;
  gateId?: string;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  payload?: Record<string, unknown>;
};

export type CreateExecutionGateInput = {
  id: string;
  executionRunId: string;
  taskRunId: string;
};

export type CreateHandlerResolutionEventInput = Omit<HandlerResolutionEvent, "createdAt">;
export type CreateExecutionTraceInput = ExecutionTrace;

export type ExecutionRepositoryPort = {
  createRun(input: CreateExecutionRunInput): Promise<ExecutionRunDetail>;
  getRunById(id: string): Promise<ExecutionRun | undefined>;
  getRunByRuntimeAndIdempotency(runtimePlanId: string, idempotencyKey: string): Promise<ExecutionRun | undefined>;
  getDetail(id: string): Promise<ExecutionRunDetail | undefined>;
  listRuns(filter: ListExecutionRunsFilter): Promise<ExecutionRun[]>;
  listTasks(runId: string): Promise<ExecutionTaskRun[]>;
  listEvents(runId: string): Promise<ExecutionEvent[]>;
  appendEvent(input: CreateExecutionEventInput): Promise<ExecutionEvent>;
  updateRunState(input: { id: string; state: ExecutionRunState; expectedVersion: number; startedAt?: string; finishedAt?: string; cancelledAt?: string }): Promise<ExecutionRun>;
  replaceRunState(input: { id: string; state: ExecutionRunState; startedAt?: string; finishedAt?: string; cancelledAt?: string }): Promise<ExecutionRun>;
  updateTaskRunState(input: { id: string; state: ExecutionTaskRunState; expectedVersion: number; blockedReason?: string; startedAt?: string; finishedAt?: string }): Promise<ExecutionTaskRun>;
  replaceTaskRunState(input: { id: string; state: ExecutionTaskRunState; blockedReason?: string; startedAt?: string; finishedAt?: string }): Promise<ExecutionTaskRun>;
  createAttempt(input: CreateExecutionAttemptInput): Promise<ExecutionAttempt>;
  finishAttempt(input: { id: string; state: ExecutionAttemptState; failure?: ExecutionFailure }): Promise<ExecutionAttempt>;
  createArtifacts(inputs: readonly CreateExecutionArtifactInput[]): Promise<ExecutionArtifact[]>;
  createGate(input: CreateExecutionGateInput): Promise<ExecutionGate>;
  resolveGate(input: { runId: string; gateId: string; decision: ExecutionGateDecision; decidedByUserId?: string }): Promise<ExecutionGate>;
  appendHandlerResolution(input: CreateHandlerResolutionEventInput): Promise<HandlerResolutionEvent>;
  appendTrace(input: CreateExecutionTraceInput): Promise<ExecutionTrace>;
};
