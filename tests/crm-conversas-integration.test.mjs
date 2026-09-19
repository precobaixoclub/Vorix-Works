import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresContactIdentityRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-identity-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import { PostgresDealRepository } from "../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import { createContact, linkContactIdentity } from "../dist/application/crm/contact-use-cases.js";
import { createPipeline, createStage } from "../dist/application/crm/pipeline-use-cases.js";
import { createDeal, listDeals } from "../dist/application/crm/deal-use-cases.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import {
  AUTO_CONTACT_ORIGIN,
  MIN_MESSAGES_FOR_AUTO_CRM_CONTACT,
  ensureCrmContactForInboxContact,
  maybeAutoLinkInboxContactToCrm,
} from "../dist/application/commercial-bridge/inbox-crm-bridge-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * CRM/Comercial — Fase 4 (Integração com Conversas). Foco: (1) ligar um `inbox_contacts`
 * (WhatsApp) a um `Contact` do CRM torna o vínculo visível tanto em
 * `PostgresInboxContactRepository.getById` quanto na listagem de conversas
 * (`InboxConversationListItem.crmContactId`) — sem nenhuma fusão automática, só depois de um
 * `linkContactIdentity` explícito; (2) negócios podem ser filtrados por `contactId`, permitindo
 * ao painel do Conversas listar "negócios deste contato" sem carregar o workspace inteiro.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55703 });
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

test("Vincular um inbox_contact (WhatsApp) a um Contact do CRM aparece em InboxContact.crmContactId e na listagem de conversas", async () => {
  const tenantId = "tenant-integ-1";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const inboxContactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "WhatsApp" });
  const inboxContact = await inboxContactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: "+5511977776666", name: "Cliente Integrado" });
  const conversation = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, chatType: "direct", externalChatId: "+5511977776666", contactId: inboxContact.id });

  // Antes de vincular: nem InboxContact nem a listagem de conversas mostram nenhum vínculo.
  const beforeLink = await inboxContactRepo.getById(inboxContact.id);
  assert.equal(beforeLink.crmContactId, undefined);
  const listBefore = await conversationRepo.listByWorkspace({ tenantId, workspaceId: workspace.id });
  assert.equal(listBefore.find((c) => c.id === conversation.id).crmContactId, undefined);

  // Vínculo explícito (nunca automático) — mesmo fluxo que o painel do Conversas dispara.
  const crmContact = await createContact(contactDeps(), { tenantId, workspaceId: workspace.id, name: "Cliente Integrado", origin: "whatsapp" });
  const linkResult = await linkContactIdentity(contactDeps(), { contactId: crmContact.id, tenantId, workspaceId: workspace.id, channel: "whatsapp", externalId: inboxContact.id });
  assert.equal(linkResult.wasCreated, true);
  assert.equal(linkResult.conflictsWithAnotherContact, false);

  const afterLink = await inboxContactRepo.getById(inboxContact.id);
  assert.equal(afterLink.crmContactId, crmContact.id);
  const listAfter = await conversationRepo.listByWorkspace({ tenantId, workspaceId: workspace.id });
  assert.equal(listAfter.find((c) => c.id === conversation.id).crmContactId, crmContact.id);
});

test("Negócios filtrados por contactId retornam só os negócios daquele contato", async () => {
  const tenantId = "tenant-integ-2";
  const workspace = await makeWorkspace(tenantId);
  const pipelineDeps = { pipelineRepository: new PostgresPipelineRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool) };
  const dealDeps = { dealRepository: new PostgresDealRepository(db.pool), pipelineStageRepository: pipelineDeps.pipelineStageRepository, timelineEventRepository: new PostgresTimelineEventRepository(db.pool) };

  const contactA = await createContact(contactDeps(), { tenantId, workspaceId: workspace.id, name: "Contato A" });
  const contactB = await createContact(contactDeps(), { tenantId, workspaceId: workspace.id, name: "Contato B" });
  const pipeline = await createPipeline(pipelineDeps, { tenantId, workspaceId: workspace.id, name: "Vendas" });
  const stage = await createStage(pipelineDeps, { pipelineId: pipeline.id, tenantId, workspaceId: workspace.id, name: "Novo", position: 0 });

  await createDeal(dealDeps, { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: stage.id, contactId: contactA.id, title: "Negócio de A" });
  await createDeal(dealDeps, { tenantId, workspaceId: workspace.id, pipelineId: pipeline.id, stageId: stage.id, contactId: contactB.id, title: "Negócio de B" });

  const dealsOfA = await listDeals(dealDeps, { tenantId, workspaceId: workspace.id, contactId: contactA.id });
  assert.equal(dealsOfA.length, 1);
  assert.equal(dealsOfA[0].title, "Negócio de A");
});

/**
 * Jornada Comercial Integrada, Fase 1 — ponte automática Inbox→CRM
 * (`src/application/commercial-bridge/inbox-crm-bridge-use-cases.ts`). Mesmo harness/convenções dos
 * testes acima (Postgres real via pglite, nunca mocks) — a ponte só é "real" se sobreviver a
 * concorrência/reentrega de verdade, não a um double do repositório.
 */
function bridgeDeps() {
  return { inboxContactRepository: new PostgresInboxContactRepository(db.pool), inboxMessageRepository: new PostgresInboxMessageRepository(db.pool), contact: contactDeps() };
}

async function makeDirectConversationWithMessages(tenantId, workspace, phone, messageCount) {
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const inboxContactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "WhatsApp" });
  const inboxContact = await inboxContactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: phone, name: "Cliente Automático" });
  const conversation = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, chatType: "direct", externalChatId: phone, contactId: inboxContact.id });
  for (let i = 0; i < messageCount; i += 1) {
    await messageRepo.create({ tenantId, workspaceId: workspace.id, conversationId: conversation.id, connectionId: connection.id, direction: "inbound", type: "text", body: `mensagem ${i + 1}` });
  }
  return { inboxContact, conversation, inboxContactRepo };
}

test("Ponte automática: conversa direta com sinal mínimo de mensagens cria e vincula um Contact do CRM automaticamente", async () => {
  const tenantId = "tenant-bridge-1";
  const workspace = await makeWorkspace(tenantId);
  const { inboxContact, conversation, inboxContactRepo } = await makeDirectConversationWithMessages(tenantId, workspace, "+5511911112222", MIN_MESSAGES_FOR_AUTO_CRM_CONTACT);

  const result = await maybeAutoLinkInboxContactToCrm(bridgeDeps(), { tenantId, workspaceId: workspace.id, inboxContact, conversationId: conversation.id });
  assert.ok(result, "deveria ter criado/vinculado um Contact");
  assert.equal(result.created, true);

  const linked = await inboxContactRepo.getById(inboxContact.id);
  assert.equal(linked.crmContactId, result.contactId);

  const contact = await contactDeps().contactRepository.getById(result.contactId);
  assert.equal(contact.origin, AUTO_CONTACT_ORIGIN, "origem deve ser distinguível do vínculo manual (whatsapp_auto vs whatsapp)");
  assert.equal(contact.name, "Cliente Automático");

  const identity = await contactDeps().contactIdentityRepository.findByChannelAndExternalId("whatsapp", inboxContact.id);
  assert.equal(identity.contactId, result.contactId, "mesma convenção do vínculo manual: externalId = InboxContact.id");
});

test("Ponte automática: NUNCA dispara antes do sinal mínimo de mensagens (evita virar lixo por uma mensagem isolada)", async () => {
  const tenantId = "tenant-bridge-2";
  const workspace = await makeWorkspace(tenantId);
  const { inboxContact, conversation, inboxContactRepo } = await makeDirectConversationWithMessages(tenantId, workspace, "+5511922223333", MIN_MESSAGES_FOR_AUTO_CRM_CONTACT - 1);

  const result = await maybeAutoLinkInboxContactToCrm(bridgeDeps(), { tenantId, workspaceId: workspace.id, inboxContact, conversationId: conversation.id });
  assert.equal(result, undefined);

  const stillUnlinked = await inboxContactRepo.getById(inboxContact.id);
  assert.equal(stillUnlinked.crmContactId, undefined);
});

test("Ponte automática: idempotente — chamar duas vezes para o mesmo InboxContact nunca cria um segundo Contact", async () => {
  const tenantId = "tenant-bridge-3";
  const workspace = await makeWorkspace(tenantId);
  const { inboxContact } = await makeDirectConversationWithMessages(tenantId, workspace, "+5511933334444", MIN_MESSAGES_FOR_AUTO_CRM_CONTACT);

  const first = await ensureCrmContactForInboxContact(bridgeDeps(), { tenantId, workspaceId: workspace.id, inboxContactId: inboxContact.id, contactName: inboxContact.name, contactPhone: inboxContact.phoneNormalized });
  const second = await ensureCrmContactForInboxContact(bridgeDeps(), { tenantId, workspaceId: workspace.id, inboxContactId: inboxContact.id, contactName: inboxContact.name, contactPhone: inboxContact.phoneNormalized });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.contactId, first.contactId);

  const allContacts = await contactDeps().contactRepository.listByWorkspace({ tenantId, workspaceId: workspace.id });
  assert.equal(allContacts.length, 1, "nunca deveria existir um segundo Contact pro mesmo InboxContact");
});

test("Ponte automática: simula uma corrida concorrente (duas chamadas em paralelo) — só um Contact sobrevive, nunca duas identidades divergentes", async () => {
  const tenantId = "tenant-bridge-4";
  const workspace = await makeWorkspace(tenantId);
  const { inboxContact, inboxContactRepo } = await makeDirectConversationWithMessages(tenantId, workspace, "+5511944445555", MIN_MESSAGES_FOR_AUTO_CRM_CONTACT);

  const [a, b] = await Promise.all([
    ensureCrmContactForInboxContact(bridgeDeps(), { tenantId, workspaceId: workspace.id, inboxContactId: inboxContact.id, contactName: inboxContact.name, contactPhone: inboxContact.phoneNormalized }),
    ensureCrmContactForInboxContact(bridgeDeps(), { tenantId, workspaceId: workspace.id, inboxContactId: inboxContact.id, contactName: inboxContact.name, contactPhone: inboxContact.phoneNormalized }),
  ]);

  // As duas chamadas devem convergir pro MESMO Contact vencedor — nunca fundem silenciosamente,
  // nunca deixam o InboxContact vinculado a duas identidades diferentes.
  assert.equal(a.contactId, b.contactId);
  const linked = await inboxContactRepo.getById(inboxContact.id);
  assert.equal(linked.crmContactId, a.contactId);

  const identities = await contactDeps().contactIdentityRepository.listByContact(a.contactId);
  assert.equal(identities.filter((identity) => identity.externalId === inboxContact.id).length, 1);
});

test("Ponte automática: contato de GRUPO nunca é chamado (grupo nunca tem InboxContact) — checagem estrutural do gatilho", async () => {
  const tenantId = "tenant-bridge-5";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "WhatsApp" });
  // Grupo: SEM contactId, exatamente como `registerInboundMessage` cria (nunca resolve InboxContact
  // pra grupo) — não há `contact` nenhum pra passar pro gatilho, então a ponte estruturalmente nunca
  // é chamada por um evento de grupo (ver `inbox-worker.ts`: `if (contact && ...)`).
  const groupConversation = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, chatType: "group", externalChatId: "123@g.us", groupName: "Grupo Teste" });
  for (let i = 0; i < MIN_MESSAGES_FOR_AUTO_CRM_CONTACT + 5; i += 1) {
    await messageRepo.create({ tenantId, workspaceId: workspace.id, conversationId: groupConversation.id, connectionId: connection.id, direction: "inbound", type: "text", body: `mensagem de grupo ${i}` });
  }
  assert.equal(groupConversation.contactId, undefined);
  // Nenhuma chamada à ponte é feita aqui de propósito — o teste documenta a garantia estrutural
  // (a própria assinatura de `maybeAutoLinkInboxContactToCrm` exige um `InboxContact`, que um
  // grupo nunca tem pra oferecer).
});

test("Ponte automática: multi-tenant — mesmo número de telefone em tenants diferentes nunca se cruza", async () => {
  const phone = "+5511955556666";
  const workspaceX = await makeWorkspace("tenant-bridge-6x");
  const workspaceY = await makeWorkspace("tenant-bridge-6y");
  const { inboxContact: contactX, conversation: conversationX, inboxContactRepo } = await makeDirectConversationWithMessages("tenant-bridge-6x", workspaceX, phone, MIN_MESSAGES_FOR_AUTO_CRM_CONTACT);
  const { inboxContact: contactY, conversation: conversationY } = await makeDirectConversationWithMessages("tenant-bridge-6y", workspaceY, phone, MIN_MESSAGES_FOR_AUTO_CRM_CONTACT);

  const resultX = await maybeAutoLinkInboxContactToCrm(bridgeDeps(), { tenantId: "tenant-bridge-6x", workspaceId: workspaceX.id, inboxContact: contactX, conversationId: conversationX.id });
  const resultY = await maybeAutoLinkInboxContactToCrm(bridgeDeps(), { tenantId: "tenant-bridge-6y", workspaceId: workspaceY.id, inboxContact: contactY, conversationId: conversationY.id });

  assert.notEqual(resultX.contactId, resultY.contactId, "tenants diferentes nunca compartilham o mesmo Contact, mesmo com o mesmo telefone");
  const linkedX = await inboxContactRepo.getById(contactX.id);
  assert.equal(linkedX.crmContactId, resultX.contactId);
});
