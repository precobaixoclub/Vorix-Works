import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import { PostgresDealRepository } from "../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresTeamRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import { registerDealsRoutes } from "../dist/interfaces/api/routes/v1/deals.route.js";
import { registerErrorHandler } from "../dist/interfaces/api/http/error-handler.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import {
  createPipeline,
  createStage,
  ensureDefaultPipeline,
  mustPipelineBelongToTenantAndWorkspace,
  reorderStages,
  updateStage,
  deleteStage,
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
import { registerPipelinesRoutes } from "../dist/interfaces/api/routes/v1/pipelines.route.js";

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

async function openSummaryFixture() {
  const tenantId = nextId("summary-tenant");
  const workspace = await makeWorkspace(tenantId);
  const { pipeline, stages } = await ensureDefaultPipeline(pipelineDeps(), tenantId, workspace.id);
  const contact = await new PostgresContactRepository(db.pool).create({ tenantId, workspaceId: workspace.id, name: "Cliente com oportunidades" });
  const team = await new PostgresTeamRepository(db.pool).create({ tenantId, workspaceId: workspace.id, name: "Equipe de vendas" });
  const repository = dealDeps().dealRepository;
  const base = { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: stages[0].id, contactId: contact.id, title: "Oportunidade", ownerUserId: "seller-a" };
  return { tenantId, workspace, contact, team, repository, base };
}

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

test("Fases personalizadas: renomear, reordenar atomicamente e rejeitar lista incompleta ou de outro tenant", async () => {
  const tenantId = nextId("custom-pipeline-tenant");
  const workspace = await makeWorkspace(tenantId);
  const deps = pipelineDeps();
  const { pipeline, stages } = await ensureDefaultPipeline(deps, tenantId, workspace.id);
  const input = { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id };
  await updateStage(deps, { ...input, stageId: stages[0].id, patch: { name: "Aguardando retorno" } });
  const ids = [...stages.filter(s => !s.isWon && !s.isLost).reverse(), ...stages.filter(s => s.isWon || s.isLost)].map(s => s.id);
  await reorderStages(deps, { ...input, stageIds: ids });
  assert.deepEqual((await deps.pipelineStageRepository.listByPipeline(pipeline.id)).map((stage) => stage.id), ids);
  assert.equal((await deps.pipelineStageRepository.getById(stages[0].id)).name, "Aguardando retorno");
  for (const invalid of [ids.slice(1), [...ids.slice(0, -1), ids[0]], [...ids.slice(0, -1), "foreign-stage"]]) {
    await assert.rejects(() => reorderStages(deps, { ...input, stageIds: invalid }), /PIPELINE_STAGE_INVALID/);
  }
  assert.deepEqual((await deps.pipelineStageRepository.listByPipeline(pipeline.id)).map((stage) => stage.id), ids);
  await assert.rejects(() => reorderStages(deps, { ...input, tenantId: "other-tenant", stageIds: ids }), /PIPELINE_NOT_FOUND/);
  const app = Fastify();
  registerErrorHandler(app);
  app.addHook("onRequest", async request => { request.zunoContext = { principal: { tenantId, userId: "admin", role: "owner" } }; });
  await registerPipelinesRoutes(app, deps);
  try {
    const response = await app.inject({ method: "POST", url: `/pipelines/${pipeline.id}/stages/reorder`, payload: { workspaceId: workspace.id, stageIds: [...ids.slice(0, -2).reverse(), ...ids.slice(-2)] } });
    assert.equal(response.statusCode, 204, response.body);
    const invalid = await app.inject({ method: "POST", url: `/pipelines/${pipeline.id}/stages/reorder`, payload: { workspaceId: workspace.id, stageIds: ids.slice(1) } });
    assert.equal(invalid.statusCode, 400, invalid.body);
  } finally { await app.close(); }
});

test("Excluir fase preserva oportunidades e mantém ao menos uma fase", async () => {
  const tenantId = nextId("delete-pipeline-tenant");
  const workspace = await makeWorkspace(tenantId);
  const deps = pipelineDeps();
  const pipeline = await createPipeline(deps, { tenantId, workspaceId: workspace.id, name: "Funil personalizado" });
  const input = { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id };
  const initial = await deps.pipelineStageRepository.listByPipeline(pipeline.id);
  for (const stage of initial.filter(s => !s.isWon && !s.isLost).slice(1)) await deleteStage(deps, { ...input, stageId: stage.id });
  const first = initial[0];
  await assert.rejects(() => deleteStage(deps, { ...input, stageId: first.id }), /PIPELINE_STAGE_INVALID/);
  const second = await createStage(deps, { ...input, name: "Retorno", position: 1 });
  await createDeal(dealDeps(), { ...input, stageId: first.id, title: "Preservar" });
  await assert.rejects(() => deleteStage(deps, { ...input, stageId: first.id }), (error) => ["23503", "23001"].includes(error.code));
  await deleteStage(deps, { ...input, stageId: second.id });
  assert.equal((await deps.pipelineStageRepository.listByPipeline(pipeline.id)).length, 3);
});

test("Fases sistêmicas: protegidas, únicas e sempre depois das fases configuráveis", async () => {
  const tenantId = nextId("system-stages");
  const workspace = await makeWorkspace(tenantId);
  const deps = pipelineDeps();
  const pipeline = await createPipeline(deps, { tenantId, workspaceId: workspace.id, name: "Novo funil" });
  const scope = { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id };
  const initial = await deps.pipelineStageRepository.listByPipeline(pipeline.id);
  const won = initial.find(s => s.isWon), lost = initial.find(s => s.isLost);
  for (const stage of [won, lost]) {
    await assert.rejects(deleteStage(deps, { ...scope, stageId: stage.id }), /PIPELINE_STAGE_INVALID/);
    await assert.rejects(updateStage(deps, { ...scope, stageId: stage.id, patch: { isWon: false, isLost: false } }), /PIPELINE_STAGE_INVALID/);
  }
  await assert.rejects(createStage(deps, { ...scope, name: "Outra ganha", position: 0, isWon: true }), /PIPELINE_STAGE_INVALID/);
  await updateStage(deps, { ...scope, stageId: won.id, patch: { name: "Venda realizada" } });
  const custom = await createStage(deps, { ...scope, name: "Contrato", position: 999 });
  const stages = await deps.pipelineStageRepository.listByPipeline(pipeline.id);
  assert.deepEqual(stages.slice(-3).map(s => s.id), [custom.id, won.id, lost.id]);
  assert.equal(stages.at(-2).isWon, true);
  await assert.rejects(reorderStages(deps, { ...scope, stageIds: [...stages].reverse().map(s => s.id) }), /PIPELINE_STAGE_INVALID/);
});

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
  const ganho = (await deps.pipelineStageRepository.listByPipeline(pipeline.id)).find(stage => stage.isWon);
  const perdido = (await deps.pipelineStageRepository.listByPipeline(pipeline.id)).find(stage => stage.isLost);
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


test("Resumo por contato soma todas as abertas, em pipelines diferentes e sem truncar em 200", async () => {
  const { tenantId, workspace, contact, team, repository, base } = await openSummaryFixture();
  await db.pool.query(
    `insert into deals (id, tenant_id, workspace_id, pipeline_id, stage_id, contact_id, title, value_cents, currency, owner_user_id)
     select $1 || '-' || n, $2, $3, $4, $5, $6, 'Em aberto', 100, 'BRL', 'seller-a' from generate_series(1, 205) n`,
    [nextId("many-deals"), tenantId, workspace.id, base.pipelineId, base.stageId, contact.id],
  );
  const secondPipeline = await createPipeline(pipelineDeps(), { tenantId, workspaceId: workspace.id, name: "Outro pipeline" });
  const secondStage = await createStage(pipelineDeps(), { pipelineId: secondPipeline.id, tenantId, workspaceId: workspace.id, name: "Novo", position: 0 });
  await repository.create({ ...base, pipelineId: secondPipeline.id, stageId: secondStage.id, ownerUserId: "seller-b", valueCents: 500, teamId: team.id });
  await repository.create({ ...base, valueCents: 300, currency: "USD" });
  await repository.create({ ...base, contactId: undefined, valueCents: 999999 });
  for (const status of ["won", "lost", "cancelled"]) {
    const closed = await repository.create({ ...base, valueCents: 999999 });
    await db.pool.query("update deals set status = $2 where id = $1", [closed.id, status]);
  }
  assert.deepEqual(await repository.summarizeOpenByContact({ tenantId, workspaceId: workspace.id }), [
    { contactId: contact.id, currency: "BRL", count: 206, valueCentsSum: 21000 },
    { contactId: contact.id, currency: "USD", count: 1, valueCentsSum: 300 },
  ]);
  assert.deepEqual(await repository.summarizeOpenByContact({ tenantId: "outro-tenant", workspaceId: workspace.id }), []);
  const anotherWorkspace = await makeWorkspace(tenantId);
  assert.deepEqual(await repository.summarizeOpenByContact({ tenantId, workspaceId: anotherWorkspace.id }), []);
  assert.deepEqual(await repository.summarizeOpenByContact({ tenantId, workspaceId: workspace.id, ownerUserIdsIn: [] }), []);
  const own = await repository.summarizeOpenByContact({ tenantId, workspaceId: workspace.id, ownerUserIdsIn: ["seller-a"] });
  assert.equal(own[0].count, 205);
  const teamSummary = await repository.summarizeOpenByContact({ tenantId, workspaceId: workspace.id, ownerUserIdsIn: ["seller-a"], teamIdsIn: [team.id] });
  assert.equal(teamSummary[0].count, 206);
});

test("API do resumo aplica a visibilidade do vendedor e deriva o tenant da sessao", async (t) => {
  const { tenantId, workspace, contact, team, repository, base } = await openSummaryFixture();
  await repository.create({ ...base, valueCents: 1000 });
  await repository.create({ ...base, ownerUserId: "seller-b", teamId: team.id, valueCents: 2000 });
  let visibility = "own";
  let principal = { tenantId, userId: "seller-a", role: "editor", sessionId: "s" };
  const app = Fastify();
  registerErrorHandler(app);
  app.decorateRequest("zunoContext", null);
  app.addHook("onRequest", async request => { request.zunoContext = { principal }; });
  await registerDealsRoutes(app, { ...dealDeps(), sales: {
    salesConfigRepository: { getSettings: async () => ({ tenantId, dealVisibility: visibility }) },
    teamMembershipRepository: { listByUser: async () => [{ teamId: team.id }], listByTeam: async () => [] },
  } });
  t.after(() => app.close());
  const url = `/deals/open-by-contact?workspaceId=${workspace.id}&tenantId=forged`;
  const own = await app.inject(url);
  assert.equal(own.statusCode, 200);
  assert.deepEqual(own.json().data, [{ contactId: contact.id, currency: "BRL", count: 1, valueCentsSum: 1000 }]);
  visibility = "team";
  principal = { ...principal, permissions: ["deal:read", "deal:view_team"] };
  assert.equal((await app.inject(url)).json().data[0].valueCentsSum, 3000);
  principal = { ...principal, role: "owner", permissions: undefined };
  visibility = "own";
  assert.equal((await app.inject(url)).json().data[0].count, 2);
  principal = { ...principal, tenantId: "other-tenant" };
  assert.deepEqual((await app.inject(url)).json().data, []);
  principal = undefined;
  assert.equal((await app.inject(url)).statusCode, 401);
});
