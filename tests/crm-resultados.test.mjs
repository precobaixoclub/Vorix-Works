import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresContactIdentityRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-identity-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import { PostgresDealRepository } from "../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import { PostgresTaskRepository } from "../dist/infrastructure/storage/postgres/postgres-task-repository.js";
import { PostgresProposalRepository } from "../dist/infrastructure/storage/postgres/postgres-proposal-repository.js";
import { PostgresCommercialMetricsRepository } from "../dist/infrastructure/storage/postgres/postgres-commercial-metrics-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { PostgresInboxMetricsRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-metrics-repository.js";
import { createContact } from "../dist/application/crm/contact-use-cases.js";
import { createPipeline, createStage } from "../dist/application/crm/pipeline-use-cases.js";
import { createDeal, moveDealStage } from "../dist/application/crm/deal-use-cases.js";
import { createProposal, sendProposal, acceptPublicProposal } from "../dist/application/crm/proposal-use-cases.js";
import { getCommercialMetrics } from "../dist/application/crm/commercial-metrics-use-cases.js";
import { getInboxMetrics } from "../dist/application/inbox/inbox-metrics-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * CRM/Comercial + Conversas — Fase 7 (Resultados). Foco: (1) métricas comerciais — negócios
 * criados, valor em aberto, ganhos/perdidos, conversão, ticket médio, propostas, negócios sem
 * próximo passo, aging por etapa, motivos de perda, receita por origem (única atribuição real —
 * `contacts.origin` — nunca inventada); (2) métricas de atendimento — recebidas, backlog, tempo de
 * primeira resposta, IA vs. humano; (3) filtros (pipeline/responsável/origem) restringem
 * corretamente o relatório comercial.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55706 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

function contactDeps() {
  return {
    contactRepository: new PostgresContactRepository(db.pool),
    contactIdentityRepository: new PostgresContactIdentityRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
  };
}

function pipelineDeps() {
  return { pipelineRepository: new PostgresPipelineRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool) };
}

function dealDeps() {
  return { dealRepository: new PostgresDealRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool), timelineEventRepository: new PostgresTimelineEventRepository(db.pool) };
}

function proposalDeps() {
  return { proposalRepository: new PostgresProposalRepository(db.pool), timelineEventRepository: new PostgresTimelineEventRepository(db.pool) };
}

function metricsDeps() {
  return { commercialMetricsRepository: new PostgresCommercialMetricsRepository(db.pool) };
}

async function makePipelineWithStages(tenantId, workspaceId) {
  const deps = pipelineDeps();
  const pipeline = await createPipeline(deps, { tenantId, workspaceId, name: "Vendas" });
  const novo = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Novo", position: 0 });
  const negociacao = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Negociação", position: 1 });
  const ganho = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Ganho", position: 2, isWon: true });
  const perdido = await createStage(deps, { pipelineId: pipeline.id, tenantId, workspaceId, name: "Perdido", position: 3, isLost: true });
  return { pipeline, novo, negociacao, ganho, perdido };
}

test("Métricas comerciais: negócios criados, aberto, ganho/perdido, conversão, ticket médio e negócios sem próximo passo", async () => {
  const tenantId = "tenant-metrics-1";
  const workspace = await makeWorkspace(tenantId);
  const { pipeline, novo, ganho, perdido } = await makePipelineWithStages(tenantId, workspace.id);
  const contactWhatsapp = await createContact(contactDeps(), { tenantId, workspaceId: workspace.id, name: "Cliente WhatsApp", origin: "whatsapp" });
  const contactIndicacao = await createContact(contactDeps(), { tenantId, workspaceId: workspace.id, name: "Cliente Indicação", origin: "indicação" });

  const dealWon = await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, contactId: contactWhatsapp.id, title: "Ganho 1", valueCents: 10_000 });
  await moveDealStage(dealDeps(), { dealId: dealWon.id, tenantId, workspaceId: workspace.id, targetStageId: ganho.id });

  const dealLost = await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, contactId: contactIndicacao.id, title: "Perdido 1", valueCents: 5_000 });
  await moveDealStage(dealDeps(), { dealId: dealLost.id, tenantId, workspaceId: workspace.id, targetStageId: perdido.id, lossReason: "Sem orçamento" });

  const dealOpen = await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, title: "Aberto sem próximo passo", valueCents: 20_000 });

  const report = await getCommercialMetrics(metricsDeps(), { tenantId, workspaceId: workspace.id });
  assert.equal(report.dealsCreatedCount, 3);
  assert.equal(report.wonCount, 1);
  assert.equal(report.wonValueCents, 10_000);
  assert.equal(report.lostCount, 1);
  assert.equal(report.conversionRate, 0.5);
  assert.equal(report.avgTicketCents, 10_000);
  assert.equal(report.openPipelineValueCents, 20_000);
  assert.equal(report.dealsWithoutNextActionCount, 1);
  assert.deepEqual(report.lossReasons, [{ reason: "Sem orçamento", count: 1 }]);
  assert.ok(report.revenueByOrigin.some((r) => r.origin === "whatsapp" && r.wonValueCents === 10_000));
  assert.equal(dealOpen.title, "Aberto sem próximo passo");
});

test("Métricas comerciais: aging por etapa, filtro por origem restringe o relatório", async () => {
  const tenantId = "tenant-metrics-2";
  const workspace = await makeWorkspace(tenantId);
  const { pipeline, novo, negociacao } = await makePipelineWithStages(tenantId, workspace.id);
  const contactA = await createContact(contactDeps(), { tenantId, workspaceId: workspace.id, name: "A", origin: "whatsapp" });
  const contactB = await createContact(contactDeps(), { tenantId, workspaceId: workspace.id, name: "B", origin: "instagram" });

  await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: novo.id, contactId: contactA.id, title: "Deal A" });
  await createDeal(dealDeps(), { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: negociacao.id, contactId: contactB.id, title: "Deal B" });

  const fullReport = await getCommercialMetrics(metricsDeps(), { tenantId, workspaceId: workspace.id });
  assert.equal(fullReport.dealsCreatedCount, 2);
  const stageForNovo = fullReport.stageAging.find((s) => s.stageId === novo.id);
  assert.equal(stageForNovo.openCount, 1);

  const filteredReport = await getCommercialMetrics(metricsDeps(), { tenantId, workspaceId: workspace.id, origin: "whatsapp" });
  assert.equal(filteredReport.dealsCreatedCount, 1);
});

test("Métricas comerciais: propostas enviadas/aceitas e taxa de aceite", async () => {
  const tenantId = "tenant-metrics-3";
  const workspace = await makeWorkspace(tenantId);
  const { proposal, rawToken } = await createProposal(proposalDeps(), { tenantId, workspaceId: workspace.id, title: "Proposta 1", items: [{ name: "Item", quantity: 1, unitPriceCents: 1000 }] });
  await sendProposal(proposalDeps(), { proposalId: proposal.id, tenantId, workspaceId: workspace.id });
  await acceptPublicProposal(proposalDeps(), rawToken);
  await createProposal(proposalDeps(), { tenantId, workspaceId: workspace.id, title: "Proposta 2 (nunca enviada)", items: [{ name: "Item", quantity: 1, unitPriceCents: 500 }] });

  const report = await getCommercialMetrics(metricsDeps(), { tenantId, workspaceId: workspace.id });
  assert.equal(report.proposalsSentCount, 1);
  assert.equal(report.proposalsAcceptedCount, 1);
  assert.equal(report.proposalAcceptRate, 1);
});

test("Métricas de atendimento: recebidas, backlog, IA vs. humano e tempo de primeira resposta", async () => {
  const tenantId = "tenant-metrics-4";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const inboxContactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "WhatsApp" });
  const inboxContact = await inboxContactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: "+5511900000001", name: "Cliente" });
  const conversation = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, contactId: inboxContact.id });

  await messageRepo.create({ tenantId, workspaceId: workspace.id, conversationId: conversation.id, connectionId: connection.id, direction: "inbound", type: "text", body: "Oi" });
  await messageRepo.create({ tenantId, workspaceId: workspace.id, conversationId: conversation.id, connectionId: connection.id, direction: "outbound", type: "text", body: "Olá! Como posso ajudar?", sentByAi: true });

  const report = await getInboxMetrics({ inboxMetricsRepository: new PostgresInboxMetricsRepository(db.pool) }, { tenantId, workspaceId: workspace.id });
  assert.equal(report.receivedCount, 1);
  assert.equal(report.openCount, 1);
  assert.equal(report.backlogCount, 1);
  assert.equal(report.aiResolvedMessageCount, 1);
  assert.equal(report.humanResolvedMessageCount, 0);
  assert.ok(report.avgFirstResponseSeconds !== undefined);
});
