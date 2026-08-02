import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-conversation-repository.js";
import { PostgresBriefingRepository } from "../dist/infrastructure/storage/postgres/postgres-briefing-repository.js";
import { PostgresPreparedCommandRepository } from "../dist/infrastructure/storage/postgres/postgres-prepared-command-repository.js";
import { PostgresPlanningRepository } from "../dist/infrastructure/storage/postgres/postgres-planning-repository.js";
import { PostgresExecutionTaskRepository } from "../dist/infrastructure/storage/postgres/postgres-execution-task-repository.js";
import { PostgresExecutionGraphRepository } from "../dist/infrastructure/storage/postgres/postgres-execution-graph-repository.js";
import { PostgresPlanningArtifactRepository } from "../dist/infrastructure/storage/postgres/postgres-planning-artifact-repository.js";
import { PostgresPlanningDecisionRepository } from "../dist/infrastructure/storage/postgres/postgres-planning-decision-repository.js";
import { createPlanningFromPreparedCommand } from "../dist/application/planning/planning-engine.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

const EMPTY_INPUT_CONTRACT = { version: 1, ports: [] };
const EMPTY_OUTPUT_CONTRACT = { version: 1, ports: [] };

before(async () => {
  db = await startTestPostgres({ port: 55560 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function seedPreparedCommand(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const conversationRepo = new PostgresConversationRepository(db.pool, { idGenerator: () => nextId("conversation") });
  const briefingRepo = new PostgresBriefingRepository(db.pool, { idGenerator: () => nextId("briefing") });
  const commandRepo = new PostgresPreparedCommandRepository(db.pool, { idGenerator: () => nextId("command") });

  const workspace = await workspaceRepo.create({ tenantId, name: "Workspace" });
  const conversation = await conversationRepo.create({ tenantId, workspaceId: workspace.id });
  const briefing = await briefingRepo.create({ tenantId, workspaceId: workspace.id, conversationId: conversation.id, type: "campaign_creation", schemaVersion: 1 });
  const command = await commandRepo.create({
    tenantId,
    workspaceId: workspace.id,
    conversationId: conversation.id,
    briefingId: briefing.id,
    briefingRevision: briefing.revision,
    type: "campaign_creation",
    intent: "create_campaign",
    validatedInputs: { channel: "instagram", contentFormat: "carousel" },
    sourceReferences: { channel: "user_message" },
    unresolvedOptionalFields: [],
  });
  return { workspace, conversation, briefing, command };
}

function makeEngineDeps() {
  return {
    planningRepository: new PostgresPlanningRepository(db.pool),
    executionTaskRepository: new PostgresExecutionTaskRepository(db.pool),
    executionGraphRepository: new PostgresExecutionGraphRepository(db.pool),
    artifactRepository: new PostgresPlanningArtifactRepository(db.pool),
    decisionRepository: new PostgresPlanningDecisionRepository(db.pool),
    idGenerator: () => nextId("planning-entity"),
  };
}

// ---------------------------------------------------------------------------------------------
// PostgresPlanningRepository — unicidade lógica em nível de banco (defesa em profundidade da
// decisão obrigatória 12, além da checagem `getByPreparedCommand` já feita pelo Planning Engine)
// ---------------------------------------------------------------------------------------------

test("PostgresPlanningRepository: unique index (prepared_command_id, prepared_command_revision) rejeita um segundo insert direto", async () => {
  const { command } = await seedPreparedCommand("tenant-planning-adapters-1");
  const repo = new PostgresPlanningRepository(db.pool);
  const input = {
    id: nextId("planning"),
    tenantId: "tenant-planning-adapters-1",
    workspaceId: command.workspaceId,
    conversationId: command.conversationId,
    briefingId: command.briefingId,
    preparedCommandId: command.id,
    preparedCommandRevision: command.briefingRevision,
    status: "ready",
    plannerVersion: 1,
    plannerStrategy: "deterministic-campaign-creation-v1",
    planningTemplate: "campaign_creation-standard-pipeline-v1",
    graphVersion: 1,
    graphType: "dag",
    validationReport: { valid: true, issues: [], validatedAt: "2026-01-01T00:00:00.000Z" },
  };

  await repo.create(input);
  await assert.rejects(() => repo.create({ ...input, id: nextId("planning") }), "o índice único deve rejeitar uma segunda linha para o mesmo par lógico");
});

test("PostgresPlanningRepository: getByPreparedCommand / getActiveByPreparedCommandId / updateStatus / listByWorkspace", async () => {
  const { command, workspace } = await seedPreparedCommand("tenant-planning-adapters-2");
  const repo = new PostgresPlanningRepository(db.pool);
  const created = await repo.create({
    id: nextId("planning"),
    tenantId: "tenant-planning-adapters-2",
    workspaceId: workspace.id,
    conversationId: command.conversationId,
    briefingId: command.briefingId,
    preparedCommandId: command.id,
    preparedCommandRevision: command.briefingRevision,
    status: "ready",
    plannerVersion: 1,
    plannerStrategy: "deterministic-campaign-creation-v1",
    planningTemplate: "campaign_creation-standard-pipeline-v1",
    graphVersion: 1,
    graphType: "dag",
    validationReport: { valid: true, issues: [], validatedAt: "2026-01-01T00:00:00.000Z" },
  });

  const byCommand = await repo.getByPreparedCommand(command.id, command.briefingRevision);
  assert.equal(byCommand.id, created.id);

  const active = await repo.getActiveByPreparedCommandId(command.id);
  assert.equal(active.id, created.id);

  const superseded = await repo.updateStatus(created.id, "superseded");
  assert.equal(superseded.status, "superseded");
  assert.ok(superseded.supersededAt);
  assert.equal(await repo.getActiveByPreparedCommandId(command.id), undefined, "depois de superseded não é mais 'ativo'");

  const listed = await repo.listByWorkspace({ tenantId: "tenant-planning-adapters-2", workspaceId: workspace.id });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);
});

// ---------------------------------------------------------------------------------------------
// PostgresExecutionGraphRepository — saveGraph transacional (decisão: nunca visível pela metade)
// ---------------------------------------------------------------------------------------------

test("PostgresExecutionGraphRepository: saveGraph grava nós+arestas atomicamente; uma aresta inválida (self-loop) reverte TUDO, inclusive os nós", async () => {
  const { command, workspace } = await seedPreparedCommand("tenant-planning-adapters-3");
  const planningRepo = new PostgresPlanningRepository(db.pool);
  const taskRepo = new PostgresExecutionTaskRepository(db.pool);
  const graphRepo = new PostgresExecutionGraphRepository(db.pool);

  const planning = await planningRepo.create({
    id: nextId("planning"),
    tenantId: "tenant-planning-adapters-3",
    workspaceId: workspace.id,
    conversationId: command.conversationId,
    briefingId: command.briefingId,
    preparedCommandId: command.id,
    preparedCommandRevision: command.briefingRevision,
    status: "ready",
    plannerVersion: 1,
    plannerStrategy: "deterministic-campaign-creation-v1",
    planningTemplate: "campaign_creation-standard-pipeline-v1",
    graphVersion: 1,
    graphType: "dag",
    validationReport: { valid: true, issues: [], validatedAt: "2026-01-01T00:00:00.000Z" },
  });

  const [task] = await taskRepo.createMany([
    { id: nextId("task"), planningId: planning.id, type: "research", name: "Pesquisa", description: "d", capability: "editorial_research", expectedArtifactType: "document", status: "planned", sequenceHint: 1, inputContract: EMPTY_INPUT_CONTRACT, outputContract: EMPTY_OUTPUT_CONTRACT },
  ]);
  const node = { id: nextId("node"), planningId: planning.id, executionTaskId: task.id, label: task.name };

  await assert.rejects(
    () => graphRepo.saveGraph(planning.id, [node], [{ id: nextId("edge"), planningId: planning.id, fromNodeId: node.id, toNodeId: node.id, kind: "depends_on" }]),
    "planning_edges_no_self_loop deve rejeitar a aresta",
  );

  const raw = await graphRepo.getGraph(planning.id);
  assert.deepEqual(raw.nodes, [], "o rollback da transação deve desfazer também o nó que tinha sido inserido antes da aresta inválida");
  assert.deepEqual(raw.edges, []);
});

test("PostgresExecutionGraphRepository + projectExecutionGraph: grafo salvo é fielmente reconstruído por projeção", async () => {
  const { command } = await seedPreparedCommand("tenant-planning-adapters-4");
  const deps = makeEngineDeps();
  const planning = await createPlanningFromPreparedCommand(deps, {
    id: command.id,
    tenantId: command.tenantId,
    workspaceId: command.workspaceId,
    conversationId: command.conversationId,
    briefingId: command.briefingId,
    briefingRevision: command.briefingRevision,
    type: command.type,
    intent: command.intent,
    validatedInputs: command.validatedInputs,
    sourceReferences: command.sourceReferences,
    unresolvedOptionalFields: command.unresolvedOptionalFields,
    status: command.status,
  });

  const tasks = await deps.executionTaskRepository.listByPlanning(planning.id);
  const raw = await deps.executionGraphRepository.getGraph(planning.id);
  assert.equal(raw.nodes.length, 6);
  assert.equal(raw.edges.length, 6);
  assert.equal(tasks.length, 6);

  const artifacts = await deps.artifactRepository.listByPlanning(planning.id);
  assert.equal(artifacts.length, 6);
  const decisions = await deps.decisionRepository.listByPlanning(planning.id);
  assert.equal(decisions.length, 3);
});

// ---------------------------------------------------------------------------------------------
// PostgresExecutionTaskRepository / PlanningArtifact / PlanningDecision — CRUD básico
// ---------------------------------------------------------------------------------------------

test("PostgresExecutionTaskRepository: listByPlanning ordena por sequence_hint (só sugestão visual, mas precisa vir consistente)", async () => {
  const { command, workspace } = await seedPreparedCommand("tenant-planning-adapters-5");
  const planningRepo = new PostgresPlanningRepository(db.pool);
  const taskRepo = new PostgresExecutionTaskRepository(db.pool);
  const planning = await planningRepo.create({
    id: nextId("planning"),
    tenantId: "tenant-planning-adapters-5",
    workspaceId: workspace.id,
    conversationId: command.conversationId,
    briefingId: command.briefingId,
    preparedCommandId: command.id,
    preparedCommandRevision: command.briefingRevision,
    status: "ready",
    plannerVersion: 1,
    plannerStrategy: "deterministic-campaign-creation-v1",
    planningTemplate: "campaign_creation-standard-pipeline-v1",
    graphVersion: 1,
    graphType: "dag",
    validationReport: { valid: true, issues: [], validatedAt: "2026-01-01T00:00:00.000Z" },
  });

  await taskRepo.createMany([
    { id: nextId("task"), planningId: planning.id, type: "publication", name: "Publicação", description: "d", capability: "distribution", expectedArtifactType: "document", status: "planned", sequenceHint: 5, inputContract: EMPTY_INPUT_CONTRACT, outputContract: EMPTY_OUTPUT_CONTRACT },
    { id: nextId("task"), planningId: planning.id, type: "research", name: "Pesquisa", description: "d", capability: "editorial_research", expectedArtifactType: "document", status: "planned", sequenceHint: 1, inputContract: EMPTY_INPUT_CONTRACT, outputContract: EMPTY_OUTPUT_CONTRACT },
  ]);

  const tasks = await taskRepo.listByPlanning(planning.id);
  assert.deepEqual(tasks.map((t) => t.type), ["research", "publication"]);
});

test("PostgresPlanningArtifactRepository / PostgresPlanningDecisionRepository: createMany + listByPlanning preservam contrato/campos array", async () => {
  const { command, workspace } = await seedPreparedCommand("tenant-planning-adapters-6");
  const planningRepo = new PostgresPlanningRepository(db.pool);
  const taskRepo = new PostgresExecutionTaskRepository(db.pool);
  const artifactRepo = new PostgresPlanningArtifactRepository(db.pool);
  const decisionRepo = new PostgresPlanningDecisionRepository(db.pool);

  const planning = await planningRepo.create({
    id: nextId("planning"),
    tenantId: "tenant-planning-adapters-6",
    workspaceId: workspace.id,
    conversationId: command.conversationId,
    briefingId: command.briefingId,
    preparedCommandId: command.id,
    preparedCommandRevision: command.briefingRevision,
    status: "ready",
    plannerVersion: 1,
    plannerStrategy: "deterministic-campaign-creation-v1",
    planningTemplate: "campaign_creation-standard-pipeline-v1",
    graphVersion: 1,
    graphType: "dag",
    validationReport: { valid: true, issues: [], validatedAt: "2026-01-01T00:00:00.000Z" },
  });
  const [task] = await taskRepo.createMany([
    { id: nextId("task"), planningId: planning.id, type: "research", name: "Pesquisa", description: "d", capability: "editorial_research", expectedArtifactType: "document", status: "planned", sequenceHint: 1, inputContract: EMPTY_INPUT_CONTRACT, outputContract: EMPTY_OUTPUT_CONTRACT },
  ]);

  const [artifact] = await artifactRepo.createMany([
    { id: nextId("artifact"), planningId: planning.id, executionTaskId: task.id, contract: { expectedType: "document", description: "Síntese", expectedFields: ["summary", "keyInsights"] }, status: "expected" },
  ]);
  assert.deepEqual(artifact.contract.expectedFields, ["summary", "keyInsights"]);

  const [decision] = await decisionRepo.createMany([
    { id: nextId("decision"), planningId: planning.id, decisionCode: "template_selected", reason: "motivo", relatedTaskIds: [task.id] },
  ]);
  assert.deepEqual(decision.relatedTaskIds, [task.id]);

  const artifacts = await artifactRepo.listByPlanning(planning.id);
  assert.equal(artifacts.length, 1);
  const decisions = await decisionRepo.listByPlanning(planning.id);
  assert.equal(decisions.length, 1);
});
