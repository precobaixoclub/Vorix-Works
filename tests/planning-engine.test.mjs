import { test } from "node:test";
import assert from "node:assert/strict";

import { createPlanningFromPreparedCommand, supersedePlanningForPreparedCommand } from "../dist/application/planning/planning-engine.js";
import { InMemoryPlanningRepository } from "../dist/infrastructure/storage/in-memory-planning-repository.js";
import { InMemoryExecutionTaskRepository } from "../dist/infrastructure/storage/in-memory-execution-task-repository.js";
import { InMemoryExecutionGraphRepository } from "../dist/infrastructure/storage/in-memory-execution-graph-repository.js";
import { InMemoryPlanningArtifactRepository } from "../dist/infrastructure/storage/in-memory-planning-artifact-repository.js";
import { InMemoryPlanningDecisionRepository } from "../dist/infrastructure/storage/in-memory-planning-decision-repository.js";

/**
 * Planning Engine — Sprint 09 (Fase 3), decisões obrigatórias 12/23. Testado com os adapters em
 * memória (mesmo padrão de `ai-gateway-orchestration.test.mjs`): rápido, sem I/O real, cobre a
 * lógica de orquestração pura (idempotência, gate de validação, propagação de superseded).
 */

function makeDeps() {
  let counter = 0;
  return {
    planningRepository: new InMemoryPlanningRepository(),
    executionTaskRepository: new InMemoryExecutionTaskRepository(),
    executionGraphRepository: new InMemoryExecutionGraphRepository(),
    artifactRepository: new InMemoryPlanningArtifactRepository(),
    decisionRepository: new InMemoryPlanningDecisionRepository(),
    idGenerator: () => `id-${++counter}`,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  };
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

// ---------------------------------------------------------------------------------------------
// Idempotência — decisão obrigatória 12
// ---------------------------------------------------------------------------------------------

test("createPlanningFromPreparedCommand: chamado duas vezes para o MESMO (preparedCommandId, revision) devolve o MESMO Planning, nunca duplica", async () => {
  const deps = makeDeps();
  const first = await createPlanningFromPreparedCommand(deps, preparedCommand());
  const second = await createPlanningFromPreparedCommand(deps, preparedCommand());
  assert.equal(first.id, second.id);

  const allTasks = await deps.executionTaskRepository.listByPlanning(first.id);
  assert.equal(allTasks.length, 6, "a segunda chamada não pode ter duplicado as tarefas");
});

test("createPlanningFromPreparedCommand: revisões diferentes do MESMO PreparedCommand produzem Plannings distintos", async () => {
  const deps = makeDeps();
  const first = await createPlanningFromPreparedCommand(deps, preparedCommand({ briefingRevision: 1 }));
  const second = await createPlanningFromPreparedCommand(deps, preparedCommand({ briefingRevision: 2 }));
  assert.notEqual(first.id, second.id);
});

// A garantia de unicidade sob CONCORRÊNCIA real (duas chamadas simultâneas) depende do índice
// único do Postgres — o adapter em memória não tem compare-and-swap, então "getByPreparedCommand
// -> create" não é atômico aqui (mesma limitação, de propósito, de qualquer repositório em
// memória deste projeto). Essa garantia está coberta contra o Postgres real em
// `planning-adapters.test.mjs` ("unique index ... rejeita um segundo insert direto").

// ---------------------------------------------------------------------------------------------
// Gate de validação — decisão obrigatória 23 (ValidationReport roda ANTES do grafo)
// ---------------------------------------------------------------------------------------------

test("PreparedCommand inválido (tipo sem template) -> Planning nasce 'failed', SEM tarefas/grafo/artefatos/decisões", async () => {
  const deps = makeDeps();
  const planning = await createPlanningFromPreparedCommand(deps, preparedCommand({ type: "knowledge_query" }));

  assert.equal(planning.status, "failed");
  assert.equal(planning.validationReport.valid, false);
  assert.equal(planning.planningTemplate, "none");

  assert.deepEqual(await deps.executionTaskRepository.listByPlanning(planning.id), []);
  assert.deepEqual((await deps.executionGraphRepository.getGraph(planning.id)).nodes, []);
  assert.deepEqual(await deps.artifactRepository.listByPlanning(planning.id), []);
  assert.deepEqual(await deps.decisionRepository.listByPlanning(planning.id), []);
});

test("PreparedCommand válido com só warning (sem channel) -> Planning fica 'ready' normalmente, com todas as tarefas", async () => {
  const deps = makeDeps();
  const planning = await createPlanningFromPreparedCommand(deps, preparedCommand({ validatedInputs: {} }));

  assert.equal(planning.status, "ready");
  assert.equal(planning.validationReport.valid, true);
  assert.ok(planning.validationReport.issues.some((i) => i.code === "missing_channel_hint"));

  const tasks = await deps.executionTaskRepository.listByPlanning(planning.id);
  assert.equal(tasks.length, 6, "warning nunca deve impedir a montagem do grafo");
});

test("PreparedCommand válido -> grafo persistido é consistente: mesmo número de nós que tarefas, arestas referenciando nós válidos", async () => {
  const deps = makeDeps();
  const planning = await createPlanningFromPreparedCommand(deps, preparedCommand());

  const tasks = await deps.executionTaskRepository.listByPlanning(planning.id);
  const raw = await deps.executionGraphRepository.getGraph(planning.id);
  assert.equal(raw.nodes.length, tasks.length);

  const nodeIds = new Set(raw.nodes.map((n) => n.id));
  for (const edge of raw.edges) {
    assert.ok(nodeIds.has(edge.fromNodeId));
    assert.ok(nodeIds.has(edge.toNodeId));
  }

  const artifacts = await deps.artifactRepository.listByPlanning(planning.id);
  assert.equal(artifacts.length, tasks.length, "cada tarefa tem exatamente um artefato esperado");

  const decisions = await deps.decisionRepository.listByPlanning(planning.id);
  assert.equal(decisions.length, 3);
});

// ---------------------------------------------------------------------------------------------
// Superseded — decisão obrigatória 11 (Planning superseded segue PreparedCommand superseded)
// ---------------------------------------------------------------------------------------------

test("supersedePlanningForPreparedCommand: marca o Planning ativo como superseded", async () => {
  const deps = makeDeps();
  const planning = await createPlanningFromPreparedCommand(deps, preparedCommand());
  assert.equal(planning.status, "ready");

  await supersedePlanningForPreparedCommand(deps, "command-1");

  const after = await deps.planningRepository.getById(planning.id);
  assert.equal(after.status, "superseded");
  assert.ok(after.supersededAt);
});

test("supersedePlanningForPreparedCommand: sem Planning ativo para o comando -> não faz nada, nunca lança", async () => {
  const deps = makeDeps();
  await assert.doesNotReject(() => supersedePlanningForPreparedCommand(deps, "command-inexistente"));
});

test("supersedePlanningForPreparedCommand: chamado duas vezes seguidas é seguro (idempotente)", async () => {
  const deps = makeDeps();
  const planning = await createPlanningFromPreparedCommand(deps, preparedCommand());
  await supersedePlanningForPreparedCommand(deps, "command-1");
  await assert.doesNotReject(() => supersedePlanningForPreparedCommand(deps, "command-1"));
  const after = await deps.planningRepository.getById(planning.id);
  assert.equal(after.status, "superseded");
});
