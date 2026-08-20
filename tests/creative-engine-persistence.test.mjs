import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresCreativeEngineRunRepository } from "../dist/infrastructure/storage/postgres/postgres-creative-engine-run-repository.js";
import { PostgresIcaroCostLedger } from "../dist/infrastructure/telemetry/postgres-icaro-cost-ledger.js";
import { PostgresIcaroLogger } from "../dist/infrastructure/telemetry/postgres-icaro-logger.js";
import { InMemoryCreativeEngineRunRepository } from "../dist/infrastructure/storage/in-memory-creative-engine-run-repository.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55640 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

test("Migrations: 0060 (creative_engine_runs), 0061 (provenance), 0062 (icaro_ai_calls) e 0063 (icaro_ai_call_errors) aplicam sem erro", async () => {
  const status = await db.pool.query(
    "select id from schema_migrations where id in ('0060_creative_engine_runs', '0061_creative_engine_provenance', '0062_icaro_ai_calls', '0063_icaro_ai_call_errors')",
  );
  assert.equal(status.rows.length, 4);
});

test("0061: colunas aditivas existem em content_generation_history/execution_runs/execution_task_runs", async () => {
  const columns = await db.pool.query(
    `select table_name, column_name from information_schema.columns
     where (table_name = 'content_generation_history' and column_name in ('engine_mode', 'creative_engine_run_id', 'description'))
        or (table_name = 'execution_runs' and column_name = 'creative_engine')
        or (table_name = 'execution_task_runs' and column_name = 'creative_engine')`,
  );
  assert.equal(columns.rows.length, 5);
});

/** Cadeia mínima de FKs (workspace → conversation → briefing → prepared_command → planning →
 * runtime_plan → execution_run) construída via SQL bruto — mesmo espírito do fixture de
 * `PostgresWorkspaceRepository` em `ai-execution-postgres-adapter.test.mjs`, só que um nível mais
 * fundo porque `creative_engine_runs`/`execution_runs` exige a cadeia inteira. */
async function createExecutionRunFixture(pool, { tenantId, workspaceId }) {
  const conversationId = nextId("conv");
  const briefingId = nextId("briefing");
  const preparedCommandId = nextId("cmd");
  const planningId = nextId("planning");
  const runtimePlanId = nextId("runtime");
  const executionRunId = nextId("exec-run");

  await pool.query(
    `insert into conversations (id, tenant_id, workspace_id, status, state, created_at, updated_at)
     values ($1, $2, $3, 'active', 'idle', now(), now())`,
    [conversationId, tenantId, workspaceId],
  );
  await pool.query(
    `insert into briefings (id, tenant_id, workspace_id, conversation_id, schema_type, status, schema_version, created_at, updated_at)
     values ($1, $2, $3, $4, 'content_request', 'ready', 1, now(), now())`,
    [briefingId, tenantId, workspaceId, conversationId],
  );
  await pool.query(
    `insert into prepared_commands (id, tenant_id, workspace_id, conversation_id, briefing_id, briefing_revision, schema_type, intent, validated_inputs, source_references, status, created_at)
     values ($1, $2, $3, $4, $5, 1, 'content_request', 'generate_visual', '{}'::jsonb, '{}'::jsonb, 'prepared', now())`,
    [preparedCommandId, tenantId, workspaceId, conversationId, briefingId],
  );
  await pool.query(
    `insert into planning (id, tenant_id, workspace_id, conversation_id, briefing_id, prepared_command_id, prepared_command_revision, status, planner_version, planner_strategy, planning_template, graph_version, graph_type, validation_report, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, 1, 'ready', 1, 'arthur-deterministic-v1', 'content_request-gpt-creative-v3', 1, 'dag', '{}'::jsonb, now(), now())`,
    [planningId, tenantId, workspaceId, conversationId, briefingId, preparedCommandId],
  );
  await pool.query(
    `insert into runtime_plans (id, tenant_id, workspace_id, conversation_id, briefing_id, prepared_command_id, planning_id, status, runtime_schema_version, translator_version, translator_strategy, translation_template, source_graph_fingerprint, validation_report, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'validated', 1, 1, 'caio-deterministic-v1', 'content_request-gpt-creative-v3', 'fingerprint-1', '{}'::jsonb, now(), now())`,
    [runtimePlanId, tenantId, workspaceId, conversationId, briefingId, preparedCommandId, planningId],
  );
  await pool.query(
    `insert into execution_runs (id, runtime_plan_id, planning_id, tenant_id, workspace_id, state, mode, idempotency_key, source_graph_fingerprint, runtime_fingerprint, created_at, updated_at)
     values ($1, $2, $3, $4, $5, 'completed', 'real', $6, 'fingerprint-1', 'fingerprint-1', now(), now())`,
    [executionRunId, runtimePlanId, planningId, tenantId, workspaceId, nextId("idem")],
  );

  return { executionRunId };
}

test("PostgresCreativeEngineRunRepository: create()/getByExecutionRunId() — creative_context/creative_plan completos, publishable nasce coerente com o input", async () => {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const workspace = await workspaceRepo.create({ tenantId: "tenant-cer-1", name: "W" });
  const { executionRunId } = await createExecutionRunFixture(db.pool, { tenantId: "tenant-cer-1", workspaceId: workspace.id });

  const repo = new PostgresCreativeEngineRunRepository(db.pool);
  const creativeContext = { brandName: "Preço Baixo Club", objective: "vendas", confirmedFacts: ["Preço atual: R$ 39,99"] };
  const creativePlan = { headline: "Ofertas imperdíveis", cta: "Confira agora" };

  const created = await repo.create({
    id: nextId("cer"),
    tenantId: "tenant-cer-1",
    workspaceId: workspace.id,
    executionRunId,
    engineMode: "gpt",
    planningTemplate: "content_request-gpt-creative-v3",
    directorModel: "gpt-4o",
    imageModel: "gpt-image-1",
    generationMethod: "edit",
    creativeContext,
    creativePlan,
    finalImagePrompt: "Crie uma peça 4:5 para Preço Baixo Club...",
    assetsUsed: [{ role: "logo", url: "https://example.com/logo.png" }],
    compositionSteps: [{ step: "logo_overlay", ok: true, detail: "logo real colada" }],
    qualityGate: { verdict: "pass", issues: [] },
    repairRounds: [],
    finalImageUrl: "https://example.com/final.jpg",
    finalImageWidth: 1080,
    finalImageHeight: 1350,
    publishable: true,
    estimatedCostUsd: 0.084,
    latencyMs: 18234,
    status: "completed",
  });

  assert.equal(created.engineMode, "gpt");
  assert.equal(created.publishable, true);
  assert.deepEqual(created.creativeContext, creativeContext);
  assert.deepEqual(created.creativePlan, creativePlan);

  const found = await repo.getByExecutionRunId(executionRunId);
  assert.ok(found);
  assert.equal(found.directorModel, "gpt-4o");
  assert.equal(found.estimatedCostUsd, 0.084);
  assert.deepEqual(found.assetsUsed, [{ role: "logo", url: "https://example.com/logo.png" }]);
});

test("PostgresCreativeEngineRunRepository: uma execução falha ainda grava uma linha, com publishable=false", async () => {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const workspace = await workspaceRepo.create({ tenantId: "tenant-cer-2", name: "W" });
  const { executionRunId } = await createExecutionRunFixture(db.pool, { tenantId: "tenant-cer-2", workspaceId: workspace.id });

  const repo = new PostgresCreativeEngineRunRepository(db.pool);
  const created = await repo.create({
    id: nextId("cer"),
    tenantId: "tenant-cer-2",
    workspaceId: workspace.id,
    executionRunId,
    engineMode: "gpt",
    planningTemplate: "content_request-gpt-creative-v3",
    directorModel: "gpt-4o",
    creativeContext: { brandName: "Tênis RV" },
    assetsUsed: [],
    compositionSteps: [],
    repairRounds: [],
    publishable: false,
    estimatedCostUsd: 0.02,
    latencyMs: 4200,
    status: "failed",
    errorCode: "CREATIVE_QUALITY_GATE_NOT_PASSED",
  });

  assert.equal(created.status, "failed");
  assert.equal(created.publishable, false);
  assert.equal(created.errorCode, "CREATIVE_QUALITY_GATE_NOT_PASSED");
});

test("PostgresCreativeEngineRunRepository: listByWorkspace filtra por engineMode", async () => {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const workspace = await workspaceRepo.create({ tenantId: "tenant-cer-3", name: "W" });
  const repo = new PostgresCreativeEngineRunRepository(db.pool);

  const gptRun = await createExecutionRunFixture(db.pool, { tenantId: "tenant-cer-3", workspaceId: workspace.id });
  const legacyRun = await createExecutionRunFixture(db.pool, { tenantId: "tenant-cer-3", workspaceId: workspace.id });

  const baseInput = (overrides) => ({
    tenantId: "tenant-cer-3",
    workspaceId: workspace.id,
    planningTemplate: "content_request-gpt-creative-v3",
    directorModel: "gpt-4o",
    creativeContext: {},
    assetsUsed: [],
    compositionSteps: [],
    repairRounds: [],
    publishable: true,
    estimatedCostUsd: 0.01,
    latencyMs: 100,
    status: "completed",
    ...overrides,
  });

  await repo.create({ id: nextId("cer"), executionRunId: gptRun.executionRunId, engineMode: "gpt", ...baseInput({}) });
  await repo.create({ id: nextId("cer"), executionRunId: legacyRun.executionRunId, engineMode: "legacy", ...baseInput({}) });

  const onlyGpt = await repo.listByWorkspace({ workspaceId: workspace.id, engineMode: "gpt" });
  assert.equal(onlyGpt.length, 1);
  assert.equal(onlyGpt[0].engineMode, "gpt");

  const all = await repo.listByWorkspace({ workspaceId: workspace.id });
  assert.equal(all.length, 2);
});

test("PostgresIcaroCostLedger: record() grava uma linha em icaro_ai_calls com modelo/custo/latência/hash do prompt, nunca o prompt em si", async () => {
  const ledger = new PostgresIcaroCostLedger(db.pool, { brain: "creative" });

  await ledger.record({
    id: nextId("ai-cost"),
    occurredAt: new Date().toISOString(),
    specialistId: "gpt-creative-director",
    taskType: "analysis",
    providerId: "openai-creative-image",
    modelId: "gpt-4o",
    executionId: "exec-run-xyz",
    taskId: "task-xyz",
    correlationId: "corr-xyz",
    durationMs: 2140,
    tokens: { input: 800, output: 300, total: 1100 },
    cost: { estimated: 0.012, currency: "USD" },
    status: "completed",
    promptHash: "abc123hash",
    promptChars: 4820,
    retryCount: 1,
    fallbackUsed: true,
  });

  const found = await db.pool.query("select * from icaro_ai_calls where execution_run_id = $1", ["exec-run-xyz"]);
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0].brain, "creative");
  assert.equal(found.rows[0].model_id, "gpt-4o");
  assert.equal(found.rows[0].prompt_hash, "abc123hash");
  assert.equal(Number(found.rows[0].estimated_cost), 0.012);
  assert.equal(found.rows[0].duration_ms, 2140);
  assert.equal(found.rows[0].retry_count, 1);
  assert.equal(found.rows[0].fallback_used, true);
  const columns = Object.keys(found.rows[0]);
  assert.ok(!columns.some((key) => /prompt$|content|response/i.test(key)), "nenhuma coluna de prompt/resposta bruta");
});

test("PostgresIcaroLogger: persiste Timeout/Error com a mensagem real, mas ignora as ações 'de trajeto'", async () => {
  const logger = new PostgresIcaroLogger(db.pool, { brain: "creative" });

  await logger.record({
    id: nextId("icaro-log"),
    occurredAt: new Date().toISOString(),
    action: "AIRequestReceived",
    message: "Ícaro recebeu uma solicitação de IA.",
    specialistId: "gpt-creative-director",
  });
  await logger.record({
    id: nextId("icaro-log"),
    occurredAt: new Date().toISOString(),
    action: "Timeout",
    message: "Timeout após 45000ms no Provider openai-creative-image.",
    specialistId: "gpt-creative-director",
    executionId: "exec-run-timeout-1",
    providerId: "openai-creative-image",
    modelId: "gpt-image-1",
    attempt: 1,
  });

  const errors = await db.pool.query("select * from icaro_ai_call_errors where execution_run_id = $1", ["exec-run-timeout-1"]);
  assert.equal(errors.rows.length, 1);
  assert.equal(errors.rows[0].action, "Timeout");
  assert.match(errors.rows[0].message, /Timeout após 45000ms/);
  assert.equal(errors.rows[0].brain, "creative");

  const allRows = await db.pool.query("select count(*)::int as count from icaro_ai_call_errors");
  assert.equal(allRows.rows[0].count, 1, "AIRequestReceived não deve gerar linha — só Timeout/Error");
});

test("InMemoryCreativeEngineRunRepository: create()/getByExecutionRunId()/listByWorkspace equivalentes ao adapter Postgres", async () => {
  const repo = new InMemoryCreativeEngineRunRepository({ now: () => new Date("2026-01-01T00:00:00.000Z") });
  const input = {
    id: "cer-mem-1",
    tenantId: "t1",
    workspaceId: "w1",
    executionRunId: "exec-mem-1",
    engineMode: "gpt",
    planningTemplate: "content_request-gpt-creative-v3",
    directorModel: "gpt-4o",
    creativeContext: { brandName: "X" },
    assetsUsed: [],
    compositionSteps: [],
    repairRounds: [],
    publishable: true,
    estimatedCostUsd: 0.05,
    latencyMs: 900,
    status: "completed",
  };
  const created = await repo.create(input);
  assert.equal(created.createdAt, "2026-01-01T00:00:00.000Z");

  const found = await repo.getByExecutionRunId("exec-mem-1");
  assert.ok(found);
  assert.equal(found.id, "cer-mem-1");

  const listed = await repo.listByWorkspace({ workspaceId: "w1" });
  assert.equal(listed.length, 1);
  assert.equal(await repo.getByExecutionRunId("nope"), undefined);
});
