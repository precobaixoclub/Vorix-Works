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
import { PostgresRuntimeRepository } from "../dist/infrastructure/storage/postgres/postgres-runtime-repository.js";
import { createPlanningFromPreparedCommand } from "../dist/application/planning/planning-engine.js";
import { ensureRuntimeForPlanning } from "../dist/application/runtime/runtime-engine.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55590 });
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

async function seedReadyPlanning(tenantId) {
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

  const planningRepos = makePlanningRepos();
  const planning = await createPlanningFromPreparedCommand({ ...planningRepos, idGenerator: () => nextId("planning-entity") }, command);
  return { workspace, conversation, briefing, command, planning, planningRepos };
}

// ---------------------------------------------------------------------------------------------
// Unicidade lógica em nível de banco — decisão obrigatória 7
// ---------------------------------------------------------------------------------------------

test("PostgresRuntimeRepository: unique index (planning_id) rejeita um segundo insert direto para o mesmo Planning", async () => {
  const { planning } = await seedReadyPlanning("tenant-runtime-adapters-1");
  const repo = new PostgresRuntimeRepository(db.pool);
  const basePlan = {
    id: nextId("runtime"),
    sourceContext: { tenantId: "tenant-runtime-adapters-1", workspaceId: planning.workspaceId, conversationId: planning.conversationId, briefingId: planning.briefingId, preparedCommandId: planning.preparedCommandId, planningId: planning.id },
    status: "validated",
    runtimeSchemaVersion: 1,
    translatorVersion: 1,
    translatorStrategy: "deterministic-port-binding-v1",
    translationTemplate: "campaign_creation-standard-pipeline-v1",
    sourceGraphFingerprint: "fingerprint-1",
    runtimeFingerprint: "fingerprint-2",
    validationReport: { valid: true, issues: [], validatedAt: "2026-01-01T00:00:00.000Z" },
  };

  await repo.persist({ plan: basePlan, tasks: [], inputs: [], outputs: [], bindings: [], artifacts: [], issues: [] });
  await assert.rejects(
    () => repo.persist({ plan: { ...basePlan, id: nextId("runtime") }, tasks: [], inputs: [], outputs: [], bindings: [], artifacts: [], issues: [] }),
    "o índice único deve rejeitar uma segunda linha para o mesmo planning_id",
  );
});

// ---------------------------------------------------------------------------------------------
// Transacionalidade — decisões obrigatórias 30/31/32
// ---------------------------------------------------------------------------------------------

test("PostgresRuntimeRepository: persist grava RuntimePlan + TODOS os filhos atomicamente (caminho validado)", async () => {
  const { planning, planningRepos } = await seedReadyPlanning("tenant-runtime-adapters-2");
  const runtimeRepository = new PostgresRuntimeRepository(db.pool);
  const runtimeDeps = { ...planningRepos, runtimeRepository, idGenerator: () => nextId("runtime-entity") };

  const runtimePlan = await ensureRuntimeForPlanning(runtimeDeps, planning);
  assert.equal(runtimePlan.status, "validated");

  const details = await runtimeRepository.getDetails(runtimePlan.id);
  assert.equal(details.tasks.length, 6);
  assert.equal(details.inputs.length, 6);
  assert.equal(details.outputs.length, 6);
  assert.equal(details.bindings.length, 6);
  assert.equal(details.artifacts.length, 6);
  assert.deepEqual(details.issues, []);
});

test("PostgresRuntimeRepository: uma escrita que viola uma constraint no meio da transação reverte TUDO — nem o RuntimePlan fica gravado", async () => {
  const { planning } = await seedReadyPlanning("tenant-runtime-adapters-3");
  const repo = new PostgresRuntimeRepository(db.pool);
  const runtimePlanId = nextId("runtime");
  const taskId = nextId("runtime-task");

  const plan = {
    id: runtimePlanId,
    sourceContext: { tenantId: "tenant-runtime-adapters-3", workspaceId: planning.workspaceId, conversationId: planning.conversationId, briefingId: planning.briefingId, preparedCommandId: planning.preparedCommandId, planningId: planning.id },
    status: "validated",
    runtimeSchemaVersion: 1,
    translatorVersion: 1,
    translatorStrategy: "deterministic-port-binding-v1",
    translationTemplate: "campaign_creation-standard-pipeline-v1",
    sourceGraphFingerprint: "fp-source",
    runtimeFingerprint: "fp-runtime",
    validationReport: { valid: true, issues: [], validatedAt: "2026-01-01T00:00:00.000Z" },
  };

  await assert.rejects(() =>
    repo.persist({
      plan,
      tasks: [{ id: taskId, runtimePlanId, executionTaskId: "execution-task-inexistente", type: "research", capability: "editorial_research", status: "prepared" }],
      inputs: [],
      outputs: [],
      bindings: [],
      // artefato referenciando uma runtime_task que NUNCA existiu -> viola FK, deve estourar DEPOIS de tasks já terem sido inseridas na mesma transação.
      artifacts: [{ id: nextId("runtime-artifact"), runtimePlanId, runtimeTaskId: "runtime-task-inexistente", schema: { artifactType: "document", description: "d", expectedFields: [] }, status: "expected" }],
      issues: [],
    }),
  );

  const found = await repo.getById(runtimePlanId);
  assert.equal(found, undefined, "o RuntimePlan não pode existir se a transação reverteu — mesmo tendo sido o primeiro insert");
});

// ---------------------------------------------------------------------------------------------
// Leitura — getById / getByPlanningId / updateStatus / listByWorkspace
// ---------------------------------------------------------------------------------------------

test("PostgresRuntimeRepository: getByPlanningId / updateStatus / listByWorkspace", async () => {
  const { planning, planningRepos, workspace } = await seedReadyPlanning("tenant-runtime-adapters-4");
  const runtimeRepository = new PostgresRuntimeRepository(db.pool);
  const runtimeDeps = { ...planningRepos, runtimeRepository, idGenerator: () => nextId("runtime-entity") };

  const runtimePlan = await ensureRuntimeForPlanning(runtimeDeps, planning);

  const byPlanningId = await runtimeRepository.getByPlanningId(planning.id);
  assert.equal(byPlanningId.id, runtimePlan.id);

  const superseded = await runtimeRepository.updateStatus(runtimePlan.id, "superseded");
  assert.equal(superseded.status, "superseded");
  assert.ok(superseded.supersededAt);

  const listed = await runtimeRepository.listByWorkspace({ tenantId: "tenant-runtime-adapters-4", workspaceId: workspace.id });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, runtimePlan.id);

  const listedByPlanning = await runtimeRepository.listByWorkspace({ tenantId: "tenant-runtime-adapters-4", workspaceId: workspace.id, planningId: planning.id });
  assert.equal(listedByPlanning.length, 1);
});
