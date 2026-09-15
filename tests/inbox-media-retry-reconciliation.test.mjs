import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { reconcilePendingMediaDownloads } from "../dist/infrastructure/storage/postgres/inbox-media-retry-reconciliation.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Bloco "retry de mídia" — achado ao vivo em produção (relatado pelo usuário: mensagens "só
 * informação de mídia recebida que não carregou"). Antes desta reconciliação, uma falha
 * transitória no download (rede instável, WuzAPI reiniciando no meio) deixava a mensagem sem mídia
 * pra sempre — o ref bruto só existia na memória do worker durante a única tentativa.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55667 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

function makeFakeMediaStorage() {
  const objects = new Map();
  return {
    async health() { return { ok: true }; },
    async put(input) { objects.set(input.key, { body: input.body, contentType: input.contentType }); },
    async get(key) { return objects.get(key); },
    async delete(key) { objects.delete(key); },
    objects,
  };
}

async function seedMessageWithSourceRef(tenantId, workspaceId, connectionId, conversationId, sourceRef) {
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const { message } = await messageRepo.create({
    tenantId, workspaceId, conversationId, connectionId,
    externalMessageId: nextId("wamid"), direction: "inbound", type: "image",
  });
  await messageRepo.attachMediaSourceRef(message.id, sourceRef);
  return message;
}

test("reconcilePendingMediaDownloads: mensagem que falhou na primeira tentativa é baixada com sucesso na reconciliação", async () => {
  const tenantId = "tenant-media-retry-1";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: "sess-media-retry-1" });
  const contact = await contactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: "+5511933334444" });
  const conversation = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, chatType: "direct", externalChatId: "+5511933334444", contactId: contact.id });

  const message = await seedMessageWithSourceRef(tenantId, workspace.id, connection.id, conversation.id, {
    url: "https://mmg.whatsapp.net/fake", directPath: "/v/fake-direct-path", mediaKey: "chave-teste", mimeType: "image/jpeg", fileSizeBytes: 12345,
  });

  const inboxMediaStorage = makeFakeMediaStorage();
  let capturedRef;
  const provider = {
    async downloadMedia(input) { capturedRef = input.ref; return { body: Buffer.from("imagem baixada no retry"), mimeType: "image/jpeg" }; },
  };

  const result = await reconcilePendingMediaDownloads(db.pool, provider, inboxMediaStorage);
  assert.equal(result.synced, 1);
  assert.equal(capturedRef.directPath, "/v/fake-direct-path", "o retry precisa usar o MESMO ref bruto persistido na primeira tentativa");

  const updated = await messageRepo.getById(message.id);
  assert.ok(updated.mediaStorageRef);
  const stored = await inboxMediaStorage.get(updated.mediaStorageRef.objectKey);
  assert.equal(stored.body.toString("utf8"), "imagem baixada no retry");

  // Rodar de novo é um no-op — já tem mídia, nunca tenta de novo.
  let calledAgain = false;
  const providerSpy = { async downloadMedia() { calledAgain = true; return undefined; } };
  const again = await reconcilePendingMediaDownloads(db.pool, providerSpy, inboxMediaStorage);
  assert.equal(again.synced, 0);
  assert.equal(calledAgain, false);
});

test("reconcilePendingMediaDownloads: download falha de novo (WuzAPI ainda indisponível) — mensagem continua candidata pra próxima rodada, nunca lança", async () => {
  const tenantId = "tenant-media-retry-2";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: "sess-media-retry-2" });
  const contact = await contactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: "+5511922223333" });
  const conversation = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, chatType: "direct", externalChatId: "+5511922223333", contactId: contact.id });
  const message = await seedMessageWithSourceRef(tenantId, workspace.id, connection.id, conversation.id, { url: "https://mmg.whatsapp.net/fake2", directPath: "/v/fake2", mediaKey: "k2" });

  const provider = { async downloadMedia() { throw new Error("WuzAPI indisponível (transiente)"); } };
  const result = await reconcilePendingMediaDownloads(db.pool, provider, makeFakeMediaStorage());
  assert.equal(result.synced, 0);

  const stillPending = await messageRepo.getById(message.id);
  assert.equal(stillPending.mediaStorageRef, undefined, "continua sem mídia — mas nunca lança, e o ref bruto continua lá pra próxima tentativa");
});

test("reconcilePendingMediaDownloads: sem provider.downloadMedia ou sem storage, nunca lança — scanned:0", async () => {
  const result1 = await reconcilePendingMediaDownloads(db.pool, {}, makeFakeMediaStorage());
  assert.deepEqual(result1, { scanned: 0, synced: 0 });

  const result2 = await reconcilePendingMediaDownloads(db.pool, { async downloadMedia() { return undefined; } }, undefined);
  assert.deepEqual(result2, { scanned: 0, synced: 0 });
});
