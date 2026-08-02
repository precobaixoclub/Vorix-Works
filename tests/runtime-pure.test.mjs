import { test } from "node:test";
import assert from "node:assert/strict";

import { planFromPreparedCommand } from "../dist/application/planning/arthur-planner.js";
import { getTranslationTemplate, RUNTIME_SCHEMA_VERSION, TRANSLATOR_STRATEGY, TRANSLATOR_VERSION } from "../dist/application/runtime/translation-template.js";
import { translatePlanningToRuntime } from "../dist/application/runtime/translator.js";
import { validateRuntimeTranslation } from "../dist/application/runtime/validation.js";
import { computeRuntimeFingerprint, computeSourceGraphFingerprint } from "../dist/application/runtime/fingerprints.js";

function makeIdGenerator(prefix) {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
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

function fakePlanning(overrides = {}) {
  return {
    id: "planning-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    briefingId: "briefing-1",
    preparedCommandId: "command-1",
    preparedCommandRevision: 1,
    status: "ready",
    plannerVersion: 1,
    plannerStrategy: "deterministic-campaign-creation-v1",
    planningTemplate: "campaign_creation-standard-pipeline-v1",
    graphVersion: 1,
    graphType: "dag",
    validationReport: { valid: true, issues: [], validatedAt: "2026-01-01T00:00:00.000Z" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Monta as ExecutionTasks + o ExecutionGraph reais que o Arthur Planner (Sprint 09) produziria,
 * exatamente como o Runtime Engine faria na prática — a base para os testes do tradutor real. */
function buildPlanningFixture() {
  const result = planFromPreparedCommand(preparedCommand(), "planning-1", { idGenerator: makeIdGenerator("task"), now: () => new Date("2026-01-01T00:00:00.000Z") });
  const nodes = result.tasks.map((task) => ({ id: `node-${task.id}`, planningId: "planning-1", executionTaskId: task.id, label: task.name, createdAt: "2026-01-01T00:00:00.000Z" }));
  const nodeIdByTaskId = new Map(nodes.map((n) => [n.executionTaskId, n.id]));
  const edges = result.edges.map((edge, index) => ({
    id: `edge-${index}`,
    planningId: "planning-1",
    fromNodeId: nodeIdByTaskId.get(edge.fromTaskId),
    toNodeId: nodeIdByTaskId.get(edge.toTaskId),
    kind: "depends_on",
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
  return { tasks: result.tasks, artifacts: result.artifacts, graph: { nodes, edges } };
}

// ---------------------------------------------------------------------------------------------
// translation-template.js
// ---------------------------------------------------------------------------------------------

test("translation-template: só campaign_creation-standard-pipeline-v1 tem tradução registrada", () => {
  assert.equal(getTranslationTemplate("campaign_creation-standard-pipeline-v1").length, 6);
  assert.equal(getTranslationTemplate("nao-existe"), undefined);
  assert.equal(TRANSLATOR_VERSION, 1);
  assert.equal(TRANSLATOR_STRATEGY, "deterministic-port-binding-v1");
  assert.equal(RUNTIME_SCHEMA_VERSION, 1);
});

// ---------------------------------------------------------------------------------------------
// PlanningExecutionTranslator — Fase 3
// ---------------------------------------------------------------------------------------------

test("translatePlanningToRuntime: traduz as 6 ExecutionTasks reais em 6 RuntimeTasks + portas + 6 bindings + 6 artefatos", () => {
  const { tasks, artifacts } = buildPlanningFixture();
  const candidate = translatePlanningToRuntime(fakePlanning(), tasks, artifacts, "runtime-1", { idGenerator: makeIdGenerator("rt"), now: () => new Date("2026-01-01T00:00:00.000Z") });

  assert.ok(candidate);
  assert.equal(candidate.tasks.length, 6);
  assert.equal(candidate.outputPorts.length, 6, "cada uma das 6 tarefas produz exatamente 1 porta de saída neste template");
  assert.equal(candidate.inputPorts.length, 6, "research não tem entrada; approval tem 2 — total 0+1+1+1+2+1=6");
  assert.equal(candidate.bindings.length, 6);
  assert.equal(candidate.artifacts.length, 6);
  for (const binding of candidate.bindings) {
    assert.ok(binding.fromRuntimeTaskId, `binding ${binding.fromTaskType}->${binding.toTaskType} deveria resolver a tarefa de origem`);
    assert.ok(binding.toRuntimeTaskId, `binding ${binding.fromTaskType}->${binding.toTaskType} deveria resolver a tarefa de destino`);
  }
  for (const task of candidate.tasks) assert.equal(task.status, "prepared", "nenhuma RuntimeTask pode nascer em outro status — nada é executado nesta sprint");
});

test("translatePlanningToRuntime: planningTemplate sem tradução registrada -> undefined (quem chama vira issue no_translation_template_registered)", () => {
  const { tasks, artifacts } = buildPlanningFixture();
  const candidate = translatePlanningToRuntime(fakePlanning({ planningTemplate: "outro-template-desconhecido" }), tasks, artifacts, "runtime-1", { idGenerator: makeIdGenerator("rt") });
  assert.equal(candidate, undefined);
});

test("translatePlanningToRuntime + validateRuntimeTranslation: a tradução real do template fechado sempre produz um RuntimeValidationReport válido", () => {
  const { tasks, artifacts, graph } = buildPlanningFixture();
  const candidate = translatePlanningToRuntime(fakePlanning(), tasks, artifacts, "runtime-1", { idGenerator: makeIdGenerator("rt"), now: () => new Date("2026-01-01T00:00:00.000Z") });
  const report = validateRuntimeTranslation(candidate, graph, () => new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(report.valid, true);
  assert.deepEqual(report.issues, []);
});

// ---------------------------------------------------------------------------------------------
// RuntimeValidationReport — Fase 4, códigos fechados (construídos à mão para cobrir cada caso)
// ---------------------------------------------------------------------------------------------

function twoTaskGraph({ withEdge = true } = {}) {
  return {
    nodes: [
      { id: "node-a", planningId: "p1", executionTaskId: "et-a", label: "A", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "node-b", planningId: "p1", executionTaskId: "et-b", label: "B", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    edges: withEdge ? [{ id: "e1", planningId: "p1", fromNodeId: "node-a", toNodeId: "node-b", kind: "depends_on", createdAt: "2026-01-01T00:00:00.000Z" }] : [],
  };
}

function baseCandidate(overrides = {}) {
  return {
    translationTemplate: "test-template",
    tasks: [
      { id: "rt-a", runtimePlanId: "rp1", executionTaskId: "et-a", type: "typeA", capability: "editorial_research", status: "prepared", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "rt-b", runtimePlanId: "rp1", executionTaskId: "et-b", type: "typeB", capability: "strategic_planning", status: "prepared", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    outputPorts: [{ id: "op1", runtimePlanId: "rp1", runtimeTaskId: "rt-a", portKey: "out", artifactType: "text", description: "d", createdAt: "2026-01-01T00:00:00.000Z" }],
    inputPorts: [{ id: "ip1", runtimePlanId: "rp1", runtimeTaskId: "rt-b", portKey: "in", acceptedArtifactTypes: ["text"], required: true, description: "d", createdAt: "2026-01-01T00:00:00.000Z" }],
    bindings: [{ id: "b1", runtimePlanId: "rp1", fromTaskType: "typeA", fromOutputPort: "out", toTaskType: "typeB", toInputPort: "in", fromRuntimeTaskId: "rt-a", toRuntimeTaskId: "rt-b" }],
    artifacts: [],
    ...overrides,
  };
}

test("RuntimeValidationReport: caso válido (2 tarefas, 1 binding compatível, backed por PlanningEdge) -> valid: true", () => {
  const report = validateRuntimeTranslation(baseCandidate(), twoTaskGraph(), () => new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(report.valid, true);
  assert.deepEqual(report.issues, []);
});

test("RuntimeValidationReport: fromRuntimeTaskId ausente -> unknown_source_task", () => {
  const candidate = baseCandidate({ bindings: [{ ...baseCandidate().bindings[0], fromRuntimeTaskId: undefined }] });
  const report = validateRuntimeTranslation(candidate, twoTaskGraph());
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((i) => i.code === "unknown_source_task"));
});

test("RuntimeValidationReport: toRuntimeTaskId ausente -> unknown_target_task", () => {
  const candidate = baseCandidate({ bindings: [{ ...baseCandidate().bindings[0], toRuntimeTaskId: undefined }] });
  const report = validateRuntimeTranslation(candidate, twoTaskGraph());
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((i) => i.code === "unknown_target_task"));
});

test("RuntimeValidationReport: fromOutputPort não declarado na tarefa de origem -> unknown_output_port", () => {
  const candidate = baseCandidate({ bindings: [{ ...baseCandidate().bindings[0], fromOutputPort: "porta-inexistente" }] });
  const report = validateRuntimeTranslation(candidate, twoTaskGraph());
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((i) => i.code === "unknown_output_port"));
});

test("RuntimeValidationReport: toInputPort não declarado na tarefa de destino -> unknown_input_port", () => {
  const candidate = baseCandidate({ bindings: [{ ...baseCandidate().bindings[0], toInputPort: "porta-inexistente" }] });
  const report = validateRuntimeTranslation(candidate, twoTaskGraph());
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((i) => i.code === "unknown_input_port"));
});

test("RuntimeValidationReport: tipo de artefato incompatível entre saída e entrada -> incompatible_artifact_type", () => {
  const candidate = baseCandidate({ outputPorts: [{ ...baseCandidate().outputPorts[0], artifactType: "image" }] });
  const report = validateRuntimeTranslation(candidate, twoTaskGraph());
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((i) => i.code === "incompatible_artifact_type"));
});

test("RuntimeValidationReport: binding proposto sem PlanningEdge correspondente -> binding_not_backed_by_planning_edge (nenhuma dependência inventada)", () => {
  const report = validateRuntimeTranslation(baseCandidate(), twoTaskGraph({ withEdge: false }));
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((i) => i.code === "binding_not_backed_by_planning_edge"));
});

test("RuntimeValidationReport: dois bindings para a MESMA porta de entrada -> duplicate_binding", () => {
  const candidate = baseCandidate({ bindings: [baseCandidate().bindings[0], { ...baseCandidate().bindings[0], id: "b2" }] });
  const report = validateRuntimeTranslation(candidate, twoTaskGraph());
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((i) => i.code === "duplicate_binding"));
});

test("RuntimeValidationReport: porta de entrada obrigatória sem nenhum binding -> missing_required_input", () => {
  const candidate = baseCandidate({ bindings: [] });
  const report = validateRuntimeTranslation(candidate, twoTaskGraph());
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((i) => i.code === "missing_required_input"));
});

test("RuntimeValidationReport: porta de entrada OPCIONAL sem binding não gera nenhum issue", () => {
  const candidate = baseCandidate({ inputPorts: [{ ...baseCandidate().inputPorts[0], required: false }], bindings: [] });
  const report = validateRuntimeTranslation(candidate, twoTaskGraph());
  assert.equal(report.valid, true);
});

test("RuntimeValidationReport: ciclo no grafo de bindings -> cycle_detected", () => {
  const graph = {
    nodes: [
      { id: "node-a", planningId: "p1", executionTaskId: "et-a", label: "A", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "node-b", planningId: "p1", executionTaskId: "et-b", label: "B", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "node-c", planningId: "p1", executionTaskId: "et-c", label: "C", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    edges: [
      { id: "e1", planningId: "p1", fromNodeId: "node-a", toNodeId: "node-b", kind: "depends_on", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "e2", planningId: "p1", fromNodeId: "node-b", toNodeId: "node-c", kind: "depends_on", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "e3", planningId: "p1", fromNodeId: "node-c", toNodeId: "node-a", kind: "depends_on", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
  };
  const candidate = {
    translationTemplate: "test-template",
    tasks: [
      { id: "rt-a", runtimePlanId: "rp1", executionTaskId: "et-a", type: "typeA", capability: "editorial_research", status: "prepared", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "rt-b", runtimePlanId: "rp1", executionTaskId: "et-b", type: "typeB", capability: "strategic_planning", status: "prepared", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "rt-c", runtimePlanId: "rp1", executionTaskId: "et-c", type: "typeC", capability: "copywriting", status: "prepared", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    outputPorts: [
      { id: "op-a", runtimePlanId: "rp1", runtimeTaskId: "rt-a", portKey: "out", artifactType: "text", description: "d", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "op-b", runtimePlanId: "rp1", runtimeTaskId: "rt-b", portKey: "out", artifactType: "text", description: "d", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "op-c", runtimePlanId: "rp1", runtimeTaskId: "rt-c", portKey: "out", artifactType: "text", description: "d", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    inputPorts: [
      { id: "ip-a", runtimePlanId: "rp1", runtimeTaskId: "rt-a", portKey: "in", acceptedArtifactTypes: ["text"], required: false, description: "d", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "ip-b", runtimePlanId: "rp1", runtimeTaskId: "rt-b", portKey: "in", acceptedArtifactTypes: ["text"], required: false, description: "d", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "ip-c", runtimePlanId: "rp1", runtimeTaskId: "rt-c", portKey: "in", acceptedArtifactTypes: ["text"], required: false, description: "d", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    bindings: [
      { id: "b1", runtimePlanId: "rp1", fromTaskType: "typeA", fromOutputPort: "out", toTaskType: "typeB", toInputPort: "in", fromRuntimeTaskId: "rt-a", toRuntimeTaskId: "rt-b" },
      { id: "b2", runtimePlanId: "rp1", fromTaskType: "typeB", fromOutputPort: "out", toTaskType: "typeC", toInputPort: "in", fromRuntimeTaskId: "rt-b", toRuntimeTaskId: "rt-c" },
      { id: "b3", runtimePlanId: "rp1", fromTaskType: "typeC", fromOutputPort: "out", toTaskType: "typeA", toInputPort: "in", fromRuntimeTaskId: "rt-c", toRuntimeTaskId: "rt-a" },
    ],
    artifacts: [],
  };
  const report = validateRuntimeTranslation(candidate, graph);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((i) => i.code === "cycle_detected"));
});

// ---------------------------------------------------------------------------------------------
// Fingerprints — decisões obrigatórias 8/33/34
// ---------------------------------------------------------------------------------------------

test("computeSourceGraphFingerprint: determinístico (mesma estrutura -> mesmo hash), ignora IDs/timestamps", () => {
  const { tasks, graph } = buildPlanningFixture();
  const a = computeSourceGraphFingerprint(tasks, graph);
  const b = computeSourceGraphFingerprint(tasks, graph);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);

  // Mesma estrutura LÓGICA, mas com IDs/timestamps diferentes -> mesmo fingerprint.
  const tasksWithDifferentIds = tasks.map((task, index) => ({ ...task, id: `outro-id-${index}`, createdAt: "2030-05-05T00:00:00.000Z" }));
  const nodesWithDifferentIds = graph.nodes.map((node, index) => ({ ...node, id: `outro-node-${index}`, executionTaskId: tasksWithDifferentIds[index].id }));
  const nodeIdOldToNew = new Map(graph.nodes.map((node, index) => [node.id, nodesWithDifferentIds[index].id]));
  const edgesWithDifferentIds = graph.edges.map((edge) => ({ ...edge, fromNodeId: nodeIdOldToNew.get(edge.fromNodeId), toNodeId: nodeIdOldToNew.get(edge.toNodeId) }));
  const c = computeSourceGraphFingerprint(tasksWithDifferentIds, { nodes: nodesWithDifferentIds, edges: edgesWithDifferentIds });
  assert.equal(a, c, "IDs aleatórios/timestamps nunca deveriam afetar o fingerprint");
});

test("computeSourceGraphFingerprint: estruturas logicamente diferentes produzem fingerprints diferentes", () => {
  const { tasks, graph } = buildPlanningFixture();
  const a = computeSourceGraphFingerprint(tasks, graph);
  const graphWithOneEdgeRemoved = { nodes: graph.nodes, edges: graph.edges.slice(1) };
  const b = computeSourceGraphFingerprint(tasks, graphWithOneEdgeRemoved);
  assert.notEqual(a, b);
});

test("computeRuntimeFingerprint: determinístico e sensível à estrutura (tasks/ports/bindings)", () => {
  const { tasks, artifacts } = buildPlanningFixture();
  const candidate = translatePlanningToRuntime(fakePlanning(), tasks, artifacts, "runtime-1", { idGenerator: makeIdGenerator("rt"), now: () => new Date("2026-01-01T00:00:00.000Z") });

  const a = computeRuntimeFingerprint(candidate);
  const b = computeRuntimeFingerprint(candidate);
  assert.equal(a, b);

  const candidateWithoutOneBinding = { ...candidate, bindings: candidate.bindings.slice(1) };
  const c = computeRuntimeFingerprint(candidateWithoutOneBinding);
  assert.notEqual(a, c);
});
