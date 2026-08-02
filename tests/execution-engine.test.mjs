import { test } from "node:test";
import assert from "node:assert/strict";

import { createPlanningFromPreparedCommand } from "../dist/application/planning/planning-engine.js";
import { ensureRuntimeForPlanning, supersedeRuntimeForPlanning } from "../dist/application/runtime/runtime-engine.js";
import { createExecutionRun, startExecutionRun, decideExecutionGate, cancelExecutionRun } from "../dist/application/execution/execution-engine.js";
import { DeterministicExecutionTaskHandler, FailingExecutionTaskHandler } from "../dist/application/execution/deterministic-handlers.js";
import { InMemoryPlanningRepository } from "../dist/infrastructure/storage/in-memory-planning-repository.js";
import { InMemoryExecutionTaskRepository } from "../dist/infrastructure/storage/in-memory-execution-task-repository.js";
import { InMemoryExecutionGraphRepository } from "../dist/infrastructure/storage/in-memory-execution-graph-repository.js";
import { InMemoryPlanningArtifactRepository } from "../dist/infrastructure/storage/in-memory-planning-artifact-repository.js";
import { InMemoryPlanningDecisionRepository } from "../dist/infrastructure/storage/in-memory-planning-decision-repository.js";
import { InMemoryRuntimeRepository } from "../dist/infrastructure/storage/in-memory-runtime-repository.js";
import { InMemoryExecutionRepository } from "../dist/infrastructure/storage/in-memory-execution-repository.js";

function preparedCommand(overrides = {}) {
  return {
    id: "command-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    briefingId: "briefing-1",
    briefingRevision: 1,
    type: "campaign_creation",
    intent: "create_campaign",
    validatedInputs: { channel: "instagram", contentFormat: "carousel" },
    sourceReferences: {},
    unresolvedOptionalFields: [],
    status: "prepared",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDeps(handlers = [new DeterministicExecutionTaskHandler()]) {
  let counter = 0;
  const shared = {
    planningRepository: new InMemoryPlanningRepository(),
    executionTaskRepository: new InMemoryExecutionTaskRepository(),
    executionGraphRepository: new InMemoryExecutionGraphRepository(),
    artifactRepository: new InMemoryPlanningArtifactRepository(),
    decisionRepository: new InMemoryPlanningDecisionRepository(),
    runtimeRepository: new InMemoryRuntimeRepository({ now: () => new Date("2026-01-01T00:00:00.000Z") }),
    executionRepository: new InMemoryExecutionRepository({ now: () => new Date("2026-01-01T00:00:00.000Z") }),
  };
  const idGenerator = () => `execution-id-${++counter}`;
  return {
    shared,
    planningDeps: { ...shared, idGenerator: () => `planning-id-${++counter}`, now: () => new Date("2026-01-01T00:00:00.000Z") },
    runtimeDeps: { ...shared, idGenerator: () => `runtime-id-${++counter}`, now: () => new Date("2026-01-01T00:00:00.000Z") },
    executionDeps: { ...shared, handlers, idGenerator, now: () => new Date("2026-01-01T00:00:00.000Z") },
  };
}

async function seedRuntime(deps) {
  const planning = await createPlanningFromPreparedCommand(deps.planningDeps, preparedCommand());
  const runtime = await ensureRuntimeForPlanning(deps.runtimeDeps, planning);
  return { planning, runtime };
}

test("ExecutionRun: criação é explícita, dry_run e idempotente por runtimePlanId + idempotencyKey", async () => {
  const deps = makeDeps();
  const { runtime } = await seedRuntime(deps);

  const first = await createExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runtimePlanId: runtime.id, idempotencyKey: "idem-1" });
  const second = await createExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runtimePlanId: runtime.id, idempotencyKey: "idem-1" });

  assert.equal(first.id, second.id);
  assert.equal(first.mode, "dry_run");
  assert.equal(first.state, "created");
  const detail = await deps.shared.executionRepository.getDetail(first.id);
  assert.equal(detail.taskRuns.length, 6);
  assert.ok(detail.events.some((event) => event.eventType === "run_created"));
});

test("Execution preconditions: Runtime superseded não cria execução parcial", async () => {
  const deps = makeDeps();
  const { planning, runtime } = await seedRuntime(deps);
  await supersedeRuntimeForPlanning(deps.runtimeDeps, planning.id);

  await assert.rejects(
    () => createExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runtimePlanId: runtime.id, idempotencyKey: "idem-2" }),
    /EXECUTION_PRECONDITION_FAILED/,
  );
  const runs = await deps.shared.executionRepository.listRuns({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(runs.length, 0);
});

test("Execution preconditions: fingerprint divergente bloqueia sem criar run", async () => {
  const deps = makeDeps();
  const { runtime } = await seedRuntime(deps);
  const originalGetById = deps.shared.runtimeRepository.getById.bind(deps.shared.runtimeRepository);
  deps.shared.runtimeRepository.getById = async (id) => {
    const plan = await originalGetById(id);
    return plan ? { ...plan, sourceGraphFingerprint: "fingerprint-divergente" } : undefined;
  };

  await assert.rejects(
    () => createExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runtimePlanId: runtime.id, idempotencyKey: "idem-3" }),
    /sourceGraphFingerprint diverge/,
  );
  const runs = await deps.shared.executionRepository.listRuns({ tenantId: "tenant-1", workspaceId: "workspace-1" });
  assert.equal(runs.length, 0);
});

test("ExecutionEngine: DAG desbloqueia tarefas, produz artefatos, pausa em gate e conclui após aprovação", async () => {
  const deps = makeDeps();
  const { runtime } = await seedRuntime(deps);
  const run = await createExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runtimePlanId: runtime.id, idempotencyKey: "idem-4" });

  const waiting = await startExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id });
  assert.equal(waiting.state, "waiting_for_approval");

  let detail = await deps.shared.executionRepository.getDetail(run.id);
  assert.ok(detail.taskRuns.find((task) => task.type === "copy_generation").state === "completed");
  assert.ok(detail.taskRuns.find((task) => task.type === "visual_generation").state === "completed");
  assert.equal(detail.gates.length, 1);
  assert.equal(detail.artifacts.length, 4, "research, structure, copy e visual já foram produzidos antes do gate");

  const completed = await decideExecutionGate(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id, gateId: detail.gates[0].id, decision: "approved" });
  assert.equal(completed.state, "completed");
  detail = await deps.shared.executionRepository.getDetail(run.id);
  assert.equal(detail.taskRuns.every((task) => task.state === "completed"), true);
  assert.equal(detail.artifacts.length, 6);
  for (const artifact of detail.artifacts) assert.match(artifact.checksum, /^[0-9a-f]{64}$/);
  assert.ok(detail.events.some((event) => event.eventType === "gate_resolved"));
  assert.ok(detail.events.some((event) => event.eventType === "run_completed"));
});

test("Human gate: rejeição falha o run por política v1 gate_rejection_fails_run", async () => {
  const deps = makeDeps();
  const { runtime } = await seedRuntime(deps);
  const run = await createExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runtimePlanId: runtime.id, idempotencyKey: "idem-5" });
  await startExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id });
  const detail = await deps.shared.executionRepository.getDetail(run.id);

  const failed = await decideExecutionGate(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id, gateId: detail.gates[0].id, decision: "rejected" });
  assert.equal(failed.state, "failed");
  const after = await deps.shared.executionRepository.getDetail(run.id);
  assert.equal(after.taskRuns.find((task) => task.type === "approval").state, "failed");
});

test("Cancelamento: idempotente, cancela blocked/ready e preserva artefatos já produzidos", async () => {
  const deps = makeDeps();
  const { runtime } = await seedRuntime(deps);
  const run = await createExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runtimePlanId: runtime.id, idempotencyKey: "idem-6" });
  const cancelled = await cancelExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id });
  const again = await cancelExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id });

  assert.equal(cancelled.state, "cancelled");
  assert.equal(again.state, "cancelled");
  const detail = await deps.shared.executionRepository.getDetail(run.id);
  assert.equal(detail.taskRuns.every((task) => task.state === "cancelled"), true);
});

test("Retry: falha transitória agenda retry; falha não retentável falha sem retry", async () => {
  const transientDeps = makeDeps([new FailingExecutionTaskHandler({ transient: true, taskType: "research" }), new DeterministicExecutionTaskHandler()]);
  const { runtime } = await seedRuntime(transientDeps);
  const run = await createExecutionRun(transientDeps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runtimePlanId: runtime.id, idempotencyKey: "idem-7" });
  const failed = await startExecutionRun(transientDeps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: run.id });
  const detail = await transientDeps.shared.executionRepository.getDetail(run.id);
  assert.equal(failed.state, "failed");
  assert.equal(detail.attempts.length, 2);
  assert.ok(detail.events.some((event) => event.eventType === "retry_scheduled"));

  const permanentDeps = makeDeps([new FailingExecutionTaskHandler({ transient: false, taskType: "research" }), new DeterministicExecutionTaskHandler()]);
  const seeded = await seedRuntime(permanentDeps);
  const permanentRun = await createExecutionRun(permanentDeps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runtimePlanId: seeded.runtime.id, idempotencyKey: "idem-8" });
  await startExecutionRun(permanentDeps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runId: permanentRun.id });
  const permanentDetail = await permanentDeps.shared.executionRepository.getDetail(permanentRun.id);
  assert.equal(permanentDetail.attempts.length, 1);
  assert.equal(permanentDetail.events.some((event) => event.eventType === "retry_scheduled"), false);
});

test("Optimistic locking: ExecutionRun e ExecutionTaskRun rejeitam versão divergente", async () => {
  const deps = makeDeps();
  const { runtime } = await seedRuntime(deps);
  const run = await createExecutionRun(deps.executionDeps, { tenantId: "tenant-1", workspaceId: "workspace-1", runtimePlanId: runtime.id, idempotencyKey: "idem-9" });
  const detail = await deps.shared.executionRepository.getDetail(run.id);

  await assert.rejects(() => deps.shared.executionRepository.updateRunState({ id: run.id, expectedVersion: 999, state: "ready" }), /OPTIMISTIC_LOCK_CONFLICT/);
  await assert.rejects(() => deps.shared.executionRepository.updateTaskRunState({ id: detail.taskRuns[0].id, expectedVersion: 999, state: "ready" }), /OPTIMISTIC_LOCK_CONFLICT/);
});
