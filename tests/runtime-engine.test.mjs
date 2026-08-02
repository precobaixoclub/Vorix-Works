import { test } from "node:test";
import assert from "node:assert/strict";

import { createPlanningFromPreparedCommand } from "../dist/application/planning/planning-engine.js";
import { ensureRuntimeForPlanning, supersedeRuntimeForPlanning } from "../dist/application/runtime/runtime-engine.js";
import { InMemoryPlanningRepository } from "../dist/infrastructure/storage/in-memory-planning-repository.js";
import { InMemoryExecutionTaskRepository } from "../dist/infrastructure/storage/in-memory-execution-task-repository.js";
import { InMemoryExecutionGraphRepository } from "../dist/infrastructure/storage/in-memory-execution-graph-repository.js";
import { InMemoryPlanningArtifactRepository } from "../dist/infrastructure/storage/in-memory-planning-artifact-repository.js";
import { InMemoryPlanningDecisionRepository } from "../dist/infrastructure/storage/in-memory-planning-decision-repository.js";
import { InMemoryRuntimeRepository } from "../dist/infrastructure/storage/in-memory-runtime-repository.js";

/**
 * Runtime Engine — Sprint 10 (Fase 3), testado com adapters em memória (mesmo padrão de
 * `planning-engine.test.mjs`). `makePlanningDeps`/`makeRuntimeDeps` compartilham DELIBERADAMENTE
 * as mesmas instâncias de `executionTaskRepository`/`executionGraphRepository`/`artifactRepository`
 * — é exatamente assim que a produção conecta os dois (ver `container.ts`: `runtimeEngineHook`
 * lê os mesmos repositórios de Planning que `planningEngineHook` escreve).
 */

function makeSharedRepos() {
  return {
    planningRepository: new InMemoryPlanningRepository(),
    executionTaskRepository: new InMemoryExecutionTaskRepository(),
    executionGraphRepository: new InMemoryExecutionGraphRepository(),
    artifactRepository: new InMemoryPlanningArtifactRepository(),
    decisionRepository: new InMemoryPlanningDecisionRepository(),
    runtimeRepository: new InMemoryRuntimeRepository(),
  };
}

function makeDeps() {
  let counter = 0;
  const shared = makeSharedRepos();
  const planningDeps = { ...shared, idGenerator: () => `planning-id-${++counter}`, now: () => new Date("2026-01-01T00:00:00.000Z") };
  const runtimeDeps = { ...shared, idGenerator: () => `runtime-id-${++counter}`, now: () => new Date("2026-01-01T00:00:00.000Z") };
  return { shared, planningDeps, runtimeDeps };
}

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

function fakeReadyPlanningWithUnregisteredTemplate() {
  return {
    id: "planning-fake-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    briefingId: "briefing-1",
    preparedCommandId: "command-1",
    preparedCommandRevision: 1,
    status: "ready",
    plannerVersion: 1,
    plannerStrategy: "deterministic-campaign-creation-v1",
    planningTemplate: "template-sem-traducao-registrada",
    graphVersion: 1,
    graphType: "dag",
    validationReport: { valid: true, issues: [], validatedAt: "2026-01-01T00:00:00.000Z" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------------------------
// Idempotência — decisão obrigatória 6/7
// ---------------------------------------------------------------------------------------------

test("ensureRuntimeForPlanning: chamado duas vezes para o MESMO Planning devolve o MESMO RuntimePlan, nunca duplica", async () => {
  const { planningDeps, runtimeDeps } = makeDeps();
  const planning = await createPlanningFromPreparedCommand(planningDeps, preparedCommand());
  assert.equal(planning.status, "ready");

  const first = await ensureRuntimeForPlanning(runtimeDeps, planning);
  const second = await ensureRuntimeForPlanning(runtimeDeps, planning);
  assert.equal(first.id, second.id);

  const details = await runtimeDeps.runtimeRepository.getDetails(first.id);
  assert.equal(details.tasks.length, 6, "a segunda chamada não pode ter duplicado as tarefas");
});

test("ensureRuntimeForPlanning: dois Plannings diferentes produzem RuntimePlans distintos", async () => {
  const { planningDeps, runtimeDeps } = makeDeps();
  const planningA = await createPlanningFromPreparedCommand(planningDeps, preparedCommand({ id: "command-a", briefingId: "briefing-a" }));
  const planningB = await createPlanningFromPreparedCommand(planningDeps, preparedCommand({ id: "command-b", briefingId: "briefing-b" }));

  const runtimeA = await ensureRuntimeForPlanning(runtimeDeps, planningA);
  const runtimeB = await ensureRuntimeForPlanning(runtimeDeps, planningB);
  assert.notEqual(runtimeA.id, runtimeB.id);
});

// ---------------------------------------------------------------------------------------------
// Caminho validado — decisões obrigatórias 33 (fingerprints/versões) e evidência de fluxo
// ---------------------------------------------------------------------------------------------

test("ensureRuntimeForPlanning: Planning ready válido -> RuntimePlan 'validated', 6 tasks 'prepared', 6 artifacts 'expected', runtimeFingerprint presente", async () => {
  const { planningDeps, runtimeDeps } = makeDeps();
  const planning = await createPlanningFromPreparedCommand(planningDeps, preparedCommand());
  const runtimePlan = await ensureRuntimeForPlanning(runtimeDeps, planning);

  assert.equal(runtimePlan.status, "validated");
  assert.equal(runtimePlan.validationReport.valid, true);
  assert.ok(runtimePlan.sourceGraphFingerprint);
  assert.ok(runtimePlan.runtimeFingerprint);
  assert.equal(runtimePlan.translationTemplate, "campaign_creation-standard-pipeline-v1");
  assert.equal(runtimePlan.sourceContext.planningId, planning.id);
  assert.equal(runtimePlan.sourceContext.tenantId, planning.tenantId);

  const details = await runtimeDeps.runtimeRepository.getDetails(runtimePlan.id);
  assert.equal(details.tasks.length, 6);
  for (const task of details.tasks) assert.equal(task.status, "prepared");
  assert.equal(details.artifacts.length, 6);
  for (const artifact of details.artifacts) assert.equal(artifact.status, "expected");
  assert.equal(details.bindings.length, 6);
});

// ---------------------------------------------------------------------------------------------
// Atomicidade / falha de validação — decisões obrigatórias 30/31/32
// ---------------------------------------------------------------------------------------------

test("ensureRuntimeForPlanning: Planning com planningTemplate sem tradução registrada -> RuntimePlan 'validation_failed', SEM tasks/bindings/artifacts", async () => {
  const { runtimeDeps } = makeDeps();
  const planning = fakeReadyPlanningWithUnregisteredTemplate();

  const runtimePlan = await ensureRuntimeForPlanning(runtimeDeps, planning);

  assert.equal(runtimePlan.status, "validation_failed");
  assert.equal(runtimePlan.validationReport.valid, false);
  assert.ok(runtimePlan.validationReport.issues.some((issue) => issue.code === "no_translation_template_registered"));
  assert.equal(runtimePlan.runtimeFingerprint, undefined, "nunca existiu uma tradução válida para ter fingerprint");

  const details = await runtimeDeps.runtimeRepository.getDetails(runtimePlan.id);
  assert.deepEqual(details.tasks, []);
  assert.deepEqual(details.inputs, []);
  assert.deepEqual(details.outputs, []);
  assert.deepEqual(details.bindings, []);
  assert.deepEqual(details.artifacts, []);
  assert.equal(details.issues.length, 1, "o relatório de validação (mesmo de falha) é sempre persistido");
});

test("ensureRuntimeForPlanning: idempotência também vale para o caminho de falha — nunca tenta traduzir de novo", async () => {
  const { runtimeDeps } = makeDeps();
  const planning = fakeReadyPlanningWithUnregisteredTemplate();

  const first = await ensureRuntimeForPlanning(runtimeDeps, planning);
  const second = await ensureRuntimeForPlanning(runtimeDeps, planning);
  assert.equal(first.id, second.id);
  assert.equal(second.status, "validation_failed");
});

// ---------------------------------------------------------------------------------------------
// Supersede — decisão obrigatória 9
// ---------------------------------------------------------------------------------------------

test("supersedeRuntimeForPlanning: marca o RuntimePlan ativo como superseded", async () => {
  const { planningDeps, runtimeDeps } = makeDeps();
  const planning = await createPlanningFromPreparedCommand(planningDeps, preparedCommand());
  const runtimePlan = await ensureRuntimeForPlanning(runtimeDeps, planning);
  assert.equal(runtimePlan.status, "validated");

  await supersedeRuntimeForPlanning(runtimeDeps, planning.id);

  const after = await runtimeDeps.runtimeRepository.getById(runtimePlan.id);
  assert.equal(after.status, "superseded");
  assert.ok(after.supersededAt);
});

test("supersedeRuntimeForPlanning: sem RuntimePlan para o Planning -> não faz nada, nunca lança", async () => {
  const { runtimeDeps } = makeDeps();
  await assert.doesNotReject(() => supersedeRuntimeForPlanning(runtimeDeps, "planning-inexistente"));
});

test("supersedeRuntimeForPlanning: chamado duas vezes seguidas é seguro (idempotente)", async () => {
  const { planningDeps, runtimeDeps } = makeDeps();
  const planning = await createPlanningFromPreparedCommand(planningDeps, preparedCommand());
  const runtimePlan = await ensureRuntimeForPlanning(runtimeDeps, planning);

  await supersedeRuntimeForPlanning(runtimeDeps, planning.id);
  await assert.doesNotReject(() => supersedeRuntimeForPlanning(runtimeDeps, planning.id));
  const after = await runtimeDeps.runtimeRepository.getById(runtimePlan.id);
  assert.equal(after.status, "superseded");
});

// ---------------------------------------------------------------------------------------------
// Imutabilidade — decisão obrigatória 13
// ---------------------------------------------------------------------------------------------

test("Imutabilidade: um RuntimePlan validated NUNCA é reescrito por ensureRuntimeForPlanning — mesmo chamando de novo com o mesmo Planning", async () => {
  const { planningDeps, runtimeDeps } = makeDeps();
  const planning = await createPlanningFromPreparedCommand(planningDeps, preparedCommand());
  const first = await ensureRuntimeForPlanning(runtimeDeps, planning);
  const firstFingerprint = first.runtimeFingerprint;
  const firstUpdatedAt = first.updatedAt;

  const second = await ensureRuntimeForPlanning(runtimeDeps, planning);
  assert.equal(second.runtimeFingerprint, firstFingerprint);
  assert.equal(second.updatedAt, firstUpdatedAt, "nenhuma nova gravação deve ter acontecido");
});
