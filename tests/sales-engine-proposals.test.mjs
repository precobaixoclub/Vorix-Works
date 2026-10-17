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
import {
  PostgresCommercialApprovalRepository,
  PostgresDealItemRepository,
  PostgresSalesCatalogRepository,
  PostgresSalesConfigRepository,
} from "../dist/infrastructure/storage/postgres/postgres-sales-engine-repositories.js";
import { ensureDefaultPipeline } from "../dist/application/crm/pipeline-use-cases.js";
import { createDeal } from "../dist/application/crm/deal-use-cases.js";
import {
  acceptPublicProposal,
  applyProposalAcceptanceToDeal,
  createProposalVersion,
  getPublicProposal,
  publicProposalContent,
  rejectPublicProposal,
  sendProposal,
} from "../dist/application/crm/proposal-use-cases.js";
import { addDealItem, decideCommercialApproval } from "../dist/application/sales/deal-commercial-use-cases.js";
import {
  createProposalFromDeal,
  proposalAcceptanceHandler,
  proposalApprovalGate,
  renderProposalMessage,
  runProposalFollowUps,
} from "../dist/application/sales/proposal-sales-use-cases.js";
import { updateCommercialSettings } from "../dist/application/sales/sales-config-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** Sales Engine — fases 5–7: proposta gerada da oportunidade, aprovação antes do envio, versões
 * que se substituem, rastreio real (link ≠ WhatsApp lido), aceite auditado e idempotente,
 * ganho automático configurável e follow-up sem spam. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-prop-${++counter}`;

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function setup({ autoWin = false } = {}) {
  const tenantId = nextId("tenant");
  const workspace = await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }).create({ tenantId, name: "W" });
  const workspaceId = workspace.id;
  const buyerEvents = [];
  const base = {
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
    proposalRepository: new PostgresProposalRepository(db.pool),
  };
  const proposal = {
    proposalRepository: base.proposalRepository,
    timelineEventRepository: base.timelineEventRepository,
    contactRepository: base.contactRepository,
    dealRepository: base.dealRepository,
    approvalGate: proposalApprovalGate(base),
    onBuyerEvent: async (event) => { buyerEvents.push(`${event.type}:${event.proposal.viewCount}`); },
  };
  const d = { ...base, proposal };
  const { pipeline, stages } = await ensureDefaultPipeline(d, tenantId, workspaceId);
  const seller = { tenantId, userId: nextId("seller"), role: "editor" };
  const manager = { tenantId, userId: nextId("manager"), role: "admin" };
  const contact = await base.contactRepository.create({ tenantId, workspaceId, name: "Ana Souza", company: "Empresa ABC" });
  const deal = await createDeal(d, { tenantId, workspaceId, pipelineId: pipeline.id, stageId: stages[1].id, contactId: contact.id, title: "Plano Pro", ownerUserId: seller.userId });
  const product = await base.productRepository.create({ tenantId, workspaceId, name: "Plano Pro", priceCents: 100000, costCents: 40000, minimumPriceCents: 80000 });
  if (autoWin) await updateCommercialSettings(d, { tenantId, workspaceId, patch: { proposalAcceptAutoWin: true } });
  return { d, tenantId, workspaceId, seller, manager, deal, product, stages, buyerEvents };
}

test("Gerar proposta da oportunidade puxa cliente, itens e totais (número PROP-AAAA-NNN v1)", async () => {
  const { d, workspaceId, seller, deal, product } = await setup();
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: product.id, quantity: 2, proposedUnitPriceCents: 95000 });
  const { proposal, approvalRequired } = await createProposalFromDeal(d, seller, { workspaceId, dealId: deal.id });
  assert.equal(approvalRequired, false);
  assert.equal(proposal.status, "draft");
  assert.equal(proposal.contactId, deal.contactId);
  assert.equal(proposal.totalCents, 190000);
  assert.equal(proposal.listTotalCents, 200000);
  assert.equal(proposal.items[0].listPriceCents, 100000);
  assert.match(proposal.number, /^PROP-\d{4}-001$/);
  assert.equal(proposal.version, 1);
  const content = publicProposalContent(proposal);
  assert.equal(JSON.stringify(content).includes("unitCostCents"), false, "custo nunca vai para o cliente");
  const events = await d.proposalRepository.listEvents(proposal.id);
  assert.deepEqual(events.map((event) => event.eventType), ["created"]);
  const second = await createProposalFromDeal(d, seller, { workspaceId, dealId: deal.id });
  assert.match(second.proposal.number, /-002$/);
});

test("Abaixo do mínimo: proposta nasce aguardando aprovação; envio bloqueado até o gestor aprovar", async () => {
  const { d, workspaceId, tenantId, seller, manager, deal, product } = await setup();
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: product.id, quantity: 1, proposedUnitPriceCents: 75000 });
  const { proposal, approvalRequired } = await createProposalFromDeal(d, seller, { workspaceId, dealId: deal.id, justification: "Concorrência" });
  assert.equal(approvalRequired, true);
  assert.equal(proposal.status, "pending_approval");
  await assert.rejects(sendProposal(d.proposal, { proposalId: proposal.id, tenantId, workspaceId }), /COMMERCIAL_APPROVAL_REQUIRED/);
  const [request] = await d.approvalRepository.listByWorkspace({ tenantId, workspaceId, status: "pending" });
  assert.equal(request.proposalId, proposal.id);
  await decideCommercialApproval(d, manager, { workspaceId, approvalId: request.id, decision: "approved", reason: "estratégico" });
  assert.equal((await d.proposalRepository.getById(proposal.id)).status, "approved");
  const sent = await sendProposal(d.proposal, { proposalId: proposal.id, tenantId, workspaceId, actorUserId: seller.userId, channel: "link" });
  assert.equal(sent.status, "sent");
  assert.equal(sent.sentByUserId, seller.userId);
});

test("Nova versão substitui a anterior só quando enviada; link antigo não aceita mais", async () => {
  const { d, workspaceId, tenantId, seller, deal, product } = await setup();
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: product.id, quantity: 1 });
  const { proposal: v1, rawToken: v1Token } = await createProposalFromDeal(d, seller, { workspaceId, dealId: deal.id });
  await sendProposal(d.proposal, { proposalId: v1.id, tenantId, workspaceId });
  const { proposal: v2 } = await createProposalVersion(d.proposal, { proposalId: v1.id, tenantId, workspaceId, actorUserId: seller.userId, overrides: { discountCents: 5000 } });
  assert.equal(v2.version, 2);
  assert.equal(v2.number, v1.number);
  assert.equal(v2.totalCents, 95000);
  assert.equal((await d.proposalRepository.getById(v1.id)).status, "sent", "v1 continua vigente até a v2 ser enviada");
  await sendProposal(d.proposal, { proposalId: v2.id, tenantId, workspaceId });
  const oldOne = await d.proposalRepository.getById(v1.id);
  assert.equal(oldOne.status, "superseded");
  assert.equal(oldOne.supersededByProposalId, v2.id);
  await assert.rejects(acceptPublicProposal(d.proposal, v1Token), /PROPOSAL_SUPERSEDED/);
});

test("Visualização só pelo link real; alerta na 1ª abertura e no sinal quente, não a cada refresh", async () => {
  const { d, workspaceId, tenantId, seller, deal, product, buyerEvents } = await setup();
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: product.id, quantity: 1 });
  const { proposal, rawToken } = await createProposalFromDeal(d, seller, { workspaceId, dealId: deal.id });
  const draftView = await getPublicProposal(d.proposal, rawToken);
  assert.equal(draftView.viewCount, 0, "rascunho não conta visualização");
  await sendProposal(d.proposal, { proposalId: proposal.id, tenantId, workspaceId });
  for (let i = 0; i < 4; i++) await getPublicProposal(d.proposal, rawToken);
  const viewed = await d.proposalRepository.getById(proposal.id);
  assert.equal(viewed.status, "viewed");
  assert.equal(viewed.viewCount, 4);
  assert.deepEqual(buyerEvents, ["first_view:1", "hot_view:3"]);
  const events = (await d.proposalRepository.listEvents(proposal.id)).map((event) => event.eventType);
  assert.equal(events.filter((type) => type === "viewed").length, 4);
});

test("Aceite idempotente e auditado; padrão não ganha a oportunidade automaticamente", async () => {
  const { d, workspaceId, tenantId, seller, deal, product } = await setup();
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: product.id, quantity: 1 });
  const { proposal, rawToken } = await createProposalFromDeal(d, seller, { workspaceId, dealId: deal.id });
  await sendProposal(d.proposal, { proposalId: proposal.id, tenantId, workspaceId });
  const accepted = await acceptPublicProposal(d.proposal, rawToken, { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (iPhone)" });
  const again = await acceptPublicProposal(d.proposal, rawToken, { ip: "203.0.113.9" });
  assert.equal(accepted.status, "accepted");
  assert.equal(again.respondedAt, accepted.respondedAt);
  assert.equal(accepted.acceptedVersion, 1);
  assert.match(accepted.acceptedContentHash, /^[a-f0-9]{64}$/);
  const events = (await d.proposalRepository.listEvents(proposal.id)).map((event) => event.eventType);
  assert.equal(events.filter((type) => type === "accepted").length, 1);
  const raw = await db.pool.query("select accepted_ip_hash, accepted_user_agent from proposals where id = $1", [proposal.id]);
  assert.notEqual(raw.rows[0].accepted_ip_hash, "203.0.113.9", "IP nunca guardado em claro");
  await applyProposalAcceptanceToDeal({ ...d, acceptanceHandler: proposalAcceptanceHandler(d) }, accepted);
  assert.equal((await d.dealRepository.getById(deal.id)).status, "open", "padrão B: vendedor finaliza manualmente");
});

test("Com ganho automático configurado, o aceite fecha a venda com o valor da proposta", async () => {
  const { d, workspaceId, tenantId, seller, deal, product } = await setup({ autoWin: true });
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: product.id, quantity: 1, proposedUnitPriceCents: 90000 });
  const { proposal, rawToken } = await createProposalFromDeal(d, seller, { workspaceId, dealId: deal.id });
  await sendProposal(d.proposal, { proposalId: proposal.id, tenantId, workspaceId });
  const accepted = await acceptPublicProposal(d.proposal, rawToken);
  await applyProposalAcceptanceToDeal({ ...d, acceptanceHandler: proposalAcceptanceHandler(d) }, accepted);
  const won = await d.dealRepository.getById(deal.id);
  assert.equal(won.status, "won");
  assert.equal(won.wonProposalId, proposal.id);
  assert.equal(won.finalValueCents, 90000);
  assert.equal(won.creditedOwnerUserId, seller.userId);
});

test("Recusa registra motivo e não perde a oportunidade; proposta vencida não é aceita", async () => {
  const { d, workspaceId, tenantId, seller, deal, product } = await setup();
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: product.id, quantity: 1 });
  const { proposal, rawToken } = await createProposalFromDeal(d, seller, { workspaceId, dealId: deal.id });
  await sendProposal(d.proposal, { proposalId: proposal.id, tenantId, workspaceId });
  const declined = await rejectPublicProposal(d.proposal, rawToken, { reason: "Prazo", comment: "Precisamos para março" });
  assert.equal(declined.status, "rejected");
  assert.equal(declined.rejectionReason, "Prazo");
  assert.equal((await d.dealRepository.getById(deal.id)).status, "open");

  const expired = await createProposalFromDeal(d, seller, { workspaceId, dealId: deal.id, validUntil: "2020-01-01" });
  await assert.rejects(sendProposal(d.proposal, { proposalId: expired.proposal.id, tenantId, workspaceId }), /PROPOSAL_NOT_SENDABLE/);
});

test("Follow-up: tarefa única para proposta enviada e não aberta em 24h (sem spam)", async () => {
  const { d, workspaceId, tenantId, seller, deal, product } = await setup();
  await addDealItem(d, seller, { workspaceId, dealId: deal.id, productId: product.id, quantity: 1 });
  const { proposal } = await createProposalFromDeal(d, seller, { workspaceId, dealId: deal.id });
  await sendProposal(d.proposal, { proposalId: proposal.id, tenantId, workspaceId });
  await db.pool.query("update proposals set sent_at = now() - interval '25 hours' where id = $1", [proposal.id]);
  const first = await runProposalFollowUps(d);
  const second = await runProposalFollowUps(d);
  assert.ok(first.tasks >= 1);
  assert.equal(second.tasks, 0);
  const tasks = await d.taskRepository.listByWorkspace({ tenantId, workspaceId, dealId: deal.id });
  assert.equal(tasks.filter((task) => task.type === "follow_up").length, 1);
  assert.equal(tasks[0].ownerUserId, seller.userId);
});

test("Mensagem do WhatsApp vem de modelo configurável e sempre leva o link", () => {
  const text = renderProposalMessage("Olá, {{nome}}! Valor: {{valor}} até {{validade}}.", { nome: "Ana", valor: "R$ 1.000,00", validade: "30/10/2026", proposal_link: "https://app/p/abc" });
  assert.equal(text, "Olá, Ana! Valor: R$ 1.000,00 até 30/10/2026.\n\nhttps://app/p/abc");
  assert.equal(renderProposalMessage("Veja: {{proposal_link}}", { valor: "x", proposal_link: "https://app/p/abc" }), "Veja: https://app/p/abc");
});
