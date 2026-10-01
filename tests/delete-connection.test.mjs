import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { FakeMessagingProvider } from "../dist/infrastructure/messaging/fake-messaging-provider.js";
import { registerInboundMessage, deleteConnection } from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Bloco "excluir canal" (achado real do usuário em produção: "não tá sendo possível excluir o
 * canal") — nenhum teste cobria `deleteConnection` até aqui; a causa real da falha em produção era
 * uma permissão de FRONTEND mal calibrada (`canOperate` em vez de `canManageTenant`, corrigido em
 * `connections-tab.tsx`), mas o próprio caso de uso nunca tinha sido verificado de ponta a ponta
 * contra um Postgres real — este arquivo fecha essa lacuna.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
before(async () => {
  db = await startTestPostgres({ port: 55999 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeSetup(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `workspace-${tenantId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const provider = new FakeMessagingProvider();
  const outboundQueue = { published: [], async publish(input) { this.published.push(input); } };
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, connectionRepository: connectionRepo, providers: { wuzapi: provider }, outboundQueue };
  return { workspace, contactRepo, conversationRepo, messageRepo, connectionRepo, provider, deps };
}

async function makeConnection(connectionRepo, tenantId, workspaceId, displayName) {
  const connection = await connectionRepo.create({ tenantId, workspaceId, provider: "wuzapi", displayName });
  return connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: `session-${connection.id}` });
}

test("deleteConnection: apaga o canal e suas conversas; contato exclusivo some, contato que também fala por OUTRO canal do workspace é preservado", async () => {
  const tenantId = "tenant-delete-conn-1";
  const { workspace, contactRepo, conversationRepo, connectionRepo, deps } = await makeSetup(tenantId);
  const connectionA = await makeConnection(connectionRepo, tenantId, workspace.id, "Canal A");
  const connectionB = await makeConnection(connectionRepo, tenantId, workspace.id, "Canal B");

  // Contato compartilhado: fala com o workspace pelos DOIS canais (dedup por telefone, migration 0081).
  const sharedOnA = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connectionA.id,
    chatId: "+5511900000001", isGroup: false, fromMe: false,
    senderId: "+5511900000001", senderName: "Cliente compartilhado",
    externalMessageId: "wamid.shared-a", type: "text", body: "Oi pelo canal A",
    occurredAt: new Date().toISOString(),
  });
  const sharedOnB = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connectionB.id,
    chatId: "+5511900000001", isGroup: false, fromMe: false,
    senderId: "+5511900000001", senderName: "Cliente compartilhado",
    externalMessageId: "wamid.shared-b", type: "text", body: "Oi pelo canal B",
    occurredAt: new Date().toISOString(),
  });
  assert.equal(sharedOnA.contact.id, sharedOnB.contact.id, "mesmo telefone no mesmo workspace precisa resolver pro MESMO contato (pré-condição do teste)");

  // Contato exclusivo do canal A — só existe pra ele, precisa sumir junto com o canal.
  const exclusiveOnA = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connectionA.id,
    chatId: "+5511900000002", isGroup: false, fromMe: false,
    senderId: "+5511900000002", senderName: "Cliente exclusivo do A",
    externalMessageId: "wamid.exclusive-a", type: "text", body: "Só falo pelo canal A",
    occurredAt: new Date().toISOString(),
  });

  await deleteConnection(deps, { tenantId, workspaceId: workspace.id, connectionId: connectionA.id });

  assert.equal(await connectionRepo.getById(connectionA.id), undefined, "o canal A some");
  assert.ok(await connectionRepo.getById(connectionB.id), "o canal B nunca é tocado");

  assert.equal(await conversationRepo.getById(sharedOnA.conversation.id), undefined, "conversa do contato compartilhado NO CANAL A some (cascade)");
  assert.ok(await conversationRepo.getById(sharedOnB.conversation.id), "conversa do MESMO contato no canal B permanece intacta");
  assert.equal(await conversationRepo.getById(exclusiveOnA.conversation.id), undefined, "conversa exclusiva do canal A some (cascade)");

  assert.ok(await contactRepo.getById(sharedOnA.contact.id), "contato compartilhado é preservado — ainda tem conversa ativa no canal B");
  assert.equal(await contactRepo.getById(exclusiveOnA.contact.id), undefined, "contato exclusivo do canal A é apagado — não sobrou nenhuma conversa dele em nenhum canal");
});

test("deleteConnection: canal com proposta comercial ENTREGUE através dele não pode ser excluído — erro claro, nada é apagado", async () => {
  const tenantId = "tenant-delete-conn-2";
  const { workspace, conversationRepo, connectionRepo, deps } = await makeSetup(tenantId);
  const connection = await makeConnection(connectionRepo, tenantId, workspace.id, "Canal com proposta entregue");

  const inbound = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511900000003", isGroup: false, fromMe: false,
    senderId: "+5511900000003", senderName: "Cliente com proposta",
    externalMessageId: "wamid.proposal-target", type: "text", body: "Me manda a proposta",
    occurredAt: new Date().toISOString(),
  });

  // Mínimo necessário pra satisfazer as FKs de `proposals`/`proposal_deliveries` (migrations
  // 0098/0130) sem passar pela pipeline completa de CRM — o que importa aqui é só a linha de
  // ENTREGA apontando pra uma conversa deste canal (`conversation_id on delete restrict`).
  const proposalId = `proposal-${randomUUID()}`;
  await db.pool.query(
    `insert into proposals (id, tenant_id, workspace_id, title, public_token_hash) values ($1, $2, $3, 'Proposta de teste', $4)`,
    [proposalId, tenantId, workspace.id, `hash-${randomUUID()}`],
  );
  await db.pool.query(
    `insert into proposal_deliveries (id, tenant_id, workspace_id, proposal_id, conversation_id, idempotency_key, status) values ($1, $2, $3, $4, $5, $6, 'queued')`,
    [`delivery-${randomUUID()}`, tenantId, workspace.id, proposalId, inbound.conversation.id, `idem-${randomUUID()}`],
  );

  await assert.rejects(
    deleteConnection(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id }),
    /INBOX_CONNECTION_HAS_PROPOSAL_DELIVERIES/,
  );

  assert.ok(await connectionRepo.getById(connection.id), "nada foi apagado — o canal continua existindo depois do erro");
  assert.ok(await conversationRepo.getById(inbound.conversation.id), "a conversa com a entrega de proposta continua existindo depois do erro");
});

test("deleteConnection: canal de outro tenant nunca é encontrado — lança, nunca apaga por engano", async () => {
  const tenantId = "tenant-delete-conn-3";
  const { workspace, connectionRepo, deps } = await makeSetup(tenantId);
  const other = await makeSetup("tenant-delete-conn-3-other");
  const theirConnection = await makeConnection(other.connectionRepo, "tenant-delete-conn-3-other", other.workspace.id, "Canal de outro tenant");

  await assert.rejects(
    deleteConnection(deps, { tenantId, workspaceId: workspace.id, connectionId: theirConnection.id }),
    /INBOX_CONNECTION_NOT_FOUND/,
  );

  assert.ok(await connectionRepo.getById(theirConnection.id), "o canal do outro tenant continua existindo — nunca foi apagado");
});
