import type { RuntimeDetails } from "@/features/runtime/types";

export type ExecutionRunState = "created" | "validating" | "ready" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
export type ExecutionTaskRunState = "blocked" | "ready" | "running" | "waiting_for_approval" | "completed" | "failed" | "skipped" | "cancelled";

export type ExecutionRun = {
  id: string;
  runtimePlanId: string;
  planningId: string;
  tenantId: string;
  workspaceId: string;
  state: ExecutionRunState;
  mode: "dry_run" | "real";
  idempotencyKey: string;
  sourceGraphFingerprint: string;
  runtimeFingerprint: string;
  correlationId: string;
  causationId?: string;
  traceId: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  cancelledAt?: string;
  version: number;
};

export type ExecutionTaskRun = {
  id: string;
  executionRunId: string;
  runtimePlanId: string;
  runtimeTaskId: string;
  executionTaskId: string;
  type: string;
  capability: string;
  state: ExecutionTaskRunState;
  blockedReason?: string;
  correlationId: string;
  causationId?: string;
  traceId: string;
  attemptsCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  version: number;
};

export type ExecutionAttempt = {
  id: string;
  executionRunId: string;
  taskRunId: string;
  attemptNumber: number;
  state: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  failure?: { code: string; message: string; category: string; retryable: boolean };
  idempotencyKey: string;
  correlationId: string;
  causationId?: string;
  traceId: string;
};

export type ExecutionArtifact = {
  id: string;
  executionRunId: string;
  artifactType: string;
  schemaId: string;
  schemaVersion: number;
  producerTaskRunId: string;
  outputPort: string;
  payload?: Record<string, unknown>;
  payloadRef?: string;
  handlerId?: string;
  provider?: string;
  parentArtifactIds: readonly string[];
  checksum: string;
  createdAt: string;
};

export type ExecutionEvent = {
  id: string;
  executionRunId: string;
  eventType: string;
  taskRunId?: string;
  gateId?: string;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  createdAt: string;
  payload?: Record<string, unknown>;
};

export type ExecutionGate = {
  id: string;
  executionRunId: string;
  taskRunId: string;
  state: "open" | "approved" | "rejected";
  decision?: "approved" | "rejected";
  createdAt: string;
  resolvedAt?: string;
};

export type HandlerResolutionEvent = {
  id: string;
  executionRunId: string;
  taskRunId: string;
  capability: string;
  handler: string;
  provider: string;
  handlerVersion: string;
  featureFlags: Record<string, boolean>;
  executionMode: "dry_run" | "real";
  capabilityMapping?: { mappingVersion: number; executionCapability: string; skillCapability: string };
  fallbackPolicy: "fail_closed" | "deterministic_fallback";
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  createdAt: string;
};

export type ExecutionTrace = {
  id: string;
  executionRunId: string;
  taskRunId: string;
  attemptId: string;
  correlationId: string;
  causationId?: string;
  traceId: string;
  capability: string;
  handler: string;
  provider: string;
  handlerVersion: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  retryAttempt: number;
  warnings: readonly string[];
  success: boolean;
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
