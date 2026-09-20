import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresContactIdentityRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-identity-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import { PostgresDealRepository } from "../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import { PostgresTaskRepository } from "../dist/infrastructure/storage/postgres/postgres-task-repository.js";
import { PostgresProposalRepository } from "../dist/infrastructure/storage/postgres/postgres-proposal-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxConversationEventRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-event-repository.js";
import { ensureDefaultPipeline } from "../dist/application/crm/pipeline-use-cases.js";
import { createContact, linkContactIdentity } from "../dist/application/crm/contact-use-cases.js";
import { createDeal, moveDealStage } from "../dist/application/crm/deal-use-cases.js";
import { createTask, completeTask, updateTask } from "../dist/application/crm/task-use-cases.js";
import { createProposal, sendProposal, getPublicProposal, acceptPublicProposal, rejectPublicProposal, applyProposalAcceptanceToDeal } from "../dist/application/crm/proposal-use-cases.js";
import { takeOverConversation, transferConversation, setAiConversationEnabled, closeConversation } from "../dist/application/inbox/inbox-use-cases.js";
import { getContactActivity } from "../dist/application/commercial/contact-activity-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fase5-${++counter}`;

before(async () => { db = await startTestPostgres({ port: 55713 }); await applyMigrations(db.pool, MIGRATIONS_DIR); });
after(async () => { await db.stop(); });

function crmDeps() {
  return {
    contactRepository: new PostgresContactRepository(db.pool),
    contactIdentityRepository: new PostgresContactIdentityRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
  };
}
function dealDeps() {
  return { dealRepository: new PostgresDealRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool), timelineEventRepository: new PostgresTimelineEventRepository(db.pool) };
}
function taskDeps() {
  return { taskRepository: new PostgresTaskRepository(db.pool), timelineEventRepository: new PostgresTimelineEventRepository(db.pool) };
}
function proposalDeps() {
  return { proposalRepository: new PostgresProposalRepository(db.pool), timelineEventRepository: new PostgresTimelineEventRepository(db.pool) };
}
function activityDeps(withInbox = true) {
  return {
    contactRepository: new PostgresContactRepository(db.pool),
    dealRepository: new PostgresDealRepository(db.pool),
    taskRepository: new PostgresTaskRepository(db.pool),
    proposalRepository: new PostgresProposalRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
    inbox: withInbox ? {
      conversationRepository: new PostgresInboxConversationRepository(db.pool),
      conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool),
    } : undefined,
  };
}

async function makeWorkspace(tenantId) {
  return new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }).create({ tenantId, name: "W" });
}

async function makeConversationForContact(tenantId, workspaceId, crmContactId) {
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const inboxContactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const connection = await connectionRepo.create({ tenantId, workspaceId, provider: "wuzapi", displayName: "Conexão" });
  const phone = `+55119${String(counter).padStart(8, "0")}`;
  const inboxContact = await inboxContactRepo.upsertByPhone({ tenantId, workspaceId, phoneNormalized: phone });
  await inboxContactRepo.linkCrmContact(inboxContact.id, crmContactId);
  const conversation = await conversationRepo.findOrCreate({ tenantId, workspaceId, connectionId: connection.id, chatType: "direct", externalChatId: phone, contactId: inboxContact.id });
  return conversationRepo.getById(conversation.id);
}

test("Fase 5 — Timeline 360 agrega contato, negócio, tarefa, proposta e conversa numa lista só, mais recente primeiro", async () => {
  const tenantId = "tenant-fase5-e2e-accept";
  const ws = await makeWorkspace(tenantId);
  const contact = await createContact(crmDeps(), { tenantId, workspaceId: ws.id, name: "Cliente Aceite" });
  const conversation = await makeConversationForContact(tenantId, ws.id, contact.id);
  const inboxDeps = { conversationRepository: new PostgresInboxConversationRepository(db.pool), conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool) };

  await takeOverConversation(inboxDeps, { conversationId: conversation.id, tenantId, workspaceId: ws.id, userId: "user-1" });

  const { pipeline, stages } = await ensureDefaultPipeline({ pipelineRepository: new PostgresPipelineRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool) }, tenantId, ws.id);
  const openStage = stages.find((stage) => !stage.isWon && !stage.isLost);
  const deal = await createDeal(dealDeps(), { tenantId, workspaceId: ws.id, pipelineId: pipeline.id, stageId: openStage.id, contactId: contact.id, title: "Negócio E2E" });

  const task = await createTask(taskDeps(), { tenantId, workspaceId: ws.id, contactId: contact.id, dealId: deal.id, type: "follow_up", title: "Ligar pro cliente" });
  await completeTask(taskDeps(), { taskId: task.id, tenantId, workspaceId: ws.id });

  const { proposal, rawToken } = await createProposal(proposalDeps(), { tenantId, workspaceId: ws.id, dealId: deal.id, contactId: contact.id, title: "Proposta E2E", items: [{ name: "Item", quantity: 1, unitPriceCents: 1000 }] });
  await sendProposal(proposalDeps(), { proposalId: proposal.id, tenantId, workspaceId: ws.id });
  await getPublicProposal(proposalDeps(), rawToken);
  const accepted = await acceptPublicProposal(proposalDeps(), rawToken);
  await applyProposalAcceptanceToDeal({ dealRepository: new PostgresDealRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool), timelineEventRepository: new PostgresTimelineEventRepository(db.pool) }, accepted);

  const activity = await getContactActivity(activityDeps(), { contactId: contact.id, tenantId, workspaceId: ws.id });

  const types = activity.map((item) => item.type);
  assert.ok(types.includes("contact_created"));
  assert.ok(types.includes("conversation_started"));
  assert.ok(types.includes("conversation_took_over"));
  assert.ok(types.includes("deal_created"));
  assert.ok(types.includes("task_created"));
  assert.ok(types.includes("task_completed"));
  assert.ok(types.includes("proposal_created"));
  assert.ok(types.includes("proposal_sent"));
  assert.ok(types.includes("proposal_viewed"));
  assert.ok(types.includes("proposal_accepted"));
  assert.ok(types.includes("deal_won"), "aceite da proposta move o negócio pra Ganho — deve aparecer como deal_won, nunca só deal_stage_changed genérico");

  // Ordenação: mais recente primeiro (deal_won foi o último a acontecer).
  assert.equal(activity[0].type, "deal_won");
  for (let i = 1; i < activity.length; i++) {
    assert.ok(activity[i - 1].occurredAt >= activity[i].occurredAt, "lista deve estar em ordem decrescente de occurredAt");
  }

  // Ator do aceite é o CLIENTE (via link público), nunca "system" cru.
  const acceptedItem = activity.find((item) => item.type === "proposal_accepted");
  assert.deepEqual(acceptedItem.actor, { type: "contact" });

  // "Assumir atendimento" foi um humano de verdade — nunca um UUID sem contexto de tipo.
  const tookOverItem = activity.find((item) => item.type === "conversation_took_over");
  assert.deepEqual(tookOverItem.actor, { type: "user", id: "user-1" });

  // Privacidade — nunca vaza token/hash público nem ids de conexão/mensageria crus no metadata.
  const serialized = JSON.stringify(activity);
  assert.ok(!serialized.includes(rawToken));
  assert.ok(!serialized.includes(accepted.publicTokenHash));
});

test("Fase 5 — recusa de proposta mantém negócio aberto e é registrada como ação do cliente", async () => {
  const tenantId = "tenant-fase5-e2e-reject";
  const ws = await makeWorkspace(tenantId);
  const contact = await createContact(crmDeps(), { tenantId, workspaceId: ws.id, name: "Cliente Recusa" });
  const { pipeline, stages } = await ensureDefaultPipeline({ pipelineRepository: new PostgresPipelineRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool) }, tenantId, ws.id);
  const openStage = stages.find((stage) => !stage.isWon && !stage.isLost);
  const deal = await createDeal(dealDeps(), { tenantId, workspaceId: ws.id, pipelineId: pipeline.id, stageId: openStage.id, contactId: contact.id, title: "Negócio Recusado" });
  const { proposal, rawToken } = await createProposal(proposalDeps(), { tenantId, workspaceId: ws.id, dealId: deal.id, contactId: contact.id, title: "Proposta Recusada", items: [{ name: "Item", quantity: 1, unitPriceCents: 500 }] });
  await sendProposal(proposalDeps(), { proposalId: proposal.id, tenantId, workspaceId: ws.id });
  await getPublicProposal(proposalDeps(), rawToken);
  await rejectPublicProposal(proposalDeps(), rawToken, { reason: "price", comment: "Caro" });

  const activity = await getContactActivity(activityDeps(), { contactId: contact.id, tenantId, workspaceId: ws.id });
  const rejectedItem = activity.find((item) => item.type === "proposal_rejected");
  assert.ok(rejectedItem);
  assert.deepEqual(rejectedItem.actor, { type: "contact" });
  assert.equal(rejectedItem.description, "Motivo: price");
  assert.ok(!activity.some((item) => item.type === "deal_won" || item.type === "deal_lost"), "recusa nunca move o negócio sozinha");

  const currentDeal = await new PostgresDealRepository(db.pool).getById(deal.id);
  assert.equal(currentDeal.stageId, openStage.id, "negócio continua na mesma etapa aberta após a recusa");
});

test("Fase 5 — contato sem negócio nenhum ainda mostra tarefa e conversa na Timeline", async () => {
  const tenantId = "tenant-fase5-sem-deal";
  const ws = await makeWorkspace(tenantId);
  const contact = await createContact(crmDeps(), { tenantId, workspaceId: ws.id, name: "Cliente Sem Negócio" });
  const conversation = await makeConversationForContact(tenantId, ws.id, contact.id);
  const inboxDeps = { conversationRepository: new PostgresInboxConversationRepository(db.pool), conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool) };
  await takeOverConversation(inboxDeps, { conversationId: conversation.id, tenantId, workspaceId: ws.id, userId: "user-2" });
  const task = await createTask(taskDeps(), { tenantId, workspaceId: ws.id, contactId: contact.id, type: "follow_up", title: "Follow-up sem negócio" });

  const activity = await getContactActivity(activityDeps(), { contactId: contact.id, tenantId, workspaceId: ws.id });
  const types = activity.map((item) => item.type);
  assert.ok(types.includes("task_created"));
  assert.ok(types.includes("conversation_started"));
  assert.ok(!types.includes("deal_created"), "nunca deve inventar/exigir negócio pra Timeline funcionar");
  assert.ok(types.every((type) => !type.startsWith("deal_")));
  void task;
});

test("Fase 5 — funciona sem o módulo Conversas (inbox desligado) usando só eventos CRM", async () => {
  const tenantId = "tenant-fase5-no-inbox";
  const ws = await makeWorkspace(tenantId);
  const contact = await createContact(crmDeps(), { tenantId, workspaceId: ws.id, name: "Cliente Sem Inbox" });
  await createTask(taskDeps(), { tenantId, workspaceId: ws.id, contactId: contact.id, type: "follow_up", title: "Tarefa isolada" });

  const activity = await getContactActivity(activityDeps(false), { contactId: contact.id, tenantId, workspaceId: ws.id });
  assert.ok(activity.some((item) => item.type === "task_created"));
  assert.ok(!activity.some((item) => item.category === "conversation"));
});

test("Fase 5 — isolamento multi-tenant: contato de um tenant nunca aparece pra outro", async () => {
  const tenantA = "tenant-fase5-multi-a";
  const tenantB = "tenant-fase5-multi-b";
  const wsA = await makeWorkspace(tenantA);
  const wsB = await makeWorkspace(tenantB);
  const contactA = await createContact(crmDeps(), { tenantId: tenantA, workspaceId: wsA.id, name: "Contato A" });

  await assert.rejects(() => getContactActivity(activityDeps(), { contactId: contactA.id, tenantId: tenantB, workspaceId: wsB.id }), /CONTACT_NOT_FOUND/);
  await assert.rejects(() => getContactActivity(activityDeps(), { contactId: contactA.id, tenantId: tenantA, workspaceId: wsB.id }), /CONTACT_NOT_FOUND/);
});

test("Fase 5 — reagendar tarefa gera task_rescheduled; negócio reaberto após Ganho vira deal_reopened", async () => {
  const tenantId = "tenant-fase5-reschedule-reopen";
  const ws = await makeWorkspace(tenantId);
  const contact = await createContact(crmDeps(), { tenantId, workspaceId: ws.id, name: "Cliente Reagenda" });
  const task = await createTask(taskDeps(), { tenantId, workspaceId: ws.id, contactId: contact.id, type: "follow_up", title: "Reagendável", dueAt: "2026-01-01T10:00:00.000Z" });
  await updateTask(taskDeps(), { taskId: task.id, tenantId, workspaceId: ws.id, patch: { dueAt: "2026-01-05T10:00:00.000Z" } });

  const { pipeline, stages } = await ensureDefaultPipeline({ pipelineRepository: new PostgresPipelineRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool) }, tenantId, ws.id);
  const openStage = stages.find((stage) => !stage.isWon && !stage.isLost);
  const wonStage = stages.find((stage) => stage.isWon);
  const deal = await createDeal(dealDeps(), { tenantId, workspaceId: ws.id, pipelineId: pipeline.id, stageId: openStage.id, contactId: contact.id, title: "Negócio Reaberto" });
  await moveDealStage(dealDeps(), { dealId: deal.id, tenantId, workspaceId: ws.id, targetStageId: wonStage.id });
  await moveDealStage(dealDeps(), { dealId: deal.id, tenantId, workspaceId: ws.id, targetStageId: openStage.id });

  const activity = await getContactActivity(activityDeps(), { contactId: contact.id, tenantId, workspaceId: ws.id });
  assert.ok(activity.some((item) => item.type === "task_rescheduled"));
  assert.ok(activity.some((item) => item.type === "deal_won"));
  assert.ok(activity.some((item) => item.type === "deal_reopened"));
});

test("Fase 5 — eventos operacionais de baixo nível (assigned, IA) não viram ruído na Timeline salvo os listados", async () => {
  const tenantId = "tenant-fase5-noise";
  const ws = await makeWorkspace(tenantId);
  const contact = await createContact(crmDeps(), { tenantId, workspaceId: ws.id, name: "Cliente Ruído" });
  const conversation = await makeConversationForContact(tenantId, ws.id, contact.id);
  const inboxDeps = { conversationRepository: new PostgresInboxConversationRepository(db.pool), conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool) };
  await setAiConversationEnabled(inboxDeps, { conversationId: conversation.id, tenantId, workspaceId: ws.id, aiEnabled: true, performedBy: "user-3" });
  await setAiConversationEnabled(inboxDeps, { conversationId: conversation.id, tenantId, workspaceId: ws.id, aiEnabled: false, performedBy: "user-3" });
  await takeOverConversation(inboxDeps, { conversationId: conversation.id, tenantId, workspaceId: ws.id, userId: "user-3" });
  await transferConversation(inboxDeps, { conversationId: conversation.id, tenantId, workspaceId: ws.id, toUserId: "user-4", performedBy: "user-3" });
  await closeConversation(inboxDeps, { conversationId: conversation.id, tenantId, workspaceId: ws.id, performedBy: "user-4" });

  const activity = await getContactActivity(activityDeps(), { contactId: contact.id, tenantId, workspaceId: ws.id });
  const types = activity.map((item) => item.type);
  assert.ok(types.includes("conversation_ai_paused"));
  assert.ok(types.includes("conversation_ai_resumed"));
  assert.ok(types.includes("conversation_took_over"));
  assert.ok(types.includes("conversation_transferred"));
  assert.ok(types.includes("conversation_resolved"));
  assert.ok(!types.includes("assigned"));
  assert.ok(!types.includes("kanban_phase_changed"));
});
