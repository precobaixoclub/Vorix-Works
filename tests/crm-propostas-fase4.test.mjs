import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresProposalRepository } from "../dist/infrastructure/storage/postgres/postgres-proposal-repository.js";
import { PostgresProposalTemplateRepository } from "../dist/infrastructure/storage/postgres/postgres-proposal-template-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import { PostgresDealRepository } from "../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import { ensureDefaultPipeline } from "../dist/application/crm/pipeline-use-cases.js";
import { createDeal } from "../dist/application/crm/deal-use-cases.js";
import { acceptPublicProposal, applyProposalAcceptanceToDeal, createProposal, getPublicProposal, regenerateProposalLink, rejectPublicProposal, revokeProposalLink, sendProposal } from "../dist/application/crm/proposal-use-cases.js";
import { createProposalTemplate, deleteProposalTemplate, duplicateProposalTemplate, listProposalTemplates, updateProposalTemplate } from "../dist/application/crm/proposal-template-use-cases.js";
import { deliverProposalThroughInbox } from "../dist/application/commercial/proposal-delivery-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;

before(async () => { db = await startTestPostgres({ port: 55712 }); await applyMigrations(db.pool, MIGRATIONS_DIR); });
after(async () => { await db.stop(); });

async function workspace(tenantId) {
  return new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `workspace-phase4-${++counter}` }).create({ tenantId, name: "W" });
}
function proposalDeps() { return { proposalRepository: new PostgresProposalRepository(db.pool), timelineEventRepository: new PostgresTimelineEventRepository(db.pool) }; }
function templateDeps() { return { proposalTemplateRepository: new PostgresProposalTemplateRepository(db.pool) }; }
function dealLinkDeps() {
  return {
    dealRepository: new PostgresDealRepository(db.pool),
    pipelineStageRepository: new PostgresPipelineStageRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
  };
}

/** Pipeline padrão (6 etapas, com Ganho/Perdido já configurados) + 1 Deal aberto na primeira
 * etapa — mesma fixture de `crm-pipelines-deals.test.mjs`, reusada aqui pra testar o vínculo
 * Proposal->Deal sem duplicar a lógica de setup de pipeline. */
async function dealInOpenStage(tenantId, workspaceId) {
  const pipelineDeps = { pipelineRepository: new PostgresPipelineRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool) };
  const { pipeline, stages } = await ensureDefaultPipeline(pipelineDeps, tenantId, workspaceId);
  const openStage = stages.find((stage) => !stage.isWon && !stage.isLost);
  const deal = await createDeal(dealLinkDeps(), { tenantId, workspaceId, pipelineId: pipeline.id, stageId: openStage.id, title: "Negócio Fase 4" });
  return { pipeline, stages, deal };
}

test("Fase 4 registra primeira/ultima abertura e quantidade sem dados invasivos", async () => {
  const tenantId = "tenant-phase4-view";
  const ws = await workspace(tenantId);
  const deps = proposalDeps();
  const { proposal, rawToken } = await createProposal(deps, { tenantId, workspaceId: ws.id, title: "Tracking", items: [{ name: "Item", quantity: 1, unitPriceCents: 100 }] });
  await sendProposal(deps, { proposalId: proposal.id, tenantId, workspaceId: ws.id });
  const first = await getPublicProposal(deps, rawToken);
  const second = await getPublicProposal(deps, rawToken);
  assert.equal(first.viewCount, 1);
  assert.equal(second.viewCount, 2);
  assert.equal(second.viewedAt, first.viewedAt);
  assert.ok(second.lastViewedAt);
  const columns = await db.pool.query("select column_name from information_schema.columns where table_name='proposal_views'");
  assert.deepEqual(columns.rows.map((row) => row.column_name).sort(), ["id", "proposal_id", "viewed_at"]);
});

test("Fase 4 rotaciona e revoga token; resposta repetida e idempotente", async () => {
  const tenantId = "tenant-phase4-link";
  const ws = await workspace(tenantId);
  const deps = proposalDeps();
  const { proposal, rawToken } = await createProposal(deps, { tenantId, workspaceId: ws.id, title: "Link", items: [{ name: "Item", quantity: 1, unitPriceCents: 100 }] });
  await sendProposal(deps, { proposalId: proposal.id, tenantId, workspaceId: ws.id });
  const rotated = await regenerateProposalLink(deps, { proposalId: proposal.id, tenantId, workspaceId: ws.id });
  await assert.rejects(() => getPublicProposal(deps, rawToken), /PROPOSAL_NOT_FOUND/);
  await getPublicProposal(deps, rotated.rawToken);
  const rejected = await rejectPublicProposal(deps, rotated.rawToken, { reason: "price", comment: "Acima do orçamento" });
  assert.equal(rejected.rejectionReason, "price");
  assert.equal((await rejectPublicProposal(deps, rotated.rawToken, { reason: "other" })).id, proposal.id);

  const next = await createProposal(deps, { tenantId, workspaceId: ws.id, title: "Revogação", items: [{ name: "Item", quantity: 1, unitPriceCents: 100 }] });
  await sendProposal(deps, { proposalId: next.proposal.id, tenantId, workspaceId: ws.id });
  await revokeProposalLink(deps, { proposalId: next.proposal.id, tenantId, workspaceId: ws.id });
  await assert.rejects(() => getPublicProposal(deps, next.rawToken), /PROPOSAL_LINK_REVOKED/);
});

test("Fase 4 modelos tem CRUD, duplicacao e isolamento multi-tenant", async () => {
  const tenantA = "tenant-phase4-template-a";
  const tenantB = "tenant-phase4-template-b";
  const wsA = await workspace(tenantA);
  const wsB = await workspace(tenantB);
  const deps = templateDeps();
  const template = await createProposalTemplate(deps, { tenantId: tenantA, workspaceId: wsA.id, name: "Padrao", defaultTitle: "Proposta padrao", defaultItems: [{ name: "Plano", quantity: 2, unitPriceCents: 500, subtotalCents: 0 }], defaultValidDays: 7 });
  assert.equal(template.defaultItems[0].subtotalCents, 1000);
  const copy = await duplicateProposalTemplate(deps, { id: template.id, tenantId: tenantA, workspaceId: wsA.id });
  await updateProposalTemplate(deps, { id: template.id, tenantId: tenantA, workspaceId: wsA.id, patch: { active: false } });
  assert.equal((await listProposalTemplates(deps, { tenantId: tenantA, workspaceId: wsA.id, activeOnly: true })).length, 1);
  assert.equal((await listProposalTemplates(deps, { tenantId: tenantB, workspaceId: wsB.id })).length, 0);
  await assert.rejects(() => updateProposalTemplate(deps, { id: template.id, tenantId: tenantB, workspaceId: wsB.id, patch: { name: "Invalido" } }), /PROPOSAL_TEMPLATE_NOT_FOUND/);
  await deleteProposalTemplate(deps, { id: copy.id, tenantId: tenantA, workspaceId: wsA.id });
  assert.equal((await listProposalTemplates(deps, { tenantId: tenantA, workspaceId: wsA.id })).length, 1);
});

test("Fase 4 reserva idempotente impede envio duplicado, inclusive em falha de publish", async () => {
  const tenantId = "tenant-phase4-delivery";
  const ws = await workspace(tenantId);
  const contact = await new PostgresContactRepository(db.pool).create({ tenantId, workspaceId: ws.id, name: "Contato" });
  const inboxContactRepository = new PostgresInboxContactRepository(db.pool);
  const inboxContact = await inboxContactRepository.upsertByPhone({ tenantId, workspaceId: ws.id, phoneNormalized: "+5511999999999", name: "Contato" });
  await inboxContactRepository.linkCrmContact(inboxContact.id, contact.id);
  const connectionRepository = new PostgresMessagingConnectionRepository(db.pool);
  const connection = await connectionRepository.create({ tenantId, workspaceId: ws.id, provider: "wuzapi", displayName: "WhatsApp" });
  const conversationRepository = new PostgresInboxConversationRepository(db.pool);
  const conversation = await conversationRepository.findOrCreate({
    tenantId, workspaceId: ws.id, connectionId: connection.id, chatType: "direct",
    externalChatId: "+5511999999999", contactId: inboxContact.id,
  });
  const deps = proposalDeps();
  const first = await createProposal(deps, { tenantId, workspaceId: ws.id, contactId: contact.id, title: "Envio", items: [{ name: "Item", quantity: 1, unitPriceCents: 100 }] });
  let publishCount = 0;
  let publishShouldFail = false;
  const inbox = {
    connectionRepository,
    contactRepository: inboxContactRepository,
    conversationRepository,
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    workspaceRepository: new PostgresWorkspaceRepository(db.pool),
    outboundQueue: {
      publish: async () => {
        publishCount += 1;
        if (publishShouldFail) throw new Error("queue unavailable");
      },
    },
    providers: {},
  };
  const deliveryDeps = { ...deps, inbox, appBaseUrl: "https://app.example.test" };

  const sent = await deliverProposalThroughInbox(deliveryDeps, {
    proposalId: first.proposal.id, tenantId, workspaceId: ws.id, conversationId: conversation.id,
    message: "Veja: {{proposalUrl}}", idempotencyKey: "same-success", sentByUserId: "user-phase4",
  });
  const repeated = await deliverProposalThroughInbox(deliveryDeps, {
    proposalId: first.proposal.id, tenantId, workspaceId: ws.id, conversationId: conversation.id,
    message: "Veja: {{proposalUrl}}", idempotencyKey: "same-success", sentByUserId: "user-phase4",
  });
  assert.equal(sent.status, "sent");
  assert.equal(repeated.id, sent.id);
  assert.equal(publishCount, 1);
  assert.equal(Number((await db.pool.query("select count(*) from inbox_messages where conversation_id = $1", [conversation.id])).rows[0].count), 1);

  const second = await createProposal(deps, { tenantId, workspaceId: ws.id, contactId: contact.id, title: "Falha", items: [{ name: "Item", quantity: 1, unitPriceCents: 100 }] });
  publishShouldFail = true;
  const failedInput = {
    proposalId: second.proposal.id, tenantId, workspaceId: ws.id, conversationId: conversation.id,
    message: "Veja: {{proposalUrl}}", idempotencyKey: "same-failure", sentByUserId: "user-phase4",
  };
  await assert.rejects(() => deliverProposalThroughInbox(deliveryDeps, failedInput), /queue unavailable/);
  await assert.rejects(() => deliverProposalThroughInbox(deliveryDeps, failedInput), /PROPOSAL_SEND_IN_PROGRESS/);
  assert.equal(publishCount, 2);
  assert.equal(Number((await db.pool.query("select count(*) from inbox_messages where conversation_id = $1", [conversation.id])).rows[0].count), 2);
});

test("Fase 4 aceite move Deal pra Ganho e e idempotente em duplo aceite", async () => {
  const tenantId = "tenant-phase4-accept";
  const ws = await workspace(tenantId);
  const { deal } = await dealInOpenStage(tenantId, ws.id);
  const deps = { ...proposalDeps(), dealRepository: new PostgresDealRepository(db.pool) };
  const linkDeps = dealLinkDeps();
  const { proposal, rawToken } = await createProposal(deps, { tenantId, workspaceId: ws.id, dealId: deal.id, title: "Aceite", items: [{ name: "Item", quantity: 1, unitPriceCents: 100 }] });
  await sendProposal(deps, { proposalId: proposal.id, tenantId, workspaceId: ws.id });

  const accepted = await acceptPublicProposal(deps, rawToken);
  assert.equal(accepted.status, "accepted");
  await applyProposalAcceptanceToDeal(linkDeps, accepted);
  const wonDeal = await linkDeps.dealRepository.getById(deal.id);
  assert.ok(wonDeal.wonAt, "Deal deveria ter wonAt preenchido após aceite");
  assert.equal(wonDeal.lostAt, undefined);

  // Duplo aceite (retry/duplo-clique) — nem `acceptPublicProposal` nem
  // `applyProposalAcceptanceToDeal` podem duplicar efeito (item 54 do pedido).
  const acceptedAgain = await acceptPublicProposal(deps, rawToken);
  assert.equal(acceptedAgain.id, accepted.id);
  assert.equal(acceptedAgain.respondedAt, accepted.respondedAt, "segundo aceite não deve trocar respondedAt");
  await applyProposalAcceptanceToDeal(linkDeps, acceptedAgain);
  const wonDealAgain = await linkDeps.dealRepository.getById(deal.id);
  assert.equal(wonDealAgain.wonAt, wonDeal.wonAt, "segunda chamada não deve trocar wonAt (no-op, já estava na etapa de Ganho)");

  const timeline = await linkDeps.timelineEventRepository.listByEntity({ entityType: "deal", entityId: deal.id });
  const wonEvents = timeline.filter((event) => event.eventType === "deal_stage_changed" && event.payload?.trigger === "proposal_accepted");
  assert.equal(wonEvents.length, 1, "deal_stage_changed por aceite de proposta deveria acontecer uma única vez, não duas");
});

test("Fase 4 tracking de visualização é preservado depois do aceite", async () => {
  const tenantId = "tenant-phase4-tracking-accept";
  const ws = await workspace(tenantId);
  const deps = proposalDeps();
  const { proposal, rawToken } = await createProposal(deps, { tenantId, workspaceId: ws.id, title: "Tracking + aceite", items: [{ name: "Item", quantity: 1, unitPriceCents: 100 }] });
  await sendProposal(deps, { proposalId: proposal.id, tenantId, workspaceId: ws.id });
  await getPublicProposal(deps, rawToken);
  const beforeAccept = await getPublicProposal(deps, rawToken);
  assert.equal(beforeAccept.viewCount, 2);

  const accepted = await acceptPublicProposal(deps, rawToken);
  assert.equal(accepted.viewCount, beforeAccept.viewCount, "aceitar não deveria mexer no contador de visualizações");
  assert.equal(accepted.viewedAt, beforeAccept.viewedAt, "aceitar não deveria mexer na primeira visualização");
  assert.equal(accepted.lastViewedAt, beforeAccept.lastViewedAt, "aceitar não deveria mexer na última visualização");
});

test("Fase 4 template pré-preenche, mas Proposal já criada vira snapshot independente", async () => {
  const tenantId = "tenant-phase4-template-snapshot";
  const ws = await workspace(tenantId);
  const tplDeps = templateDeps();
  const proposalDepsForTest = proposalDeps();
  const template = await createProposalTemplate(tplDeps, {
    tenantId, workspaceId: ws.id, name: "Consultoria", defaultTitle: "Proposta de Consultoria",
    defaultItems: [{ name: "Consultoria mensal", quantity: 1, unitPriceCents: 250000, subtotalCents: 0 }],
    defaultConditions: "Pagamento em até 5 dias úteis.", defaultValidDays: 10,
  });

  // O "aplicar modelo" em si é uma ação de frontend (QuickCreateProposalModal copia os campos do
  // template pro formulário antes de enviar) — aqui simulamos exatamente essa cópia, chamando
  // `createProposal` com os valores do template, pra verificar o que importa de verdade: depois
  // de criada, a Proposal para de depender do template (item 7/8 do pedido).
  const { proposal } = await createProposal(proposalDepsForTest, {
    tenantId, workspaceId: ws.id, title: template.defaultTitle,
    items: template.defaultItems.map(({ name, quantity, unitPriceCents, productId }) => ({ name, quantity, unitPriceCents, productId })),
    conditions: template.defaultConditions,
  });
  assert.equal(proposal.title, "Proposta de Consultoria");
  assert.equal(proposal.items[0].subtotalCents, 250000);

  // Muda e depois apaga o template — a Proposal já criada não pode refletir nenhuma das duas coisas.
  await updateProposalTemplate(tplDeps, { id: template.id, tenantId, workspaceId: ws.id, patch: { defaultTitle: "Nome mudou", defaultConditions: "Condição mudou" } });
  await deleteProposalTemplate(tplDeps, { id: template.id, tenantId, workspaceId: ws.id });

  const stillSnapshot = await proposalDepsForTest.proposalRepository.getById(proposal.id);
  assert.equal(stillSnapshot.title, "Proposta de Consultoria", "título da proposta já criada não pode mudar com o template");
  assert.equal(stillSnapshot.conditions, "Pagamento em até 5 dias úteis.", "condições da proposta já criada não podem mudar com o template");
  assert.equal(stillSnapshot.items[0].subtotalCents, 250000, "itens da proposta já criada continuam snapshot mesmo com o template apagado");
});

test("Fase 4 recusa nunca move o Deal vinculado — negócio continua aberto", async () => {
  const tenantId = "tenant-phase4-reject-deal";
  const ws = await workspace(tenantId);
  const { deal, stages } = await dealInOpenStage(tenantId, ws.id);
  const openStageId = deal.stageId;
  const deps = { ...proposalDeps(), dealRepository: new PostgresDealRepository(db.pool) };
  const { proposal, rawToken } = await createProposal(deps, { tenantId, workspaceId: ws.id, dealId: deal.id, title: "Recusa com negócio", items: [{ name: "Item", quantity: 1, unitPriceCents: 100 }] });
  await sendProposal(deps, { proposalId: proposal.id, tenantId, workspaceId: ws.id });

  const rejected = await rejectPublicProposal(deps, rawToken, { reason: "price" });
  assert.equal(rejected.status, "rejected");

  const dealRepository = new PostgresDealRepository(db.pool);
  const dealAfterReject = await dealRepository.getById(deal.id);
  assert.equal(dealAfterReject.stageId, openStageId, "recusar a proposta nunca deveria mudar a etapa do negócio");
  assert.equal(dealAfterReject.lostAt, undefined, "recusar a proposta nunca deveria marcar o negócio como perdido automaticamente");
  const lostStage = stages.find((stage) => stage.isLost);
  assert.notEqual(dealAfterReject.stageId, lostStage.id);
});
