import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { mapWuzApiEvent } from "../dist/infrastructure/messaging/wuzapi/wuzapi-event-mapper.js";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { PostgresInboxIdentityLinkRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-identity-link-repository.js";
import { InMemoryInboxMessageRepository } from "../dist/infrastructure/storage/in-memory-inbox-message-repository.js";
import { registerInboundMessage, applyMessageReaction } from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Bloco "resposta citada" + "menção em grupo" + "reações" (pedido explícito do usuário em
 * produção: "quando alguem responde uma mensagem não esta mostrando o conteudo corretamente, e
 * tambem quando marca uma pessoa em um grupo... ajuste tambem para quando alguem reagir a uma
 * mensagem"). Cobre as 3 camadas: mapper (extração do payload bruto do WuzAPI), use-case
 * (resolução de menção + persistência de snapshot da citação + aplicação de reação) e repositório
 * (Postgres real via pglite, mesmo padrão de `inbox-identity-link.test.mjs`).
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
before(async () => {
  db = await startTestPostgres({ port: 55668 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function rawEvent(message, overrides = {}) {
  return {
    type: "Message",
    instanceName: "conn-1",
    event: {
      Info: { ID: "wamid-1", Sender: "5511999998888@s.whatsapp.net", PushName: "Cliente Teste", Timestamp: 1735000000, ...overrides.info },
      Message: message,
    },
  };
}

test("mapWuzApiEvent: extendedTextMessage com contextInfo.quotedMessage extrai stanzaID/participant/corpo/tipo da mensagem citada", () => {
  const mapped = mapWuzApiEvent(rawEvent({
    extendedTextMessage: {
      text: "Sim, combinado!",
      contextInfo: {
        stanzaID: "wamid-original-123",
        participant: "5511988887777@s.whatsapp.net",
        quotedMessage: { conversation: "Podemos marcar às 15h?" },
      },
    },
  }));

  assert.ok(mapped && mapped.type === "message.inbound");
  assert.equal(mapped.body, "Sim, combinado!");
  assert.equal(mapped.quotedExternalMessageId, "wamid-original-123");
  assert.equal(mapped.quotedSenderId, "5511988887777@s.whatsapp.net");
  assert.equal(mapped.quotedBody, "Podemos marcar às 15h?");
  assert.equal(mapped.quotedType, "text");
});

test("mapWuzApiEvent: contextInfo.quotedMessage de mídia usa caption como quotedBody e o tipo real (não 'text')", () => {
  const mapped = mapWuzApiEvent(rawEvent({
    extendedTextMessage: {
      text: "Gostei dessa foto",
      contextInfo: {
        stanzaID: "wamid-original-456",
        participant: "5511988887777@s.whatsapp.net",
        quotedMessage: { imageMessage: { caption: "Foto da reunião" } },
      },
    },
  }));

  assert.equal(mapped.quotedBody, "Foto da reunião");
  assert.equal(mapped.quotedType, "image");
});

test("mapWuzApiEvent: sem contextInfo (mensagem normal, não é resposta), campos de citação ficam undefined", () => {
  const mapped = mapWuzApiEvent(rawEvent({ conversation: "Mensagem qualquer" }));
  assert.equal(mapped.quotedExternalMessageId, undefined);
  assert.equal(mapped.quotedBody, undefined);
  assert.equal(mapped.mentionedJids, undefined);
});

test("mapWuzApiEvent: contextInfo.mentionedJID vira mentionedJids (array de JIDs crus, ainda não resolvidos)", () => {
  const mapped = mapWuzApiEvent(rawEvent({
    extendedTextMessage: {
      text: "@5511988887777 bom dia pessoal",
      contextInfo: { mentionedJID: ["5511988887777@s.whatsapp.net", "5511977776666@lid"] },
    },
  }));

  assert.deepEqual(mapped.mentionedJids, ["5511988887777@s.whatsapp.net", "5511977776666@lid"]);
});

test("mapWuzApiEvent: reactionMessage vira MessageReactionReceived (nunca message.inbound) com key.ID/text/sender", () => {
  const mapped = mapWuzApiEvent(rawEvent({
    reactionMessage: {
      key: { ID: "wamid-alvo-789", remoteJID: "5511999998888@s.whatsapp.net", fromMe: false },
      text: "👍",
      senderTimestampMS: 1735000100000,
    },
  }));

  assert.ok(mapped, "reação deveria ser mapeada, não descartada");
  assert.equal(mapped.type, "message.reaction");
  assert.equal(mapped.targetExternalMessageId, "wamid-alvo-789");
  assert.equal(mapped.emoji, "👍");
  assert.equal(mapped.reactorId, "+5511999998888");
  assert.equal(mapped.reactorName, "Cliente Teste");
});

test("mapWuzApiEvent: reactionMessage com text vazio (remoção de reação) ainda mapeia, emoji fica string vazia", () => {
  const mapped = mapWuzApiEvent(rawEvent({
    reactionMessage: { key: { ID: "wamid-alvo-789" }, text: "" },
  }));

  assert.ok(mapped && mapped.type === "message.reaction");
  assert.equal(mapped.emoji, "", "string vazia = reação removida, nunca descartada como se não existisse");
});

test("registerInboundMessage: mensagem com mentionedJids substitui o placeholder @<dígitos> pelo nome real do contato já conhecido", async () => {
  const tenantId = "tenant-mention-1";
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `workspace-mention-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const identityLinkRepository = new PostgresInboxIdentityLinkRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, identityLinkRepository };

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });

  // Contato mencionado já é conhecido do workspace (mesma pessoa já trocou mensagem antes).
  await contactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: "+5511988887777", name: "Maria" });

  const group = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "120363999@g.us", isGroup: true, groupName: "Equipe",
    fromMe: false, senderId: "+5511999998888", senderName: "Cliente",
    externalMessageId: "wamid.mention-1", type: "text",
    body: "@5511988887777 bom dia pessoal",
    mentionedJids: ["5511988887777@s.whatsapp.net"],
    occurredAt: new Date().toISOString(),
  });

  assert.equal(group.message.body, "@Maria bom dia pessoal", "placeholder cru vira o nome real do contato já conhecido");
});

test("registerInboundMessage: menção a JID sem contato conhecido cai pro telefone normalizado, nunca quebra a mensagem", async () => {
  const tenantId = "tenant-mention-2";
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `workspace-mention-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const identityLinkRepository = new PostgresInboxIdentityLinkRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, identityLinkRepository };

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });

  const group = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "120363998@g.us", isGroup: true, groupName: "Equipe",
    fromMe: false, senderId: "+5511999998888", senderName: "Cliente",
    externalMessageId: "wamid.mention-2", type: "text",
    body: "@5511966665555 alguém viu isso?",
    mentionedJids: ["5511966665555@s.whatsapp.net"],
    occurredAt: new Date().toISOString(),
  });

  assert.equal(group.message.body, "@+5511966665555 alguém viu isso?");
});

test("registerInboundMessage: mensagem-resposta grava um snapshot de quotedMessage (externalMessageId/senderId/body/type), nunca resolvido de novo depois", async () => {
  const tenantId = "tenant-quote-1";
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `workspace-quote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const identityLinkRepository = new PostgresInboxIdentityLinkRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, identityLinkRepository };

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });

  const result = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511999998888", isGroup: false,
    fromMe: false, senderId: "+5511999998888", senderName: "Cliente",
    externalMessageId: "wamid.reply-1", type: "text", body: "Sim, combinado!",
    quotedExternalMessageId: "wamid-original-123",
    quotedSenderId: "+5511977776666",
    quotedBody: "Podemos marcar às 15h?",
    quotedType: "text",
    occurredAt: new Date().toISOString(),
  });

  assert.deepEqual(result.message.quotedMessage, {
    externalMessageId: "wamid-original-123",
    senderId: "+5511977776666",
    body: "Podemos marcar às 15h?",
    type: "text",
  });

  const reloaded = await messageRepo.getById(result.message.id);
  assert.deepEqual(reloaded.quotedMessage, result.message.quotedMessage, "sobrevive a um reload do banco");
});

test("registerInboundMessage: mensagem sem contextInfo nenhum grava quotedMessage undefined (caso comum, não é erro)", async () => {
  const tenantId = "tenant-quote-2";
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `workspace-quote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const identityLinkRepository = new PostgresInboxIdentityLinkRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, identityLinkRepository };

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });

  const result = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511999997777", isGroup: false,
    fromMe: false, senderId: "+5511999997777", senderName: "Cliente",
    externalMessageId: "wamid.noquote-1", type: "text", body: "Mensagem normal",
    occurredAt: new Date().toISOString(),
  });

  assert.equal(result.message.quotedMessage, undefined);
});

test("applyMessageReaction (Postgres): aplica reação numa mensagem existente via externalMessageId, retorna dados pra notificação realtime", async () => {
  const tenantId = "tenant-reaction-1";
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `workspace-reaction-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const identityLinkRepository = new PostgresInboxIdentityLinkRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, identityLinkRepository };

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const registered = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511999996666", isGroup: false,
    fromMe: false, senderId: "+5511999996666", senderName: "Cliente",
    externalMessageId: "wamid.react-target-1", type: "text", body: "Mensagem original",
    occurredAt: new Date().toISOString(),
  });
  assert.deepEqual(registered.message.reactions, [], "mensagem nasce sem nenhuma reação");

  const result = await applyMessageReaction(deps, {
    connectionId: connection.id,
    targetExternalMessageId: "wamid.react-target-1",
    emoji: "👍",
    reactorId: "+5511988885555",
    reactorName: "Quem reagiu",
  });

  assert.equal(result.applied, true);
  assert.equal(result.conversationId, registered.conversation.id);
  assert.equal(result.tenantId, tenantId);
  assert.equal(result.workspaceId, workspace.id);

  const reloaded = await messageRepo.getById(registered.message.id);
  assert.deepEqual(reloaded.reactions, [{ reactorId: "+5511988885555", reactorName: "Quem reagiu", emoji: "👍" }]);
});

test("applyMessageReaction (Postgres): o mesmo reactorId reagindo de novo SUBSTITUI a reação anterior (nunca duplica)", async () => {
  const tenantId = "tenant-reaction-2";
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `workspace-reaction-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const identityLinkRepository = new PostgresInboxIdentityLinkRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, identityLinkRepository };

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const registered = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511999995555", isGroup: false,
    fromMe: false, senderId: "+5511999995555", senderName: "Cliente",
    externalMessageId: "wamid.react-target-2", type: "text", body: "Mensagem original",
    occurredAt: new Date().toISOString(),
  });

  await applyMessageReaction(deps, { connectionId: connection.id, targetExternalMessageId: "wamid.react-target-2", emoji: "👍", reactorId: "+5511988884444" });
  await applyMessageReaction(deps, { connectionId: connection.id, targetExternalMessageId: "wamid.react-target-2", emoji: "❤️", reactorId: "+5511988884444" });

  const reloaded = await messageRepo.getById(registered.message.id);
  assert.deepEqual(reloaded.reactions, [{ reactorId: "+5511988884444", emoji: "❤️" }], "só uma reação por reactorId, a mais recente vence");
});

test("applyMessageReaction (Postgres): emoji vazio (remoção) tira a reação do reactorId, sem afetar reações de outras pessoas", async () => {
  const tenantId = "tenant-reaction-3";
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `workspace-reaction-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const identityLinkRepository = new PostgresInboxIdentityLinkRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, identityLinkRepository };

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const registered = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511999994444", isGroup: false,
    fromMe: false, senderId: "+5511999994444", senderName: "Cliente",
    externalMessageId: "wamid.react-target-3", type: "text", body: "Mensagem original",
    occurredAt: new Date().toISOString(),
  });

  await applyMessageReaction(deps, { connectionId: connection.id, targetExternalMessageId: "wamid.react-target-3", emoji: "👍", reactorId: "+5511988883333" });
  await applyMessageReaction(deps, { connectionId: connection.id, targetExternalMessageId: "wamid.react-target-3", emoji: "😂", reactorId: "+5511988882222" });
  await applyMessageReaction(deps, { connectionId: connection.id, targetExternalMessageId: "wamid.react-target-3", emoji: "", reactorId: "+5511988883333" });

  const reloaded = await messageRepo.getById(registered.message.id);
  assert.deepEqual(reloaded.reactions, [{ reactorId: "+5511988882222", emoji: "😂" }]);
});

test("applyMessageReaction (Postgres): mensagem-alvo não encontrada (ex.: fora de retenção) retorna applied:false, nunca lança", async () => {
  const tenantId = "tenant-reaction-4";
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `workspace-reaction-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const identityLinkRepository = new PostgresInboxIdentityLinkRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, identityLinkRepository };

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });

  const result = await applyMessageReaction(deps, {
    connectionId: connection.id,
    targetExternalMessageId: "wamid.never-existed",
    emoji: "👍",
    reactorId: "+5511988881111",
  });

  assert.equal(result.applied, false);
  assert.equal(result.conversationId, undefined);
});

test("InMemoryInboxMessageRepository.setReaction: mesmo comportamento upsert-por-reactorId do Postgres, sem banco nenhum", async () => {
  const repo = new InMemoryInboxMessageRepository();
  const { message } = await repo.create({
    tenantId: "t1", workspaceId: "w1", conversationId: "c1", connectionId: "conn1",
    externalMessageId: "wamid.mem-1", direction: "inbound", type: "text", body: "Oi",
  });
  assert.deepEqual(message.reactions, []);

  await repo.setReaction(message.id, { reactorId: "r1", reactorName: "R1", emoji: "👍" });
  let reloaded = await repo.getById(message.id);
  assert.deepEqual(reloaded.reactions, [{ reactorId: "r1", reactorName: "R1", emoji: "👍" }]);

  await repo.setReaction(message.id, { reactorId: "r1", reactorName: "R1", emoji: "" });
  reloaded = await repo.getById(message.id);
  assert.deepEqual(reloaded.reactions, []);
});
