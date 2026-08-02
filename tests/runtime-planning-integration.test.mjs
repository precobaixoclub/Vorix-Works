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
import { PostgresRuntimeRepository } from "../dist/infrastructure/storage/postgres/postgres-runtime-repository.js";
import { createNotConnectedCompanyKnowledgeSource } from "../dist/infrastructure/briefing/not-connected-company-knowledge-source.js";
import { createAssetLibraryAssetMetadataSource } from "../dist/infrastructure/briefing/asset-library-asset-metadata-source.js";
import { PlanningEngineBriefingHook } from "../dist/infrastructure/planning/planning-engine-briefing-hook.js";
import { RuntimeEnginePlanningHook } from "../dist/infrastructure/runtime/runtime-engine-planning-hook.js";
import { createConversation, sendMessage } from "../dist/application/conversation/index.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Evidência do fluxo completo exigido pelo PROMPT 10: `Planning ready -> RuntimePlan criado
 * automaticamente -> contratos traduzidos -> bindings validados -> RuntimePlan validated -> todas
 * as RuntimeTasks prepared -> todos os RuntimeArtifacts expected -> nenhuma execução`, disparado
 * inteiramente pelo hook opcional adicionado a `planning-engine.ts` (decisão 5/6, sem alterar as
 * regras de Planning em si). Também cobre a decisão 9 (RuntimePlan superseded segue Planning
 * superseded) através do fluxo real de correção pós-confirmação.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55600 });
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

function makeRuntimeRepos() {
  return { runtimeRepository: new PostgresRuntimeRepository(db.pool) };
}

function makeDeps() {
  const workspaceRepository = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const assetLibraryRepository = new PostgresAssetLibraryRepository(db.pool);
  const planningRepos = makePlanningRepos();
  const runtimeRepos = makeRuntimeRepos();

  const runtimeEngineHook = new RuntimeEnginePlanningHook({
    runtimeRepository: runtimeRepos.runtimeRepository,
    executionTaskRepository: planningRepos.executionTaskRepository,
    executionGraphRepository: planningRepos.executionGraphRepository,
    artifactRepository: planningRepos.artifactRepository,
    idGenerator: () => nextId("runtime-entity"),
  });

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
    planningEngine: new PlanningEngineBriefingHook({ ...planningRepos, idGenerator: () => nextId("planning-entity"), runtimeEngine: runtimeEngineHook }),
    planningRepos,
    runtimeRepos,
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
// Evidência: Planning ready -> RuntimePlan validated -> RuntimeTasks prepared -> nenhuma execução
// ---------------------------------------------------------------------------------------------

test("Evidência de fluxo: confirmar o Briefing gera Planning ready E RuntimePlan validated automaticamente, com ZERO efeitos de execução", async () => {
  const { deps, conversation } = await setup("tenant-runtime-flow-1");
  const confirmed = await runToConfirmation(deps, "tenant-runtime-flow-1", conversation);
  assert.ok(confirmed.preparedCommandSummary);
  const preparedCommandId = confirmed.preparedCommandSummary.id;

  const planning = await deps.planningRepos.planningRepository.getByPreparedCommand(preparedCommandId, confirmed.preparedCommandSummary.briefingRevision);
  assert.equal(planning.status, "ready");

  const runtimePlan = await deps.runtimeRepos.runtimeRepository.getByPlanningId(planning.id);
  assert.ok(runtimePlan, "um RuntimePlan deve nascer automaticamente quando o Planning fica ready (decisão obrigatória 5), sem nenhum endpoint de criação");
  assert.equal(runtimePlan.status, "validated");
  assert.equal(runtimePlan.validationReport.valid, true);
  assert.equal(runtimePlan.sourceContext.planningId, planning.id);
  assert.equal(runtimePlan.sourceContext.preparedCommandId, preparedCommandId);
  assert.ok(runtimePlan.sourceGraphFingerprint);
  assert.ok(runtimePlan.runtimeFingerprint);

  const details = await deps.runtimeRepos.runtimeRepository.getDetails(runtimePlan.id);
  assert.equal(details.tasks.length, 6);
  for (const task of details.tasks) assert.equal(task.status, "prepared", "NENHUMA RuntimeTask pode estar em outro status — nada foi executado");
  assert.equal(details.artifacts.length, 6);
  for (const artifact of details.artifacts) assert.equal(artifact.status, "expected");
  assert.equal(details.bindings.length, 6);

  // Nunca conectamos Caio/Skill/AI Gateway — nenhum evento de execução real no log da conversa.
  const events = confirmed.events.map((e) => e.type);
  assert.ok(!events.includes("decision_made"));
  assert.ok(!events.includes("skill_executed"));
});

test("Nenhum RuntimePlan nasce antes do Planning ficar ready", async () => {
  const { deps, conversation } = await setup("tenant-runtime-flow-2");
  const send = (content) => sendMessage(deps, { tenantId: "tenant-runtime-flow-2", workspaceId: conversation.workspaceId, conversationId: conversation.id, content });

  await send("quero criar uma campanha para vender tênis novo");
  const listed = await deps.runtimeRepos.runtimeRepository.listByWorkspace({ tenantId: "tenant-runtime-flow-2", workspaceId: conversation.workspaceId });
  assert.deepEqual(listed, []);
});

// ---------------------------------------------------------------------------------------------
// Correção pós-confirmação: Planning superseded -> RuntimePlan superseded (decisão 9)
// ---------------------------------------------------------------------------------------------

test("Correção depois da confirmação: o RuntimePlan do Planning antigo fica superseded; um RuntimePlan NOVO nasce validated para o Planning da correção", async () => {
  const { deps, conversation } = await setup("tenant-runtime-flow-3");
  const send = (content) => sendMessage(deps, { tenantId: "tenant-runtime-flow-3", workspaceId: conversation.workspaceId, conversationId: conversation.id, content });

  const confirmed = await runToConfirmation(deps, "tenant-runtime-flow-3", conversation);
  const firstCommandId = confirmed.preparedCommandSummary.id;
  const firstPlanning = await deps.planningRepos.planningRepository.getByPreparedCommand(firstCommandId, confirmed.preparedCommandSummary.briefingRevision);
  const firstRuntime = await deps.runtimeRepos.runtimeRepository.getByPlanningId(firstPlanning.id);
  assert.equal(firstRuntime.status, "validated");

  await send("na verdade, corrigir o canal para facebook");
  const reconfirmed = await send("sim");
  assert.notEqual(reconfirmed.preparedCommandSummary.id, firstCommandId);

  const firstPlanningAfter = await deps.planningRepos.planningRepository.getById(firstPlanning.id);
  assert.equal(firstPlanningAfter.status, "superseded");
  const firstRuntimeAfter = await deps.runtimeRepos.runtimeRepository.getById(firstRuntime.id);
  assert.equal(firstRuntimeAfter.status, "superseded", "o RuntimePlan do Planning superado também deve virar superseded (decisão obrigatória 9)");

  const secondPlanning = await deps.planningRepos.planningRepository.getByPreparedCommand(reconfirmed.preparedCommandSummary.id, reconfirmed.preparedCommandSummary.briefingRevision);
  const secondRuntime = await deps.runtimeRepos.runtimeRepository.getByPlanningId(secondPlanning.id);
  assert.ok(secondRuntime, "a reconfirmação deve gerar um RuntimePlan novo para o Planning novo");
  assert.equal(secondRuntime.status, "validated");
  assert.notEqual(secondRuntime.id, firstRuntime.id);
});

test("planningEngine sem runtimeEngine wired reproduz o comportamento sem Runtime — nenhuma regressão quando o hook de Runtime não está plugado", async () => {
  const workspaceRepository = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const assetLibraryRepository = new PostgresAssetLibraryRepository(db.pool);
  const planningRepos = makePlanningRepos();
  const deps = {
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
  };

  const workspace = await deps.workspaceRepository.create({ tenantId: "tenant-runtime-flow-4", name: "Workspace" });
  const conversation = await createConversation(deps, { tenantId: "tenant-runtime-flow-4", workspaceId: workspace.id });
  const confirmed = await runToConfirmation(deps, "tenant-runtime-flow-4", conversation);
  assert.equal(confirmed.conversation.state, "resolved");
  assert.ok(confirmed.preparedCommandSummary, "confirmação continua funcionando normalmente sem o hook de Runtime");
});
