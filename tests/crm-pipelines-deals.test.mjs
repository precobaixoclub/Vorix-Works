import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import { PostgresDealRepository } from "../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import {
  createPipeline,
  createStage,
  ensureDefaultPipeline,
  mustPipelineBelongToTenantAndWorkspace,
} from "../dist/application/crm/pipeline-use-cases.js";
import {
  createDeal,
  getDealsSummary,
  getDealTimeline,
  listDeals,
  moveDealStage,
  mustDealBelongToTenantAndWorkspace,
  updateDeal,
} from "../dist/application/crm/deal-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * CRM/Comercial — Fase 2 (Pipelines/Etapas/Negócios/Kanban). Foco: (1) pipeline padrão é criado
 * sob demanda, uma única vez por workspace; (2) negócio só muda de etapa via `moveDealStage`
 * (nunca `updateDeal`), e perder exige motivo; (3) mover de volta a uma etapa aberta reabre o
 * negócio (limpa ganho/perda); (4) isolamento cross-tenant; (5) resumo por etapa para o Kanban.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55701 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

function pipelineDeps() {
  return { pipelineRepository: new PostgresPipelineRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool) };
}

function dealDeps() {
  return {
    dealRepository: new PostgresDealRepository(db.pool),
    pipelineStageRepository: new PostgresPipelineStageRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
  };
}

test("Migrations 0094-0095 aplicam sem erro; tabelas de pipeline/deal existem", async () => {
  for (const id of ["0094_crm_pipelines", "0095_crm_deals"]) {
    const status = await db.pool.query("select id from schema_migrations where id = $1", [id]);
    assert.equal(status.rows.length, 1, `migration ${id} deveria estar registrada`);
  }
});

test("Pipeline padrão: criado sob demanda com 6 etapas, idempotente", async () => {
  const tenantId = "tenant-pipeline-1";
  const workspace = await makeWorkspace(tenantId);
  const deps = pipelineDeps();

  const first = await ensureDefaultPipeline(deps, tenantId, workspace.id);
  assert.equal(first.pipeline.isDefault, true);
  assert.equal(first.stages.length, 6);
  assert.equal(first.stages.filter((s) => s.isWon).length, 1);
  assert.equal(first.stages.filter((s) => s.isLost).length, 1);

  const second = await ensureDefaultPipeline(deps, tenantId, workspace.id);
  assert.equal(second.pipeline.id, first.pipeline.id, "segunda chamada não deve criar outro pipeline padrão");

  const pipelines = await deps.pipelineRepository.listByWorkspace(tenantId, workspace.id);
  assert.equal(pipelines.filter((p) => p.isDefault).length, 1);
});

test("Pipeline: isolamento cross-tenant nunca vaza existência (404)", async () => {
  const tenantA = "tenant-pipeline-a";
  const tenantB = "tenant-pipeline-b";
  const workspaceA = await makeWorkspace(tenantA);
  const workspaceB = await makeWorkspace(tenantB);
  const deps = pipelineDeps();
  const pipeline = await createPipeline(deps, { tenantId: tenantA, workspaceId: workspaceA.id, name: "Só do Tenant A" });

  await assert.rejects(
    () => mustPipelineBelongToTenantAndWorkspace(deps, pipeline.id, tenantB, workspaceB.id),
    /PIPELINE_NOT_FOUND/,
  );
});

async function makePipelineWithStages(tenantId, workspaceId) {
  const deps = pipelineDeps();
  const pipeline = await createPipeline(deps, { tenantId, workspaceId, name: "Vendas" });
  const novo = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Novo", position: 0 });
  const negociacao = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Negociação", position: 1 });
  const ganho = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Ganho", position: 2, isWon: true });
  const perdido = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Perdido", position: 3, isLost: true });
  return { pipeline, novo, negociacao, ganho, perdido };
}

test("Negócio: criar exige que a etapa pertença ao pipeline informado", async () => {
  const tenantId = "tenant-deal-1";
  const workspace = await makeWorkspace(tenantId);
  const { pipeline, novo } = await makePipelineWithStages(tenantId, workspace.id);
  const otherPipelineDeps = pipelineDeps();
  const otherPipeline = await createPipeline(otherPipelineDeps, { tenantId, workspaceId: workspace.id, name: "Outro Pipeline" });

  await assert.rejects(
    () => createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: otherPipeline.id, stageId: novo.id, title: "Negócio Errado" }),
    /DEAL_STAGE_PIPELINE_MISMATCH/,
  );

  const deal = await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "Negócio Certo", valueCents: 10000 });
  assert.equal(deal.stageId, novo.id);
  assert.equal(deal.valueCents, 10000);

  const timeline = await getDealTimeline(dealDeps(), { dealId: deal.id, tenantId, workspaceId: workspace.id });
  assert.equal(timeline.some((event) => event.eventType === "deal_created"), true);
});

test("Negócio: mover para etapa de perda exige motivo; mover para etapa de ganho marca wonAt", async () => {
  const tenantId = "tenant-deal-2";
  const workspace = await makeWorkspace(tenantId);
  const { pipeline, novo, ganho, perdido } = await makePipelineWithStages(tenantId, workspace.id);
  const deal = await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "Negócio A" });

  await assert.rejects(
    () => moveDealStage(dealDeps(), { dealId: deal.id, tenantId, workspaceId: workspace.id, targetStageId: perdido.id }),
    /DEAL_LOSS_REASON_REQUIRED/,
  );

  const lost = await moveDealStage(dealDeps(), { dealId: deal.id, tenantId, workspaceId: workspace.id, targetStageId: perdido.id, lossReason: "Sem orçamento" });
  assert.equal(lost.stageId, perdido.id);
  assert.equal(lost.lossReason, "Sem orçamento");
  assert.ok(lost.lostAt);

  const won = await moveDealStage(dealDeps(), { dealId: deal.id, tenantId, workspaceId: workspace.id, targetStageId: ganho.id });
  assert.equal(won.stageId, ganho.id);
  assert.ok(won.wonAt);
  assert.equal(won.lossReason, undefined, "mover para Ganho limpa o motivo de perda anterior");
  assert.equal(won.lostAt, undefined);

  const timeline = await getDealTimeline(dealDeps(), { dealId: deal.id, tenantId, workspaceId: workspace.id });
  const stageChanges = timeline.filter((event) => event.eventType === "deal_stage_changed");
  assert.equal(stageChanges.length, 2);
});

test("Negócio: reabrir (mover de volta a etapa aberta) limpa ganho/perda", async () => {
  const tenantId = "tenant-deal-3";
  const workspace = await makeWorkspace(tenantId);
  const { pipeline, novo, negociacao, perdido } = await makePipelineWithStages(tenantId, workspace.id);
  const deal = await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "Negócio B" });

  await moveDealStage(dealDeps(), { dealId: deal.id, tenantId, workspaceId: workspace.id, targetStageId: perdido.id, lossReason: "Foi com concorrente" });
  const reopened = await moveDealStage(dealDeps(), { dealId: deal.id, tenantId, workspaceId: workspace.id, targetStageId: negociacao.id });
  assert.equal(reopened.stageId, negociacao.id);
  assert.equal(reopened.lossReason, undefined);
  assert.equal(reopened.lostAt, undefined);
});

test("Negócio: isolamento cross-tenant nunca vaza existência (404)", async () => {
  const tenantA = "tenant-deal-a";
  const tenantB = "tenant-deal-b";
  const workspaceA = await makeWorkspace(tenantA);
  const workspaceB = await makeWorkspace(tenantB);
  const { pipeline, novo } = await makePipelineWithStages(tenantA, workspaceA.id);
  const deal = await createDeal(dealDeps(), { tenantId: tenantA, workspaceId: workspaceA.id, pipelineId: pipeline.id, stageId: novo.id, title: "Só do Tenant A" });

  await assert.rejects(
    () => mustDealBelongToTenantAndWorkspace(dealDeps(), deal.id, tenantB, workspaceB.id),
    /DEAL_NOT_FOUND/,
  );
});

test("Negócio: updateDeal nunca muda a etapa (só moveDealStage pode)", async () => {
  const tenantId = "tenant-deal-4";
  const workspace = await makeWorkspace(tenantId);
  const { pipeline, novo } = await makePipelineWithStages(tenantId, workspace.id);
  const deal = await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "Original" });

  const updated = await updateDeal(dealDeps(), { dealId: deal.id, tenantId, workspaceId: workspace.id, patch: { title: "Renomeado", valueCents: 5000 } });
  assert.equal(updated.title, "Renomeado");
  assert.equal(updated.valueCents, 5000);
  assert.equal(updated.stageId, novo.id, "updateDeal não deve alterar stageId");
});

test("Negócios: listagem com filtro de responsável, e resumo por etapa (contagem + soma)", async () => {
  const tenantId = "tenant-deal-5";
  const workspace = await makeWorkspace(tenantId);
  const { pipeline, novo, negociacao } = await makePipelineWithStages(tenantId, workspace.id);

  await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "D1", valueCents: 1000, ownerUserId: "user-a" });
  await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "D2", valueCents: 2000, ownerUserId: "user-b" });
  await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: negociacao.id, title: "D3", valueCents: 4000, ownerUserId: "user-a" });

  const forUserA = await listDeals(dealDeps(), { tenantId, workspaceId: workspace.id, ownerUserId: "user-a" });
  assert.equal(forUserA.length, 2);

  const summary = await getDealsSummary(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id });
  const novoSummary = summary.find((s) => s.stageId === novo.id);
  const negociacaoSummary = summary.find((s) => s.stageId === negociacao.id);
  assert.equal(novoSummary.count, 2);
  assert.equal(novoSummary.valueCentsSum, 3000);
  assert.equal(negociacaoSummary.count, 1);
  assert.equal(negociacaoSummary.valueCentsSum, 4000);
});
