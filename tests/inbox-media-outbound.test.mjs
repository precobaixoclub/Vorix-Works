import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { processOutboundMessage, sendInboxContactCardMessage, sendInboxMediaMessage } from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Bloco "Media Outbound" (ver docs/conversas-whatsapp-experience-completion.md) — envio de
 * imagem/áudio/vídeo/documento pela UI. Cobre: (1) `sendInboxMediaMessage` grava uma cópia própria
 * no storage e enfileira exatamente como texto; (2) `processOutboundMessage` lê a cópia de volta e
 * monta o data URI base64 que a documentação real do WuzAPI exige (nunca uma URL fetchável); (3)
 * sem storage configurado, nunca finge sucesso.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55705 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function makeFakeMediaStorage() {
  const objects = new Map();
  return {
    objects,
    async health() { return { ok: true }; },
    async put(input) { objects.set(input.key, { body: input.body, contentType: input.contentType }); },
    async get(key) { return objects.get(key); },
    async delete(key) { objects.delete(key); },
  };
}

function makeFakeMessagingProvider() {
  return {
    sent: [],
    async sendText(input) { this.sent.push({ method: "sendText", input }); return { externalMessageId: `fake-text-${this.sent.length}` }; },
    async sendImage(input) { this.sent.push({ method: "sendImage", input }); return { externalMessageId: `fake-image-${this.sent.length}` }; },
    async sendAudio(input) { this.sent.push({ method: "sendAudio", input }); return { externalMessageId: `fake-audio-${this.sent.length}` }; },
    async sendVideo(input) { this.sent.push({ method: "sendVideo", input }); return { externalMessageId: `fake-video-${this.sent.length}` }; },
    async sendDocument(input) { this.sent.push({ method: "sendDocument", input }); return { externalMessageId: `fake-document-${this.sent.length}` }; },
    async sendContact(input) { this.sent.push({ method: "sendContact", input }); return { externalMessageId: `fake-contact-${this.sent.length}` }; },
  };
}

async function makeConversation(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);

  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: `sess-${connection.id}` });
  // Formato fixo de 8 dígitos zero-padded — ver mesmo comentário em inbox-ai-responder.test.mjs
  // (bloco "réplica de identidade"): garante um celular BR válido e já canônico sempre.
  const phone = `+55119${String(++counter).padStart(8, "0")}`;
  const contact = await contactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: phone });
  const conversation = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, chatType: "direct", externalChatId: phone, contactId: contact.id });
  return { workspace, connection: await connectionRepo.getById(connection.id), conversation };
}

test("IMAGE_OUTBOUND: sendInboxMediaMessage grava cópia própria + processOutboundMessage envia como data URI base64", async () => {
  const tenantId = "tenant-media-out-1";
  const { workspace, connection, conversation } = await makeConversation(tenantId);
  const mediaStorage = makeFakeMediaStorage();
  const provider = makeFakeMessagingProvider();
  const deps = {
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    outboundQueue: { async publish() {} },
    providers: { wuzapi: provider },
    inboxMediaStorage: mediaStorage,
  };

  const imageBytes = Buffer.from("fake-jpeg-bytes");
  const message = await sendInboxMediaMessage(deps, {
    tenantId, workspaceId: workspace.id, conversationId: conversation.id, sentByUserId: "user-1",
    type: "image", body: imageBytes, mimeType: "image/jpeg", caption: "Segue a foto",
  });

  assert.equal(message.status, "queued");
  assert.equal(message.type, "image");
  assert.ok(message.mediaStorageRef?.objectKey, "deve gravar uma cópia própria (preview imediato na UI)");
  assert.equal(mediaStorage.objects.size, 1);

  const sent = await processOutboundMessage(deps, { messageId: message.id });
  assert.equal(sent.status, "sent");
  assert.equal(sent.externalMessageId, "fake-image-1");

  assert.equal(provider.sent.length, 1);
  assert.equal(provider.sent[0].method, "sendImage");
  assert.equal(provider.sent[0].input.to, conversation.externalChatId, "destino é a identidade canônica do chat, nunca um telefone qualquer");
  assert.equal(provider.sent[0].input.caption, "Segue a foto");
  assert.equal(
    provider.sent[0].input.mediaUrl,
    `data:image/jpeg;base64,${imageBytes.toString("base64")}`,
    "contrato real do WuzAPI (API.md): campo de mídia é um data URI base64, nunca uma URL fetchável",
  );
});

test("DOCUMENT_OUTBOUND: fileName é repassado ao provider", async () => {
  const tenantId = "tenant-media-out-2";
  const { workspace, connection, conversation } = await makeConversation(tenantId);
  const mediaStorage = makeFakeMediaStorage();
  const provider = makeFakeMessagingProvider();
  const deps = {
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    outboundQueue: { async publish() {} },
    providers: { wuzapi: provider },
    inboxMediaStorage: mediaStorage,
  };

  const docBytes = Buffer.from("%PDF-1.4 fake");
  const message = await sendInboxMediaMessage(deps, {
    tenantId, workspaceId: workspace.id, conversationId: conversation.id,
    type: "document", body: docBytes, mimeType: "application/pdf", fileName: "contrato.pdf",
  });
  await processOutboundMessage(deps, { messageId: message.id });

  assert.equal(provider.sent[0].method, "sendDocument");
  assert.equal(provider.sent[0].input.fileName, "contrato.pdf");
});

test("AUDIO_OUTBOUND: sem InboxMediaStoragePort configurado, sendInboxMediaMessage nunca finge sucesso", async () => {
  const tenantId = "tenant-media-out-3";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = {
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    outboundQueue: { async publish() {} },
    providers: { wuzapi: makeFakeMessagingProvider() },
    // inboxMediaStorage ausente de propósito.
  };

  await assert.rejects(
    () => sendInboxMediaMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, type: "audio", body: Buffer.from("x"), mimeType: "audio/ogg" }),
    /INBOX_MEDIA_STORAGE_NOT_CONFIGURED/,
  );
});

/**
 * Bloco "enviar contato salvo" (pedido explícito do usuário em produção: "criar uma opção para eu
 * clicar e conseguir selecionar um dos contatos salvos no sistema para estar enviando") — cobre:
 * (1) `sendInboxContactCardMessage` monta o vCard e enfileira SEM precisar de `inboxMediaStorage`
 * (um contato não é mídia); (2) `processOutboundMessage` despacha pro `provider.sendContact` real
 * (`POST /chat/send/contact`, `API.md`), nunca cai no caminho de mídia.
 */
test("CONTACT_OUTBOUND: sendInboxContactCardMessage monta vcard e enfileira sem storage; processOutboundMessage chama provider.sendContact", async () => {
  const tenantId = "tenant-contact-out-1";
  const { workspace, conversation } = await makeConversation(tenantId);
  const provider = makeFakeMessagingProvider();
  const deps = {
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    outboundQueue: { async publish() {} },
    providers: { wuzapi: provider },
    // inboxMediaStorage ausente de propósito — contato não deve precisar disso.
  };

  const message = await sendInboxContactCardMessage(deps, {
    tenantId, workspaceId: workspace.id, conversationId: conversation.id, sentByUserId: "user-1",
    contactName: "Fornecedor Principal", contactPhone: "+5511988887777",
  });

  assert.equal(message.status, "queued");
  assert.equal(message.type, "contact");
  assert.equal(message.metadata?.contactName, "Fornecedor Principal");
  assert.equal(message.metadata?.contactPhone, "+5511988887777");
  assert.ok(message.metadata?.vcard?.includes("waid=5511988887777"), "vcard tem que trazer waid= sem o + (WhatsApp usa dígitos puros)");

  const sent = await processOutboundMessage(deps, { messageId: message.id });
  assert.equal(sent.status, "sent");
  assert.equal(provider.sent.length, 1);
  assert.equal(provider.sent[0].method, "sendContact");
  assert.equal(provider.sent[0].input.to, conversation.externalChatId);
  assert.equal(provider.sent[0].input.name, "Fornecedor Principal");
  assert.ok(provider.sent[0].input.vcard.includes("BEGIN:VCARD"));
});

test("CONTACT_OUTBOUND: nome vazio é rejeitado explicitamente — nunca envia um cartão sem nome", async () => {
  const tenantId = "tenant-contact-out-2";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = {
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    outboundQueue: { async publish() {} },
    providers: { wuzapi: makeFakeMessagingProvider() },
  };

  await assert.rejects(
    () => sendInboxContactCardMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, contactName: "   ", contactPhone: "+5511988887777" }),
    /INBOX_CONTACT_CARD_NAME_REQUIRED/,
  );
});
