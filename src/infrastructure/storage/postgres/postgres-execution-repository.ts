import type { Pool, PoolClient } from "pg";
import type {
  CreateExecutionArtifactInput,
  CreateExecutionAttemptInput,
  CreateExecutionEventInput,
  CreateExecutionGateInput,
  CreateExecutionTraceInput,
  CreateHandlerResolutionEventInput,
  CreateExecutionRunInput,
  ExecutionRepositoryPort,
  ExecutionRunDetail,
  ListExecutionRunsFilter,
} from "../../../application/ports/execution-repository.port.js";
import type { RuntimeDetails } from "../../../application/ports/runtime-repository.port.js";
import type {
  ExecutionArtifact,
  ExecutionAttempt,
  ExecutionEvent,
  ExecutionFailure,
  ExecutionGate,
  ExecutionGateDecision,
  ExecutionRun,
  ExecutionRunState,
  ExecutionTaskRun,
  ExecutionTaskRunState,
  ExecutionTrace,
  HandlerFallbackPolicy,
  HandlerResolutionEvent,
} from "../../../domain/execution/execution.model.js";
import type { ExecutionCapability, PlanningArtifactType, TaskType } from "../../../domain/planning/planning.model.js";
import type { RuntimeArtifactStatus, RuntimeBinding, RuntimeTask, RuntimeTaskInputPort, RuntimeTaskOutputPort, RuntimeTaskStatus, RuntimeValidationIssue } from "../../../domain/runtime/runtime.model.js";

type RunRow = {
  id: string; runtime_plan_id: string; planning_id: string; tenant_id: string; workspace_id: string; state: string; mode: string; idempotency_key: string;
  source_graph_fingerprint: string; runtime_fingerprint: string; correlation_id: string | null; causation_id: string | null; trace_id: string | null; created_at: Date; updated_at: Date; started_at: Date | null; finished_at: Date | null; cancelled_at: Date | null; version: number;
};
type TaskRunRow = {
  id: string; execution_run_id: string; runtime_plan_id: string; runtime_task_id: string; execution_task_id: string; type: string; capability: string; state: string; blocked_reason: string | null;
  correlation_id: string | null; causation_id: string | null; trace_id: string | null; attempts_count: number; created_at: Date; updated_at: Date; started_at: Date | null; finished_at: Date | null; version: number;
};
type AttemptRow = { id: string; execution_run_id: string; task_run_id: string; attempt_number: number; state: string; started_at: Date; finished_at: Date | null; failure: ExecutionFailure | null; idempotency_key: string; correlation_id: string | null; causation_id: string | null; trace_id: string | null };
type ArtifactRow = {
  id: string; execution_run_id: string; runtime_plan_id: string; tenant_id: string; workspace_id: string; artifact_type: string; schema_id: string; schema_version: number;
  producer_task_run_id: string; output_port: string; payload: Record<string, unknown> | null; payload_ref: string | null; handler_id: string | null; provider: string | null; parent_artifact_ids: string[] | null; checksum: string; created_at: Date;
};
type EventRow = { id: string; execution_run_id: string; event_type: string; task_run_id: string | null; gate_id: string | null; correlation_id: string | null; causation_id: string | null; trace_id: string | null; created_at: Date; payload: Record<string, unknown> | null };
type GateRow = { id: string; execution_run_id: string; task_run_id: string; state: string; decision: string | null; created_at: Date; resolved_at: Date | null; decided_by_user_id: string | null };
type HandlerResolutionRow = {
  id: string; execution_run_id: string; task_run_id: string; capability: string; handler: string; provider: string; handler_version: string;
  feature_flags: Record<string, boolean>; execution_mode: string; mapping_version: number | null; skill_capability: string | null; fallback_policy: string; correlation_id: string | null; causation_id: string | null; trace_id: string | null; created_at: Date;
};
type TraceRow = {
  id: string; execution_run_id: string; task_run_id: string; attempt_id: string; capability: string; handler: string; provider: string; handler_version: string;
  correlation_id: string | null; causation_id: string | null; trace_id: string | null; started_at: Date; finished_at: Date; duration_ms: number; retry_attempt: number; warnings: string[]; success: boolean;
};

type RuntimeTaskRow = { id: string; runtime_plan_id: string; execution_task_id: string; type: string; capability: string; status: string; created_at: Date };
type RuntimeInputRow = { id: string; runtime_plan_id: string; runtime_task_id: string; port_key: string; accepted_artifact_types: string[]; required: boolean; description: string; created_at: Date };
type RuntimeOutputRow = { id: string; runtime_plan_id: string; runtime_task_id: string; port_key: string; artifact_type: string; description: string; created_at: Date };
type RuntimeBindingRow = { id: string; runtime_plan_id: string; from_runtime_task_id: string; from_output_port: string; to_runtime_task_id: string; to_input_port: string; created_at: Date };
type RuntimeArtifactRow = { id: string; runtime_plan_id: string; runtime_task_id: string; artifact_type: string; description: string; expected_fields: string[]; status: string; created_at: Date };
type RuntimeIssueRow = { code: string; message: string; field: string | null; severity: string };

export class PostgresExecutionRepository implements ExecutionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async createRun(input: CreateExecutionRunInput): Promise<ExecutionRunDetail> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into execution_runs (
          id, runtime_plan_id, planning_id, tenant_id, workspace_id, state, mode, idempotency_key,
          source_graph_fingerprint, runtime_fingerprint, correlation_id, causation_id, trace_id, created_at, updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(), now())`,
        [
          input.run.id,
          input.run.runtimePlanId,
          input.run.planningId,
          input.run.tenantId,
          input.run.workspaceId,
          input.run.state,
          input.run.mode,
          input.run.idempotencyKey,
          input.run.sourceGraphFingerprint,
          input.run.runtimeFingerprint,
          input.run.correlationId,
          input.run.causationId ?? null,
          input.run.traceId,
        ],
      );
      for (const task of input.runtimeTasks) {
        await client.query(
          `insert into execution_task_runs (
            id, execution_run_id, runtime_plan_id, runtime_task_id, execution_task_id, type, capability,
            state, blocked_reason, correlation_id, causation_id, trace_id, attempts_count, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,'blocked','Waiting for dependencies.',$8,$9,$10,0,now(),now())`,
          [`${input.run.id}:${task.id}`, input.run.id, input.run.runtimePlanId, task.id, task.executionTaskId, task.type, task.capability, input.run.correlationId, input.run.id, input.run.traceId],
        );
      }
      await client.query("commit");
      const detail = await this.getDetail(input.run.id);
      if (!detail) throw new Error("EXECUTION_RUN_NOT_FOUND: execution run criado não foi encontrado.");
      return detail;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getRunById(id: string): Promise<ExecutionRun | undefined> {
    const result = await this.pool.query<RunRow>("select * from execution_runs where id = $1", [id]);
    return result.rows[0] ? toRun(result.rows[0]) : undefined;
  }

  async getRunByRuntimeAndIdempotency(runtimePlanId: string, idempotencyKey: string): Promise<ExecutionRun | undefined> {
    const result = await this.pool.query<RunRow>("select * from execution_runs where runtime_plan_id = $1 and idempotency_key = $2", [runtimePlanId, idempotencyKey]);
    return result.rows[0] ? toRun(result.rows[0]) : undefined;
  }

  async getDetail(id: string): Promise<ExecutionRunDetail | undefined> {
    const run = await this.getRunById(id);
    if (!run) return undefined;
    const taskRuns = await this.listTasks(id);
    const attempts = await this.pool.query<AttemptRow>("select * from execution_attempts where execution_run_id = $1 order by started_at, attempt_number", [id]).then((r) => r.rows.map(toAttempt));
    const artifacts = await this.pool.query<ArtifactRow>("select * from execution_artifacts where execution_run_id = $1 order by created_at", [id]).then((r) => r.rows.map(toArtifact));
    const events = await this.listEvents(id);
    const gates = await this.pool.query<GateRow>("select * from execution_gates where execution_run_id = $1 order by created_at", [id]).then((r) => r.rows.map(toGate));
    const handlerResolution = await this.pool.query<HandlerResolutionRow>("select * from execution_handler_resolution_events where execution_run_id = $1 order by created_at, id", [id]).then((r) => r.rows.map(toHandlerResolution));
    const traces = await this.pool.query<TraceRow>("select * from execution_traces where execution_run_id = $1 order by started_at, id", [id]).then((r) => r.rows.map(toTrace));
    const runtimeDetails = await this.getRuntimeDetails(run.runtimePlanId);
    return { run, taskRuns, attempts, artifacts, events, gates, runtimeDetails, handlerResolution, traces };
  }

  async listRuns(filter: ListExecutionRunsFilter): Promise<ExecutionRun[]> {
    const conditions = ["tenant_id = $1", "workspace_id = $2"];
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    if (filter.runtimePlanId) {
      params.push(filter.runtimePlanId);
      conditions.push(`runtime_plan_id = $${params.length}`);
    }
    const result = await this.pool.query<RunRow>(`select * from execution_runs where ${conditions.join(" and ")} order by created_at desc`, params);
    return result.rows.map(toRun);
  }

  async listTasks(runId: string): Promise<ExecutionTaskRun[]> {
    const result = await this.pool.query<TaskRunRow>("select * from execution_task_runs where execution_run_id = $1 order by created_at, id", [runId]);
    return result.rows.map(toTaskRun);
  }

  async listEvents(runId: string): Promise<ExecutionEvent[]> {
    const result = await this.pool.query<EventRow>("select * from execution_events where execution_run_id = $1 order by created_at, id", [runId]);
    return result.rows.map(toEvent);
  }

  async appendEvent(input: CreateExecutionEventInput): Promise<ExecutionEvent> {
    const result = await this.pool.query<EventRow>(
      `insert into execution_events (id, execution_run_id, event_type, task_run_id, gate_id, correlation_id, causation_id, trace_id, created_at, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) returning *`,
      [input.id, input.executionRunId, input.eventType, input.taskRunId ?? null, input.gateId ?? null, input.correlationId ?? null, input.causationId ?? null, input.traceId ?? null, input.payload ? JSON.stringify(input.payload) : null],
    );
    return toEvent(result.rows[0]);
  }

  async updateRunState(input: { id: string; state: ExecutionRunState; expectedVersion: number; startedAt?: string; finishedAt?: string; cancelledAt?: string }): Promise<ExecutionRun> {
    return this.updateRun(input.id, input.state, input.expectedVersion, input);
  }

  async replaceRunState(input: { id: string; state: ExecutionRunState; startedAt?: string; finishedAt?: string; cancelledAt?: string }): Promise<ExecutionRun> {
    const run = await this.getRunById(input.id);
    if (!run) throw new Error(`EXECUTION_RUN_NOT_FOUND: execution run "${input.id}" não existe.`);
    return this.updateRun(input.id, input.state, run.version, input);
  }

  async updateTaskRunState(input: { id: string; state: ExecutionTaskRunState; expectedVersion: number; blockedReason?: string; startedAt?: string; finishedAt?: string }): Promise<ExecutionTaskRun> {
    return this.updateTask(input.id, input.state, input.expectedVersion, input);
  }

  async replaceTaskRunState(input: { id: string; state: ExecutionTaskRunState; blockedReason?: string; startedAt?: string; finishedAt?: string }): Promise<ExecutionTaskRun> {
    const result = await this.pool.query<TaskRunRow>("select * from execution_task_runs where id = $1", [input.id]);
    const task = result.rows[0];
    if (!task) throw new Error(`EXECUTION_TASK_RUN_NOT_FOUND: task run "${input.id}" não existe.`);
    return this.updateTask(input.id, input.state, task.version, input);
  }

  async createAttempt(input: CreateExecutionAttemptInput): Promise<ExecutionAttempt> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const attempt = await client.query<AttemptRow>(
        `insert into execution_attempts (id, execution_run_id, task_run_id, attempt_number, state, started_at, idempotency_key, correlation_id, causation_id, trace_id)
         values ($1,$2,$3,$4,'running',now(),$5,$6,$7,$8) returning *`,
        [input.id, input.executionRunId, input.taskRunId, input.attemptNumber, input.idempotencyKey, input.correlationId, input.causationId ?? null, input.traceId],
      );
      await client.query("update execution_task_runs set attempts_count = attempts_count + 1, updated_at = now(), version = version + 1 where id = $1", [input.taskRunId]);
      await client.query("commit");
      return toAttempt(attempt.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async finishAttempt(input: { id: string; state: "running" | "completed" | "failed"; failure?: ExecutionFailure }): Promise<ExecutionAttempt> {
    const result = await this.pool.query<AttemptRow>(
      "update execution_attempts set state = $2, failure = $3, finished_at = now() where id = $1 returning *",
      [input.id, input.state, input.failure ? JSON.stringify(input.failure) : null],
    );
    if (!result.rows[0]) throw new Error(`EXECUTION_ATTEMPT_NOT_FOUND: attempt "${input.id}" não existe.`);
    return toAttempt(result.rows[0]);
  }

  async createArtifacts(inputs: readonly CreateExecutionArtifactInput[]): Promise<ExecutionArtifact[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const created: ExecutionArtifact[] = [];
      for (const input of inputs) {
        const result = await client.query<ArtifactRow>(
          `insert into execution_artifacts (
            id, execution_run_id, runtime_plan_id, tenant_id, workspace_id, artifact_type, schema_id, schema_version,
            producer_task_run_id, output_port, payload, payload_ref, handler_id, provider, parent_artifact_ids, checksum, created_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now()) returning *`,
          [
            input.id,
            input.executionRunId,
            input.runtimePlanId,
            input.tenantId,
            input.workspaceId,
            input.artifactType,
            input.schemaId,
            input.schemaVersion,
            input.producerTaskRunId,
            input.outputPort,
            input.payload ? JSON.stringify(input.payload) : null,
            input.payloadRef ?? null,
            input.handlerId ?? null,
            input.provider ?? null,
            input.parentArtifactIds,
            input.checksum,
          ],
        );
        created.push(toArtifact(result.rows[0]));
      }
      await client.query("commit");
      return created;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createGate(input: CreateExecutionGateInput): Promise<ExecutionGate> {
    const existing = await this.pool.query<GateRow>("select * from execution_gates where task_run_id = $1 and state = 'open'", [input.taskRunId]);
    if (existing.rows[0]) return toGate(existing.rows[0]);
    const result = await this.pool.query<GateRow>(
      "insert into execution_gates (id, execution_run_id, task_run_id, state, created_at) values ($1,$2,$3,'open',now()) returning *",
      [input.id, input.executionRunId, input.taskRunId],
    );
    return toGate(result.rows[0]);
  }

  async resolveGate(input: { runId: string; gateId: string; decision: ExecutionGateDecision; decidedByUserId?: string }): Promise<ExecutionGate> {
    const result = await this.pool.query<GateRow>(
      `update execution_gates
       set state = case when state = 'open' then $3 else state end,
           decision = case when state = 'open' then $3 else decision end,
           decided_by_user_id = case when state = 'open' then $4 else decided_by_user_id end,
           resolved_at = case when state = 'open' then now() else resolved_at end
       where execution_run_id = $1 and id = $2
       returning *`,
      [input.runId, input.gateId, input.decision, input.decidedByUserId ?? null],
    );
    if (!result.rows[0]) throw new Error(`EXECUTION_GATE_NOT_FOUND: gate "${input.gateId}" não existe.`);
    return toGate(result.rows[0]);
  }

  async appendHandlerResolution(input: CreateHandlerResolutionEventInput): Promise<HandlerResolutionEvent> {
    const result = await this.pool.query<HandlerResolutionRow>(
      `insert into execution_handler_resolution_events (
        id, execution_run_id, task_run_id, capability, handler, provider, handler_version, feature_flags,
        execution_mode, mapping_version, skill_capability, fallback_policy, correlation_id, causation_id, trace_id, created_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now()) returning *`,
      [
        input.id,
        input.executionRunId,
        input.taskRunId,
        input.capability,
        input.handler,
        input.provider,
        input.handlerVersion,
        JSON.stringify(input.featureFlags),
        input.executionMode,
        input.capabilityMapping?.mappingVersion ?? null,
        input.capabilityMapping?.skillCapability ?? null,
        input.fallbackPolicy,
        input.correlationId ?? null,
        input.causationId ?? null,
        input.traceId ?? null,
      ],
    );
    return toHandlerResolution(result.rows[0]);
  }

  async appendTrace(input: CreateExecutionTraceInput): Promise<ExecutionTrace> {
    const result = await this.pool.query<TraceRow>(
      `insert into execution_traces (
        id, execution_run_id, task_run_id, attempt_id, capability, handler, provider, handler_version,
        correlation_id, causation_id, trace_id, started_at, finished_at, duration_ms, retry_attempt, warnings, success
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
      [
        input.id,
        input.executionRunId,
        input.taskRunId,
        input.attemptId,
        input.capability,
        input.handler,
        input.provider,
        input.handlerVersion,
        input.correlationId,
        input.causationId ?? null,
        input.traceId,
        input.startedAt,
        input.finishedAt,
        input.durationMs,
        input.retryAttempt,
        input.warnings,
        input.success,
      ],
    );
    return toTrace(result.rows[0]);
  }

  private async updateRun(id: string, state: ExecutionRunState, expectedVersion: number, times: { startedAt?: string; finishedAt?: string; cancelledAt?: string }): Promise<ExecutionRun> {
    const result = await this.pool.query<RunRow>(
      `update execution_runs
       set state = $2,
           started_at = coalesce($3, started_at),
           finished_at = coalesce($4, finished_at),
           cancelled_at = coalesce($5, cancelled_at),
           updated_at = now(),
           version = version + 1
       where id = $1 and version = $6
       returning *`,
      [id, state, times.startedAt ?? null, times.finishedAt ?? null, times.cancelledAt ?? null, expectedVersion],
    );
    if (!result.rows[0]) throw new Error("OPTIMISTIC_LOCK_CONFLICT: ExecutionRun version divergiu.");
    return toRun(result.rows[0]);
  }

  private async updateTask(id: string, state: ExecutionTaskRunState, expectedVersion: number, times: { blockedReason?: string; startedAt?: string; finishedAt?: string }): Promise<ExecutionTaskRun> {
    const result = await this.pool.query<TaskRunRow>(
      `update execution_task_runs
       set state = $2,
           blocked_reason = $3,
           started_at = coalesce($4, started_at),
           finished_at = coalesce($5, finished_at),
           updated_at = now(),
           version = version + 1
       where id = $1 and version = $6
       returning *`,
      [id, state, times.blockedReason ?? null, times.startedAt ?? null, times.finishedAt ?? null, expectedVersion],
    );
    if (!result.rows[0]) throw new Error("OPTIMISTIC_LOCK_CONFLICT: ExecutionTaskRun version divergiu.");
    return toTaskRun(result.rows[0]);
  }

  private async getRuntimeDetails(runtimePlanId: string): Promise<RuntimeDetails> {
    const tasks = await this.pool.query<RuntimeTaskRow>("select * from runtime_tasks where runtime_plan_id = $1", [runtimePlanId]);
    const inputs = await this.pool.query<RuntimeInputRow>("select * from runtime_task_inputs where runtime_plan_id = $1", [runtimePlanId]);
    const outputs = await this.pool.query<RuntimeOutputRow>("select * from runtime_task_outputs where runtime_plan_id = $1", [runtimePlanId]);
    const bindings = await this.pool.query<RuntimeBindingRow>("select * from runtime_bindings where runtime_plan_id = $1", [runtimePlanId]);
    const artifacts = await this.pool.query<RuntimeArtifactRow>("select * from runtime_artifacts where runtime_plan_id = $1", [runtimePlanId]);
    const issues = await this.pool.query<RuntimeIssueRow>("select code, message, field, severity from runtime_validation_issues where runtime_plan_id = $1", [runtimePlanId]);
    return {
      tasks: tasks.rows.map(toRuntimeTask),
      inputs: inputs.rows.map(toRuntimeInput),
      outputs: outputs.rows.map(toRuntimeOutput),
      bindings: bindings.rows.map(toRuntimeBinding),
      artifacts: artifacts.rows.map(toRuntimeArtifact),
      issues: issues.rows.map((row) => ({ code: row.code, message: row.message, field: row.field ?? undefined, severity: row.severity })) as RuntimeValidationIssue[],
    };
  }
}

function toRun(row: RunRow): ExecutionRun {
  return {
    id: row.id,
    runtimePlanId: row.runtime_plan_id,
    planningId: row.planning_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    state: row.state as ExecutionRunState,
    mode: row.mode as ExecutionRun["mode"],
    idempotencyKey: row.idempotency_key,
    sourceGraphFingerprint: row.source_graph_fingerprint,
    runtimeFingerprint: row.runtime_fingerprint,
    correlationId: row.correlation_id ?? row.id,
    causationId: row.causation_id ?? undefined,
    traceId: row.trace_id ?? row.id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    startedAt: row.started_at?.toISOString(),
    finishedAt: row.finished_at?.toISOString(),
    cancelledAt: row.cancelled_at?.toISOString(),
    version: row.version,
  };
}

function toTaskRun(row: TaskRunRow): ExecutionTaskRun {
  return {
    id: row.id,
    executionRunId: row.execution_run_id,
    runtimePlanId: row.runtime_plan_id,
    runtimeTaskId: row.runtime_task_id,
    executionTaskId: row.execution_task_id,
    type: row.type as TaskType,
    capability: row.capability as ExecutionCapability,
    state: row.state as ExecutionTaskRunState,
    blockedReason: row.blocked_reason ?? undefined,
    correlationId: row.correlation_id ?? row.execution_run_id,
    causationId: row.causation_id ?? undefined,
    traceId: row.trace_id ?? row.execution_run_id,
    attemptsCount: row.attempts_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    startedAt: row.started_at?.toISOString(),
    finishedAt: row.finished_at?.toISOString(),
    version: row.version,
  };
}

function toAttempt(row: AttemptRow): ExecutionAttempt {
  return { id: row.id, executionRunId: row.execution_run_id, taskRunId: row.task_run_id, attemptNumber: row.attempt_number, state: row.state as ExecutionAttempt["state"], startedAt: row.started_at.toISOString(), finishedAt: row.finished_at?.toISOString(), failure: row.failure ?? undefined, idempotencyKey: row.idempotency_key, correlationId: row.correlation_id ?? row.execution_run_id, causationId: row.causation_id ?? undefined, traceId: row.trace_id ?? row.execution_run_id };
}

function toArtifact(row: ArtifactRow): ExecutionArtifact {
  return { id: row.id, executionRunId: row.execution_run_id, runtimePlanId: row.runtime_plan_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, artifactType: row.artifact_type as PlanningArtifactType, schemaId: row.schema_id, schemaVersion: row.schema_version, producerTaskRunId: row.producer_task_run_id, outputPort: row.output_port, payload: row.payload ?? undefined, payloadRef: row.payload_ref ?? undefined, handlerId: row.handler_id ?? undefined, provider: row.provider ?? undefined, parentArtifactIds: row.parent_artifact_ids ?? [], checksum: row.checksum, createdAt: row.created_at.toISOString() };
}

function toEvent(row: EventRow): ExecutionEvent {
  return { id: row.id, executionRunId: row.execution_run_id, eventType: row.event_type as ExecutionEvent["eventType"], taskRunId: row.task_run_id ?? undefined, gateId: row.gate_id ?? undefined, correlationId: row.correlation_id ?? undefined, causationId: row.causation_id ?? undefined, traceId: row.trace_id ?? undefined, createdAt: row.created_at.toISOString(), payload: row.payload ?? undefined };
}

function toGate(row: GateRow): ExecutionGate {
  return { id: row.id, executionRunId: row.execution_run_id, taskRunId: row.task_run_id, state: row.state as ExecutionGate["state"], decision: row.decision as ExecutionGate["decision"] | undefined, createdAt: row.created_at.toISOString(), resolvedAt: row.resolved_at?.toISOString(), decidedByUserId: row.decided_by_user_id ?? undefined };
}

function toHandlerResolution(row: HandlerResolutionRow): HandlerResolutionEvent {
  return {
    id: row.id,
    executionRunId: row.execution_run_id,
    taskRunId: row.task_run_id,
    capability: row.capability as ExecutionCapability,
    handler: row.handler,
    provider: row.provider,
    handlerVersion: row.handler_version,
    featureFlags: row.feature_flags,
    executionMode: row.execution_mode as HandlerResolutionEvent["executionMode"],
    capabilityMapping: row.mapping_version && row.skill_capability
      ? { mappingVersion: row.mapping_version, executionCapability: row.capability as ExecutionCapability, skillCapability: row.skill_capability }
      : undefined,
    fallbackPolicy: row.fallback_policy as HandlerFallbackPolicy,
    correlationId: row.correlation_id ?? undefined,
    causationId: row.causation_id ?? undefined,
    traceId: row.trace_id ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

function toTrace(row: TraceRow): ExecutionTrace {
  return {
    id: row.id,
    executionRunId: row.execution_run_id,
    taskRunId: row.task_run_id,
    attemptId: row.attempt_id,
    correlationId: row.correlation_id ?? row.execution_run_id,
    causationId: row.causation_id ?? undefined,
    traceId: row.trace_id ?? row.execution_run_id,
    capability: row.capability as ExecutionCapability,
    handler: row.handler,
    provider: row.provider,
    handlerVersion: row.handler_version,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at.toISOString(),
    durationMs: row.duration_ms,
    retryAttempt: row.retry_attempt,
    warnings: row.warnings,
    success: row.success,
  };
}

function toRuntimeTask(row: RuntimeTaskRow): RuntimeTask {
  return { id: row.id, runtimePlanId: row.runtime_plan_id, executionTaskId: row.execution_task_id, type: row.type as TaskType, capability: row.capability as ExecutionCapability, status: row.status as RuntimeTaskStatus, createdAt: row.created_at.toISOString() };
}
function toRuntimeInput(row: RuntimeInputRow): RuntimeTaskInputPort {
  return { id: row.id, runtimePlanId: row.runtime_plan_id, runtimeTaskId: row.runtime_task_id, portKey: row.port_key, acceptedArtifactTypes: row.accepted_artifact_types as PlanningArtifactType[], required: row.required, description: row.description, createdAt: row.created_at.toISOString() };
}
function toRuntimeOutput(row: RuntimeOutputRow): RuntimeTaskOutputPort {
  return { id: row.id, runtimePlanId: row.runtime_plan_id, runtimeTaskId: row.runtime_task_id, portKey: row.port_key, artifactType: row.artifact_type as PlanningArtifactType, description: row.description, createdAt: row.created_at.toISOString() };
}
function toRuntimeBinding(row: RuntimeBindingRow): RuntimeBinding {
  return { id: row.id, runtimePlanId: row.runtime_plan_id, fromRuntimeTaskId: row.from_runtime_task_id, fromOutputPort: row.from_output_port, toRuntimeTaskId: row.to_runtime_task_id, toInputPort: row.to_input_port, createdAt: row.created_at.toISOString() };
}
function toRuntimeArtifact(row: RuntimeArtifactRow) {
  return { id: row.id, runtimePlanId: row.runtime_plan_id, runtimeTaskId: row.runtime_task_id, schema: { artifactType: row.artifact_type as PlanningArtifactType, description: row.description, expectedFields: row.expected_fields }, status: row.status as RuntimeArtifactStatus, createdAt: row.created_at.toISOString() };
}
