import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresAssetLibraryRepository } from "../dist/infrastructure/storage/postgres/postgres-asset-library-repository.js";
import { PostgresConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-conversation-repository.js";
import { PostgresConversationEventRepository } from "../dist/infrastructure/storage/postgres/postgres-conversation-event-repository.js";
import { PostgresConversationMemoryRepository } from "../dist/infrastructure/storage/postgres/postgres-conversation-memory-repository.js";
import { PostgresBriefingRepository } from "../dist/infrastructure/storage/postgres/postgres-briefing-repository.js";
import { PostgresBriefingFieldValueRepository } from "../dist/infrastructure/storage/postgres/postgres-briefing-field-value-repository.js";
import { PostgresBriefingQuestionRepository } from "../dist/infrastructure/storage/postgres/postgres-briefing-question-repository.js";
import { PostgresPreparedCommandRepository } from "../dist/infrastructure/storage/postgres/postgres-prepared-command-repository.js";
import { PostgresPlanningRepository } from "../dist/infrastructure/storage/postgres/postgres-planning-repository.js";
import { PostgresExecutionTaskRepository } from "../dist/infrastructure/storage/postgres/postgres-execution-task-repository.js";
import { PostgresExecutionGraphRepository } from "../dist/infrastructure/storage/postgres/postgres-execution-graph-repository.js";
import { PostgresPlanningArtifactRepository } from "../dist/infrastructure/storage/postgres/postgres-planning-artifact-repository.js";
import { PostgresPlanningDecisionRepository } from "../dist/infrastructure/storage/postgres/postgres-planning-decision-repository.js";
import { createNotConnectedCompanyKnowledgeSource } from "../dist/infrastructure/briefing/not-connected-company-knowledge-source.js";
import { createAssetLibraryAssetMetadataSource } from "../dist/infrastructure/briefing/asset-library-asset-metadata-source.js";
import { PlanningEngineBriefingHook } from "../dist/infrastructure/planning/planning-engine-briefing-hook.js";
import { projectExecutionGraph, topologicalSort } from "../dist/domain/planning/graph-projection.js";
import { createConversation, sendMessage } from "../dist/application/conversation/index.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Evidência do fluxo completo exigido pelo PROMPT 09: `PreparedCommand -> Planning ->
 * ExecutionGraph -> nenhuma execução`, disparado inteiramente pelo hook opcional adicionado a
 * `briefing-use-cases.ts` (decisão 10, sem alterar as regras de Briefing/Conversation em si —
 * decisões 36/37). Também cobre a decisão 11 (Planning superseded segue PreparedCommand
 * superseded) através do fluxo real de correção pós-confirmação, já coberto para Briefing em
 * `briefing-conversation-flow.test.mjs`.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55570 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function makePlanningRepos() {
  return {
    planningRepository: new PostgresPlanningRepository(db.pool),
    executionTaskRepository: new PostgresExecutionTaskRepository(db.pool),
    executionGraphRepository: new PostgresExecutionGraphRepository(db.pool),
    artifactRepository: new PostgresPlanningArtifactRepository(db.pool),
    decisionRepository: new PostgresPlanningDecisionRepository(db.pool),
  };
}

function makeDeps() {
  const workspaceRepository = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const assetLibraryRepository = new PostgresAssetLibraryRepository(db.pool);
  const planningRepos = makePlanningRepos();
  return {
    workspaceRepository,
    conversationRepository: new PostgresConversationRepository(db.pool, { idGenerator: () => nextId("conversation") }),
    eventRepository: new PostgresConversationEventRepository(db.pool, { idGenerator: () => nextId("event") }),
    memoryRepository: new PostgresConversationMemoryRepository(db.pool),
    briefingRepository: new PostgresBriefingRepository(db.pool, { idGenerator: () => nextId("briefing") }),
    fieldValueRepository: new PostgresBriefingFieldValueRepository(db.pool, { idGenerator: () => nextId("briefing-value") }),
    questionRepository: new PostgresBriefingQuestionRepository(db.pool, { idGenerator: () => nextId("briefing-question") }),
    preparedCommandRepository: new PostgresPreparedCommandRepository(db.pool, { idGenerator: () => nextId("prepared-command") }),
    companyKnowledgeSource: createNotConnectedCompanyKnowledgeSource(),
    assetMetadataSource: createAssetLibraryAssetMetadataSource(workspaceRepository, assetLibraryRepository),
    planningEngine: new PlanningEngineBriefingHook({ ...planningRepos, idGenerator: () => nextId("planning-entity") }),
    planningRepos,
  };
}

async function setup(tenantId) {
  const deps = makeDeps();
  const workspace = await deps.workspaceRepository.create({ tenantId, name: "Workspace" });
  const conversation = await createConversation(deps, { tenantId, workspaceId: workspace.id });
  return { deps, workspace, conversation };
}

async function runToConfirmation(deps, tenantId, conversation) {
  const send = (content) => sendMessage(deps, { tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id, content });
  await send("quero criar uma campanha para vender tênis novo");
  await send("tênis de corrida modelo Speed X");
  await send("instagram");
  await send("jovens de 18 a 25 anos, praticantes de corrida");
  await send("carrossel");
  return send("sim");
}

// ---------------------------------------------------------------------------------------------
// Evidência: PreparedCommand -> Planning -> ExecutionGraph -> nenhuma execução
// ---------------------------------------------------------------------------------------------

test("Evidência de fluxo: confirmar o Briefing gera automaticamente um Planning 'ready' com ExecutionGraph válido e ZERO efeitos de execução", async () => {
  const { deps, conversation } = await setup("tenant-planning-flow-1");
  const confirmed = await runToConfirmation(deps, "tenant-planning-flow-1", conversation);
  assert.ok(confirmed.preparedCommandSummary, "PreparedCommand deve existir depois da confirmação");
  const preparedCommandId = confirmed.preparedCommandSummary.id;

  const planning = await deps.planningRepos.planningRepository.getByPreparedCommand(preparedCommandId, confirmed.preparedCommandSummary.briefingRevision);
  assert.ok(planning, "um Planning deve nascer automaticamente ao confirmar o Briefing (decisão obrigatória 10), sem nenhum endpoint de criação");
  assert.equal(planning.status, "ready");
  assert.equal(planning.preparedCommandId, preparedCommandId);
  assert.equal(planning.planningTemplate, "campaign_creation-standard-pipeline-v1");

  const tasks = await deps.planningRepos.executionTaskRepository.listByPlanning(planning.id);
  assert.equal(tasks.length, 6);
  for (const task of tasks) assert.equal(task.status, "planned", "NENHUMA tarefa pode estar em outro status — nada foi executado");

  const raw = await deps.planningRepos.executionGraphRepository.getGraph(planning.id);
  const graph = projectExecutionGraph(planning, raw.nodes, raw.edges);
  const sorted = topologicalSort(graph);
  assert.equal(sorted.ok, true, "o grafo persistido deve continuar sendo um DAG válido");
  assert.equal(sorted.orderedNodeIds.length, 6);

  // Nunca conectamos Caio/Skill — nenhum evento de execução real no log da conversa.
  const events = confirmed.events.map((e) => e.type);
  assert.ok(!events.includes("decision_made"));
  assert.ok(!events.includes("skill_executed"));
});

test("Nenhum Planning nasce antes da confirmação — só depois que existe um PreparedCommand", async () => {
  const { deps, conversation } = await setup("tenant-planning-flow-2");
  const send = (content) => sendMessage(deps, { tenantId: "tenant-planning-flow-2", workspaceId: conversation.workspaceId, conversationId: conversation.id, content });

  await send("quero criar uma campanha para vender tênis novo");
  const listedBefore = await deps.planningRepos.planningRepository.listByWorkspace({ tenantId: "tenant-planning-flow-2", workspaceId: conversation.workspaceId });
  assert.deepEqual(listedBefore, [], "nenhum Planning deve existir enquanto o Briefing ainda está sendo coletado");
});

// ---------------------------------------------------------------------------------------------
// Correção pós-confirmação: PreparedCommand superseded -> Planning superseded (decisão 11)
// ---------------------------------------------------------------------------------------------

test("Correção depois da confirmação: o Planning do PreparedCommand antigo fica superseded; um Planning NOVO nasce para o PreparedCommand da correção", async () => {
  const { deps, conversation } = await setup("tenant-planning-flow-3");
  const send = (content) => sendMessage(deps, { tenantId: "tenant-planning-flow-3", workspaceId: conversation.workspaceId, conversationId: conversation.id, content });

  const confirmed = await runToConfirmation(deps, "tenant-planning-flow-3", conversation);
  const firstCommandId = confirmed.preparedCommandSummary.id;
  const firstPlanning = await deps.planningRepos.planningRepository.getByPreparedCommand(firstCommandId, confirmed.preparedCommandSummary.briefingRevision);
  assert.equal(firstPlanning.status, "ready");

  await send("na verdade, corrigir o canal para facebook");
  const reconfirmed = await send("sim");
  assert.notEqual(reconfirmed.preparedCommandSummary.id, firstCommandId);

  const firstPlanningAfter = await deps.planningRepos.planningRepository.getById(firstPlanning.id);
  assert.equal(firstPlanningAfter.status, "superseded", "o Planning do PreparedCommand superado também deve virar superseded (decisão obrigatória 11)");

  const secondPlanning = await deps.planningRepos.planningRepository.getByPreparedCommand(reconfirmed.preparedCommandSummary.id, reconfirmed.preparedCommandSummary.briefingRevision);
  assert.ok(secondPlanning, "a reconfirmação deve gerar um Planning novo para o PreparedCommand novo");
  assert.equal(secondPlanning.status, "ready");
  assert.notEqual(secondPlanning.id, firstPlanning.id);
});

test("planningEngine ausente (undefined) reproduz o comportamento da Sprint 07/08 exatamente — nenhuma regressão quando o hook não está plugado", async () => {
  const deps = makeDeps();
  deps.planningEngine = undefined;
  const workspace = await deps.workspaceRepository.create({ tenantId: "tenant-planning-flow-4", name: "Workspace" });
  const conversation = await createConversation(deps, { tenantId: "tenant-planning-flow-4", workspaceId: workspace.id });

  const confirmed = await runToConfirmation(deps, "tenant-planning-flow-4", conversation);
  assert.equal(confirmed.conversation.state, "resolved");
  assert.ok(confirmed.preparedCommandSummary, "confirmação continua funcionando normalmente sem o hook de Planning");
});
