import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import { PostgresDealRepository } from "../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import { PostgresProductRepository } from "../dist/infrastructure/storage/postgres/postgres-product-repository.js";
import { PostgresTaskRepository } from "../dist/infrastructure/storage/postgres/postgres-task-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import {
  PostgresCommercialApprovalRepository,
  PostgresDealItemRepository,
  PostgresSalesCatalogRepository,
  PostgresSalesConfigRepository,
} from "../dist/infrastructure/storage/postgres/postgres-sales-engine-repositories.js";
import { ensureDefaultPipeline } from "../dist/application/crm/pipeline-use-cases.js";
import { createDeal, moveDealStage, updateDeal, listDeals } from "../dist/application/crm/deal-use-cases.js";
import { computeCommercialTotals, evaluateCommercialTerms, priceLine } from "../dist/domain/sales/pricing.js";
import {
  addDealItem,
  assertTermsApproved,
  decideCommercialApproval,
  getDealCommercialSummary,
  itemsToPricingLines,
  loseDeal,
  reopenDeal,
  requestCommercialApproval,
  updateDealCommercialTerms,
  updateDealItem,
  winDeal,
  correctDealClosure,
} from "../dist/application/sales/deal-commercial-use-cases.js";
import { resolveProductPricing } from "../dist/application/sales/catalog-use-cases.js";
import { listCloseReasons, createCloseReason, updateCloseReason, deleteCloseReason, reorderCloseReasons, updateCommercialSettings, findPossibleDuplicateDeals } from "../dist/application/sales/sales-config-use-cases.js";
import { resolveDealScope } from "../dist/application/sales/sales-context.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";
import { DEFAULT_CLOSE_REASONS } from "../dist/domain/sales/sales.model.js";
import { registerDealsRoutes } from "../dist/interfaces/api/routes/v1/deals.route.js";
import { registerSalesEngineRoutes } from "../dist/interfaces/api/routes/v1/sales-engine.route.js";
import { registerErrorHandler } from "../dist/interfaces/api/http/error-handler.js";
import { PostgresAutomationRuleRepository } from "../dist/infrastructure/storage/postgres/postgres-automation-rule-repository.js";
import { PostgresAutomationRunLogRepository } from "../dist/infrastructure/storage/postgres/postgres-automation-run-log-repository.js";

/**
 * Sales Engine — fases 1–4: catálogo com custo/tabela/mínimo, snapshot dos itens, margem e espaço
 * de negociação calculados no backend, política comercial + aprovação, ganho/perda com snapshot
 * definitivo e isolamento multi-tenant. Cenários numerados do pedido (147–153).
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-sales-${++counter}`;

test("Ciclo comercial: ganho manual sem proposta, valor negociado, arquivo e reabertura preservam histórico", async () => {
  const { d, tenantId, workspaceId, deal, seller, stages } = await setup();
  await updateDeal(d, { dealId: deal.id, tenantId, workspaceId, patch: { valueCents: 100000 } });
  await updateCommercialSettings(d, { tenantId, workspaceId, patch: { closedDealArchiveDays: 0 } });
  const closedAt = new Date(Date.now() - 3600000).toISOString();
  const won = await moveDealStage({ ...d, sales: d }, { dealId: deal.id, tenantId, workspaceId, targetStageId: stages.find(s => s.isWon).id, actorUserId: seller.userId, finalValueCents: 85000, closedAt, lossComment: "Negociação presencial" });
  assert.equal(won.status, "won");
  assert.equal(won.finalValueCents, 85000);
  assert.equal(won.closedAt, closedAt);
  assert.equal(won.firstClosedAt, closedAt);
  assert.equal(won.wonProposalId, undefined);
  assert.equal(won.closureSource, "kanban");
  assert.ok(won.archivedAt);
  const filter = { tenantId, workspaceId, pipelineId: deal.pipelineId };
  assert.equal((await listDeals(d, { ...filter, boardView: "operational" })).length, 0);
  assert.equal((await listDeals(d, { ...filter, boardView: "won" })).length, 1);
  assert.equal((await listDeals(d, { ...filter, boardView: "archived", search: deal.title })).length, 1);
  assert.equal(await d.dealRepository.archiveDueClosedDeals(filter), 0);
  const reopened = await moveDealStage({ ...d, sales: d }, { dealId: deal.id, tenantId, workspaceId, targetStageId: stages[2].id, actorUserId: seller.userId });
  assert.equal(reopened.status, "open");
  assert.equal(reopened.archivedAt, undefined);
  assert.equal(reopened.closedAt, undefined);
  assert.equal(reopened.firstClosedAt, closedAt);
  assert.equal(reopened.reopenCount, 1);
  assert.equal(reopened.reopenedByUserId, seller.userId);
  assert.ok(reopened.reopenedAt);
  const events = await d.timelineEventRepository.listByEntity({ entityType: "deal", entityId: deal.id });
  assert.equal(events.filter(e => e.eventType === "deal_archived").length, 1);
  const event = events.find(e => e.eventType === "deal_reopened");
  assert.equal(event.actorId, seller.userId);
  assert.equal(event.payload.fromStageId, won.stageId);
  assert.equal(event.payload.toStageId, stages[2].id);
  assert.equal(event.payload.previousFinalValueCents, 85000);
  assert.equal(event.payload.reopenCount, 1);
});

test("Arquivamento respeita prazo, Nunca, preferência existente e liberação manual", async () => {
  const { d, tenantId, workspaceId, deal, seller } = await setup();
  await updateDeal(d, { dealId: deal.id, tenantId, workspaceId, patch: { valueCents: 50000 } });
  await updateCommercialSettings(d, { tenantId, workspaceId, patch: { closedDealArchiveDays: 3, proposalAcceptAutoWin: false } });
  const won = await winDeal(d, seller, { dealId: deal.id, workspaceId });
  assert.equal(won.archivedAt, undefined);
  await db.pool.query("update deals set closed_at = now() - interval '4 days' where id = $1", [deal.id]);
  assert.equal(await d.dealRepository.archiveDueClosedDeals({ tenantId: "foreign", workspaceId }), 0);
  assert.equal(await d.dealRepository.archiveDueClosedDeals({ tenantId, workspaceId }), 1);
  assert.equal((await d.dealRepository.getById(deal.id)).status, "won");
  await d.dealRepository.setArchived({ id: deal.id, tenantId, workspaceId, archived: false, actorUserId: seller.userId });
  assert.equal(await d.dealRepository.archiveDueClosedDeals({ tenantId, workspaceId }), 0, "devolução manual mantém visível até o próximo fechamento");
  await updateCommercialSettings(d, { tenantId, workspaceId, patch: { closedDealArchiveDays: null } });
  const settings = await d.salesConfigRepository.getSettings(workspaceId);
  assert.equal(settings.closedDealArchiveDays, null);
  assert.equal(settings.proposalAcceptAutoWin, false, "alterar retenção preserva opção explícita de aceite");
});

test("Perda usa motivo ativo, persiste ID e permite administrar cadastro sem apagar histórico", async () => {
  const { d, tenantId, workspaceId, deal, seller } = await setup();
  const scope = { tenantId, workspaceId };
  const custom = await createCloseReason(d, { ...scope, kind: "lost", label: "Sem disponibilidade" });
  const reasons = await listCloseReasons(d, { ...scope, kind: "lost", includeInactive: true });
  await reorderCloseReasons(d, { ...scope, kind: "lost", reasonIds: reasons.map(r => r.id).reverse() });
  assert.equal((await listCloseReasons(d, { ...scope, kind: "lost" }))[0].id, custom.id);
  await updateCloseReason(d, { ...scope, reasonId: custom.id, patch: { active: false } });
  await assert.rejects(loseDeal(d, seller, { workspaceId, dealId: deal.id, lossReason: custom.label }), /DEAL_LOSS_REASON_REQUIRED/);
  await updateCloseReason(d, { ...scope, reasonId: custom.id, patch: { active: true, label: "Sem agenda" } });
  const lost = await loseDeal(d, seller, { workspaceId, dealId: deal.id, lossReason: "Sem agenda", comment: "Retomar no próximo mês" });
  assert.equal(lost.lossReasonId, custom.id);
  assert.equal(lost.closeComment, "Retomar no próximo mês");
  await assert.rejects(deleteCloseReason(d, { ...scope, reasonId: custom.id }), /SALES_REASON_IN_USE/);
  await reopenDeal(d, seller, { workspaceId, dealId: deal.id });
  await assert.rejects(deleteCloseReason(d, { ...scope, reasonId: custom.id }), /SALES_REASON_IN_USE/);
  const unused = await createCloseReason(d, { ...scope, kind: "lost", label: "Temporário" });
  await deleteCloseReason(d, { ...scope, reasonId: unused.id });
  assert.equal(await d.salesConfigRepository.getCloseReason(unused.id), undefined);
});

test("Fechamento simultâneo emite um ganho e uma mudança de fase; datas futuras não alteram a oportunidade", async () => {
  const { d, workspaceId, deal, seller } = await setup();
  await assert.rejects(winDeal(d, seller, { workspaceId, dealId: deal.id, finalValueCents: 10000, closedAt: new Date(Date.now() + 86400000).toISOString() }), /DEAL_CLOSE_DATE_INVALID/);
  assert.equal((await d.dealRepository.getById(deal.id)).status, "open");
  await Promise.allSettled([1, 2].map(() => winDeal(d, seller, { workspaceId, dealId: deal.id, finalValueCents: 10000 })));
  const events = await d.timelineEventRepository.listByEntity({ entityType: "deal", entityId: deal.id });
  assert.equal(events.filter(e => e.eventType === "deal_won").length, 1);
  assert.equal(events.filter(e => e.eventType === "deal_stage_changed").length, 1);
});

test("Valor final no Kanban satisfaz campo obrigatório e respeita a política comercial", async () => {
  const { d, tenantId, workspaceId, deal, seller, stages } = await setup();
  const wonStage = stages.find(s => s.isWon);
  await d.pipelineStageRepository.update(wonStage.id, { requiredFields: ["valueCents"] });
  const item = await product(d, tenantId, workspaceId);
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: item.id, quantity: 1 });
  const move = finalValueCents => moveDealStage({ ...d, sales: d }, { tenantId, workspaceId, dealId: deal.id, targetStageId: wonStage.id, finalValueCents, actorUserId: seller.userId });
  await assert.rejects(move(70000), /COMMERCIAL_APPROVAL_REQUIRED/);
  assert.equal((await d.dealRepository.getById(deal.id)).stageId, deal.stageId);
  const won = await move(90000);
  assert.equal(won.finalValueCents, 90000);
  assert.equal(won.finalSnapshot.totals.totalCents, 90000);
  assert.equal(won.finalTcvCents, 90000);
});

test("Gestor corrige valor final com auditoria sem mudar data, crédito, estoque ou arquivamento", async () => {
  const { d, tenantId, workspaceId, deal, seller, manager } = await setup();
  await updateCommercialSettings(d, { tenantId, workspaceId, patch: { closedDealArchiveDays: 0 } });
  const won = await winDeal(d, seller, { workspaceId, dealId: deal.id, finalValueCents: 10000 });
  await assert.rejects(correctDealClosure(d, seller, { workspaceId, dealId: deal.id, finalValueCents: 9000 }), /DEAL_PERMISSION_REQUIRED/);
  const corrected = await correctDealClosure(d, manager, { workspaceId, dealId: deal.id, finalValueCents: 9000, comment: "Ajuste autorizado" });
  assert.equal(corrected.finalValueCents, 9000);
  assert.equal(corrected.finalSnapshot.totals.totalCents, 9000);
  assert.equal(corrected.closedAt, won.closedAt);
  assert.equal(corrected.creditedOwnerUserId, seller.userId);
  assert.equal(corrected.archivedAt, won.archivedAt);
  const events = await d.timelineEventRepository.listByEntity({ entityType: "deal", entityId: deal.id });
  assert.equal(events.filter(e => e.eventType === "deal_won").length, 1);
  assert.deepEqual(events.find(e => e.eventType === "deal_final_value_changed").payload.fromValueCents, 10000);
  assert.equal(events.find(e => e.eventType === "deal_final_value_changed").payload.toValueCents, 9000);
});

test("HTTP: permissões específicas protegem fechamento, correções e arquivo e isolam o tenant", async () => {
  const { d, workspaceId, deal, seller, manager, tenantId } = await setup();
  let actor = { ...seller, role: "viewer" };
  const app = Fastify();
  registerErrorHandler(app);
  app.addHook("onRequest", async request => { request.zunoContext = { principal: actor }; });
  await registerDealsRoutes(app, { ...d, sales: d });
  await registerSalesEngineRoutes(app, d);
  try {
    const win = () => app.inject({ method: "POST", url: `/deals/${deal.id}/win`, payload: { workspaceId, finalValueCents: 8500 } });
    assert.equal((await win()).statusCode, 403);
    actor = seller;
    assert.equal((await win()).statusCode, 200);
    const correction = () => app.inject({ method: "PATCH", url: `/deals/${deal.id}/closure`, payload: { workspaceId, finalValueCents: 8000 } });
    assert.equal((await correction()).statusCode, 403);
    const archive = () => app.inject({ method: "POST", url: `/deals/${deal.id}/archive`, payload: { workspaceId, archived: true } });
    assert.equal((await archive()).statusCode, 200);
    assert.equal((await archive()).statusCode, 200);
    const events = await d.timelineEventRepository.listByEntity({ entityType: "deal", entityId: deal.id });
    assert.equal(events.filter(e => e.eventType === "deal_archived").length, 1);
    actor = manager;
    assert.equal((await correction()).statusCode, 200);
    const settings = await app.inject({ method: "PATCH", url: "/commercial-settings", payload: { workspaceId, closedDealArchiveDays: null } });
    assert.equal(settings.statusCode, 200, settings.body);
    actor = { ...manager, tenantId: "another-tenant" };
    assert.equal((await archive()).statusCode, 404);
    assert.equal((await correction()).statusCode, 404);
    assert.equal((await d.dealRepository.getById(deal.id)).tenantId, tenantId);
  } finally { await app.close(); }
});

test("Automação de fase executa fechamento comercial e gatilho de ganho sem recursão", async () => {
  const { d, workspaceId, deal, seller, tenantId, stages } = await setup();
  await updateDeal(d, { dealId: deal.id, tenantId, workspaceId, patch: { valueCents: 25000 } });
  const automation = { ...d, automationRuleRepository: new PostgresAutomationRuleRepository(db.pool), automationRunLogRepository: new PostgresAutomationRunLogRepository(db.pool) };
  const sales = { ...d, automation };
  automation.transitionDealStage = (current, targetStageId) => moveDealStage({ ...d, sales, automation }, { dealId: current.id, tenantId, workspaceId, targetStageId, source: "automation" });
  await automation.automationRuleRepository.create({ tenantId, workspaceId, name: "Encerrar negociação", trigger: "deal_stage_changed", conditions: [{ field: "stageId", equals: stages[1].id }], action: "move_deal_stage", actionConfig: { targetStageId: stages.find(s => s.isWon).id }, active: true });
  await automation.automationRuleRepository.create({ tenantId, workspaceId, name: "Pós-venda", trigger: "deal_won", conditions: [], action: "create_task", actionConfig: { taskTitle: "Acompanhar entrega" }, active: true });
  await moveDealStage({ ...d, sales, automation }, { dealId: deal.id, tenantId, workspaceId, targetStageId: stages[1].id, actorUserId: seller.userId });
  const won = await d.dealRepository.getById(deal.id);
  assert.equal(won.status, "won");
  assert.equal(won.finalValueCents, 25000);
  assert.equal(won.closureSource, "automation");
  assert.equal(won.closedByUserId, undefined);
  const events = await d.timelineEventRepository.listByEntity({ entityType: "deal", entityId: deal.id });
  assert.equal(events.filter(e => e.eventType === "deal_won").length, 1);
  assert.equal(events.find(e => e.eventType === "deal_won").actorType, "automation");
  const tasks = await d.taskRepository.listByWorkspace({ tenantId, workspaceId, dealId: deal.id });
  assert.equal(tasks.filter(t => t.title === "Acompanhar entrega").length, 1);
});

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function deps() {
  return {
    dealRepository: new PostgresDealRepository(db.pool),
    pipelineRepository: new PostgresPipelineRepository(db.pool),
    pipelineStageRepository: new PostgresPipelineStageRepository(db.pool),
    productRepository: new PostgresProductRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
    dealItemRepository: new PostgresDealItemRepository(db.pool),
    salesCatalogRepository: new PostgresSalesCatalogRepository(db.pool),
    salesConfigRepository: new PostgresSalesConfigRepository(db.pool),
    approvalRepository: new PostgresCommercialApprovalRepository(db.pool),
    membershipRepository: new PostgresTenantMembershipRepository(db.pool),
    teamMembershipRepository: new PostgresTeamMembershipRepository(db.pool),
    taskRepository: new PostgresTaskRepository(db.pool),
    contactRepository: new PostgresContactRepository(db.pool),
  };
}

async function setup(tenantId = nextId("tenant")) {
  const workspace = await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }).create({ tenantId, name: "W" });
  const d = deps();
  const { pipeline, stages } = await ensureDefaultPipeline(d, tenantId, workspace.id);
  const seller = { tenantId, userId: nextId("seller"), role: "editor" };
  const manager = { tenantId, userId: nextId("manager"), role: "owner" };
  const deal = await createDeal({ ...d, sales: d }, { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: stages[0].id, title: "Plano anual", ownerUserId: seller.userId });
  return { d, tenantId, workspaceId: workspace.id, pipeline, stages, seller, manager, deal };
}

async function product(d, tenantId, workspaceId, overrides = {}) {
  return d.productRepository.create({ tenantId, workspaceId, name: overrides.name ?? "Produto A", priceCents: 100000, costCents: 40000, minimumPriceCents: 80000, ...overrides });
}

test("Motivos padrão: inicialização concorrente não duplica registros nem deixa grupos incompletos", async () => {
  const tenantId = nextId("reason-tenant");
  const workspace = await new PostgresWorkspaceRepository(db.pool).create({ tenantId, name: "Motivos" });
  const d = deps();
  await Promise.all(Array.from({ length: 4 }, () => listCloseReasons(d, { tenantId, workspaceId: workspace.id })));
  const stored = await d.salesConfigRepository.listCloseReasons({ tenantId, workspaceId: workspace.id, includeInactive: true });
  assert.equal(stored.length, Object.values(DEFAULT_CLOSE_REASONS).flat().length);
  assert.equal(new Set(stored.map((reason) => `${reason.kind}:${reason.label}`)).size, stored.length);
  for (const [kind, expected] of Object.entries(DEFAULT_CLOSE_REASONS)) {
    assert.deepEqual(stored.filter((reason) => reason.kind === kind).map((reason) => reason.label), expected);
  }
});

test("Motivos duplicados de workspaces antigos aparecem uma única vez na configuração", async () => {
  const { d, tenantId, workspaceId } = await setup();
  await listCloseReasons(d, { tenantId, workspaceId });
  await d.salesConfigRepository.createCloseReason({ tenantId, workspaceId, kind: "proposal_decline", label: "  Preço  " });
  const reasons = await listCloseReasons(d, { tenantId, workspaceId, kind: "proposal_decline" });
  assert.equal(reasons.filter((reason) => reason.label.trim().toLowerCase() === "preço").length, 1);
});

test("Domínio: margem, desconto e espaço de negociação (cenário 147)", () => {
  const line = priceLine({ quantity: 1, unitCostCents: 40000, listPriceCents: 100000, minimumPriceCents: 80000, proposedUnitPriceCents: 95000, billingType: "one_time" });
  assert.equal(line.grossProfitCents, 55000);
  assert.equal(line.grossMarginBp, 5789); // 55000/95000 = 57,89%
  assert.equal(line.discountCents, 5000);
  assert.equal(line.discountBp, 500);
  assert.equal(line.negotiationRoomCents, 15000);
  assert.equal(line.belowMinimum, false);
});

test("Domínio: acima da tabela é permitido e aumenta a margem (cenário 148)", () => {
  const totals = computeCommercialTotals([{ quantity: 1, unitCostCents: 40000, listPriceCents: 100000, minimumPriceCents: 80000, proposedUnitPriceCents: 120000, billingType: "one_time" }]);
  assert.equal(totals.discountCents, 0);
  assert.equal(totals.grossMarginBp, 6667);
  const evaluation = evaluateCommercialTerms(totals, { minMarginBp: 5000, maxDiscountBp: 1000, allowBelowMinimum: false, source: "workspace" });
  assert.deepEqual(evaluation.reasons, []);
  assert.equal(evaluation.health, "healthy");
});

test("Domínio: recorrência gera MRR/ARR/TCV sem forçar contrato anual", () => {
  const lines = [
    { quantity: 1, listPriceCents: 50000, proposedUnitPriceCents: 50000, billingType: "monthly" },
    { quantity: 1, listPriceCents: 200000, proposedUnitPriceCents: 200000, billingType: "one_time" },
  ];
  const open = computeCommercialTotals(lines);
  assert.equal(open.mrrCents, 50000);
  assert.equal(open.arrCents, 600000);
  assert.equal(open.tcvCents, 200000 + 600000);
  const contract = computeCommercialTotals(lines, { contractMonths: 24 });
  assert.equal(contract.tcvCents, 200000 + 50000 * 24);
  assert.equal(computeCommercialTotals([], {}).costCents, undefined, "sem itens nunca inventa custo");
});

test("Item da oportunidade: snapshot nunca muda quando o catálogo muda (cenário 150)", async () => {
  const { d, tenantId, workspaceId, deal, seller } = await setup();
  const p = await product(d, tenantId, workspaceId);
  const item = await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: p.id, quantity: 1, proposedUnitPriceCents: 95000 });
  assert.equal(item.listPriceCentsSnapshot, 100000);
  await d.productRepository.update(p.id, { priceCents: 150000, costCents: 70000, minimumPriceCents: 120000, name: "Produto A v2" });
  const [stored] = await d.dealItemRepository.listByDeal(deal.id);
  assert.equal(stored.listPriceCentsSnapshot, 100000);
  assert.equal(stored.unitCostCentsSnapshot, 40000);
  assert.equal(stored.minimumPriceCentsSnapshot, 80000);
  assert.equal(stored.productNameSnapshot, "Produto A");
  const refreshed = await d.dealRepository.getById(deal.id);
  assert.equal(refreshed.valueMode, "calculated", "primeiro produto torna o valor calculado");
  assert.equal(refreshed.valueCents, 95000);
});

test("Multi-produto: quantidades, descontos, custo e margem determinísticos (cenário 151)", async () => {
  const { d, tenantId, workspaceId, deal, seller, manager } = await setup();
  const a = await product(d, tenantId, workspaceId, { name: "A" });
  const b = await product(d, tenantId, workspaceId, { name: "B", priceCents: 20000, costCents: 5000, minimumPriceCents: 15000 });
  const c = await product(d, tenantId, workspaceId, { name: "C", priceCents: 9990, costCents: 3333, minimumPriceCents: null, billingType: "monthly" });
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: a.id, quantity: 2, proposedUnitPriceCents: 90000 });
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: b.id, quantity: 3, discountBp: 1000 });
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: c.id, quantity: 1.5 });
  const summary = await getDealCommercialSummary(d, manager, { workspaceId, dealId: deal.id });
  // A: 2×900 = 1800,00 | B: 3×180 = 540,00 | C: 1,5×99,90 = 149,85
  assert.equal(summary.totals.totalCents, 180000 + 54000 + 14985);
  assert.equal(summary.totals.listTotalCents, 200000 + 60000 + 14985);
  assert.equal(summary.totals.costCents, 80000 + 15000 + 5000); // 1,5 × 33,33 = 49,995 → 50,00
  assert.equal(summary.totals.grossProfitCents, summary.totals.totalCents - summary.totals.costCents);
  assert.equal(summary.totals.mrrCents, 14985);
  // Desconto global não é aplicado duas vezes e entra no total.
  await updateDealCommercialTerms(d, seller, { workspaceId, dealId: deal.id, discountCents: 4985 });
  const after = await getDealCommercialSummary(d, manager, { workspaceId, dealId: deal.id });
  assert.equal(after.totals.totalCents, 244000);
  assert.equal((await d.dealRepository.getById(deal.id)).valueCents, 244000);
});

test("Visibilidade: vendedor sem permissão não recebe custo; margem conforme configuração", async () => {
  const { d, tenantId, workspaceId, deal, seller } = await setup();
  const p = await product(d, tenantId, workspaceId);
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: p.id, quantity: 1 });
  const asSeller = await getDealCommercialSummary(d, seller, { workspaceId, dealId: deal.id });
  assert.equal(asSeller.totals.costCents, undefined);
  assert.equal(asSeller.items[0].unitCostCentsSnapshot, undefined);
  assert.equal(typeof asSeller.totals.grossMarginBp, "number", "margem liberada por padrão");
  assert.equal(asSeller.totals.negotiationRoomCents, 20000, "espaço de negociação sempre visível");
  await updateCommercialSettings(d, { tenantId, workspaceId, patch: { sellersCanViewMargin: false } });
  const hidden = await getDealCommercialSummary(d, seller, { workspaceId, dealId: deal.id });
  assert.equal(hidden.totals.grossMarginBp, undefined);
  const viewer = await getDealCommercialSummary(d, { ...seller, role: "viewer" }, { workspaceId, dealId: deal.id });
  assert.equal(viewer.totals.costCents, undefined);
});

test("Abaixo do mínimo exige aprovação; envio bloqueado até aprovar (cenário 149)", async () => {
  const { d, tenantId, workspaceId, deal, seller, manager } = await setup();
  const p = await product(d, tenantId, workspaceId);
  const item = await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: p.id, quantity: 1, proposedUnitPriceCents: 75000 });
  const summary = await getDealCommercialSummary(d, seller, { workspaceId, dealId: deal.id });
  assert.deepEqual(summary.evaluation.reasons, ["below_minimum_price"]);
  assert.equal(summary.evaluation.health, "below_limit");
  assert.equal(summary.approval.status, "missing");
  const lines = itemsToPricingLines([item]);
  await assert.rejects(assertTermsApproved(d, { deal, lines, globalDiscountCents: 0, actorUserId: seller.userId }), /COMMERCIAL_APPROVAL_REQUIRED/);
  await assert.rejects(winDeal(d, seller, { workspaceId, dealId: deal.id }), /COMMERCIAL_APPROVAL_REQUIRED/);

  const request = await requestCommercialApproval(d, seller, { workspaceId, dealId: deal.id, justification: "Cliente estratégico" });
  const again = await requestCommercialApproval(d, seller, { workspaceId, dealId: deal.id });
  assert.equal(again.id, request.id, "pedido pendente é idempotente");
  assert.equal(request.snapshot.requestedTotalCents, 75000);
  assert.equal(request.snapshot.minimumTotalCents, 80000);
  await assert.rejects(decideCommercialApproval(d, manager, { workspaceId, approvalId: request.id, decision: "rejected" }), /APPROVAL_REASON_REQUIRED/);
  const approved = await decideCommercialApproval(d, manager, { workspaceId, approvalId: request.id, decision: "approved", reason: "ok" });
  assert.equal(approved.status, "approved");
  assert.equal(approved.decidedByUserId, manager.userId);
  await assert.rejects(decideCommercialApproval(d, manager, { workspaceId, approvalId: request.id, decision: "approved" }), /APPROVAL_ALREADY_DECIDED/);
  await assertTermsApproved(d, { deal, lines, globalDiscountCents: 0, actorUserId: seller.userId });

  // Mudar o preço invalida a aprovação (novos termos, nova aprovação).
  await updateDealItem(d, seller, { workspaceId, dealId: deal.id, itemId: item.id, proposedUnitPriceCents: 70000 });
  const changed = await getDealCommercialSummary(d, seller, { workspaceId, dealId: deal.id });
  assert.equal(changed.approval.status, "missing");
});

test("Política: margem mínima e desconto máximo por usuário sobrescrevem o workspace", async () => {
  const { d, tenantId, workspaceId, deal, seller } = await setup();
  const p = await product(d, tenantId, workspaceId, { minimumPriceCents: null });
  await d.salesConfigRepository.upsertPolicy({ tenantId, workspaceId, scopeType: "workspace", minMarginBp: 5000, maxDiscountBp: 1000 });
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: p.id, quantity: 1, discountBp: 1500 });
  const strict = await getDealCommercialSummary(d, seller, { workspaceId, dealId: deal.id });
  assert.deepEqual(strict.evaluation.reasons, ["discount_above_autonomy"]);
  await d.salesConfigRepository.upsertPolicy({ tenantId, workspaceId, scopeType: "user", scopeId: seller.userId, minMarginBp: 4000, maxDiscountBp: 2000 });
  const relaxed = await getDealCommercialSummary(d, seller, { workspaceId, dealId: deal.id });
  assert.deepEqual(relaxed.evaluation.reasons, []);
  assert.equal(relaxed.policy.source, "user");
});

test("Ganho grava snapshot definitivo e credita o responsável do momento (cenário 152)", async () => {
  const { d, tenantId, workspaceId, deal, seller, manager, stages } = await setup();
  const p = await product(d, tenantId, workspaceId);
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: p.id, quantity: 2, proposedUnitPriceCents: 90000 });
  const won = await winDeal(d, seller, { workspaceId, dealId: deal.id, wonReason: "Relacionamento" });
  assert.equal(won.status, "won");
  assert.equal(won.stageId, stages.find((stage) => stage.isWon).id);
  assert.equal(won.finalValueCents, 180000);
  assert.equal(won.finalCostCents, 80000);
  assert.equal(won.finalGrossProfitCents, 100000);
  assert.equal(won.finalMarginBp, 5556);
  assert.equal(won.creditedOwnerUserId, seller.userId);
  assert.equal(won.finalSnapshot.items[0].proposedUnitPriceCents, 90000);
  assert.equal((await winDeal(d, seller, { workspaceId, dealId: deal.id })).closedAt, won.closedAt, "ganho idempotente");

  // Catálogo e responsável mudam depois: a venda histórica não muda.
  await d.productRepository.update(p.id, { priceCents: 999999, costCents: 1 });
  await updateDeal({ ...d }, { dealId: deal.id, tenantId, workspaceId, patch: { ownerUserId: manager.userId } });
  const later = await d.dealRepository.getById(deal.id);
  assert.equal(later.finalValueCents, 180000);
  assert.equal(later.creditedOwnerUserId, seller.userId);
  await assert.rejects(addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: p.id, quantity: 1 }), /DEAL_CLOSED/);

  const reopened = await reopenDeal(d, seller, { workspaceId, dealId: deal.id });
  assert.equal(reopened.status, "open");
  assert.equal(reopened.finalValueCents, undefined);
  assert.equal(stages.find((stage) => stage.id === reopened.stageId).isWon, false);
});

test("Perda exige motivo, registra concorrente e não conta como venda (cenário 153)", async () => {
  const { d, tenantId, workspaceId, deal, seller } = await setup();
  await updateDeal(d, { dealId: deal.id, tenantId, workspaceId, patch: { valueCents: 50000 } });
  await assert.rejects(loseDeal(d, seller, { workspaceId, dealId: deal.id, lossReason: " " }), /DEAL_LOSS_REASON_REQUIRED/);
  const lost = await loseDeal(d, seller, { workspaceId, dealId: deal.id, lossReason: "Concorrência", competitorName: "Acme", comment: "Preço deles 20% menor" });
  assert.equal(lost.status, "lost");
  assert.equal(lost.lossReason, "Concorrência");
  assert.ok(lost.competitorId);
  assert.equal(lost.creditedOwnerUserId, seller.userId);
  assert.equal(lost.finalMarginBp, undefined);
  const reasons = await listCloseReasons(d, { tenantId, workspaceId, kind: "lost" });
  assert.ok(reasons.some((reason) => reason.label === "Cliente desistiu"), "motivos padrão semeados e editáveis");
});

test("Kanban: mover para etapa de ganho fecha com snapshot; etapa exige campos configurados", async () => {
  const { d, tenantId, workspaceId, deal, stages } = await setup();
  const dealDeps = { ...d, sales: d };
  const proposalStage = stages[2];
  await d.pipelineStageRepository.update(proposalStage.id, { requiredFields: ["expectedCloseDate", "valueCents"] });
  await assert.rejects(moveDealStage(dealDeps, { dealId: deal.id, tenantId, workspaceId, targetStageId: proposalStage.id }), /DEAL_STAGE_REQUIREMENTS_MISSING: .*Previsão de fechamento, Valor/);
  await updateDeal(dealDeps, { dealId: deal.id, tenantId, workspaceId, patch: { valueCents: 30000, expectedCloseDate: "2026-12-01" } });
  await moveDealStage(dealDeps, { dealId: deal.id, tenantId, workspaceId, targetStageId: proposalStage.id });
  const won = await moveDealStage(dealDeps, { dealId: deal.id, tenantId, workspaceId, targetStageId: stages.find((stage) => stage.isWon).id, actorUserId: "user-x" });
  assert.equal(won.status, "won");
  assert.equal(won.finalValueCents, 30000);
  const reopened = await moveDealStage(dealDeps, { dealId: deal.id, tenantId, workspaceId, targetStageId: stages[1].id });
  assert.equal(reopened.status, "open");
});

test("Tabela de preço e variação resolvem o preço; isolamento entre tenants", async () => {
  const { d, tenantId, workspaceId, deal, seller } = await setup();
  const p = await product(d, tenantId, workspaceId);
  const variant = await d.salesCatalogRepository.createVariant({ tenantId, workspaceId, productId: p.id, name: "50 usuários", listPriceCents: 300000, minimumPriceCents: 250000, costCents: 100000 });
  const book = await d.salesCatalogRepository.createPriceBook({ tenantId, workspaceId, name: "Parceiros" });
  await d.salesCatalogRepository.upsertPriceBookItem({ priceBookId: book.id, productId: p.id, listPriceCents: 85000 });
  assert.equal((await resolveProductPricing(d, { tenantId, workspaceId, productId: p.id })).listPriceCents, 100000);
  assert.equal((await resolveProductPricing(d, { tenantId, workspaceId, productId: p.id, priceBookId: book.id })).listPriceCents, 85000);
  const v = await resolveProductPricing(d, { tenantId, workspaceId, productId: p.id, variantId: variant.id });
  assert.equal(v.listPriceCents, 300000);
  assert.equal(v.name, "Produto A — 50 usuários");

  const other = await setup();
  await assert.rejects(addDealItem(d, other.seller, { workspaceId: other.workspaceId, dealId: other.deal.id, productId: p.id, quantity: 1 }), /PRODUCT_NOT_FOUND/);
  await assert.rejects(getDealCommercialSummary(d, other.seller, { workspaceId: other.workspaceId, dealId: deal.id }), /DEAL_NOT_FOUND/);
  await assert.rejects(addDealItem(d, seller, { workspaceId: other.workspaceId, dealId: deal.id, productId: p.id, quantity: 1 }), /DEAL_NOT_FOUND/);
});

test("Visibilidade own/team e aviso de duplicidade", async () => {
  const { d, tenantId, workspaceId, deal, seller, manager, pipeline } = await setup();
  await updateCommercialSettings(d, { tenantId, workspaceId, patch: { dealVisibility: "own" } });
  assert.deepEqual(await resolveDealScope(d, seller, workspaceId), { ownerUserIdsIn: [seller.userId] });
  assert.deepEqual(await resolveDealScope(d, manager, workspaceId), {});
  const visible = await d.dealRepository.listByWorkspace({ tenantId, workspaceId, ownerUserIdsIn: ["someone-else"] });
  assert.equal(visible.length, 0);
  const duplicates = await findPossibleDuplicateDeals(d, { tenantId, workspaceId, pipelineId: pipeline.id, title: "plano ANUAL" });
  assert.deepEqual(duplicates.map((item) => item.id), [deal.id]);
});
