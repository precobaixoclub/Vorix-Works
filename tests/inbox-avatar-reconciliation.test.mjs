import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { reconcilePendingContactPictures, reconcilePendingGroupPictures } from "../dist/infrastructure/storage/postgres/inbox-avatar-reconciliation.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Bloco "fotos de grupo/contato" — achado ao vivo em produção (o usuário testou logo após o deploy
 * da feature de avatares e reportou "não mudou nada"): contatos/grupos criados ANTES do deploy só
 * ganhariam foto quando uma mensagem NOVA chegasse. Esta reconciliação varre o que já existe e
 * busca a foto retroativamente, sem depender de mensagem nova nenhuma.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55666 });
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

test("reconcilePendingContactPictures: contato criado ANTES do deploy da feature ganha foto retroativamente, sem precisar de mensagem nova", async () => {
  const tenantId = "tenant-avatar-recon-1";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: "sess-recon-1" });
  // Contato "antigo" — já existia, nunca recebeu mensagem nenhuma desde que a feature de fotos foi
  // deployada, então nunca teria sido sincronizado pelo caminho normal (só dispara em mensagem nova).
  const contact = await contactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: "+5511911112222" });
  await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, chatType: "direct", externalChatId: "+5511911112222", contactId: contact.id });

  const inboxMediaStorage = makeFakeMediaStorage();
  let requestedJid;
  const provider = { async getProfilePicture({ jid }) { requestedJid = jid; return { body: Buffer.from("foto retroativa"), mimeType: "image/jpeg" }; } };

  const result = await reconcilePendingContactPictures(db.pool, provider, inboxMediaStorage);
  assert.equal(result.synced, 1);
  assert.equal(requestedJid, "+5511911112222");

  const updated = await contactRepo.getById(contact.id);
  assert.ok(updated.profilePictureStorageRef);
  const stored = await inboxMediaStorage.get(updated.profilePictureStorageRef.objectKey);
  assert.equal(stored.body.toString("utf8"), "foto retroativa");

  // Rodar de novo é um no-op — já sincronizado, nunca refaz o download.
  let calledAgain = false;
  const providerSpy = { async getProfilePicture() { calledAgain = true; return undefined; } };
  const again = await reconcilePendingContactPictures(db.pool, providerSpy, inboxMediaStorage);
  assert.equal(again.synced, 0);
  assert.equal(calledAgain, false);
});

test("reconcilePendingGroupPictures: grupo criado ANTES do deploy da feature ganha foto retroativamente", async () => {
  const tenantId = "tenant-avatar-recon-2";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: "sess-recon-2" });
  const group = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, chatType: "group", externalChatId: "120363777888999000@g.us" });

  const inboxMediaStorage = makeFakeMediaStorage();
  const provider = { async getProfilePicture() { return { body: Buffer.from("foto de grupo retroativa"), mimeType: "image/jpeg" }; } };

  const result = await reconcilePendingGroupPictures(db.pool, provider, inboxMediaStorage);
  assert.equal(result.synced, 1);

  const updated = await conversationRepo.getById(group.id);
  assert.ok(updated.groupPictureStorageRef);
  const stored = await inboxMediaStorage.get(updated.groupPictureStorageRef.objectKey);
  assert.equal(stored.body.toString("utf8"), "foto de grupo retroativa");
});

test("reconcilePendingContactPictures/reconcilePendingGroupPictures: sem provider.getProfilePicture ou sem storage, nunca lança — scanned:0", async () => {
  const result1 = await reconcilePendingContactPictures(db.pool, {}, makeFakeMediaStorage());
  assert.deepEqual(result1, { scanned: 0, synced: 0 });

  const result2 = await reconcilePendingGroupPictures(db.pool, { async getProfilePicture() { return undefined; } }, undefined);
  assert.deepEqual(result2, { scanned: 0, synced: 0 });
});
