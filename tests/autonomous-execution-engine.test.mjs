import test from "node:test";
import assert from "node:assert/strict";
import { AutonomousExecutionEngine, selectActionsForBlocker } from "../dist/application/orchestration/autonomous/autonomous-execution-engine.js";

function report(overrides = {}) {
  return {
    executionId: "exec-test",
    state: "WAITING_ASSISTED_GENERATION",
    waitingForStepId: "step-1",
    message: "pausado",
    steps: [{
      stepId: "step-1",
      name: "Rafa — Renderização",
      skillId: "rafa-video-rendering",
      state: "WAITING_ASSISTED_GENERATION",
      response: {
        status: "needs_assisted_generation",
        output: {
          diversitySummary: { videoRatio: 0.1, minVideoRatio: 0.3, distinctPhysicalFiles: 6, minDistinctPhysicalFiles: 5 },
          productionReadinessScore: { overall: 0.5, productCoverage: 0.9, sceneDiversity: 0.9 },
        },
      },
    }],
    ...overrides,
  };
}

function fakeAction(overrides = {}) {
  return {
    id: overrides.id ?? "footage_acquisition",
    name: overrides.name ?? "Fake Action",
    description: "ação fake para teste",
    resolves: overrides.resolves ?? ["video_coverage_low"],
    prerequisites: [],
    expectedDurationMsRange: [0, 0],
    sideEffects: [],
    limitations: [],
    maxAttempts: overrides.maxAttempts ?? 1,
    backoffMs: overrides.backoffMs ?? 0,
    isApplicable: overrides.isApplicable ?? (() => true),
    execute: overrides.execute,
  };
}

function noSleep() {
  return async () => {};
}

test("engine: bloqueio resolvido na primeira tentativa -> completed, 1 ação, 1 recálculo", async () => {
  const executeCalls = [];
  const action = fakeAction({
    execute: async (ctx) => {
      executeCalls.push(ctx.attemptNumber);
      return { actionId: "footage_acquisition", ok: true, detail: "resolvido", sideEffectsApplied: ["x"], durationMs: 1 };
    },
  });
  const completedReport = { ...report(), state: "COMPLETED", steps: [] };
  const engine = new AutonomousExecutionEngine({
    registry: [action],
    continueExecution: async () => completedReport,
    sleep: noSleep(),
  });
  const outcome = await engine.run(report());
  assert.equal(outcome.stoppedReason, "completed");
  assert.equal(outcome.resolvedBlockers, 1);
  assert.equal(outcome.totalActionsExecuted, 1);
  assert.equal(outcome.totalRecalculations, 1);
  assert.deepEqual(executeCalls, [1]);
  assert.equal(outcome.history.length, 1);
  assert.equal(outcome.history[0].resultado, "resolved");
});

test("engine: retry com backoff -> falha na 1a tentativa, resolve na 2a", async () => {
  let calls = 0;
  const sleepCalls = [];
  const action = fakeAction({
    maxAttempts: 2,
    backoffMs: 10,
    execute: async (ctx) => {
      calls += 1;
      if (ctx.attemptNumber === 1) return { actionId: "footage_acquisition", ok: false, detail: "falhou", sideEffectsApplied: [], durationMs: 1 };
      return { actionId: "footage_acquisition", ok: true, detail: "resolvido na 2a", sideEffectsApplied: [], durationMs: 1 };
    },
  });
  const completedReport = { ...report(), state: "COMPLETED", steps: [] };
  const engine = new AutonomousExecutionEngine({
    registry: [action],
    continueExecution: async () => completedReport,
    sleep: async (ms) => { sleepCalls.push(ms); },
  });
  const outcome = await engine.run(report());
  assert.equal(calls, 2);
  assert.equal(sleepCalls.length, 1);
  assert.equal(sleepCalls[0], 20); // backoffMs * tentativa 2
  assert.equal(outcome.history.length, 2);
  assert.equal(outcome.history[0].resultado, "unresolved");
  assert.equal(outcome.history[1].resultado, "resolved");
  assert.equal(outcome.stoppedReason, "completed");
});

test("engine: nunca excede maxAttempts (nunca loop infinito por ação)", async () => {
  let calls = 0;
  const action = fakeAction({
    maxAttempts: 3,
    execute: async () => {
      calls += 1;
      return { actionId: "footage_acquisition", ok: false, detail: "sempre falha", sideEffectsApplied: [], durationMs: 1 };
    },
  });
  const engine = new AutonomousExecutionEngine({ registry: [action], continueExecution: async () => report(), sleep: noSleep() });
  const outcome = await engine.run(report());
  assert.equal(calls, 3);
  assert.equal(outcome.stoppedReason, "escalated");
  assert.equal(outcome.escalations[0].reason, "attempts_exhausted");
});

test("engine: prioridade — ação de prioridade mais alta é tentada primeiro e resolve sozinha", async () => {
  const order = [];
  const low = fakeAction({ id: "media_catalog", execute: async () => { order.push("media_catalog"); return { actionId: "media_catalog", ok: false, detail: "não resolve", sideEffectsApplied: [], durationMs: 1 }; } });
  const high = fakeAction({ id: "footage_acquisition", execute: async () => { order.push("footage_acquisition"); return { actionId: "footage_acquisition", ok: true, detail: "resolve", sideEffectsApplied: [], durationMs: 1 }; } });
  const completedReport = { ...report(), state: "COMPLETED", steps: [] };
  const engine = new AutonomousExecutionEngine({
    registry: [low, high],
    config: { actionPriority: ["footage_acquisition", "media_catalog"] },
    continueExecution: async () => completedReport,
    sleep: noSleep(),
  });
  await engine.run(report());
  assert.deepEqual(order, ["footage_acquisition"]);
});

test("engine: fail fast — isApplicable=false exclui a ação e escalona com no_known_action quando não sobra candidata", async () => {
  const action = fakeAction({ isApplicable: () => false, execute: async () => { throw new Error("nunca deveria ser chamada"); } });
  const engine = new AutonomousExecutionEngine({ registry: [action], continueExecution: async () => report(), sleep: noSleep() });
  const outcome = await engine.run(report());
  assert.equal(outcome.stoppedReason, "escalated");
  assert.equal(outcome.escalations[0].reason, "no_known_action");
  assert.equal(outcome.totalActionsExecuted, 0);
});

test("engine: modo dry run nunca chama continueExecution e nunca reporta ok=true", async () => {
  let continueCalls = 0;
  const action = fakeAction({
    execute: async (ctx) => {
      assert.equal(ctx.dryRun, true);
      return { actionId: "footage_acquisition", ok: false, wouldSucceed: true, detail: "[dry-run] simulação", sideEffectsApplied: [], durationMs: 1 };
    },
  });
  const engine = new AutonomousExecutionEngine({
    registry: [action],
    config: { dryRun: true },
    continueExecution: async () => { continueCalls += 1; return report(); },
    sleep: noSleep(),
  });
  const outcome = await engine.run(report());
  assert.equal(continueCalls, 0);
  assert.equal(outcome.totalRecalculations, 0);
  assert.equal(outcome.stoppedReason, "completed");
  assert.equal(outcome.resolvedBlockers, 1);
});

test("engine: WAITING_HUMAN_APPROVAL é sempre um hard stop, nunca chama continueExecution", async () => {
  let continueCalls = 0;
  const engine = new AutonomousExecutionEngine({
    registry: [],
    continueExecution: async () => { continueCalls += 1; return report(); },
    sleep: noSleep(),
  });
  const outcome = await engine.run(report({ state: "WAITING_HUMAN_APPROVAL" }));
  assert.equal(outcome.stoppedReason, "human_approval_required");
  assert.equal(continueCalls, 0);
});

test("engine: WAITING_DEVELOPER_AI escalona como decisão criativa, fora do escopo do Engine", async () => {
  const engine = new AutonomousExecutionEngine({ registry: [], continueExecution: async () => report(), sleep: noSleep() });
  const outcome = await engine.run(report({ state: "WAITING_DEVELOPER_AI" }));
  assert.equal(outcome.stoppedReason, "escalated");
  assert.equal(outcome.escalations[0].reason, "subjective_judgment_required");
});

test("engine: teto global de iterações nunca é excedido, mesmo com bloqueio persistente (nunca loop infinito)", async () => {
  const action = fakeAction({ execute: async () => ({ actionId: "footage_acquisition", ok: true, detail: "resolve mas o bloqueio nunca some de verdade", sideEffectsApplied: [], durationMs: 1 }) });
  const engine = new AutonomousExecutionEngine({
    registry: [action],
    config: { maxTotalIterations: 3 },
    continueExecution: async () => report(), // sempre devolve o MESMO bloqueio, nunca resolve de fato
    sleep: noSleep(),
  });
  const outcome = await engine.run(report());
  assert.equal(outcome.stoppedReason, "max_iterations_reached");
  assert.equal(outcome.totalRecalculations, 3);
});

test("engine: exceção lançada por uma ação é registrada no histórico como erro, sem derrubar o loop", async () => {
  let calls = 0;
  const action = fakeAction({
    maxAttempts: 2,
    execute: async (ctx) => {
      calls += 1;
      if (ctx.attemptNumber === 1) throw new Error("falha inesperada");
      return { actionId: "footage_acquisition", ok: true, detail: "recupera na 2a", sideEffectsApplied: [], durationMs: 1 };
    },
  });
  const completedReport = { ...report(), state: "COMPLETED", steps: [] };
  const engine = new AutonomousExecutionEngine({ registry: [action], continueExecution: async () => completedReport, sleep: noSleep() });
  const outcome = await engine.run(report());
  assert.equal(calls, 2);
  assert.equal(outcome.history[0].resultado, "error");
  assert.match(outcome.history[0].erro, /falha inesperada/);
  assert.equal(outcome.stoppedReason, "completed");
});

test("selectActionsForBlocker: filtra por resolves+isApplicable e ordena pela prioridade configurada, ações fora da lista vão para o fim", () => {
  const blocker = { kind: "video_coverage_low", stepId: "s", stepName: "s", executionState: "WAITING_ASSISTED_GENERATION", message: "m" };
  const a = fakeAction({ id: "a", resolves: ["video_coverage_low"] });
  const b = fakeAction({ id: "b", resolves: ["video_coverage_low"] });
  const c = fakeAction({ id: "c", resolves: ["product_coverage_low"] }); // não resolve este bloqueio
  const d = fakeAction({ id: "d", resolves: ["video_coverage_low"], isApplicable: () => false }); // fail fast
  const selected = selectActionsForBlocker(blocker, [a, b, c, d], ["b", "a"]);
  assert.deepEqual(selected.map((action) => action.id), ["b", "a"]);
});
