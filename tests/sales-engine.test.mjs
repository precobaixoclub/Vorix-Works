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
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import {
  PostgresCommercialApprovalRepository,
  PostgresDealItemRepository,
  PostgresSalesCatalogRepository,
  PostgresSalesConfigRepository,
} from "../dist/infrastructure/storage/postgres/postgres-sales-engine-repositories.js";
import { ensureDefaultPipeline } from "../dist/application/crm/pipeline-use-cases.js";
import { createDeal, moveDealStage, updateDeal } from "../dist/application/crm/deal-use-cases.js";
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
} from "../dist/application/sales/deal-commercial-use-cases.js";
import { resolveProductPricing } from "../dist/application/sales/catalog-use-cases.js";
import { listCloseReasons, updateCommercialSettings, findPossibleDuplicateDeals } from "../dist/application/sales/sales-config-use-cases.js";
import { resolveDealScope } from "../dist/application/sales/sales-context.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Sales Engine — fases 1–4: catálogo com custo/tabela/mínimo, snapshot dos itens, margem e espaço
 * de negociação calculados no backend, política comercial + aprovação, ganho/perda com snapshot
 * definitivo e isolamento multi-tenant. Cenários numerados do pedido (147–153).
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-sales-${++counter}`;

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
  const manager = { tenantId, userId: nextId("manager"), role: "admin" };
  const deal = await createDeal({ ...d, sales: d }, { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: stages[0].id, title: "Plano anual", ownerUserId: seller.userId });
  return { d, tenantId, workspaceId: workspace.id, pipeline, stages, seller, manager, deal };
}

async function product(d, tenantId, workspaceId, overrides = {}) {
  return d.productRepository.create({ tenantId, workspaceId, name: overrides.name ?? "Produto A", priceCents: 100000, costCents: 40000, minimumPriceCents: 80000, ...overrides });
}

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
  const lost = await loseDeal(d, seller, { workspaceId, dealId: deal.id, lossReason: "Concorrente", competitorName: "Acme", comment: "Preço deles 20% menor" });
  assert.equal(lost.status, "lost");
  assert.equal(lost.lossReason, "Concorrente");
  assert.ok(lost.competitorId);
  assert.equal(lost.creditedOwnerUserId, seller.userId);
  assert.equal(lost.finalMarginBp, undefined);
  const reasons = await listCloseReasons(d, { tenantId, workspaceId, kind: "lost" });
  assert.ok(reasons.some((reason) => reason.label === "Sem orçamento"), "motivos padrão semeados e editáveis");
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
