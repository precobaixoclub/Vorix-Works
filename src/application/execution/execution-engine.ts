import { computeFingerprint } from "../../domain/runtime/fingerprint.js";
import type {
  ExecutionArtifact,
  ExecutionArtifactPayload,
  ExecutionAttempt,
  ExecutionFailure,
  ExecutionGateDecision,
  ExecutionRun,
  ExecutionTaskRun,
} from "../../domain/execution/execution.model.js";
import type { RuntimeBinding, RuntimeTaskOutputPort } from "../../domain/runtime/runtime.model.js";
import type { RuntimeDetails } from "../ports/runtime-repository.port.js";
import type { ExecutionRepositoryPort } from "../ports/execution-repository.port.js";
import type { ExecutionPreconditionDeps } from "./preconditions.js";
import { assertRuntimeExecutable } from "./preconditions.js";
import type { ExecutionTaskHandlerPort, ExecutionTaskInputs } from "./execution-handler.port.js";
import { DEFAULT_EXECUTION_RETRY_POLICY, type ExecutionRetryPolicy, canRetryExecutionFailure } from "./retry-policy.js";
import type { ExecutionHandlerResolver } from "./handler-resolver.js";
import { DEFAULT_EXECUTION_FEATURE_FLAGS, serializeExecutionFeatureFlags, type ExecutionFeatureFlags } from "./feature-flags.js";
import { createDefaultExecutionContractRegistry, type ExecutionContract, type ExecutionContractRegistry } from "./execution-contract-registry.js";
import { circuitOpenFailure, type HandlerCircuitBreakerPort } from "./handler-circuit-breaker.js";
import { SideEffectGuard } from "./execution-operational-policy.js";
import type { BackoffStrategy } from "../../domain/execution/execution.model.js";

// Achado ao vivo (Rodada 2, Fatia 3): `retryPolicy.backoffStrategy` do descriptor sempre existiu
// no tipo mas nunca era lido em lugar nenhum — todo retry era imediato (mesmo loop síncrono,
// zero espera), o que não dá NENHUMA chance real de uma falha transitória de provider (timeout,
// rate limit) se resolver sozinha antes da 2ª tentativa. `FIXED_BACKOFF_MS` é deliberadamente
// pequeno (a chamada HTTP inteira já leva dezenas de segundos quando há retry de verdade) — o
// objetivo não é esperar "o suficiente" pra qualquer degradação passar, só parar de bater
// imediatamente no mesmo provider que acabou de falhar.
const FIXED_BACKOFF_MS = 1_500;
const EXPONENTIAL_BASE_BACKOFF_MS = 1_000;
const MAX_EXPONENTIAL_BACKOFF_MS = 8_000;

function resolveBackoffDelayMs(strategy: BackoffStrategy | undefined, attemptNumber: number): number {
  // `undefined` (nenhuma política explícita) é tratado como "fixed", nunca como "sem espera" — o
  // ponto desta função é justamente nunca mais bater imediatamente num provider que acabou de
  // falhar; só `"none"` explícito pula o backoff de propósito.
  if (strategy === "none") return 0;
  if (strategy === "exponential") return Math.min(MAX_EXPONENTIAL_BACKOFF_MS, EXPONENTIAL_BASE_BACKOFF_MS * 2 ** (attemptNumber - 1));
  return FIXED_BACKOFF_MS;
}

async function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export type ExecutionEngineDeps = ExecutionPreconditionDeps & {
  executionRepository: ExecutionRepositoryPort;
  handlers: readonly ExecutionTaskHandlerPort[];
  handlerResolver?: ExecutionHandlerResolver;
  featureFlags?: ExecutionFeatureFlags;
  idGenerator: () => string;
  now?: () => Date;
  retryPolicy?: ExecutionRetryPolicy;
  contractRegistry?: ExecutionContractRegistry;
  sideEffectGuard?: SideEffectGuard;
  circuitBreaker?: HandlerCircuitBreakerPort;
  /** Injetável só pra teste (evita atrasar a suíte de verdade) — produção sempre usa o `setTimeout`
   * real por trás de `defaultSleep`. */
  sleep?: (ms: number) => Promise<void>;
};

export type CreateExecutionRunInput = {
  tenantId: string;
  workspaceId: string;
  runtimePlanId: string;
  idempotencyKey: string;
  executionMode?: "dry_run" | "real";
  correlationId?: string;
  causationId?: string;
};

export async function createExecutionRun(deps: ExecutionEngineDeps, input: CreateExecutionRunInput): Promise<ExecutionRun> {
  const existing = await deps.executionRepository.getRunByRuntimeAndIdempotency(input.runtimePlanId, input.idempotencyKey);
  if (existing) return existing;

  const validated = await assertRuntimeExecutable(deps, input);
  const featureFlags = deps.featureFlags ?? DEFAULT_EXECUTION_FEATURE_FLAGS;
  const requestedMode = input.executionMode ?? "dry_run";
  const executionMode = requestedMode === "real" && featureFlags.realExecutionEnabled ? "real" : "dry_run";
  const runId = deps.idGenerator();
  const traceId = deps.idGenerator();
  const correlationId = input.correlationId ?? runId;
  const detail = await deps.executionRepository.createRun({
    run: {
      id: runId,
      runtimePlanId: validated.runtimePlan.id,
      planningId: validated.planning.id,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      state: "created",
      mode: executionMode,
      idempotencyKey: input.idempotencyKey,
      sourceGraphFingerprint: validated.runtimePlan.sourceGraphFingerprint,
      runtimeFingerprint: validated.runtimePlan.runtimeFingerprint as string,
      correlationId,
      causationId: input.causationId,
      traceId,
    },
    runtimeTasks: validated.runtimeDetails.tasks,
    runtimeDetails: validated.runtimeDetails,
  });
  await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: runId, eventType: "run_created", correlationId, causationId: input.causationId, traceId, payload: { mode: executionMode } });
  return detail.run;
}

export async function startExecutionRun(deps: ExecutionEngineDeps, input: { tenantId: string; workspaceId: string; runId: string }): Promise<ExecutionRun> {
  const initial = await mustGetRunForWorkspace(deps.executionRepository, input);
  if (["completed", "failed", "cancelled"].includes(initial.state)) return initial;
  if (initial.state === "waiting_for_approval") return initial;

  await assertRuntimeExecutable(deps, { runtimePlanId: initial.runtimePlanId, tenantId: input.tenantId, workspaceId: input.workspaceId });
  if (initial.mode === "real") await validateRealModePreconditions(deps, initial.id);

  let run = await deps.executionRepository.updateRunState({ id: initial.id, expectedVersion: initial.version, state: "validating" });
  run = await deps.executionRepository.updateRunState({ id: run.id, expectedVersion: run.version, state: "ready" });
  run = await deps.executionRepository.updateRunState({ id: run.id, expectedVersion: run.version, state: "running", startedAt: run.startedAt ?? nowIso(deps) });
  await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: run.id, eventType: "run_started", correlationId: run.correlationId, causationId: run.id, traceId: run.traceId, payload: { mode: run.mode } });

  return runExecutionLoop(deps, run.id);
}

export async function decideExecutionGate(
  deps: ExecutionEngineDeps,
  input: { tenantId: string; workspaceId: string; runId: string; gateId: string; decision: ExecutionGateDecision; decidedByUserId?: string },
): Promise<ExecutionRun> {
  const run = await mustGetRunForWorkspace(deps.executionRepository, input);
  if (run.state !== "waiting_for_approval") return run;
  const gate = await deps.executionRepository.resolveGate({ runId: run.id, gateId: input.gateId, decision: input.decision, decidedByUserId: input.decidedByUserId });
  await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: run.id, eventType: "gate_resolved", gateId: gate.id, taskRunId: gate.taskRunId, correlationId: run.correlationId, causationId: gate.id, traceId: run.traceId, payload: { decision: input.decision } });

  const detail = await deps.executionRepository.getDetail(run.id);
  const taskRun = detail?.taskRuns.find((task) => task.id === gate.taskRunId);
  if (!detail) throw new Error(`EXECUTION_RUN_NOT_FOUND: execution run "${run.id}" não existe.`);
  if (!taskRun) throw new Error(`EXECUTION_TASK_RUN_NOT_FOUND: task run "${gate.taskRunId}" não existe.`);

  if (input.decision === "rejected") {
    await deps.executionRepository.replaceTaskRunState({ id: taskRun.id, state: "failed", finishedAt: nowIso(deps), blockedReason: "Human gate rejected." });
    const failed = await deps.executionRepository.replaceRunState({ id: run.id, state: "failed", finishedAt: nowIso(deps) });
    await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: run.id, eventType: "task_failed", taskRunId: taskRun.id, correlationId: run.correlationId, causationId: gate.id, traceId: run.traceId, payload: { code: "HUMAN_GATE_REJECTED" } });
    await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: run.id, eventType: "run_failed", correlationId: run.correlationId, causationId: taskRun.id, traceId: run.traceId, payload: { policy: "gate_rejection_fails_run" } });
    return failed;
  }

  const gateInputs = resolveInputs(detail, taskRun);
  const artifacts = buildArtifactsForOutput(
    deps,
    run,
    taskRun,
    [{ outputPort: "decision", payload: { decision: "approved", synthetic: true, dryRun: run.mode === "dry_run", executionMode: run.mode, reviewedInputs: gateInputs } }],
    detail?.runtimeDetails,
    { handlerId: "human-gate", provider: "execution", parentArtifactIds: parentArtifactIdsFromInputs(gateInputs) },
  );
  if (artifacts.length > 0) await deps.executionRepository.createArtifacts(artifacts);
  for (const artifact of artifacts) {
    await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: run.id, eventType: "artifact_produced", taskRunId: taskRun.id, correlationId: run.correlationId, causationId: artifact.id, traceId: run.traceId, payload: { outputPort: artifact.outputPort, artifactType: artifact.artifactType } });
  }
  await deps.executionRepository.replaceTaskRunState({ id: taskRun.id, state: "completed", finishedAt: nowIso(deps) });
  await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: run.id, eventType: "task_completed", taskRunId: taskRun.id, correlationId: run.correlationId, causationId: taskRun.id, traceId: run.traceId });
  await deps.executionRepository.replaceRunState({ id: run.id, state: "running" });
  return runExecutionLoop(deps, run.id);
}

export async function cancelExecutionRun(deps: ExecutionEngineDeps, input: { tenantId: string; workspaceId: string; runId: string }): Promise<ExecutionRun> {
  const run = await mustGetRunForWorkspace(deps.executionRepository, input);
  if (["completed", "failed", "cancelled"].includes(run.state)) return run;
  const detail = await deps.executionRepository.getDetail(run.id);
  for (const task of detail?.taskRuns ?? []) {
    if (["blocked", "ready"].includes(task.state)) {
      await deps.executionRepository.replaceTaskRunState({ id: task.id, state: "cancelled", finishedAt: nowIso(deps) });
    }
  }
  const cancelled = await deps.executionRepository.replaceRunState({ id: run.id, state: "cancelled", cancelledAt: nowIso(deps), finishedAt: nowIso(deps) });
  await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: run.id, eventType: "run_cancelled", correlationId: run.correlationId, causationId: run.id, traceId: run.traceId });
  return cancelled;
}

async function runExecutionLoop(deps: ExecutionEngineDeps, runId: string): Promise<ExecutionRun> {
  while (true) {
    const detail = await deps.executionRepository.getDetail(runId);
    if (!detail) throw new Error(`EXECUTION_RUN_NOT_FOUND: execution run "${runId}" não existe.`);
    if (detail.run.state === "cancelled") return detail.run;

    const ready = findReadyTasks(detail.taskRuns, detail.runtimeDetails.bindings, detail.artifacts);
    if (ready.length === 0) {
      if (detail.taskRuns.every((task) => task.state === "completed" || task.state === "skipped")) {
        const completed = await deps.executionRepository.replaceRunState({ id: runId, state: "completed", finishedAt: nowIso(deps) });
        await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: runId, eventType: "run_completed", correlationId: detail.run.correlationId, causationId: runId, traceId: detail.run.traceId });
        return completed;
      }
      return detail.run;
    }

    for (const taskRun of ready) {
      await deps.executionRepository.replaceTaskRunState({ id: taskRun.id, state: "ready" });
      await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: runId, eventType: "task_ready", taskRunId: taskRun.id, correlationId: detail.run.correlationId, causationId: taskRun.id, traceId: detail.run.traceId });
      if (taskRun.type === "approval") {
        await deps.executionRepository.replaceTaskRunState({ id: taskRun.id, state: "waiting_for_approval", startedAt: nowIso(deps) });
        const gate = await deps.executionRepository.createGate({ id: deps.idGenerator(), executionRunId: runId, taskRunId: taskRun.id });
        await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: runId, eventType: "gate_created", taskRunId: taskRun.id, gateId: gate.id, correlationId: detail.run.correlationId, causationId: taskRun.id, traceId: detail.run.traceId });
        const run = await deps.executionRepository.getRunById(runId);
        if (!run) throw new Error(`EXECUTION_RUN_NOT_FOUND: execution run "${runId}" não existe.`);
        return deps.executionRepository.updateRunState({ id: runId, expectedVersion: run.version, state: "waiting_for_approval" });
      }
      const maybeFailed = await executeTask(deps, runId, taskRun.id);
      if (maybeFailed?.state === "failed") return maybeFailed;
    }
  }
}

async function executeTask(deps: ExecutionEngineDeps, runId: string, taskRunId: string): Promise<ExecutionRun | undefined> {
  const detail = await deps.executionRepository.getDetail(runId);
  if (!detail) throw new Error(`EXECUTION_RUN_NOT_FOUND: execution run "${runId}" não existe.`);
  const taskRun = detail.taskRuns.find((task) => task.id === taskRunId);
  if (!taskRun || taskRun.state === "running") return undefined;
  const runtimeTask = detail.runtimeDetails.tasks.find((task) => task.id === taskRun.runtimeTaskId);
  if (!runtimeTask) throw new Error(`RUNTIME_TASK_NOT_FOUND: RuntimeTask "${taskRun.runtimeTaskId}" não existe.`);

  const resolution = resolveHandler(deps, runtimeTask.capability, runtimeTask.type, detail.run.mode);
  if (!resolution.ok) {
    return failRunForTask(deps, detail.run, taskRun, {
      code: resolution.error.code,
      message: resolution.error.message,
      category: resolution.error.code === "REAL_EXECUTION_DISABLED" ? "configuration" : "policy_violation",
      retryable: false,
    });
  }
  const handler = resolution.descriptor.handler;
  const contractRegistry = deps.contractRegistry ?? createDefaultExecutionContractRegistry();
  const contract = contractRegistry.get({ capability: runtimeTask.capability, taskType: runtimeTask.type });
  if (detail.run.mode === "real" && !contract) {
    return failRunForTask(deps, detail.run, taskRun, { code: "EXECUTION_CONTRACT_NOT_FOUND", message: `Contrato formal ausente para ${runtimeTask.capability}/${runtimeTask.type}.`, category: "configuration", retryable: false });
  }
  if (detail.run.mode === "real" && contract) {
    const compatibility = contractRegistry.validateRuntimeCompatibility(contract, detail.runtimeDetails, runtimeTask.id);
    if (!compatibility.ok) return failRunForTask(deps, detail.run, taskRun, { code: compatibility.code, message: compatibility.message, category: "configuration", retryable: false });
  }
  const guard = (deps.sideEffectGuard ?? new SideEffectGuard()).assertAllowed({
    executionMode: detail.run.mode,
    tenantId: detail.run.tenantId,
    workspaceId: detail.run.workspaceId,
    capability: runtimeTask.capability,
    descriptor: resolution.descriptor,
    featureFlags: deps.featureFlags ?? DEFAULT_EXECUTION_FEATURE_FLAGS,
  });
  if (!guard.ok) {
    await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: runId, eventType: "side_effect_blocked", taskRunId: taskRun.id, correlationId: detail.run.correlationId, causationId: taskRun.id, traceId: detail.run.traceId, payload: { code: guard.failure.code, sideEffectPolicy: resolution.descriptor.sideEffectPolicy ?? "none", provider: resolution.descriptor.provider } });
    return failRunForTask(deps, detail.run, taskRun, guard.failure);
  }
  const circuitKey = { tenantId: detail.run.tenantId, handlerId: resolution.descriptor.id, provider: resolution.descriptor.provider, capability: runtimeTask.capability };
  const circuit = deps.circuitBreaker?.canExecute(circuitKey);
  if (circuit?.state === "open") return failRunForTask(deps, detail.run, taskRun, circuitOpenFailure(circuit));
  await deps.executionRepository.appendHandlerResolution({
    id: deps.idGenerator(),
    executionRunId: runId,
    taskRunId: taskRun.id,
    capability: runtimeTask.capability,
    handler: resolution.descriptor.id,
    provider: resolution.descriptor.provider,
    handlerVersion: resolution.descriptor.version,
    featureFlags: serializeExecutionFeatureFlags(deps.featureFlags ?? DEFAULT_EXECUTION_FEATURE_FLAGS),
    executionMode: detail.run.mode,
    capabilityMapping: resolution.capabilityMapping,
    fallbackPolicy: resolution.fallbackPolicy,
    correlationId: detail.run.correlationId,
    causationId: taskRun.id,
    traceId: detail.run.traceId,
  });

  const running = await deps.executionRepository.replaceTaskRunState({ id: taskRun.id, state: "running", startedAt: taskRun.startedAt ?? nowIso(deps) });
  await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: runId, eventType: "task_started", taskRunId: taskRun.id, correlationId: detail.run.correlationId, causationId: taskRun.id, traceId: detail.run.traceId });
  const attempt = await deps.executionRepository.createAttempt({ id: deps.idGenerator(), executionRunId: runId, taskRunId: taskRun.id, attemptNumber: running.attemptsCount + 1, idempotencyKey: `${detail.run.id}:${taskRun.id}:${running.attemptsCount + 1}`, correlationId: detail.run.correlationId, causationId: taskRun.id, traceId: detail.run.traceId });
  const inputs = resolveInputs(detail, taskRun);
  if (detail.run.mode === "real" && contract) {
    const inputValidation = contractRegistry.validateInputs(contract, inputs);
    if (!inputValidation.ok) {
      const failure: ExecutionFailure = { code: inputValidation.code, message: inputValidation.message, category: "invalid_input", retryable: false };
      await deps.executionRepository.finishAttempt({ id: attempt.id, state: "failed", failure });
      return failRunForTask(deps, detail.run, taskRun, failure);
    }
  }
  const traceStartedAt = nowIso(deps);
  const result = await executeWithTimeout(handler.execute({ task: runtimeTask, inputs, context: { executionRunId: runId, tenantId: detail.run.tenantId, workspaceId: detail.run.workspaceId, mode: detail.run.mode }, attempt }), resolution.descriptor.executionTimeoutMs);
  const traceFinishedAt = nowIso(deps);
  await deps.executionRepository.appendTrace({
    id: deps.idGenerator(),
    executionRunId: runId,
    taskRunId: taskRun.id,
    attemptId: attempt.id,
    correlationId: detail.run.correlationId,
    causationId: taskRun.id,
    traceId: detail.run.traceId,
    capability: runtimeTask.capability,
    handler: resolution.descriptor.id,
    provider: resolution.descriptor.provider,
    handlerVersion: resolution.descriptor.version,
    startedAt: traceStartedAt,
    finishedAt: traceFinishedAt,
    durationMs: Math.max(0, Date.parse(traceFinishedAt) - Date.parse(traceStartedAt)),
    retryAttempt: attempt.attemptNumber,
    warnings: result.ok ? result.value.warnings ?? [] : [result.error.code],
    success: result.ok,
  });

  if (!result.ok) {
    deps.circuitBreaker?.recordFailure(circuitKey, result.error);
    await deps.executionRepository.finishAttempt({ id: attempt.id, state: "failed", failure: result.error });
    const descriptorRetryPolicy = resolution.descriptor.retryPolicy;
    const retryPolicy = descriptorRetryPolicy
      ? { maxAttempts: descriptorRetryPolicy.supportsRetry ? descriptorRetryPolicy.maxAttempts : 1 }
      : deps.retryPolicy ?? DEFAULT_EXECUTION_RETRY_POLICY;
    if (canRetryExecutionFailure(result.error, attempt.attemptNumber, retryPolicy)) {
      const backoffMs = resolveBackoffDelayMs(descriptorRetryPolicy?.backoffStrategy, attempt.attemptNumber);
      await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: runId, eventType: "retry_scheduled", taskRunId: taskRun.id, correlationId: detail.run.correlationId, causationId: attempt.id, traceId: detail.run.traceId, payload: { attemptNumber: attempt.attemptNumber + 1, backoffMs } });
      await (deps.sleep ?? defaultSleep)(backoffMs);
      await deps.executionRepository.replaceTaskRunState({ id: taskRun.id, state: "ready" });
      return undefined;
    }
    return failRunForTask(deps, detail.run, taskRun, result.error);
  }
  deps.circuitBreaker?.recordSuccess(circuitKey);
  if (detail.run.mode === "real" && contract) {
    for (const output of result.value.outputs) {
      if (output.outputPort !== contract.outputPort) {
        const failure: ExecutionFailure = { code: "EXECUTION_OUTPUT_PORT_MISMATCH", message: `Handler produziu outputPort "${output.outputPort}", contrato exige "${contract.outputPort}".`, category: "invalid_output", retryable: false };
        await deps.executionRepository.finishAttempt({ id: attempt.id, state: "failed", failure });
        return failRunForTask(deps, detail.run, taskRun, failure);
      }
      const outputValidation = contractRegistry.validateExecutionOutput(contract, output.payload);
      if (!outputValidation.ok) {
        const failure: ExecutionFailure = { code: outputValidation.code, message: outputValidation.message, category: "invalid_output", retryable: false };
        await deps.executionRepository.finishAttempt({ id: attempt.id, state: "failed", failure });
        return failRunForTask(deps, detail.run, taskRun, failure);
      }
    }
  }

  const artifacts = buildArtifactsForOutput(deps, detail.run, taskRun, result.value.outputs, detail.runtimeDetails, {
    handlerId: resolution.descriptor.id,
    provider: resolution.descriptor.provider,
    parentArtifactIds: parentArtifactIdsFromInputs(inputs),
  }, contract);
  await deps.executionRepository.createArtifacts(artifacts);
  await deps.executionRepository.finishAttempt({ id: attempt.id, state: "completed" });
  for (const artifact of artifacts) {
    await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: runId, eventType: "artifact_produced", taskRunId: taskRun.id, correlationId: detail.run.correlationId, causationId: artifact.id, traceId: detail.run.traceId, payload: { outputPort: artifact.outputPort, artifactType: artifact.artifactType } });
  }
  await deps.executionRepository.replaceTaskRunState({ id: taskRun.id, state: "completed", finishedAt: nowIso(deps) });
  await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: runId, eventType: "task_completed", taskRunId: taskRun.id, correlationId: detail.run.correlationId, causationId: taskRun.id, traceId: detail.run.traceId });
  return undefined;
}

function findReadyTasks(taskRuns: readonly ExecutionTaskRun[], bindings: readonly RuntimeBinding[], artifacts: readonly ExecutionArtifact[]): ExecutionTaskRun[] {
  return taskRuns
    .filter((task) => task.state === "blocked" || task.state === "ready")
    .filter((task) => {
      const inbound = bindings.filter((binding) => binding.toRuntimeTaskId === task.runtimeTaskId);
      return inbound.every((binding) =>
        taskRuns.some((candidate) => candidate.runtimeTaskId === binding.fromRuntimeTaskId && candidate.state === "completed")
        && artifacts.some((artifact) => artifact.producerTaskRunId === taskRuns.find((candidate) => candidate.runtimeTaskId === binding.fromRuntimeTaskId)?.id && artifact.outputPort === binding.fromOutputPort),
      );
    })
    .sort((left, right) => left.runtimeTaskId.localeCompare(right.runtimeTaskId));
}

function resolveInputs(detail: { taskRuns: readonly ExecutionTaskRun[]; artifacts: readonly ExecutionArtifact[]; runtimeDetails: RuntimeDetails }, taskRun: ExecutionTaskRun): ExecutionTaskInputs {
  const inputs: ExecutionTaskInputs = {};
  const inbound = detail.runtimeDetails.bindings.filter((binding) => binding.toRuntimeTaskId === taskRun.runtimeTaskId);
  for (const binding of inbound) {
    const producer = detail.taskRuns.find((candidate) => candidate.runtimeTaskId === binding.fromRuntimeTaskId);
    const artifact = producer ? detail.artifacts.find((candidate) => candidate.producerTaskRunId === producer.id && candidate.outputPort === binding.fromOutputPort) : undefined;
    if (!artifact || artifact.checksum !== checksumPayload(artifact.payload ?? { payloadRef: artifact.payloadRef })) {
      throw new Error("EXECUTION_BINDING_RESOLUTION_FAILED: Artefato ausente ou checksum inválido.");
    }
    inputs[binding.toInputPort] = [...(inputs[binding.toInputPort] ?? []), { artifactId: artifact.id, payload: artifact.payload, checksum: artifact.checksum }];
  }
  return inputs;
}

function buildArtifactsForOutput(
  deps: Pick<ExecutionEngineDeps, "idGenerator">,
  run: ExecutionRun,
  taskRun: ExecutionTaskRun,
  outputs: readonly { outputPort: string; payload: ExecutionArtifactPayload }[],
  runtimeDetails?: RuntimeDetails,
  producer?: { handlerId?: string; provider?: string; parentArtifactIds?: readonly string[] },
  contract?: ExecutionContract,
): Omit<ExecutionArtifact, "createdAt">[] {
  const declaredOutputs = runtimeDetails?.outputs.filter((port) => port.runtimeTaskId === taskRun.runtimeTaskId) ?? [];
  return outputs.map((output) => {
    const declared = declaredOutputs.find((port) => port.portKey === output.outputPort) ?? fallbackApprovalPort(output.outputPort);
    if (!declared) throw new Error(`EXECUTION_OUTPUT_VALIDATION_FAILED: Porta de saída não declarada "${output.outputPort}".`);
    return {
      id: deps.idGenerator(),
      executionRunId: run.id,
      runtimePlanId: run.runtimePlanId,
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      artifactType: declared.artifactType,
      schemaId: contract?.schemaId ?? `${taskRun.type}.${declared.portKey}`,
      schemaVersion: contract?.schemaVersion ?? 1,
      producerTaskRunId: taskRun.id,
      outputPort: declared.portKey,
      payload: output.payload,
      handlerId: producer?.handlerId,
      provider: producer?.provider,
      parentArtifactIds: producer?.parentArtifactIds ?? [],
      checksum: checksumPayload(output.payload),
    };
  });
}

function parentArtifactIdsFromInputs(inputs: ExecutionTaskInputs): string[] {
  return Object.values(inputs).flatMap((artifacts) => artifacts.map((artifact) => artifact.artifactId));
}

function fallbackApprovalPort(outputPort: string): RuntimeTaskOutputPort | undefined {
  if (outputPort !== "decision") return undefined;
  return { id: "approval-decision", runtimePlanId: "", runtimeTaskId: "", portKey: "decision", artifactType: "document", description: "", createdAt: "" };
}

function resolveHandler(deps: ExecutionEngineDeps, capability: ExecutionTaskRun["capability"], taskType: ExecutionTaskRun["type"], executionMode: ExecutionRun["mode"]) {
  if (deps.handlerResolver) {
    return deps.handlerResolver.resolve({ capability, taskType, executionMode, featureFlags: deps.featureFlags ?? DEFAULT_EXECUTION_FEATURE_FLAGS });
  }
  const handler = deps.handlers.find((candidate) => candidate.canHandle(capability, taskType));
    return handler
    ? { ok: true as const, descriptor: { id: "legacy-deterministic", provider: "deterministic", version: "1", priority: 0, handler, executionModes: ["dry_run"] as const, enabled: true, supportedCapabilities: [capability], fallbackPolicy: "deterministic_fallback" as const, sideEffectPolicy: "none" as const, retryPolicy: undefined, executionTimeoutMs: 5_000 }, capabilityMapping: undefined, fallbackPolicy: "deterministic_fallback" as const }
    : { ok: false as const, error: { code: "EXECUTION_HANDLER_NOT_AVAILABLE", message: "Nenhum handler disponível.", fallbackPolicy: "fail_closed" as const } };
}

async function validateRealModePreconditions(deps: ExecutionEngineDeps, runId: string): Promise<void> {
  const detail = await deps.executionRepository.getDetail(runId);
  if (!detail) throw new Error(`EXECUTION_RUN_NOT_FOUND: execution run "${runId}" não existe.`);
  for (const taskRun of detail.taskRuns) {
    if (taskRun.type === "approval") continue;
    const resolution = resolveHandler(deps, taskRun.capability, taskRun.type, detail.run.mode);
    if (!resolution.ok) {
      throw new Error(`EXECUTION_REAL_PRECONDITION_FAILED: ${resolution.error.code}: ${resolution.error.message}`);
    }
    const availability = await resolution.descriptor.handler.validateAvailability?.(taskRun.capability, taskRun.type);
    if (availability && !availability.ok) {
      throw new Error(`EXECUTION_REAL_PRECONDITION_FAILED: ${availability.code}: ${availability.message}`);
    }
    const contract = (deps.contractRegistry ?? createDefaultExecutionContractRegistry()).get({ capability: taskRun.capability, taskType: taskRun.type });
    if (!contract) throw new Error(`EXECUTION_REAL_PRECONDITION_FAILED: EXECUTION_CONTRACT_NOT_FOUND: ${taskRun.capability}/${taskRun.type}`);
    const compatibility = (deps.contractRegistry ?? createDefaultExecutionContractRegistry()).validateRuntimeCompatibility(contract, detail.runtimeDetails, taskRun.runtimeTaskId);
    if (!compatibility.ok) throw new Error(`EXECUTION_REAL_PRECONDITION_FAILED: ${compatibility.code}: ${compatibility.message}`);
  }
}

async function failRunForTask(deps: ExecutionEngineDeps, run: ExecutionRun, taskRun: ExecutionTaskRun, failure: ExecutionFailure): Promise<ExecutionRun> {
  await deps.executionRepository.replaceTaskRunState({ id: taskRun.id, state: "failed", finishedAt: nowIso(deps), blockedReason: failure.code });
  await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: run.id, eventType: "task_failed", taskRunId: taskRun.id, correlationId: run.correlationId, causationId: taskRun.id, traceId: run.traceId, payload: { code: failure.code, category: failure.category } });
  const failed = await deps.executionRepository.replaceRunState({ id: run.id, state: "failed", finishedAt: nowIso(deps) });
  await deps.executionRepository.appendEvent({ id: deps.idGenerator(), executionRunId: run.id, eventType: "run_failed", correlationId: run.correlationId, causationId: taskRun.id, traceId: run.traceId, payload: { failedTaskRunId: taskRun.id } });
  return failed;
}

async function mustGetRunForWorkspace(repository: ExecutionRepositoryPort, input: { tenantId: string; workspaceId: string; runId: string }): Promise<ExecutionRun> {
  const run = await repository.getRunById(input.runId);
  if (!run || run.tenantId !== input.tenantId || run.workspaceId !== input.workspaceId) {
    throw new Error(`EXECUTION_RUN_NOT_FOUND: execution run "${input.runId}" não existe.`);
  }
  return run;
}

function checksumPayload(payload: unknown): string {
  return computeFingerprint(payload);
}

function nowIso(deps: Pick<ExecutionEngineDeps, "now">): string {
  return (deps.now ?? (() => new Date()))().toISOString();
}

async function executeWithTimeout<T extends { ok: boolean }>(
  operation: Promise<T>,
  timeoutMs: number | undefined,
): Promise<T | { ok: false; error: ExecutionFailure }> {
  if (!timeoutMs || timeoutMs <= 0) return operation;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<{ ok: false; error: ExecutionFailure }>((resolve) => {
        timeoutHandle = setTimeout(() => {
          resolve({
            ok: false,
            error: {
              code: "HANDLER_TIMEOUT",
              message: `Handler excedeu timeout de ${timeoutMs}ms.`,
              category: "timeout",
              retryable: true,
            },
          });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
