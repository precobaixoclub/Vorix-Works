import { test } from "node:test";
import assert from "node:assert/strict";

import { projectExecutionGraph, topologicalSort } from "../dist/domain/planning/graph-projection.js";
import { validatePreparedCommandForPlanning } from "../dist/application/planning/validation.js";
import { getPlanningTemplateId, PLANNING_TEMPLATES_BY_PREPARED_COMMAND_TYPE } from "../dist/application/planning/templates.js";
import { GRAPH_VERSION, PLANNER_STRATEGY, PLANNER_VERSION, planFromPreparedCommand } from "../dist/application/planning/arthur-planner.js";

// ---------------------------------------------------------------------------------------------
// Fase 2 — templates
// ---------------------------------------------------------------------------------------------

test("templates: campaign_creation e content_request têm template registrado", () => {
  assert.equal(getPlanningTemplateId("campaign_creation"), "campaign_creation-standard-pipeline-v1");
  assert.equal(getPlanningTemplateId("content_request"), "content_request-visual-only-v2");
  assert.equal(getPlanningTemplateId("knowledge_query"), undefined);
  assert.equal(Object.keys(PLANNING_TEMPLATES_BY_PREPARED_COMMAND_TYPE).length, 2);
});

test("templates: sem creativeEngine (ou 'legacy'), content_request continua resolvendo para -v2 (migração GPT/PR 6 não muda o comportamento default)", () => {
  assert.equal(getPlanningTemplateId("content_request"), "content_request-visual-only-v2");
  assert.equal(getPlanningTemplateId("content_request", "legacy"), "content_request-visual-only-v2");
});

test("templates: com creativeEngine='gpt', content_request resolve para o grafo exclusivo do motor GPT", () => {
  assert.equal(getPlanningTemplateId("content_request", "gpt"), "content_request-gpt-creative-v3");
  // campaign_creation nunca é afetado pelo motor criativo (não tem variante por engine).
  assert.equal(getPlanningTemplateId("campaign_creation", "gpt"), "campaign_creation-standard-pipeline-v1");
});

// ---------------------------------------------------------------------------------------------
// Fase 3 — ValidationReport (roda ANTES de qualquer grafo ser montado)
// ---------------------------------------------------------------------------------------------

function basePreparedCommand(overrides = {}) {
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

test("ValidationReport: PreparedCommand prepared + tipo com template + channel presente -> válido, sem issues", () => {
  const report = validatePreparedCommandForPlanning(basePreparedCommand());
  assert.equal(report.valid, true);
  assert.deepEqual(report.issues, []);
});

test("ValidationReport: status != prepared -> error, bloqueia (valid: false)", () => {
  const report = validatePreparedCommandForPlanning(basePreparedCommand({ status: "superseded" }));
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === "prepared_command_not_active" && issue.severity === "error"));
});

test("ValidationReport: tipo sem template registrado -> error, bloqueia", () => {
  const report = validatePreparedCommandForPlanning(basePreparedCommand({ type: "knowledge_query" }));
  assert.equal(report.valid, false);
  assert.ok(report.issues.some((issue) => issue.code === "no_planning_template_for_type" && issue.severity === "error"));
});

test("ValidationReport: channel ausente -> só warning, NUNCA bloqueia", () => {
  const report = validatePreparedCommandForPlanning(basePreparedCommand({ validatedInputs: {} }));
  assert.equal(report.valid, true, "warning nunca deve tornar o report inválido");
  assert.ok(report.issues.some((issue) => issue.code === "missing_channel_hint" && issue.severity === "warning"));
});

// ---------------------------------------------------------------------------------------------
// Fase 4 — Arthur Planner: forma do DAG (dependência simples, paralelismo, aprovação)
// ---------------------------------------------------------------------------------------------

function makeIdGenerator(prefix) {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

test("Arthur Planner: gera exatamente 6 tarefas, nunca cita especialista nenhum, é 100% determinístico", () => {
  const result = planFromPreparedCommand(basePreparedCommand(), "planning-1", { idGenerator: makeIdGenerator("task"), now: () => new Date("2026-01-01T00:00:00.000Z") });
  assert.equal(result.tasks.length, 6);
  assert.deepEqual(
    result.tasks.map((t) => t.type),
    ["research", "campaign_structure", "copy_generation", "visual_generation", "approval", "publication"],
  );
  for (const task of result.tasks) assert.equal(task.status, "planned", "nenhuma tarefa pode nascer em outro status — nada é executado nesta sprint");

  const again = planFromPreparedCommand(basePreparedCommand(), "planning-1", { idGenerator: makeIdGenerator("task"), now: () => new Date("2026-01-01T00:00:00.000Z") });
  assert.deepEqual(
    again.tasks.map((t) => ({ type: t.type, name: t.name, capability: t.capability })),
    result.tasks.map((t) => ({ type: t.type, name: t.name, capability: t.capability })),
    "mesmo PreparedCommand deve sempre produzir a mesma decomposição — determinístico",
  );
});

test("Arthur Planner: contentFormat=carousel decide o tipo de artefato visual como carousel (nunca um palpite fixo)", () => {
  const result = planFromPreparedCommand(basePreparedCommand({ validatedInputs: { channel: "instagram", contentFormat: "reel" } }), "planning-1", {
    idGenerator: makeIdGenerator("task"),
  });
  const visualTask = result.tasks.find((t) => t.type === "visual_generation");
  assert.equal(visualTask.expectedArtifactType, "video", "reel deve virar vídeo, não o palpite default (imagem)");
});

test("Arthur Planner: PLANNER_VERSION/PLANNER_STRATEGY/GRAPH_VERSION são constantes estáveis", () => {
  assert.equal(PLANNER_VERSION, 1);
  assert.equal(PLANNER_STRATEGY, "deterministic-campaign-creation-v1");
  assert.equal(GRAPH_VERSION, 1);
});

test("Arthur Planner: lança se chamado para um tipo sem template — só defesa, quem chama já deveria ter checado o ValidationReport", () => {
  assert.throws(() => planFromPreparedCommand(basePreparedCommand({ type: "knowledge_query" }), "planning-1", { idGenerator: makeIdGenerator("task") }));
});

// ---------------------------------------------------------------------------------------------
// Migração "GPT como motor criativo único" (PR 6/9) — Graph C exclusivo do motor GPT
// ---------------------------------------------------------------------------------------------

function baseContentRequest(overrides = {}) {
  return basePreparedCommand({ type: "content_request", intent: "generate_visual", ...overrides });
}

test("content_request + creativeEngine='legacy' (ou ausente) continua produzindo o grafo -v2 de 6 tarefas, com strategic_planning e copywriting (regressão)", () => {
  const withoutEngine = planFromPreparedCommand(baseContentRequest(), "planning-1", { idGenerator: makeIdGenerator("task") });
  const withLegacy = planFromPreparedCommand(baseContentRequest(), "planning-1", { idGenerator: makeIdGenerator("task"), creativeEngine: "legacy" });

  for (const result of [withoutEngine, withLegacy]) {
    assert.equal(result.planningTemplate, "content_request-visual-only-v2");
    assert.equal(result.tasks.length, 6);
    assert.ok(result.tasks.some((t) => t.capability === "strategic_planning"));
    assert.ok(result.tasks.some((t) => t.capability === "copywriting"));
  }
});

test("content_request + creativeEngine='gpt' produz o Graph C: 4 tarefas, SEM strategic_planning nem copywriting (prova estrutural, não só ausência de chamada)", () => {
  const result = planFromPreparedCommand(baseContentRequest(), "planning-1", { idGenerator: makeIdGenerator("task"), creativeEngine: "gpt" });

  assert.equal(result.planningTemplate, "content_request-gpt-creative-v3");
  assert.equal(result.tasks.length, 4);
  assert.deepEqual(result.tasks.map((t) => t.type), ["content_brief", "visual_generation", "quality_review", "approval"]);
  assert.equal(result.tasks.some((t) => t.capability === "strategic_planning"), false, "João nunca deveria ter um nó no Graph C");
  assert.equal(result.tasks.some((t) => t.capability === "copywriting"), false, "Maria nunca deveria ter um nó no Graph C");
});

test("Graph C: DAG é uma cadeia simples content_brief -> visual_generation -> quality_review -> approval, sem paralelismo", () => {
  const result = planFromPreparedCommand(baseContentRequest(), "planning-1", { idGenerator: makeIdGenerator("task"), creativeEngine: "gpt" });
  const byType = Object.fromEntries(result.tasks.map((t) => [t.type, t]));
  const hasEdge = (fromType, toType) => result.edges.some((e) => e.fromTaskId === byType[fromType].id && e.toTaskId === byType[toType].id);

  assert.ok(hasEdge("content_brief", "visual_generation"));
  assert.ok(hasEdge("visual_generation", "quality_review"));
  assert.ok(hasEdge("visual_generation", "approval"));
  assert.ok(hasEdge("quality_review", "approval"));
  assert.equal(result.edges.length, 4);
});

test("Graph C: registra a decisão 'creative_engine_selected' explicando por que João/Maria/Bianca/Pedro/Lucas não participam", () => {
  const result = planFromPreparedCommand(baseContentRequest(), "planning-1", { idGenerator: makeIdGenerator("task"), creativeEngine: "gpt" });
  assert.ok(result.decisions.some((d) => d.decisionCode === "creative_engine_selected" && d.reason.includes("engineMode=gpt")));
});

test("Graph C: campaign_creation nunca é afetado pelo motor criativo — sempre o pipeline padrão de 6 tarefas", () => {
  const result = planFromPreparedCommand(basePreparedCommand({ type: "campaign_creation" }), "planning-1", { idGenerator: makeIdGenerator("task"), creativeEngine: "gpt" });
  assert.equal(result.planningTemplate, "campaign_creation-standard-pipeline-v1");
  assert.equal(result.tasks.length, 6);
});

// ---------------------------------------------------------------------------------------------
// Fase 6 — DAG: dependência simples + paralelismo genuíno + ponto de bloqueio (aprovação)
// ---------------------------------------------------------------------------------------------

function planningNodesAndEdgesFrom(result, planningId) {
  const nodes = result.tasks.map((task) => ({ id: `node-${task.id}`, planningId, executionTaskId: task.id, label: task.name, createdAt: "2026-01-01T00:00:00.000Z" }));
  const nodeIdByTaskId = new Map(nodes.map((n) => [n.executionTaskId, n.id]));
  const edges = result.edges.map((edge, index) => ({
    id: `edge-${index}`,
    planningId,
    fromNodeId: nodeIdByTaskId.get(edge.fromTaskId),
    toNodeId: nodeIdByTaskId.get(edge.toTaskId),
    kind: "depends_on",
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
  return { nodes, edges, nodeIdByTaskId, tasksByType: Object.fromEntries(result.tasks.map((t) => [t.type, t])) };
}

test("DAG: copy_generation e visual_generation não dependem uma da outra (paralelismo genuíno)", () => {
  const result = planFromPreparedCommand(basePreparedCommand(), "planning-1", { idGenerator: makeIdGenerator("task") });
  const hasEdgeBetween = (a, b) => result.edges.some((e) => (e.fromTaskId === a && e.toTaskId === b) || (e.fromTaskId === b && e.toTaskId === a));
  const copy = result.tasks.find((t) => t.type === "copy_generation");
  const visual = result.tasks.find((t) => t.type === "visual_generation");
  assert.equal(hasEdgeBetween(copy.id, visual.id), false);
});

test("DAG: approval depende de copy_generation E visual_generation (ponto de bloqueio real)", () => {
  const result = planFromPreparedCommand(basePreparedCommand(), "planning-1", { idGenerator: makeIdGenerator("task") });
  const approval = result.tasks.find((t) => t.type === "approval");
  const dependsOnApproval = (fromType) => {
    const fromTask = result.tasks.find((t) => t.type === fromType);
    return result.edges.some((e) => e.fromTaskId === fromTask.id && e.toTaskId === approval.id);
  };
  assert.equal(dependsOnApproval("copy_generation"), true);
  assert.equal(dependsOnApproval("visual_generation"), true);
});

test("topologicalSort: ordena o DAG do Arthur Planner respeitando toda dependência (pesquisa antes de tudo, publicação por último)", () => {
  const result = planFromPreparedCommand(basePreparedCommand(), "planning-1", { idGenerator: makeIdGenerator("task") });
  const { nodes, edges, nodeIdByTaskId, tasksByType } = planningNodesAndEdgesFrom(result, "planning-1");
  const graph = { nodes, edges };

  const sorted = topologicalSort(graph);
  assert.equal(sorted.ok, true);
  assert.equal(sorted.orderedNodeIds.length, nodes.length);

  const indexOfTask = (type) => sorted.orderedNodeIds.indexOf(nodeIdByTaskId.get(tasksByType[type].id));
  assert.equal(indexOfTask("research"), 0, "pesquisa é sempre a raiz — nada depende dela, ela não depende de nada");
  assert.equal(indexOfTask("publication"), nodes.length - 1, "publicação é sempre a folha final");
  assert.ok(indexOfTask("campaign_structure") < indexOfTask("copy_generation"));
  assert.ok(indexOfTask("campaign_structure") < indexOfTask("visual_generation"));
  assert.ok(indexOfTask("copy_generation") < indexOfTask("approval"));
  assert.ok(indexOfTask("visual_generation") < indexOfTask("approval"));
  assert.ok(indexOfTask("approval") < indexOfTask("publication"));
});

test("topologicalSort: detecta ciclo em vez de travar ou devolver ordem incompleta silenciosamente", () => {
  const nodes = [
    { id: "a", planningId: "p1", executionTaskId: "task-a", label: "A", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b", planningId: "p1", executionTaskId: "task-b", label: "B", createdAt: "2026-01-01T00:00:00.000Z" },
  ];
  const edges = [
    { id: "e1", planningId: "p1", fromNodeId: "a", toNodeId: "b", kind: "depends_on", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "e2", planningId: "p1", fromNodeId: "b", toNodeId: "a", kind: "depends_on", createdAt: "2026-01-01T00:00:00.000Z" },
  ];
  const result = topologicalSort({ nodes, edges });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "cycle_detected");
  assert.deepEqual([...result.involvedNodeIds].sort(), ["a", "b"]);
});

// ---------------------------------------------------------------------------------------------
// Fase 3/5 — projeção (reconstrução do ExecutionGraph a partir de nodes/edges persistidos)
// ---------------------------------------------------------------------------------------------

test("projectExecutionGraph: monta o tipo composto ExecutionGraph a partir de Planning + nodes/edges já persistidos, sem I/O", () => {
  const planning = {
    id: "planning-1",
    tenantId: "t",
    workspaceId: "w",
    conversationId: "c",
    briefingId: "b",
    preparedCommandId: "cmd-1",
    preparedCommandRevision: 1,
    status: "ready",
    plannerVersion: 1,
    plannerStrategy: "deterministic-campaign-creation-v1",
    planningTemplate: "campaign_creation-standard-pipeline-v1",
    graphVersion: 3,
    graphType: "dag",
    validationReport: { valid: true, issues: [], validatedAt: "2026-01-01T00:00:00.000Z" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const nodes = [{ id: "node-1", planningId: "planning-1", executionTaskId: "task-1", label: "Pesquisa de contexto", createdAt: "2026-01-01T00:00:00.000Z" }];
  const edges = [];

  const graph = projectExecutionGraph(planning, nodes, edges);
  assert.equal(graph.planningId, "planning-1");
  assert.equal(graph.graphVersion, 3, "graphVersion do grafo projetado vem sempre do Planning, nunca hardcoded");
  assert.equal(graph.graphType, "dag");
  assert.equal(graph.nodes, nodes, "projeção não deve clonar nem transformar — só monta o tipo composto");
  assert.equal(graph.edges, edges);
});
