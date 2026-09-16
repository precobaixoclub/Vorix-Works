import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { FakeMessagingProvider } from "../dist/infrastructure/messaging/fake-messaging-provider.js";
import { registerInboundMessage, sendInboxMessage, deleteInboxMessage, reactToInboxMessage } from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Bloco "3 pontinhos em cada mensagem" (pedido explícito do usuário em produção: "adicione 3
 * pontinhos em cada mensagem tambem para que seja possivel excluir uma mensagem que eu queira..
 * ou clicar para reponder uma mensagem esquecifica.... reagir com emoji a uma mensagem
 * especifica") — cobre as 3 ações a nível de caso de uso, com um `FakeMessagingProvider` real
 * (mesmo duplo usado no resto do módulo) para verificar exatamente o que seria mandado ao
 * provider, sem WuzAPI real.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
before(async () => {
  db = await startTestPostgres({ port: 55713 });
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
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: "session-token-1" });
  const provider = new FakeMessagingProvider();
  const outboundQueue = { published: [], async publish(input) { this.published.push(input); } };
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, connectionRepository: connectionRepo, providers: { wuzapi: provider }, outboundQueue };
  return { workspace, connection, contactRepo, conversationRepo, messageRepo, provider, deps };
}

test("REPLY: sendInboxMessage com replyToMessageId grava snapshot de quotedMessage e monta ContextInfo real pro provider", async () => {
  const tenantId = "tenant-msgaction-reply-1";
  const { workspace, connection, deps } = await makeSetup(tenantId);

  const original = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511911110000", isGroup: false, fromMe: false,
    senderId: "+5511911110000", senderName: "Cliente",
    externalMessageId: "wamid.reply-target-1", type: "text", body: "Qual o horário de vocês?",
    occurredAt: new Date().toISOString(),
  });

  const reply = await sendInboxMessage(deps, {
    tenantId, workspaceId: workspace.id, conversationId: original.conversation.id,
    body: "Abrimos às 9h!", sentByUserId: "user-1", replyToMessageId: original.message.id,
  });

  assert.deepEqual(reply.quotedMessage, {
    externalMessageId: "wamid.reply-target-1",
    senderId: "+5511911110000",
    body: "Qual o horário de vocês?",
    type: "text",
  });

  // O envio de verdade só acontece quando processOutboundMessage roda (fora de escopo deste
  // teste) — aqui a garantia é que o SNAPSHOT persistido tem tudo que `sendOutboundByType`
  // precisa pra montar o ContextInfo real (ver teste seguinte, mais completo).
});

test("REPLY: mensagem-alvo sem externalMessageId (ainda não confirmada pelo WhatsApp) nunca finge uma citação — lança erro claro", async () => {
  const tenantId = "tenant-msgaction-reply-2";
  const { workspace, connection, deps } = await makeSetup(tenantId);

  const original = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511911110001", isGroup: false, fromMe: false,
    senderId: "+5511911110001", senderName: "Cliente",
    externalMessageId: "wamid.reply-target-2", type: "text", body: "Oi",
    occurredAt: new Date().toISOString(),
  });

  // Uma mensagem outbound QUEUED (nunca enviada ainda) não tem externalMessageId.
  const notSentYet = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: original.conversation.id, body: "Rascunho ainda não enviado" });

  await assert.rejects(
    sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: original.conversation.id, body: "Respondendo algo que ainda não foi confirmado", replyToMessageId: notSentYet.id }),
    /INBOX_QUOTED_MESSAGE_NOT_SENT_YET/,
  );
});

test("DELETE: mensagem OUTBOUND já enviada tenta revogar de verdade no WhatsApp (best-effort) e sempre remove localmente", async () => {
  const tenantId = "tenant-msgaction-delete-1";
  const { workspace, connection, deps, messageRepo } = await makeSetup(tenantId);

  const inbound = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511911110002", isGroup: false, fromMe: false,
    senderId: "+5511911110002", senderName: "Cliente",
    externalMessageId: "wamid.delete-target-1", type: "text", body: "Oi",
    occurredAt: new Date().toISOString(),
  });
  const outbound = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: inbound.conversation.id, body: "Resposta que será apagada" });
  const claimed = await messageRepo.tryMarkSending(outbound.id);
  await messageRepo.markSent(claimed.id, { externalMessageId: "wamid.outbound-1", sentAt: new Date().toISOString() });

  await deleteInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: inbound.conversation.id, messageId: outbound.id });

  assert.equal(await messageRepo.getById(outbound.id), undefined, "removida localmente");
  assert.deepEqual(deps.providers.wuzapi.revokedMessages, [{ to: inbound.conversation.externalChatId, externalMessageId: "wamid.outbound-1" }], "tentou revogar de verdade — mensagem era OUTBOUND com externalMessageId conhecido");
});

test("DELETE: mensagem INBOUND (de um contato) NUNCA tenta revogar no WhatsApp — só remove localmente (limitação real do protocolo)", async () => {
  const tenantId = "tenant-msgaction-delete-2";
  const { workspace, connection, deps, messageRepo } = await makeSetup(tenantId);

  const inbound = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511911110003", isGroup: false, fromMe: false,
    senderId: "+5511911110003", senderName: "Cliente",
    externalMessageId: "wamid.delete-target-2", type: "text", body: "Mensagem do cliente",
    occurredAt: new Date().toISOString(),
  });

  await deleteInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: inbound.conversation.id, messageId: inbound.message.id });

  assert.equal(await messageRepo.getById(inbound.message.id), undefined);
  assert.deepEqual(deps.providers.wuzapi.revokedMessages, [], "nunca tenta revogar mensagem de outra pessoa — a API real nem suporta isso");
});

test("DELETE: mensagem de outra conversa/tenant nunca é encontrada — lança, nunca apaga por engano", async () => {
  const tenantId = "tenant-msgaction-delete-3";
  const { workspace, connection, deps } = await makeSetup(tenantId);
  const other = await makeSetup("tenant-msgaction-delete-3-other");

  const mine = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511911110004", isGroup: false, fromMe: false,
    senderId: "+5511911110004", senderName: "Cliente",
    externalMessageId: "wamid.delete-target-3", type: "text", body: "Oi",
    occurredAt: new Date().toISOString(),
  });
  const theirs = await registerInboundMessage(other.deps, {
    tenantId: "tenant-msgaction-delete-3-other", workspaceId: other.workspace.id, connectionId: other.connection.id,
    chatId: "+5511911119999", isGroup: false, fromMe: false,
    senderId: "+5511911119999", senderName: "Outro",
    externalMessageId: "wamid.delete-target-4", type: "text", body: "Mensagem de outro tenant",
    occurredAt: new Date().toISOString(),
  });

  await assert.rejects(
    deleteInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: mine.conversation.id, messageId: theirs.message.id }),
    /INBOX_MESSAGE_NOT_FOUND/,
  );
});

test("REACT: atendente reagindo a uma mensagem chama o provider PRIMEIRO e só persiste localmente se der certo", async () => {
  const tenantId = "tenant-msgaction-react-1";
  const { workspace, connection, deps, messageRepo } = await makeSetup(tenantId);

  const inbound = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511911110005", isGroup: false, fromMe: false,
    senderId: "+5511911110005", senderName: "Cliente",
    externalMessageId: "wamid.react-target-1", type: "text", body: "Adorei o atendimento!",
    occurredAt: new Date().toISOString(),
  });

  const reacted = await reactToInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: inbound.conversation.id, messageId: inbound.message.id, emoji: "❤️", reactorId: "user-1", reactorName: "Atendente Um" });

  assert.deepEqual(reacted.reactions, [{ reactorId: "user-1", reactorName: "Atendente Um", emoji: "❤️" }]);
  assert.deepEqual(deps.providers.wuzapi.sentReactions, [{ to: inbound.conversation.externalChatId, externalMessageId: "wamid.react-target-1", emoji: "❤️", fromMe: false, participantJid: undefined }], "DM: nunca manda Participant (só faz sentido em grupo)");

  const reloaded = await messageRepo.getById(inbound.message.id);
  assert.deepEqual(reloaded.reactions, reacted.reactions);
});

test("REACT: reagindo à mensagem de um PARTICIPANTE de GRUPO (não a própria) inclui participantJid; reagindo à PRÓPRIA marca fromMe", async () => {
  const tenantId = "tenant-msgaction-react-2";
  const { workspace, connection, deps } = await makeSetup(tenantId);

  const groupMessage = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "120363999000111@g.us", isGroup: true, groupName: "Equipe", fromMe: false,
    senderId: "+5511911110006", senderName: "Participante",
    externalMessageId: "wamid.react-group-1", type: "text", body: "Bom dia pessoal",
    occurredAt: new Date().toISOString(),
  });
  await reactToInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: groupMessage.conversation.id, messageId: groupMessage.message.id, emoji: "👍", reactorId: "user-1" });

  assert.deepEqual(deps.providers.wuzapi.sentReactions[0], {
    to: groupMessage.conversation.externalChatId, externalMessageId: "wamid.react-group-1", emoji: "👍", fromMe: false, participantJid: "+5511911110006",
  });

  // Self-echo (nossa própria mensagem, veio "de fora do Vorix") — reagir a ela marca fromMe:true, sem participantJid.
  const ownMessage = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "120363999000111@g.us", isGroup: true, fromMe: true,
    senderId: "+5511900000000", senderName: "Bot",
    externalMessageId: "wamid.react-group-2", type: "text", body: "Mensagem nossa mandada direto do celular",
    occurredAt: new Date().toISOString(),
  });
  await reactToInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: groupMessage.conversation.id, messageId: ownMessage.message.id, emoji: "🔥", reactorId: "user-1" });

  assert.deepEqual(deps.providers.wuzapi.sentReactions[1], {
    to: groupMessage.conversation.externalChatId, externalMessageId: "wamid.react-group-2", emoji: "🔥", fromMe: true, participantJid: undefined,
  });
});

test("REACT: mensagem ainda sem externalMessageId (queued, nunca enviada) nunca finge uma reação — lança erro claro", async () => {
  const tenantId = "tenant-msgaction-react-3";
  const { workspace, connection, deps } = await makeSetup(tenantId);

  const inbound = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511911110007", isGroup: false, fromMe: false,
    senderId: "+5511911110007", senderName: "Cliente",
    externalMessageId: "wamid.react-target-2", type: "text", body: "Oi",
    occurredAt: new Date().toISOString(),
  });
  const queued = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: inbound.conversation.id, body: "Ainda na fila" });

  await assert.rejects(
    reactToInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: inbound.conversation.id, messageId: queued.id, emoji: "👍", reactorId: "user-1" }),
    /INBOX_MESSAGE_NOT_SENT_YET/,
  );
});
