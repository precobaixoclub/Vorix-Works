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
  const conversation = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, contactId: inboxContact.id });

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
