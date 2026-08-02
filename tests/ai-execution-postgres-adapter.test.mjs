import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresAiExecutionRepository } from "../dist/infrastructure/storage/postgres/postgres-ai-execution-repository.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55530 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

test("Migrations: 0022 (ai_executions) e 0023 (proveniência de IA em briefing_field_values) aplicam sem erro", async () => {
  const status = await db.pool.query("select id from schema_migrations where id in ('0022_ai_executions', '0023_briefing_field_value_ai_provenance')");
  assert.equal(status.rows.length, 2);
});

test("PostgresAiExecutionRepository: create()/getById() — id fornecido pelo chamador (== traceId do Gateway), sem prompt/resposta persistidos", async () => {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const workspace = await workspaceRepo.create({ tenantId: "tenant-ai-1", name: "W" });
  const repo = new PostgresAiExecutionRepository(db.pool);

  const created = await repo.create({
    id: "ai-trace-fixed-1",
    tenantId: "tenant-ai-1",
    workspaceId: workspace.id,
    operation: "briefing_field_extraction",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    promptTemplateId: "briefing-field-extraction",
    promptVersion: 1,
    promptHash: "abc123",
    status: "succeeded",
    inputTokenCount: 120,
    outputTokenCount: 80,
    totalTokenCount: 200,
    estimatedCost: 0.0006,
    currency: "USD",
    latencyMs: 340,
    retryCount: 0,
    fallbackUsed: false,
    finishReason: "stop",
    traceId: "ai-trace-fixed-1",
    correlationId: "corr-1",
  });

  assert.equal(created.id, "ai-trace-fixed-1");
  assert.equal(created.currency, "USD");

  const found = await repo.getById("ai-trace-fixed-1");
  assert.ok(found);
  assert.equal(found.provider, "anthropic");
  assert.equal(found.promptHash, "abc123");
  const keys = Object.keys(found);
  assert.ok(!keys.some((key) => /prompt(?!TemplateId|Version|Hash)|response|apiKey/i.test(key)), "nenhum campo de prompt/resposta bruta persistido");
});

test("PostgresAiExecutionRepository: listByWorkspace filtra por tenant/workspace/operação/período", async () => {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const workspaceA = await workspaceRepo.create({ tenantId: "tenant-ai-2", name: "A" });
  const workspaceB = await workspaceRepo.create({ tenantId: "tenant-ai-2", name: "B" });
  const repo = new PostgresAiExecutionRepository(db.pool);

  const baseInput = (overrides) => ({
    tenantId: "tenant-ai-2",
    operation: "briefing_field_extraction",
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    promptTemplateId: "briefing-field-extraction",
    promptVersion: 1,
    promptHash: "abc123",
    status: "succeeded",
    inputTokenCount: 10,
    outputTokenCount: 10,
    totalTokenCount: 20,
    estimatedCost: 0.0001,
    currency: "USD",
    latencyMs: 100,
    retryCount: 0,
    fallbackUsed: false,
    traceId: nextId("trace"),
    correlationId: nextId("corr"),
    ...overrides,
  });

  await repo.create({ id: nextId("exec"), workspaceId: workspaceA.id, ...baseInput({}) });
  await repo.create({ id: nextId("exec"), workspaceId: workspaceB.id, ...baseInput({}) });

  const onlyA = await repo.listByWorkspace({ tenantId: "tenant-ai-2", workspaceId: workspaceA.id });
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0].workspaceId, workspaceA.id);
});
