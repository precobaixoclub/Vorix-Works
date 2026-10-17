import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import { PostgresDealRepository } from "../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import { PostgresProductRepository } from "../dist/infrastructure/storage/postgres/postgres-product-repository.js";
import { PostgresTaskRepository } from "../dist/infrastructure/storage/postgres/postgres-task-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresProposalRepository } from "../dist/infrastructure/storage/postgres/postgres-proposal-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import { InMemoryNotificationRepository } from "../dist/infrastructure/storage/in-memory-notification-repository.js";
import {
  PostgresCommercialApprovalRepository,
  PostgresDealItemRepository,
  PostgresSalesCatalogRepository,
  PostgresSalesConfigRepository,
} from "../dist/infrastructure/storage/postgres/postgres-sales-engine-repositories.js";
import { PostgresSalesAnalyticsRepository, PostgresSalesGoalRepository } from "../dist/infrastructure/storage/postgres/postgres-sales-goal-repositories.js";
import { ensureDefaultPipeline } from "../dist/application/crm/pipeline-use-cases.js";
import { createDeal, updateDeal } from "../dist/application/crm/deal-use-cases.js";
import { addDealItem, loseDeal, updateDealCommercialTerms, winDeal } from "../dist/application/sales/deal-commercial-use-cases.js";
import {
  checkGoalsReached,
  getDealGoalImpact,
  getForecast,
  getPerformance,
  getSalesReports,
  getTeamPerformance,
  listGoals,
  upsertGoal,
} from "../dist/application/sales/sales-performance-use-cases.js";
import { normalizePeriodStart, paceAndProjection } from "../dist/domain/sales/goals.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** Sales Engine — fases 8–9: metas (usuário/equipe/empresa), realizado só com GANHAS (snapshot),
 * impacto da oportunidade na meta, forecast separado (realizado ≠ commit ≠ pipeline), visão de
 * equipe só para gestão, "meta atingida" uma única vez e relatórios agregados no backend. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-perf-${++counter}`;
const thisMonth = () => normalizePeriodStart("monthly", new Date().toISOString().slice(0, 10));

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function setup() {
  const tenantId = nextId("tenant");
  const workspace = await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }).create({ tenantId, name: "W" });
  const workspaceId = workspace.id;
  const notificationRepository = new InMemoryNotificationRepository();
  const membershipRepository = new PostgresTenantMembershipRepository(db.pool);
  const d = {
    dealRepository: new PostgresDealRepository(db.pool),
    pipelineRepository: new PostgresPipelineRepository(db.pool),
    pipelineStageRepository: new PostgresPipelineStageRepository(db.pool),
    productRepository: new PostgresProductRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
    dealItemRepository: new PostgresDealItemRepository(db.pool),
    salesCatalogRepository: new PostgresSalesCatalogRepository(db.pool),
    salesConfigRepository: new PostgresSalesConfigRepository(db.pool),
    approvalRepository: new PostgresCommercialApprovalRepository(db.pool),
    membershipRepository: {
      // Sem tabela de usuários reais no teste: membros fixos do tenant.
      getByUserAndTenant: async (userId, tenant) => members.find((member) => member.userId === userId && tenant === tenantId),
      listByTenant: async (tenant) => (tenant === tenantId ? members : []),
      listByUser: async () => [],
    },
    teamMembershipRepository: new PostgresTeamMembershipRepository(db.pool),
    taskRepository: new PostgresTaskRepository(db.pool),
    contactRepository: new PostgresContactRepository(db.pool),
    proposalRepository: new PostgresProposalRepository(db.pool),
    goalRepository: new PostgresSalesGoalRepository(db.pool),
    analyticsRepository: new PostgresSalesAnalyticsRepository(db.pool),
    notification: { notificationRepository },
  };
  void membershipRepository;
  const seller = { tenantId, userId: nextId("seller"), role: "editor" };
  const other = { tenantId, userId: nextId("seller2"), role: "editor" };
  const manager = { tenantId, userId: nextId("manager"), role: "admin" };
  const members = [seller, other, manager].map((actor) => ({ id: nextId("m"), userId: actor.userId, tenantId, role: actor.role }));
  const { pipeline, stages } = await ensureDefaultPipeline(d, tenantId, workspaceId);
  const dealFor = async (owner, valueCents, extra = {}) => {
    const deal = await createDeal(d, { tenantId, workspaceId, pipelineId: pipeline.id, stageId: stages[1].id, title: nextId("deal"), ownerUserId: owner.userId, ...extra });
    await updateDeal(d, { dealId: deal.id, tenantId, workspaceId, patch: { valueCents } });
    return deal;
  };
  return { d, tenantId, workspaceId, seller, other, manager, stages, dealFor, notificationRepository };
}

test("Realizado só conta GANHAS; impacto da oportunidade na meta (cenário 78/84)", async () => {
  const { d, workspaceId, seller, manager, dealFor } = await setup();
  await upsertGoal(d, manager, { workspaceId, scopeType: "user", scopeId: seller.userId, metric: "sales_revenue", periodType: "monthly", periodStart: thisMonth(), targetValue: 10_000_000 });
  const a = await dealFor(seller, 4_000_000);
  const b = await dealFor(seller, 2_845_000);
  await winDeal(d, seller, { workspaceId, dealId: a.id });
  await winDeal(d, seller, { workspaceId, dealId: b.id });
  const commit = await dealFor(seller, 1_200_000, { expectedCloseDate: new Date().toISOString().slice(0, 10) });
  await updateDealCommercialTerms(d, seller, { workspaceId, dealId: commit.id, forecastCategory: "commit" });

  const performance = await getPerformance(d, seller, { workspaceId });
  const goal = performance.goals[0];
  assert.equal(goal.progress.realizedValue, 6_845_000, "commit não entra como vendido");
  assert.equal(goal.progress.attainmentBp, 6845);
  assert.equal(goal.progress.remainingValue, 3_155_000);
  assert.equal(performance.forecast.wonCents, 6_845_000);
  assert.equal(performance.forecast.commitCents, 1_200_000);
  assert.equal(performance.won.count, 2);
  assert.equal(performance.won.averageTicketCents, 3_422_500);

  const impact = await getDealGoalImpact(d, seller, { workspaceId, dealId: commit.id });
  assert.equal(impact.available, true);
  assert.equal(impact.afterCloseCents, 8_045_000);
  assert.equal(impact.afterCloseAttainmentBp, 8045);
  assert.equal(impact.dealShareOfGoalBp, 1200);
});

test("Vendedor não vê performance alheia nem altera meta; gestão vê equipe", async () => {
  const { d, workspaceId, seller, other, manager, dealFor } = await setup();
  await assert.rejects(getPerformance(d, seller, { workspaceId, userId: other.userId }), /SALES_REPORT_FORBIDDEN/);
  await assert.rejects(upsertGoal(d, seller, { workspaceId, scopeType: "user", scopeId: seller.userId, metric: "sales_revenue", periodType: "monthly", periodStart: thisMonth(), targetValue: 1 }), /SALES_REPORT_FORBIDDEN/);
  await assert.rejects(getTeamPerformance(d, seller, { workspaceId }), /SALES_REPORT_FORBIDDEN/);
  const won = await dealFor(other, 500_000);
  await winDeal(d, other, { workspaceId, dealId: won.id });
  const team = await getTeamPerformance(d, manager, { workspaceId });
  const row = team.sellers.find((item) => item.userId === other.userId);
  assert.equal(row.soldCents, 500_000);
  assert.equal(team.team.won.revenueCents, 500_000);
  assert.equal(team.sellers[0].userId, other.userId, "ordenado por vendido");
});

test("Crédito é do responsável no momento do ganho, mesmo após transferência", async () => {
  const { d, tenantId, workspaceId, seller, other, manager, dealFor } = await setup();
  const deal = await dealFor(seller, 300_000);
  await winDeal(d, seller, { workspaceId, dealId: deal.id });
  await updateDeal(d, { dealId: deal.id, tenantId, workspaceId, patch: { ownerUserId: other.userId } });
  assert.equal((await getPerformance(d, manager, { workspaceId, userId: seller.userId })).won.revenueCents, 300_000);
  assert.equal((await getPerformance(d, manager, { workspaceId, userId: other.userId })).won.revenueCents, 0);
});

test("Meta atingida notifica uma única vez", async () => {
  const { d, workspaceId, seller, manager, dealFor, notificationRepository } = await setup();
  await upsertGoal(d, manager, { workspaceId, scopeType: "user", scopeId: seller.userId, metric: "won_opportunities", periodType: "monthly", periodStart: thisMonth(), targetValue: 1 });
  const first = await dealFor(seller, 100_000);
  const won = await winDeal(d, seller, { workspaceId, dealId: first.id });
  await checkGoalsReached(d, won);
  await checkGoalsReached(d, won);
  const second = await dealFor(seller, 100_000);
  await checkGoalsReached(d, await winDeal(d, seller, { workspaceId, dealId: second.id }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const notes = await notificationRepository.listActive({ tenantId: seller.tenantId, workspaceId, userId: seller.userId, limit: 50 });
  assert.equal(notes.filter((note) => note.sourceType === "sales_goal_reached").length, 1);
});

test("Metas sazonais por mês e meta anual com ritmo e projeção", async () => {
  const { d, workspaceId, manager, seller } = await setup();
  const year = new Date().getUTCFullYear();
  await upsertGoal(d, manager, { workspaceId, scopeType: "company", metric: "sales_revenue", periodType: "monthly", periodStart: `${year}-01-15`, targetValue: 8_000_000 });
  await upsertGoal(d, manager, { workspaceId, scopeType: "company", metric: "sales_revenue", periodType: "monthly", periodStart: `${year}-03-01`, targetValue: 12_000_000 });
  await upsertGoal(d, manager, { workspaceId, scopeType: "company", metric: "sales_revenue", periodType: "annual", periodStart: `${year}-06-01`, targetValue: 120_000_000 });
  const goals = await listGoals(d, seller, { workspaceId, year });
  assert.deepEqual(goals.map((goal) => `${goal.periodType}:${goal.periodStart}:${goal.targetValue}`).sort(), [`annual:${year}-01-01:120000000`, `monthly:${year}-01-01:8000000`, `monthly:${year}-03-01:12000000`].sort());
  const pace = paceAndProjection("annual", `${year}-01-01`, 120_000_000, 30_000_000, new Date(Date.UTC(year, 3, 1)));
  assert.equal(pace.totalMonths, 12);
  assert.ok(pace.projectedValue > 30_000_000);
  assert.equal(pace.requiredPerRemainingMonth, 10_000_000);
});

test("Forecast trimestral separa ganho, commit, best case e pipeline ponderado", async () => {
  const { d, workspaceId, seller, dealFor } = await setup();
  const today = new Date().toISOString().slice(0, 10);
  const best = await dealFor(seller, 400_000, { expectedCloseDate: today });
  await updateDealCommercialTerms(d, seller, { workspaceId, dealId: best.id, forecastCategory: "best_case", probability: 50 });
  await dealFor(seller, 1_000_000, { expectedCloseDate: today });
  const forecast = await getForecast(d, seller, { workspaceId, periodType: "quarterly" });
  assert.equal(forecast.months.length, 3);
  assert.equal(forecast.totals.bestCaseCents, 400_000);
  assert.equal(forecast.totals.pipelineCents, 1_000_000);
  assert.equal(forecast.totals.wonCents, 0);
  assert.ok(forecast.totals.weightedCents >= 200_000 && forecast.totals.weightedCents < 1_400_000);
});

test("Relatórios: produtos, perdas por motivo e conversão; margem só para autorizados", async () => {
  const { d, tenantId, workspaceId, seller, manager, dealFor } = await setup();
  const product = await d.productRepository.create({ tenantId, workspaceId, name: "Consultoria", priceCents: 50_000, costCents: 20_000 });
  const won = await dealFor(seller, 0);
  await addDealItem(d, seller, { workspaceId, dealId: won.id, productId: product.id, quantity: 3 });
  await winDeal(d, seller, { workspaceId, dealId: won.id });
  const lost = await dealFor(seller, 80_000);
  await addDealItem(d, seller, { workspaceId, dealId: lost.id, productId: product.id, quantity: 1 });
  await loseDeal(d, seller, { workspaceId, dealId: lost.id, lossReason: "Preço" });
  const today = new Date().toISOString();
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const report = await getSalesReports(d, manager, { workspaceId, from: yesterday, to: tomorrow });
  void today;
  const row = report.products.find((item) => item.productId === product.id);
  assert.equal(row.quantity, 3);
  assert.equal(row.revenueCents, 150_000);
  assert.equal(row.grossMarginBp, 6000);
  assert.equal(row.conversionBp, 5000);
  assert.deepEqual(report.losses.byReason, [{ reason: "Preço", count: 1 }]);
  assert.equal(report.conversion.conversionBp, 5000);
  assert.equal(report.margin.grossMarginBp, 6000);
  const sellerReport = await getSalesReports(d, seller, { workspaceId, from: yesterday, to: tomorrow });
  assert.equal(sellerReport.margin.grossMarginBp, 6000, "margem liberada para vendedor por padrão");
  await d.salesConfigRepository.upsertSettings({ tenantId, workspaceId, sellersCanViewMargin: false });
  assert.equal((await getSalesReports(d, seller, { workspaceId, from: yesterday, to: tomorrow })).margin, undefined);
});

test("Isolamento: metas e relatórios de outro tenant nunca aparecem", async () => {
  const a = await setup();
  const b = await setup();
  await upsertGoal(a.d, a.manager, { workspaceId: a.workspaceId, scopeType: "company", metric: "sales_revenue", periodType: "monthly", periodStart: thisMonth(), targetValue: 100 });
  const won = await a.dealFor(a.seller, 1_000);
  await winDeal(a.d, a.seller, { workspaceId: a.workspaceId, dealId: won.id });
  assert.equal((await listGoals(b.d, b.manager, { workspaceId: b.workspaceId })).length, 0);
  assert.equal((await getPerformance(b.d, b.manager, { workspaceId: b.workspaceId })).won.revenueCents, 0);
  assert.equal((await getPerformance(b.d, b.manager, { workspaceId: a.workspaceId })).won.revenueCents, 0, "workspace de outro tenant não vaza");
});
