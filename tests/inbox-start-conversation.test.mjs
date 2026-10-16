import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxConversationEventRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-event-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { PostgresInboxQuickReplyRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-quick-reply-repository.js";
import {
  addConversationNote, closeConversation, createInboxQuickReply, deleteInboxQuickReply, listConversationEvents, listInboxQuickReplies,
  registerInboundMessage, startInboxConversation, updateInboxQuickReply,
} from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** Conversas: iniciar conversa pelo Vorix, respostas rápidas e notas internas (migration 0150). */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-start-${++counter}`;

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});
after(async () => { await db.stop(); });

function buildDeps() {
  return {
    workspaceRepository: new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }),
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    contactRepository: new PostgresInboxContactRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    quickReplyRepository: new PostgresInboxQuickReplyRepository(db.pool),
    outboundQueue: { published: [], async publish(input) { this.published.push(input); } },
    providers: { wuzapi: { async sendText() { return { externalMessageId: "x" }; } } },
  };
}

async function setup(tenantId, { status = "connected", provider = "wuzapi" } = {}) {
  const deps = buildDeps();
  const workspace = await deps.workspaceRepository.create({ tenantId, name: "W" });
  const connection = await deps.connectionRepository.create({ tenantId, workspaceId: workspace.id, provider, displayName: "Conexão" });
  await deps.connectionRepository.updateStatus(connection.id, { status, externalSessionId: `sess-${connection.id}` });
  return { deps, workspace, connection };
}

test("nova conversa por telefone nacional: cria contato + conversa no pivô E.164, atribui a quem iniciou e enfileira a 1ª mensagem", async () => {
  const tenantId = "tenant-start-1";
  const { deps, workspace, connection } = await setup(tenantId);
  const result = await startInboxConversation(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, phone: "(11) 98765-4321", name: "Maria", body: "Olá, Maria!", startedByUserId: "user-1" });

  assert.equal(result.wasExisting, false);
  assert.equal(result.conversation.externalChatId, "+5511987654321");
  assert.equal(result.conversation.assignedUserId, "user-1");
  assert.equal(result.message.direction, "outbound");
  assert.equal(result.message.body, "Olá, Maria!");
  assert.equal(deps.outboundQueue.published.length, 1);
  const contact = await deps.contactRepository.findByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: "+5511987654321" });
  assert.equal(contact?.name, "Maria");

  // A resposta do cliente cai na MESMA conversa (mesmo pivô da entrada).
  const inbound = await registerInboundMessage(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, externalMessageId: "in-1", chatId: "5511987654321@s.whatsapp.net", chatPhoneE164: "+5511987654321", type: "text", body: "Oi!", occurredAt: new Date().toISOString() });
  assert.equal(inbound.conversation.id, result.conversation.id);
});

test("nova conversa com contato já existente reaproveita a conversa e reabre se estava finalizada", async () => {
  const tenantId = "tenant-start-2";
  const { deps, workspace, connection } = await setup(tenantId);
  const first = await startInboxConversation(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, phone: "+55 21 99876-5432", body: "Primeira", startedByUserId: "user-1" });
  await closeConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: first.conversation.id, performedBy: "user-1" });

  const second = await startInboxConversation(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, contactId: first.conversation.contactId, body: "Retomando", startedByUserId: "user-2" });
  assert.equal(second.conversation.id, first.conversation.id);
  assert.equal(second.wasExisting, true);
  assert.equal(second.conversation.status, "open");
  assert.equal(second.conversation.assignedUserId, "user-1", "nunca rouba o responsável atual");
});

test("nova conversa: rejeita telefone inválido, canal desconectado, Instagram e contato de outro workspace", async () => {
  const tenantId = "tenant-start-3";
  const { deps, workspace, connection } = await setup(tenantId);
  await assert.rejects(startInboxConversation(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, phone: "1234", body: "Oi", startedByUserId: "u" }), /INBOX_INVALID_PHONE/);
  await assert.rejects(startInboxConversation(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, phone: "11987654321", body: "  ", startedByUserId: "u" }), /INBOX_MESSAGE_BODY_EMPTY/);

  const offline = await setup("tenant-start-3b", { status: "disconnected" });
  await assert.rejects(startInboxConversation(offline.deps, { tenantId: "tenant-start-3b", workspaceId: offline.workspace.id, connectionId: offline.connection.id, phone: "11987654321", body: "Oi", startedByUserId: "u" }), /INBOX_CONNECTION_NOT_READY/);

  const instagram = await setup("tenant-start-3c", { provider: "instagram" });
  await assert.rejects(startInboxConversation(instagram.deps, { tenantId: "tenant-start-3c", workspaceId: instagram.workspace.id, connectionId: instagram.connection.id, phone: "11987654321", body: "Oi", startedByUserId: "u" }), /INBOX_START_CHANNEL_UNSUPPORTED/);

  const other = await setup("tenant-start-3d");
  const foreign = await other.deps.contactRepository.upsertByPhone({ tenantId: "tenant-start-3d", workspaceId: other.workspace.id, phoneNormalized: "+5511900000001" });
  await assert.rejects(startInboxConversation(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, contactId: foreign.id, body: "Oi", startedByUserId: "u" }), /INBOX_CONTACT_NOT_FOUND/);
  await assert.rejects(startInboxConversation(deps, { tenantId, workspaceId: workspace.id, connectionId: other.connection.id, phone: "11987654321", body: "Oi", startedByUserId: "u" }), /INBOX_CONNECTION_NOT_FOUND/);
});

test("respostas rápidas: normaliza atalho, impede duplicado sem diferenciar maiúsculas e isola por workspace", async () => {
  const tenantId = "tenant-qr-1";
  const { deps, workspace } = await setup(tenantId);
  const created = await createInboxQuickReply(deps, { tenantId, workspaceId: workspace.id, shortcut: "/Bom Dia", body: "Bom dia! Como posso ajudar?", createdBy: "u" });
  assert.equal(created.shortcut, "bom-dia");
  await assert.rejects(createInboxQuickReply(deps, { tenantId, workspaceId: workspace.id, shortcut: "BOM-DIA", body: "x" }), /INBOX_QUICK_REPLY_SHORTCUT_TAKEN/);
  await assert.rejects(createInboxQuickReply(deps, { tenantId, workspaceId: workspace.id, shortcut: "///", body: "x" }), /INBOX_QUICK_REPLY_INVALID/);

  const updated = await updateInboxQuickReply(deps, { tenantId, workspaceId: workspace.id, quickReplyId: created.id, body: "Bom dia!" });
  assert.equal(updated.body, "Bom dia!");
  assert.deepEqual((await listInboxQuickReplies(deps, { tenantId, workspaceId: workspace.id })).map((item) => item.shortcut), ["bom-dia"]);

  const other = await setup("tenant-qr-2");
  await assert.rejects(deleteInboxQuickReply(other.deps, { tenantId: "tenant-qr-2", workspaceId: other.workspace.id, quickReplyId: created.id }), /INBOX_QUICK_REPLY_NOT_FOUND/);
  await assert.rejects(createInboxQuickReply(deps, { tenantId: "tenant-qr-2", workspaceId: workspace.id, shortcut: "x", body: "x" }), /INBOX_WORKSPACE_NOT_FOUND/);
  await deleteInboxQuickReply(deps, { tenantId, workspaceId: workspace.id, quickReplyId: created.id });
  assert.equal((await listInboxQuickReplies(deps, { tenantId, workspaceId: workspace.id })).length, 0);
});

test("nota interna vira evento da timeline e nunca é enviada ao contato", async () => {
  const tenantId = "tenant-note-1";
  const { deps, workspace, connection } = await setup(tenantId);
  const { conversation } = await startInboxConversation(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, phone: "11912345678", body: "Oi", startedByUserId: "u" });
  const publishedBefore = deps.outboundQueue.published.length;

  const note = await addConversationNote(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, text: "Cliente pediu desconto de 10%", performedBy: "u" });
  assert.equal(note.type, "note_added");
  assert.equal(note.metadata.text, "Cliente pediu desconto de 10%");
  assert.equal(deps.outboundQueue.published.length, publishedBefore);
  const events = await listConversationEvents(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  assert.ok(events.some((event) => event.type === "note_added"));
  await assert.rejects(addConversationNote(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, text: "   ", performedBy: "u" }), /INBOX_NOTE_EMPTY/);
});
