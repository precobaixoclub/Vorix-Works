import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createHmac } from "node:crypto";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxConversationEventRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-event-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { InMemoryInstagramDmAccountRouteRepository } from "../dist/infrastructure/storage/in-memory-instagram-dm-account-route-repository.js";
import { verifyMetaWebhookSignature } from "../dist/infrastructure/meta/meta-webhook-signature-verifier.js";
import { receiveInstagramDmWebhook } from "../dist/application/instagram-dm/receive-instagram-dm-webhook.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Módulo Instagram DM — desde a unificação (pedido explícito do usuário: "junte só a tela,
 * contabilizando no kanban também essas conversas"), Instagram DM virou canal de primeira classe do
 * Inbox: `receiveInstagramDmWebhook` chama `registerInboundMessage`, o MESMO caminho do WhatsApp
 * (ver comentário completo em `receive-instagram-dm-webhook.ts`). O módulo antigo standalone
 * (`instagram_dm_conversations`/`instagram_dm_messages`/automação por palavra-chave/tela própria)
 * foi removido — automação por palavra-chave não foi portada, é um scope cut deliberado.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55720 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function makeFakeMessagingProvider() {
  return {
    sentMessages: [],
    async sendText(input) { this.sentMessages.push(input); return { externalMessageId: `fake-wa-${this.sentMessages.length}` }; },
  };
}

async function buildDeps() {
  const workspaceRepository = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const workspace = await workspaceRepository.create({ tenantId: "t1", name: "W" });
  const accountRouteRepository = new InMemoryInstagramDmAccountRouteRepository();
  await accountRouteRepository.upsertRoute({ instagramBusinessAccountId: "ig_1", tenantId: "t1", workspaceId: workspace.id });

  const deps = {
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    contactRepository: new PostgresInboxContactRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    workspaceRepository,
    outboundQueue: { async publish() {} },
    providers: { wuzapi: makeFakeMessagingProvider() },
    accountRouteRepository,
  };
  return { workspace, deps };
}

test("verifyMetaWebhookSignature: aceita HMAC-SHA256 válido sobre os bytes crus, rejeita corpo alterado ou segredo errado", () => {
  const appSecret = "app-secret-1";
  const rawBody = Buffer.from(JSON.stringify({ object: "instagram", entry: [] }));
  const validHeader = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;

  assert.equal(verifyMetaWebhookSignature({ appSecret, rawBody, signatureHeader: validHeader }), true);
  assert.equal(verifyMetaWebhookSignature({ appSecret, rawBody: Buffer.from(rawBody.toString() + " "), signatureHeader: validHeader }), false, "corpo alterado deveria invalidar a assinatura");
  assert.equal(verifyMetaWebhookSignature({ appSecret: "outro-secret", rawBody, signatureHeader: validHeader }), false);
  assert.equal(verifyMetaWebhookSignature({ appSecret, rawBody, signatureHeader: undefined }), false);
  assert.equal(verifyMetaWebhookSignature({ appSecret, rawBody, signatureHeader: "sha1=deadbeef" }), false, "algoritmo errado deveria ser rejeitado");
});

test("receiveInstagramDmWebhook: conta sem rota conhecida é ignorada silenciosamente, nunca lança erro", async () => {
  const { deps } = await buildDeps();
  const payload = { object: "instagram", entry: [{ id: "ig_desconhecida", messaging: [{ sender: { id: "psid_1" }, message: { mid: "mid_x", text: "oi" } }] }] };

  const result = await receiveInstagramDmWebhook(deps, payload);
  assert.deepEqual(result, { processed: 0, skipped: 1, updatedConversations: [] });
});

test("receiveInstagramDmWebhook: mensagem is_echo (própria mensagem ecoada) nunca é reprocessada", async () => {
  const { workspace, deps } = await buildDeps();
  const payload = { object: "instagram", entry: [{ id: "ig_1", messaging: [{ sender: { id: "ig_1" }, recipient: { id: "psid_1" }, message: { mid: "mid_echo", text: "resposta que EU mandei", is_echo: true } }] }] };

  const result = await receiveInstagramDmWebhook(deps, payload);
  assert.deepEqual(result, { processed: 0, skipped: 1, updatedConversations: [] });
  const conversations = await deps.conversationRepository.listByWorkspace({ tenantId: "t1", workspaceId: workspace.id });
  assert.deepEqual(conversations, []);
});

test("receiveInstagramDmWebhook: nova mensagem cria/reencontra a conexão Instagram (idempotente) e registra a conversa/mensagem inbound via o mesmo pipeline do WhatsApp", async () => {
  const { workspace, deps } = await buildDeps();
  const payload = { object: "instagram", entry: [{ id: "ig_1", messaging: [{ sender: { id: "psid_1" }, recipient: { id: "ig_1" }, timestamp: 1700000000000, message: { mid: "mid_1", text: "quanto custa?" } }] }] };

  const result = await receiveInstagramDmWebhook(deps, payload);
  assert.equal(result.processed, 1);
  assert.equal(result.updatedConversations.length, 1);
  assert.equal(result.updatedConversations[0].tenantId, "t1");
  assert.equal(result.updatedConversations[0].workspaceId, workspace.id);

  const [conversation] = await deps.conversationRepository.listByWorkspace({ tenantId: "t1", workspaceId: workspace.id });
  assert.equal(conversation.connectionProvider, "instagram", "canal identificável na listagem (ícone/filtro na Inbox)");
  assert.equal(conversation.chatType, "direct");
  assert.equal(conversation.unreadCount, 1);

  const messages = await deps.messageRepository.listByConversation({ tenantId: "t1", workspaceId: workspace.id, conversationId: conversation.id });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].body, "quanto custa?");
  assert.equal(messages[0].direction, "inbound");

  // Idempotente: reconectar a mesma conta (novo evento) reaproveita a MESMA connection, nunca cria
  // uma segunda (ver `ensureInstagramMessagingConnection`).
  const connection = await deps.connectionRepository.getById(conversation.connectionId);
  const payload2 = { object: "instagram", entry: [{ id: "ig_1", messaging: [{ sender: { id: "psid_2" }, recipient: { id: "ig_1" }, timestamp: 1700000001000, message: { mid: "mid_2", text: "outra pessoa" } }] }] };
  await receiveInstagramDmWebhook(deps, payload2);
  const [, other] = await deps.conversationRepository.listByWorkspace({ tenantId: "t1", workspaceId: workspace.id });
  assert.equal(other.connectionId, connection.id, "mesma conexão Instagram reaproveitada, nunca duplicada por evento");
});

test("receiveInstagramDmWebhook: evento sem sender/text/mid é pulado sem lançar", async () => {
  const { deps } = await buildDeps();
  const payload = { object: "instagram", entry: [{ id: "ig_1", messaging: [{ sender: {}, message: { text: "sem sender.id" } }] }] };

  const result = await receiveInstagramDmWebhook(deps, payload);
  assert.deepEqual(result, { processed: 0, skipped: 1, updatedConversations: [] });
});
