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
import { PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import {
  PostgresCommercialApprovalRepository,
  PostgresDealItemRepository,
  PostgresSalesCatalogRepository,
  PostgresSalesConfigRepository,
} from "../dist/infrastructure/storage/postgres/postgres-sales-engine-repositories.js";
import { PostgresSalesAnalyticsRepository, PostgresSalesGoalRepository } from "../dist/infrastructure/storage/postgres/postgres-sales-goal-repositories.js";
import { ensureDefaultPipeline } from "../dist/application/crm/pipeline-use-cases.js";
import { createDeal } from "../dist/application/crm/deal-use-cases.js";
import { addDealItem } from "../dist/application/sales/deal-commercial-use-cases.js";
import { upsertGoal } from "../dist/application/sales/sales-performance-use-cases.js";
import { generateDealAiInsights, getDealInsights } from "../dist/application/sales/deal-insights-use-cases.js";
import { applyDealCommercialInsightsSemanticValidation, validateDealCommercialInsightsStructure } from "../dist/application/ai-gateway/schemas/deal-commercial-insights-result.v1.js";
import { normalizePeriodStart } from "../dist/domain/sales/goals.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** Sales Engine — fase 10: IA comercial. Riscos e números são determinísticos; a IA só resume,
 * aponta riscos e sugere ações COM evidência literal (o que não bate com os dados é descartado). */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-ins-${++counter}`;

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function setup({ messages = [], generator } = {}) {
  const tenantId = nextId("tenant");
  const workspace = await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }).create({ tenantId, name: "W" });
  const workspaceId = workspace.id;
  const seller = { tenantId, userId: nextId("seller"), role: "editor" };
  const manager = { tenantId, userId: nextId("manager"), role: "admin" };
  const members = [seller, manager].map((actor) => ({ id: nextId("m"), userId: actor.userId, tenantId, role: actor.role }));
  const captured = [];
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
      getByUserAndTenant: async (userId) => members.find((member) => member.userId === userId),
      listByTenant: async () => members,
      listByUser: async () => [],
    },
    teamMembershipRepository: new PostgresTeamMembershipRepository(db.pool),
    taskRepository: new PostgresTaskRepository(db.pool),
    contactRepository: new PostgresContactRepository(db.pool),
    proposalRepository: new PostgresProposalRepository(db.pool),
    goalRepository: new PostgresSalesGoalRepository(db.pool),
    analyticsRepository: new PostgresSalesAnalyticsRepository(db.pool),
    conversationReader: { recentMessages: async () => messages },
    insightsGenerator: generator ? { generate: async (input) => { captured.push(input); return generator(input); } } : undefined,
  };
  const { pipeline, stages } = await ensureDefaultPipeline(d, tenantId, workspaceId);
  const contact = await d.contactRepository.create({ tenantId, workspaceId, name: "Bruno" });
  const deal = await createDeal(d, { tenantId, workspaceId, pipelineId: pipeline.id, stageId: stages[1].id, contactId: contact.id, title: "Plano Enterprise", ownerUserId: seller.userId, expectedCloseDate: "2020-01-10" });
  const product = await d.productRepository.create({ tenantId, workspaceId, name: "Enterprise", priceCents: 1_000_000, costCents: 400_000, minimumPriceCents: 800_000 });
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: product.id, quantity: 1, proposedUnitPriceCents: 950_000 });
  return { d, tenantId, workspaceId, seller, manager, deal, captured };
}

test("Riscos determinísticos e explicações com números do backend (sem IA)", async () => {
  const { d, workspaceId, seller, manager, deal } = await setup({ messages: [{ direction: "inbound", at: "2026-10-10 10:00", text: "A concorrência ofereceu 20% menos, preciso pensar" }] });
  await upsertGoal(d, manager, { workspaceId, scopeType: "user", scopeId: seller.userId, metric: "sales_revenue", periodType: "monthly", periodStart: normalizePeriodStart("monthly", new Date().toISOString().slice(0, 10)), targetValue: 10_000_000 });
  const insights = await getDealInsights(d, seller, { workspaceId, dealId: deal.id });
  const codes = insights.risks.map((risk) => risk.code);
  assert.ok(codes.includes("no_next_action"));
  assert.ok(codes.includes("close_date_overdue"));
  assert.ok(codes.includes("competitor_mentioned"));
  assert.equal(insights.risks.find((risk) => risk.code === "competitor_mentioned").evidence, "A concorrência ofereceu 20% menos, preciso pensar");
  // Intl usa espaço não separável depois de "R$".
  assert.ok(insights.explanations.some((text) => text.replace(/\s/g, " ").includes("R$ 1.500,00") && text.includes("espaço comercial")), insights.explanations.join(" | "));
  assert.ok(insights.explanations.some((text) => text.includes("9,5%") && text.includes("meta mensal")), "9.500 de 100.000 = 9,5% da meta");
  assert.equal(insights.aiAvailable, false);
});

test("IA sob demanda recebe fatos calculados e conversa real; sem permissão de margem, margem não vai à IA", async () => {
  const generator = () => ({ ok: true, traceId: "t1", summary: "Cliente quer o Enterprise.", summaryEvidence: ["Plano Enterprise"], risks: [], nextActions: [{ title: "Ligar amanhã", rationale: "Retomar", evidence: "preciso pensar", actionType: "call" }] });
  const { d, tenantId, workspaceId, seller, deal, captured } = await setup({ messages: [{ direction: "inbound", at: "2026-10-10 10:00", text: "preciso pensar" }], generator });
  await d.salesConfigRepository.upsertSettings({ tenantId, workspaceId, sellersCanViewMargin: false });
  const result = await generateDealAiInsights(d, seller, { workspaceId, dealId: deal.id });
  assert.equal(result.nextActions[0].title, "Ligar amanhã");
  assert.equal(captured[0].messages[0].text, "preciso pensar");
  assert.ok(captured[0].facts.some((fact) => fact.startsWith("Valor: R$")));
  assert.equal(captured[0].facts.some((fact) => fact.startsWith("Margem")), false);
  const timeline = await d.timelineEventRepository.listByEntity({ entityType: "deal", entityId: deal.id });
  assert.ok(timeline.some((event) => event.eventType === "deal_ai_insights_generated"));
});

test("Validação anti-alucinação descarta risco/ação/resumo sem evidência literal", () => {
  const structural = validateDealCommercialInsightsStructure({
    schemaVersion: 1,
    summary: "Cliente tem pressa.",
    summaryEvidence: ["isto não está no texto"],
    risks: [{ title: "Concorrente", evidence: "ofereceu 20% menos" }, { title: "Inventado", evidence: "frase que não existe" }],
    nextActions: [{ title: "Ligar", rationale: "x", evidence: "inventado", actionType: "call" }],
    warnings: [],
  });
  assert.equal(structural.valid, true);
  const checked = applyDealCommercialInsightsSemanticValidation({ structural: structural.data, sourceText: "Cliente: A concorrência ofereceu 20% menos" });
  assert.equal(checked.data.summary, "");
  assert.deepEqual(checked.data.risks.map((risk) => risk.title), ["Concorrente"]);
  assert.equal(checked.data.nextActions.length, 0);
});

test("IA indisponível falha de forma explícita e segura", async () => {
  const { d, workspaceId, seller, deal } = await setup();
  await assert.rejects(generateDealAiInsights(d, seller, { workspaceId, dealId: deal.id }), /DEAL_INSIGHTS_UNAVAILABLE/);
});
