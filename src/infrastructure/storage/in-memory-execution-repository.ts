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
} from "../../application/ports/execution-repository.port.js";
import type {
  ExecutionArtifact,
  ExecutionAttempt,
  ExecutionEvent,
  ExecutionFailure,
  ExecutionGate,
  ExecutionGateDecision,
  ExecutionRun,
  ExecutionTrace,
  ExecutionRunState,
  ExecutionTaskRun,
  ExecutionTaskRunState,
  HandlerResolutionEvent,
} from "../../domain/execution/execution.model.js";
import type { RuntimeDetails } from "../../application/ports/runtime-repository.port.js";

export class InMemoryExecutionRepository implements ExecutionRepositoryPort {
  private readonly runs = new Map<string, ExecutionRun>();
  private readonly taskRunsByRun = new Map<string, ExecutionTaskRun[]>();
  private readonly attemptsByRun = new Map<string, ExecutionAttempt[]>();
  private readonly artifactsByRun = new Map<string, ExecutionArtifact[]>();
  private readonly eventsByRun = new Map<string, ExecutionEvent[]>();
  private readonly gatesByRun = new Map<string, ExecutionGate[]>();
  private readonly handlerResolutionByRun = new Map<string, HandlerResolutionEvent[]>();
  private readonly tracesByRun = new Map<string, ExecutionTrace[]>();
  private readonly runtimeDetailsByRun = new Map<string, RuntimeDetails>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async createRun(input: CreateExecutionRunInput): Promise<ExecutionRunDetail> {
    if ([...this.runs.values()].some((run) => run.runtimePlanId === input.run.runtimePlanId && run.idempotencyKey === input.run.idempotencyKey)) {
      throw new Error("EXECUTION_RUN_IDEMPOTENCY_CONFLICT: run já existe.");
    }
    const nowIso = this.timestamp();
    const run: ExecutionRun = { ...input.run, createdAt: nowIso, updatedAt: nowIso, version: 1 };
    this.runs.set(run.id, clone(run));
    this.taskRunsByRun.set(
      run.id,
      input.runtimeTasks.map((task) => ({
        id: `${run.id}:${task.id}`,
        executionRunId: run.id,
        runtimePlanId: run.runtimePlanId,
        runtimeTaskId: task.id,
        executionTaskId: task.executionTaskId,
        type: task.type,
        capability: task.capability,
        state: "blocked",
        blockedReason: "Waiting for dependencies.",
        correlationId: run.correlationId,
        causationId: run.id,
        traceId: run.traceId,
        attemptsCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
        version: 1,
      })),
    );
    this.attemptsByRun.set(run.id, []);
    this.artifactsByRun.set(run.id, []);
    this.eventsByRun.set(run.id, []);
    this.gatesByRun.set(run.id, []);
    this.handlerResolutionByRun.set(run.id, []);
    this.tracesByRun.set(run.id, []);
    this.runtimeDetailsByRun.set(run.id, clone(input.runtimeDetails));
    return this.getDetail(run.id) as Promise<ExecutionRunDetail>;
  }

  async getRunById(id: string): Promise<ExecutionRun | undefined> {
    const run = this.runs.get(id);
    return run ? clone(run) : undefined;
  }

  async getRunByRuntimeAndIdempotency(runtimePlanId: string, idempotencyKey: string): Promise<ExecutionRun | undefined> {
    const run = [...this.runs.values()].find((candidate) => candidate.runtimePlanId === runtimePlanId && candidate.idempotencyKey === idempotencyKey);
    return run ? clone(run) : undefined;
  }

  async getDetail(id: string): Promise<ExecutionRunDetail | undefined> {
    const run = this.runs.get(id);
    const runtimeDetails = this.runtimeDetailsByRun.get(id);
    if (!run || !runtimeDetails) return undefined;
    return {
      run: clone(run),
      taskRuns: (this.taskRunsByRun.get(id) ?? []).map(clone),
      attempts: (this.attemptsByRun.get(id) ?? []).map(clone),
      artifacts: (this.artifactsByRun.get(id) ?? []).map(clone),
      events: (this.eventsByRun.get(id) ?? []).map(clone),
      gates: (this.gatesByRun.get(id) ?? []).map(clone),
      runtimeDetails: clone(runtimeDetails),
      handlerResolution: (this.handlerResolutionByRun.get(id) ?? []).map(clone),
      traces: (this.tracesByRun.get(id) ?? []).map(clone),
    };
  }

  async listRuns(filter: ListExecutionRunsFilter): Promise<ExecutionRun[]> {
    return [...this.runs.values()]
      .filter((run) => run.tenantId === filter.tenantId && run.workspaceId === filter.workspaceId)
      .filter((run) => !filter.runtimePlanId || run.runtimePlanId === filter.runtimePlanId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(clone);
  }

  async listTasks(runId: string): Promise<ExecutionTaskRun[]> {
    return (this.taskRunsByRun.get(runId) ?? []).map(clone);
  }

  async listEvents(runId: string): Promise<ExecutionEvent[]> {
    return (this.eventsByRun.get(runId) ?? []).map(clone);
  }

  async appendEvent(input: CreateExecutionEventInput): Promise<ExecutionEvent> {
    const event: ExecutionEvent = { ...input, createdAt: this.timestamp() };
    this.eventsByRun.set(input.executionRunId, [...(this.eventsByRun.get(input.executionRunId) ?? []), clone(event)]);
    return clone(event);
  }

  async updateRunState(input: { id: string; state: ExecutionRunState; expectedVersion: number; startedAt?: string; finishedAt?: string; cancelledAt?: string }): Promise<ExecutionRun> {
    const existing = this.runs.get(input.id);
    if (!existing) throw new Error(`EXECUTION_RUN_NOT_FOUND: execution run "${input.id}" não existe.`);
    if (existing.version !== input.expectedVersion) throw new Error("OPTIMISTIC_LOCK_CONFLICT: ExecutionRun version divergiu.");
    return this.replaceRunState(input);
  }

  async replaceRunState(input: { id: string; state: ExecutionRunState; startedAt?: string; finishedAt?: string; cancelledAt?: string }): Promise<ExecutionRun> {
    const existing = this.runs.get(input.id);
    if (!existing) throw new Error(`EXECUTION_RUN_NOT_FOUND: execution run "${input.id}" não existe.`);
    const updated: ExecutionRun = {
      ...existing,
      state: input.state,
      startedAt: input.startedAt ?? existing.startedAt,
      finishedAt: input.finishedAt ?? existing.finishedAt,
      cancelledAt: input.cancelledAt ?? existing.cancelledAt,
      updatedAt: this.timestamp(),
      version: existing.version + 1,
    };
    this.runs.set(input.id, clone(updated));
    return clone(updated);
  }

  async updateTaskRunState(input: { id: string; state: ExecutionTaskRunState; expectedVersion: number; blockedReason?: string; startedAt?: string; finishedAt?: string }): Promise<ExecutionTaskRun> {
    const { runId, task } = this.findTask(input.id);
    if (task.version !== input.expectedVersion) throw new Error("OPTIMISTIC_LOCK_CONFLICT: ExecutionTaskRun version divergiu.");
    return this.replaceTaskRunState({ ...input, id: `${runId}:${task.runtimeTaskId}` });
  }

  async replaceTaskRunState(input: { id: string; state: ExecutionTaskRunState; blockedReason?: string; startedAt?: string; finishedAt?: string }): Promise<ExecutionTaskRun> {
    const { runId, task, index } = this.findTask(input.id);
    const updated: ExecutionTaskRun = {
      ...task,
      state: input.state,
      blockedReason: input.blockedReason,
      startedAt: input.startedAt ?? task.startedAt,
      finishedAt: input.finishedAt ?? task.finishedAt,
      updatedAt: this.timestamp(),
      version: task.version + 1,
    };
    const tasks = [...(this.taskRunsByRun.get(runId) ?? [])];
    tasks[index] = updated;
    this.taskRunsByRun.set(runId, tasks.map(clone));
    return clone(updated);
  }

  async createAttempt(input: CreateExecutionAttemptInput): Promise<ExecutionAttempt> {
    const { runId, task, index } = this.findTask(input.taskRunId);
    const attempt: ExecutionAttempt = { ...input, state: "running", startedAt: this.timestamp() };
    this.attemptsByRun.set(runId, [...(this.attemptsByRun.get(runId) ?? []), clone(attempt)]);
    const tasks = [...(this.taskRunsByRun.get(runId) ?? [])];
    tasks[index] = { ...task, attemptsCount: task.attemptsCount + 1, updatedAt: this.timestamp(), version: task.version + 1 };
    this.taskRunsByRun.set(runId, tasks.map(clone));
    return clone(attempt);
  }

  async finishAttempt(input: { id: string; state: "running" | "completed" | "failed"; failure?: ExecutionFailure }): Promise<ExecutionAttempt> {
    for (const [runId, attempts] of this.attemptsByRun.entries()) {
      const index = attempts.findIndex((attempt) => attempt.id === input.id);
      if (index === -1) continue;
      const updated: ExecutionAttempt = { ...attempts[index], state: input.state, failure: input.failure, finishedAt: this.timestamp() };
      const next = [...attempts];
      next[index] = updated;
      this.attemptsByRun.set(runId, next.map(clone));
      return clone(updated);
    }
    throw new Error(`EXECUTION_ATTEMPT_NOT_FOUND: attempt "${input.id}" não existe.`);
  }

  async createArtifacts(inputs: readonly CreateExecutionArtifactInput[]): Promise<ExecutionArtifact[]> {
    const created = inputs.map((input) => ({ ...input, createdAt: this.timestamp() }));
    for (const artifact of created) {
      this.artifactsByRun.set(artifact.executionRunId, [...(this.artifactsByRun.get(artifact.executionRunId) ?? []), clone(artifact)]);
    }
    return created.map(clone);
  }

  async createGate(input: CreateExecutionGateInput): Promise<ExecutionGate> {
    const existing = (this.gatesByRun.get(input.executionRunId) ?? []).find((gate) => gate.taskRunId === input.taskRunId && gate.state === "open");
    if (existing) return clone(existing);
    const gate: ExecutionGate = { ...input, state: "open", createdAt: this.timestamp() };
    this.gatesByRun.set(input.executionRunId, [...(this.gatesByRun.get(input.executionRunId) ?? []), clone(gate)]);
    return clone(gate);
  }

  async resolveGate(input: { runId: string; gateId: string; decision: ExecutionGateDecision; decidedByUserId?: string }): Promise<ExecutionGate> {
    const gates = this.gatesByRun.get(input.runId) ?? [];
    const index = gates.findIndex((gate) => gate.id === input.gateId);
    if (index === -1) throw new Error(`EXECUTION_GATE_NOT_FOUND: gate "${input.gateId}" não existe.`);
    if (gates[index].state !== "open") return clone(gates[index]);
    const updated: ExecutionGate = { ...gates[index], state: input.decision, decision: input.decision, decidedByUserId: input.decidedByUserId, resolvedAt: this.timestamp() };
    const next = [...gates];
    next[index] = updated;
    this.gatesByRun.set(input.runId, next.map(clone));
    return clone(updated);
  }

  async appendHandlerResolution(input: CreateHandlerResolutionEventInput): Promise<HandlerResolutionEvent> {
    const event: HandlerResolutionEvent = { ...input, createdAt: this.timestamp() };
    this.handlerResolutionByRun.set(input.executionRunId, [...(this.handlerResolutionByRun.get(input.executionRunId) ?? []), clone(event)]);
    return clone(event);
  }

  async appendTrace(input: CreateExecutionTraceInput): Promise<ExecutionTrace> {
    this.tracesByRun.set(input.executionRunId, [...(this.tracesByRun.get(input.executionRunId) ?? []), clone(input)]);
    return clone(input);
  }

  private findTask(id: string): { runId: string; task: ExecutionTaskRun; index: number } {
    for (const [runId, tasks] of this.taskRunsByRun.entries()) {
      const index = tasks.findIndex((task) => task.id === id);
      if (index >= 0) return { runId, task: tasks[index], index };
    }
    throw new Error(`EXECUTION_TASK_RUN_NOT_FOUND: task run "${id}" não existe.`);
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
