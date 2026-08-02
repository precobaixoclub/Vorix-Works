import type { ExecutionCapability, PlanningArtifactType, TaskType } from "../planning/planning.model.js";

/**
 * Domínio Execution — executa `RuntimePlan` validado em `dry_run` ou `real` controlado.
 * Não importa Caio, Helena, Skill contracts, AI Gateway, SDKs externos ou publicação.
 */

export const EXECUTION_RUN_STATES = ["created", "validating", "ready", "running", "waiting_for_approval", "completed", "failed", "cancelled"] as const;
export type ExecutionRunState = (typeof EXECUTION_RUN_STATES)[number];

export const EXECUTION_TASK_RUN_STATES = ["blocked", "ready", "running", "waiting_for_approval", "completed", "failed", "skipped", "cancelled"] as const;
export type ExecutionTaskRunState = (typeof EXECUTION_TASK_RUN_STATES)[number];

export const EXECUTION_MODES = ["dry_run", "real"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export type ExecutionRun = {
  id: string;
  runtimePlanId: string;
  planningId: string;
  tenantId: string;
  workspaceId: string;
  state: ExecutionRunState;
  mode: ExecutionMode;
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
  type: TaskType;
  capability: ExecutionCapability;
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

export const EXECUTION_FAILURE_CATEGORIES = [
  "configuration",
  "authentication",
  "timeout",
  "provider_unavailable",
  "rate_limited",
  "invalid_input",
  "invalid_output",
  "policy_violation",
  "internal",
  "cancelled",
] as const;
export type ExecutionFailureCategory = (typeof EXECUTION_FAILURE_CATEGORIES)[number];

export type ExecutionFailure = {
  code: string;
  message: string;
  category: ExecutionFailureCategory;
  retryable: boolean;
};

export const EXECUTION_ATTEMPT_STATES = ["running", "completed", "failed"] as const;
export type ExecutionAttemptState = (typeof EXECUTION_ATTEMPT_STATES)[number];

export type ExecutionAttempt = {
  id: string;
  executionRunId: string;
  taskRunId: string;
  attemptNumber: number;
  state: ExecutionAttemptState;
  startedAt: string;
  finishedAt?: string;
  failure?: ExecutionFailure;
  idempotencyKey: string;
  correlationId: string;
  causationId?: string;
  traceId: string;
};

export type ExecutionArtifactPayload = Record<string, unknown>;

export type ExecutionArtifact = {
  id: string;
  executionRunId: string;
  runtimePlanId: string;
  tenantId: string;
  workspaceId: string;
  artifactType: PlanningArtifactType;
  schemaId: string;
  schemaVersion: number;
  producerTaskRunId: string;
  outputPort: string;
  payload?: ExecutionArtifactPayload;
  payloadRef?: string;
  handlerId?: string;
  provider?: string;
  parentArtifactIds: readonly string[];
  checksum: string;
  createdAt: string;
};

export const EXECUTION_EVENT_TYPES = [
  "run_created",
  "run_started",
  "task_ready",
  "task_started",
  "task_completed",
  "task_failed",
  "artifact_produced",
  "gate_created",
  "gate_resolved",
  "retry_scheduled",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "side_effect_blocked",
] as const;
export type ExecutionEventType = (typeof EXECUTION_EVENT_TYPES)[number];

export type ExecutionEvent = {
  id: string;
  executionRunId: string;
  eventType: ExecutionEventType;
  taskRunId?: string;
  gateId?: string;
  correlationId?: string;
  causationId?: string;
  traceId?: string;
  createdAt: string;
  payload?: Record<string, unknown>;
};

export const EXECUTION_GATE_STATES = ["open", "approved", "rejected"] as const;
export type ExecutionGateState = (typeof EXECUTION_GATE_STATES)[number];

export type ExecutionGateDecision = "approved" | "rejected";

export type ExecutionGate = {
  id: string;
  executionRunId: string;
  taskRunId: string;
  state: ExecutionGateState;
  decision?: ExecutionGateDecision;
  createdAt: string;
  resolvedAt?: string;
  decidedByUserId?: string;
};

export const HANDLER_FALLBACK_POLICIES = ["fail_closed", "deterministic_fallback"] as const;
export type HandlerFallbackPolicy = (typeof HANDLER_FALLBACK_POLICIES)[number];

export const SIDE_EFFECT_POLICIES = ["none", "external_read", "external_write", "publication_preview", "publication"] as const;
export type SideEffectPolicy = (typeof SIDE_EFFECT_POLICIES)[number];

export const BACKOFF_STRATEGIES = ["none", "fixed", "exponential"] as const;
export type BackoffStrategy = (typeof BACKOFF_STRATEGIES)[number];

export type HandlerRetryPolicy = {
  supportsRetry: boolean;
  maxAttempts: number;
  backoffStrategy: BackoffStrategy;
};

export type HandlerResolutionEvent = {
  id: string;
  executionRunId: string;
  taskRunId: string;
  capability: ExecutionCapability;
  handler: string;
  provider: string;
  handlerVersion: string;
  featureFlags: Record<string, boolean>;
  executionMode: ExecutionMode;
  capabilityMapping?: {
    mappingVersion: number;
    executionCapability: ExecutionCapability;
    skillCapability: string;
  };
  fallbackPolicy: HandlerFallbackPolicy;
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
  capability: ExecutionCapability;
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
