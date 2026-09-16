import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { registerInboundMessage, syncContactProfilePicture, syncGroupMetadata, syncGroupPicture } from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Persistência real (Postgres via pglite) do módulo Conversas, Fase 1/2, e a correção do bug
 * estrutural de identidade canônica de conversa (ver docs/conversas-canonical-chat-identity.md).
 * Foco em idempotência (mesmo evento recebido duas vezes gera uma mensagem) e isolamento
 * multi-tenant, mais os dois cenários reais que motivaram a correção: GRUPO (um grupo inteiro deve
 * ser UMA InboxConversation, nunca uma por participante) e DM (inbound e outbound do mesmo par
 * devem ficar na MESMA conversa, nunca fragmentados por self-echo).
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55661 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

test("Migrations 0080-0083 e 0115 aplicam sem erro; tabelas do módulo Conversas existem", async () => {
  for (const id of ["0080_messaging_connections", "0081_inbox_contacts", "0082_inbox_conversations", "0083_inbox_messages", "0115_inbox_canonical_chat_identity"]) {
    const status = await db.pool.query("select id from schema_migrations where id = $1", [id]);
    assert.equal(status.rows.length, 1, `migration ${id} deveria estar registrada`);
  }
});

test("PostgresMessagingConnectionRepository: create()/updateStatus()/getById() round trip", async () => {
  const workspace = await makeWorkspace("tenant-conn-1");
  const repo = new PostgresMessagingConnectionRepository(db.pool);

  const connection = await repo.create({ tenantId: "tenant-conn-1", workspaceId: workspace.id, provider: "wuzapi", displayName: "WhatsApp Comercial" });
  assert.equal(connection.status, "connecting");

  const updated = await repo.updateStatus(connection.id, { status: "connected", externalSessionId: "sess-abc", phoneNumber: "+5511999990000" });
  assert.equal(updated.status, "connected");
  assert.equal(updated.phoneNumber, "+5511999990000");

  // Correlação de evento inbound usa `getById` direto — `instanceName` no evento do WuzAPI é
  // sempre o próprio `MessagingConnection.id` (ver `wuzapi-messaging-provider.ts:connect`), não o
  // token de sessão. Ver `wuzapi-event-mapper.ts`.
  const found = await repo.getById(connection.id);
  assert.equal(found.externalSessionId, "sess-abc");
});

test("PostgresInboxContactRepository: upsertByPhone() nunca duplica pelo mesmo (workspace, telefone)", async () => {
  const workspace = await makeWorkspace("tenant-contact-1");
  const repo = new PostgresInboxContactRepository(db.pool);

  const first = await repo.upsertByPhone({ tenantId: "tenant-contact-1", workspaceId: workspace.id, phoneNormalized: "+5511988887777", name: "João" });
  const second = await repo.upsertByPhone({ tenantId: "tenant-contact-1", workspaceId: workspace.id, phoneNormalized: "+5511988887777", name: "João da Silva" });

  assert.equal(first.id, second.id, "upsert pelo mesmo telefone deve atualizar o mesmo registro, nunca criar um novo");
  assert.equal(second.name, "João da Silva");
});

test("PostgresInboxConversationRepository: findOrCreate() é idempotente por (connectionId, externalChatId) — chave canônica pós-correção", async () => {
  const workspace = await makeWorkspace("tenant-conv-1");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId: "tenant-conv-1", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const contact = await contactRepo.upsertByPhone({ tenantId: "tenant-conv-1", workspaceId: workspace.id, phoneNormalized: "+5511977776666" });

  const first = await conversationRepo.findOrCreate({ tenantId: "tenant-conv-1", workspaceId: workspace.id, connectionId: connection.id, chatType: "direct", externalChatId: "+5511977776666", contactId: contact.id });
  const second = await conversationRepo.findOrCreate({ tenantId: "tenant-conv-1", workspaceId: workspace.id, connectionId: connection.id, chatType: "direct", externalChatId: "+5511977776666", contactId: contact.id });

  assert.equal(first.id, second.id, "findOrCreate repetido pelo mesmo (connection, externalChatId) nunca deve criar uma segunda conversa");
});

test("PostgresInboxConversationRepository: conversa de GRUPO nunca ganha contactId — grupo não é um Contact do CRM", async () => {
  const workspace = await makeWorkspace("tenant-conv-group-1");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId: "tenant-conv-group-1", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const group = await conversationRepo.findOrCreate({
    tenantId: "tenant-conv-group-1", workspaceId: workspace.id, connectionId: connection.id,
    chatType: "group", externalChatId: "120363999999999999@g.us", groupName: "Grupo Futebol",
  });

  assert.equal(group.chatType, "group");
  assert.equal(group.contactId, undefined, "grupo nunca deve ter um contactId — nunca fundido automaticamente com um Contact do CRM");
  assert.equal(group.groupName, "Grupo Futebol");

  const list = await conversationRepo.listByWorkspace({ tenantId: "tenant-conv-group-1", workspaceId: workspace.id });
  assert.equal(list.length, 1);
  assert.equal(list[0].contactName, undefined);
  assert.equal(list[0].contactPhone, undefined);
  assert.equal(list[0].crmContactId, undefined);
});

test("PostgresInboxMessageRepository: create() com o mesmo (connectionId, externalMessageId) é idempotente — reentrega de evento nunca duplica mensagem", async () => {
  const workspace = await makeWorkspace("tenant-msg-1");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId: "tenant-msg-1", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const contact = await contactRepo.upsertByPhone({ tenantId: "tenant-msg-1", workspaceId: workspace.id, phoneNormalized: "+5511966665555" });
  const conversation = await conversationRepo.findOrCreate({ tenantId: "tenant-msg-1", workspaceId: workspace.id, connectionId: connection.id, chatType: "direct", externalChatId: "+5511966665555", contactId: contact.id });

  const input = {
    tenantId: "tenant-msg-1",
    workspaceId: workspace.id,
    conversationId: conversation.id,
    connectionId: connection.id,
    externalMessageId: "wamid.duplicated-event",
    direction: "inbound",
    type: "text",
    body: "Oi",
  };

  const first = await messageRepo.create(input);
  const second = await messageRepo.create(input); // simula reentrega do mesmo evento pelo RabbitMQ

  assert.equal(first.message.id, second.message.id, "o mesmo externalMessageId na mesma conexão nunca deve gerar uma segunda mensagem");
  assert.equal(first.wasCreated, true);
  assert.equal(second.wasCreated, false, "reentrega deve reportar wasCreated=false — é o que registerInboundMessage usa para não incrementar unread_count de novo");

  const count = await db.pool.query("select count(*)::int as count from inbox_messages where connection_id = $1 and external_message_id = $2", [connection.id, "wamid.duplicated-event"]);
  assert.equal(count.rows[0].count, 1);
});

test("PostgresInboxMessageRepository: findByExternalId() acha sem inserir — base da idempotência de self-echo", async () => {
  const workspace = await makeWorkspace("tenant-msg-findext-1");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId: "tenant-msg-findext-1", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const conversation = await conversationRepo.findOrCreate({ tenantId: "tenant-msg-findext-1", workspaceId: workspace.id, connectionId: connection.id, chatType: "direct", externalChatId: "+5511900000001" });

  const notFound = await messageRepo.findByExternalId({ connectionId: connection.id, externalMessageId: "wamid.nao-existe" });
  assert.equal(notFound, undefined);

  const { message } = await messageRepo.create({
    tenantId: "tenant-msg-findext-1", workspaceId: workspace.id, conversationId: conversation.id, connectionId: connection.id,
    externalMessageId: "wamid.existe", direction: "outbound", type: "text", status: "sent", body: "Oi",
  });
  const found = await messageRepo.findByExternalId({ connectionId: connection.id, externalMessageId: "wamid.existe" });
  assert.equal(found.id, message.id);
});

test("PostgresInboxMessageRepository: mensagens outbound sem externalMessageId (queued) não colidem entre si", async () => {
  const workspace = await makeWorkspace("tenant-msg-2");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId: "tenant-msg-2", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const contact = await contactRepo.upsertByPhone({ tenantId: "tenant-msg-2", workspaceId: workspace.id, phoneNormalized: "+5511955554444" });
  const conversation = await conversationRepo.findOrCreate({ tenantId: "tenant-msg-2", workspaceId: workspace.id, connectionId: connection.id, chatType: "direct", externalChatId: "+5511955554444", contactId: contact.id });

  const base = { tenantId: "tenant-msg-2", workspaceId: workspace.id, conversationId: conversation.id, connectionId: connection.id, direction: "outbound", type: "text", status: "queued" };
  const first = await messageRepo.create({ ...base, body: "Mensagem 1" });
  const second = await messageRepo.create({ ...base, body: "Mensagem 2" });

  assert.notEqual(first.message.id, second.message.id, "duas mensagens queued sem externalMessageId (NULL) não podem ser tratadas como a mesma");
  assert.equal(first.wasCreated, true);
  assert.equal(second.wasCreated, true);
});

test("Isolamento multi-tenant: listByWorkspace() nunca mistura conexões/conversas de tenants diferentes", async () => {
  const workspaceA = await makeWorkspace("tenant-iso-a");
  const workspaceB = await makeWorkspace("tenant-iso-b");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);

  const connectionA = await connectionRepo.create({ tenantId: "tenant-iso-a", workspaceId: workspaceA.id, provider: "wuzapi", displayName: "A" });
  const connectionB = await connectionRepo.create({ tenantId: "tenant-iso-b", workspaceId: workspaceB.id, provider: "wuzapi", displayName: "B" });

  const listA = await connectionRepo.listByWorkspace({ tenantId: "tenant-iso-a", workspaceId: workspaceA.id });
  const listB = await connectionRepo.listByWorkspace({ tenantId: "tenant-iso-b", workspaceId: workspaceB.id });
  assert.deepEqual(listA.map((c) => c.id), [connectionA.id]);
  assert.deepEqual(listB.map((c) => c.id), [connectionB.id]);

  const contactA = await contactRepo.upsertByPhone({ tenantId: "tenant-iso-a", workspaceId: workspaceA.id, phoneNormalized: "+5511911112222" });
  const contactB = await contactRepo.upsertByPhone({ tenantId: "tenant-iso-b", workspaceId: workspaceB.id, phoneNormalized: "+5511911112222" }); // mesmo telefone, workspace diferente
  assert.notEqual(contactA.id, contactB.id, "o mesmo telefone em workspaces diferentes deve gerar contatos DIFERENTES, nunca ser tratado como o mesmo contato entre tenants");

  const conversationA = await conversationRepo.findOrCreate({ tenantId: "tenant-iso-a", workspaceId: workspaceA.id, connectionId: connectionA.id, chatType: "direct", externalChatId: "+5511911112222", contactId: contactA.id });
  const conversationsA = await conversationRepo.listByWorkspace({ tenantId: "tenant-iso-a", workspaceId: workspaceA.id });
  const conversationsB = await conversationRepo.listByWorkspace({ tenantId: "tenant-iso-b", workspaceId: workspaceB.id });
  assert.deepEqual(conversationsA.map((c) => c.id), [conversationA.id]);
  assert.deepEqual(conversationsB, [], "workspace B não pode ver a conversa criada no workspace A");

  // Mesmo externalChatId ("+5511911112222"), workspaces/tenants DIFERENTES — nunca pode colidir
  // entre tenants (a unique key é (connection_id, external_chat_id), e connection_id já é isolado
  // por tenant/workspace).
  const conversationB = await conversationRepo.findOrCreate({ tenantId: "tenant-iso-b", workspaceId: workspaceB.id, connectionId: connectionB.id, chatType: "direct", externalChatId: "+5511911112222", contactId: contactB.id });
  assert.notEqual(conversationA.id, conversationB.id);
});

test("registerInboundMessage: reentrega do mesmo evento NÃO incrementa unread_count de novo (achado ao vivo, spike Fase 2)", async () => {
  const workspace = await makeWorkspace("tenant-unread-1");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId: "tenant-unread-1", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo };

  const input = {
    tenantId: "tenant-unread-1",
    workspaceId: workspace.id,
    connectionId: connection.id,
    chatId: "5511944443333",
    isGroup: false,
    fromMe: false,
    senderId: "5511944443333",
    senderName: "Contato Teste",
    externalMessageId: "wamid.regressao-unread",
    type: "text",
    body: "Oi",
    occurredAt: new Date().toISOString(),
  };

  const first = await registerInboundMessage(deps, input);
  const second = await registerInboundMessage(deps, input); // simula reentrega do mesmo evento (RabbitMQ redelivery)

  assert.equal(first.message.id, second.message.id, "reentrega não pode gerar uma segunda mensagem");

  const conversation = await conversationRepo.getById(first.conversation.id);
  assert.equal(conversation.unreadCount, 1, "reentrega do mesmo evento não pode incrementar unread_count de novo — bug real encontrado no spike, corrigido via wasCreated");
});

/**
 * Correção do bug estrutural de identidade de conversa (ver docs/conversas-canonical-chat-identity.md).
 * Estes são os cenários REAIS reportados na homologação: DM fragmentado por self-echo e grupo
 * fragmentado por participante.
 */

test("DIRECT_CONVERSATION_IDENTITY: inbound + outbound (self-echo) + inbound de novo ficam na MESMA conversa", async () => {
  const workspace = await makeWorkspace("tenant-direct-identity-1");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo };

  const connection = await connectionRepo.create({ tenantId: "tenant-direct-identity-1", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const peer = "5511933332222";

  // 1) Pessoa A envia "entrada 1".
  const r1 = await registerInboundMessage(deps, {
    tenantId: "tenant-direct-identity-1", workspaceId: workspace.id, connectionId: connection.id,
    chatId: peer, isGroup: false, fromMe: false, senderId: peer, senderName: "Pessoa A",
    externalMessageId: "wamid.dm-in-1", type: "text", body: "entrada 1", occurredAt: new Date().toISOString(),
  });

  // 2) Vorix responde "saída 1" — via sendInboxMessage (aqui simulado diretamente no repositório,
  //    já que o use case completo depende de outboundQueue/provider) na conversa JÁ existente.
  const outbound1 = await messageRepo.create({
    tenantId: "tenant-direct-identity-1", workspaceId: workspace.id, conversationId: r1.conversation.id, connectionId: connection.id,
    direction: "outbound", type: "text", status: "queued", body: "saída 1", sentByUserId: "user-1",
  });
  // Mesma transição de estado que `processOutboundMessage` faz de verdade (`tryMarkSending` antes
  // de `markSent` — CAS `queued -> sending -> sent`; `markSent` sozinho é no-op se não estiver
  // `sending`, ver `PostgresInboxMessageRepository.markSent`).
  await messageRepo.tryMarkSending(outbound1.message.id);
  await messageRepo.markSent(outbound1.message.id, { externalMessageId: "wamid.dm-out-1", sentAt: new Date().toISOString() });

  // 3) WuzAPI emite o self-echo dessa MESMA mensagem (IsFromMe=true, Chat=peer, mesmo Info.ID) —
  //    deve ser reconhecido como já registrada, NUNCA criar uma segunda conversa/mensagem.
  const echo1 = await registerInboundMessage(deps, {
    tenantId: "tenant-direct-identity-1", workspaceId: workspace.id, connectionId: connection.id,
    chatId: peer, isGroup: false, fromMe: true, senderId: "5511900000000", senderName: "Minha Empresa",
    externalMessageId: "wamid.dm-out-1", type: "text", body: "saída 1", occurredAt: new Date().toISOString(),
  });
  assert.equal(echo1.wasCreated, false, "self-echo de uma mensagem já registrada pelo Vorix deve ser no-op");
  assert.equal(echo1.conversation.id, r1.conversation.id, "self-echo nunca cria uma segunda conversa");

  // 4) Pessoa A envia "entrada 2".
  const r2 = await registerInboundMessage(deps, {
    tenantId: "tenant-direct-identity-1", workspaceId: workspace.id, connectionId: connection.id,
    chatId: peer, isGroup: false, fromMe: false, senderId: peer, senderName: "Pessoa A",
    externalMessageId: "wamid.dm-in-2", type: "text", body: "entrada 2", occurredAt: new Date().toISOString(),
  });
  assert.equal(r2.conversation.id, r1.conversation.id, "segunda mensagem da mesma pessoa deve continuar na mesma conversa");

  // 1 conversation; 3 mensagens reais (entrada 1 + saída 1 + entrada 2) — o self-echo da saída 1
  // é idempotente (mesmo externalMessageId) e nunca soma uma 4ª linha.
  const allConversations = await conversationRepo.listByWorkspace({ tenantId: "tenant-direct-identity-1", workspaceId: workspace.id });
  assert.equal(allConversations.length, 1, "DM inbound+outbound nunca pode fragmentar em mais de uma conversa");

  const messages = await messageRepo.listByConversation({ tenantId: "tenant-direct-identity-1", workspaceId: workspace.id, conversationId: r1.conversation.id, limit: 50 });
  assert.equal(messages.length, 3, "entrada 1 + saída 1 + entrada 2 — o self-echo da saída 1 é idempotente, nunca duplica");
});

test("GROUP_CONVERSATION_IDENTITY + GROUP_PARTICIPANT_ATTRIBUTION: 3 participantes + resposta do Vorix + repetição ficam em UMA InboxConversation, com remetente correto por mensagem", async () => {
  const workspace = await makeWorkspace("tenant-group-identity-1");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo };

  const connection = await connectionRepo.create({ tenantId: "tenant-group-identity-1", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const groupJid = "120363912345678901@g.us";

  const joao = await registerInboundMessage(deps, {
    tenantId: "tenant-group-identity-1", workspaceId: workspace.id, connectionId: connection.id,
    chatId: groupJid, isGroup: true, groupName: "Grupo Futebol", fromMe: false,
    senderId: "+5511911110001", senderName: "João",
    externalMessageId: "wamid.group-joao-1", type: "text", body: "Bora jogar às 20h?", occurredAt: new Date().toISOString(),
  });
  const maria = await registerInboundMessage(deps, {
    tenantId: "tenant-group-identity-1", workspaceId: workspace.id, connectionId: connection.id,
    chatId: groupJid, isGroup: true, fromMe: false,
    senderId: "+5511911110002", senderName: "Maria",
    externalMessageId: "wamid.group-maria-1", type: "text", body: "Fechou", occurredAt: new Date().toISOString(),
  });
  const carlos = await registerInboundMessage(deps, {
    tenantId: "tenant-group-identity-1", workspaceId: workspace.id, connectionId: connection.id,
    chatId: groupJid, isGroup: true, fromMe: false,
    senderId: "+5511911110003", senderName: "Carlos",
    externalMessageId: "wamid.group-carlos-1", type: "text", body: "Vou também", occurredAt: new Date().toISOString(),
  });

  // Todos os três participantes devem cair na MESMA conversa (o grupo), nunca uma por participante.
  assert.equal(maria.conversation.id, joao.conversation.id, "participante diferente no mesmo grupo deve resolver pra mesma conversa");
  assert.equal(carlos.conversation.id, joao.conversation.id, "participante diferente no mesmo grupo deve resolver pra mesma conversa");
  assert.equal(joao.conversation.chatType, "group");
  assert.equal(joao.conversation.contactId, undefined, "conversa de grupo nunca tem contactId — nunca fundida com um Contact do CRM");

  // Vorix responde no grupo.
  const outbound = await messageRepo.create({
    tenantId: "tenant-group-identity-1", workspaceId: workspace.id, conversationId: joao.conversation.id, connectionId: connection.id,
    direction: "outbound", type: "text", status: "sent", body: "Beleza, confirmado às 20h!", sentByUserId: "user-1",
  });

  // João envia de novo.
  const joaoAgain = await registerInboundMessage(deps, {
    tenantId: "tenant-group-identity-1", workspaceId: workspace.id, connectionId: connection.id,
    chatId: groupJid, isGroup: true, fromMe: false,
    senderId: "+5511911110001", senderName: "João",
    externalMessageId: "wamid.group-joao-2", type: "text", body: "Show!", occurredAt: new Date().toISOString(),
  });
  assert.equal(joaoAgain.conversation.id, joao.conversation.id);

  // Resultado obrigatório (seção 24 do pedido original): 1 InboxConversation, 5 mensagens.
  const allConversations = await conversationRepo.listByWorkspace({ tenantId: "tenant-group-identity-1", workspaceId: workspace.id });
  assert.equal(allConversations.length, 1, "um grupo inteiro deve ser UMA InboxConversation, nunca uma por participante");

  const messages = await messageRepo.listByConversation({ tenantId: "tenant-group-identity-1", workspaceId: workspace.id, conversationId: joao.conversation.id, limit: 50 });
  assert.equal(messages.length, 5);

  const bySender = Object.fromEntries(messages.map((m) => [m.externalMessageId, m.senderExternalId]));
  assert.equal(bySender["wamid.group-joao-1"], "+5511911110001");
  assert.equal(bySender["wamid.group-maria-1"], "+5511911110002");
  assert.equal(bySender["wamid.group-carlos-1"], "+5511911110003");
  assert.equal(bySender["wamid.group-joao-2"], "+5511911110001");
});

test("CONCURRENT_GROUP_MESSAGES: dois participantes mandando ao mesmo tempo no mesmo grupo nunca criam duas conversas", async () => {
  const workspace = await makeWorkspace("tenant-group-concurrency-1");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo };

  const connection = await connectionRepo.create({ tenantId: "tenant-group-concurrency-1", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const groupJid = "120363987654321000@g.us";

  const [a, b] = await Promise.all([
    registerInboundMessage(deps, {
      tenantId: "tenant-group-concurrency-1", workspaceId: workspace.id, connectionId: connection.id,
      chatId: groupJid, isGroup: true, fromMe: false, senderId: "5511922220001", senderName: "Participante A",
      externalMessageId: "wamid.group-concurrent-a", type: "text", body: "grupo A", occurredAt: new Date().toISOString(),
    }),
    registerInboundMessage(deps, {
      tenantId: "tenant-group-concurrency-1", workspaceId: workspace.id, connectionId: connection.id,
      chatId: groupJid, isGroup: true, fromMe: false, senderId: "5511922220002", senderName: "Participante B",
      externalMessageId: "wamid.group-concurrent-b", type: "text", body: "grupo B", occurredAt: new Date().toISOString(),
    }),
  ]);

  assert.equal(a.conversation.id, b.conversation.id, "duas mensagens concorrentes do mesmo grupo (participantes diferentes) devem resolver pra UMA única conversa");

  const allConversations = await conversationRepo.listByWorkspace({ tenantId: "tenant-group-concurrency-1", workspaceId: workspace.id });
  assert.equal(allConversations.length, 1, "concorrência nunca pode criar uma segunda conversa pro mesmo grupo (constraint unique (connection_id, external_chat_id))");
});

/**
 * Bloco "Identity UX" (ver docs/conversas-whatsapp-experience-completion.md) — telefone como pivô
 * central da pessoa, LID/PN só como aliases técnicos resolvidos a partir de dado real do provider.
 */

test("PHONE_IDENTITY_CANONICAL: LID com RecipientAlt real vira contato keyed por TELEFONE, com o LID gravado como alias", async () => {
  const workspace = await makeWorkspace("tenant-identity-1");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo };

  const connection = await connectionRepo.create({ tenantId: "tenant-identity-1", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });

  const r1 = await registerInboundMessage(deps, {
    tenantId: "tenant-identity-1", workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+123456789012345", isGroup: false, fromMe: false,
    chatPhoneE164: "+5511988889999", chatPn: "+5511988889999", chatLid: "+123456789012345",
    senderId: "+123456789012345", senderName: "Costureira Cleo", senderPn: "+5511988889999", senderLid: "+123456789012345",
    externalMessageId: "wamid.identity-1", type: "text", body: "Oi", occurredAt: new Date().toISOString(),
  });

  assert.equal(r1.contact.phoneNormalized, "+5511988889999", "telefone é o pivô canônico quando o provider confirma o alias");
  assert.equal(r1.contact.whatsappLid, "+123456789012345");
  assert.equal(r1.contact.whatsappPn, "+5511988889999");

  const messages = await messageRepo.listByConversation({ tenantId: "tenant-identity-1", workspaceId: workspace.id, conversationId: r1.conversation.id, limit: 1 });
  assert.equal(messages[0].senderPhoneE164, "+5511988889999");
});

test("PHONE_IDENTITY_CANONICAL: LID SEM alt não inventa telefone — pivô degradado documentado", async () => {
  const workspace = await makeWorkspace("tenant-identity-2");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo };

  const connection = await connectionRepo.create({ tenantId: "tenant-identity-2", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });

  const r1 = await registerInboundMessage(deps, {
    tenantId: "tenant-identity-2", workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+123456789099999", isGroup: false, fromMe: false,
    // sem chatPhoneE164/chatPn — provider nunca confirmou o alias.
    chatLid: "+123456789099999",
    senderId: "+123456789099999", senderName: "Alguém",
    externalMessageId: "wamid.identity-2", type: "text", body: "Oi", occurredAt: new Date().toISOString(),
  });

  assert.equal(r1.contact.phoneNormalized, "+123456789099999", "sem alt, o LID vira o pivô degradado — nunca telefone inventado");
  assert.equal(r1.contact.whatsappPn, undefined);
});

test("LID_PHONE_ALIAS_RESOLUTION: mesmo alias LID em telefones DIFERENTES nunca funde automaticamente — registra conflito e segue sem o alias", async () => {
  const workspace = await makeWorkspace("tenant-identity-conflict-1");
  const contactRepo = new PostgresInboxContactRepository(db.pool);

  const contactA = await contactRepo.upsertByPhone({ tenantId: "tenant-identity-conflict-1", workspaceId: workspace.id, phoneNormalized: "+5511911112222", whatsappLid: "+999999999999999" });
  assert.equal(contactA.whatsappLid, "+999999999999999");

  // Um evento DIFERENTE tenta atribuir o MESMO lid a um telefone diferente — nunca funde os dois
  // contatos, nunca lança (o worker não pode crashar por causa de um conflito de identidade).
  const contactB = await contactRepo.upsertByPhone({ tenantId: "tenant-identity-conflict-1", workspaceId: workspace.id, phoneNormalized: "+5511922223333", whatsappLid: "+999999999999999" });

  assert.notEqual(contactB.id, contactA.id, "nunca funde automaticamente — dois contatos distintos permanecem distintos");
  assert.equal(contactB.whatsappLid, undefined, "o alias conflitante não é gravado no segundo contato — evita reivindicação dupla silenciosa");

  const stillA = await contactRepo.getById(contactA.id);
  assert.equal(stillA.whatsappLid, "+999999999999999", "o primeiro contato preserva seu alias original, intocado");
});

test("GROUP_METADATA: syncGroupMetadata preenche groupName/participantCount reais via MessagingProvider.getGroupInfo", async () => {
  const workspace = await makeWorkspace("tenant-group-metadata-1");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId: "tenant-group-metadata-1", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: "sess-group-meta" });
  const group = await conversationRepo.findOrCreate({
    tenantId: "tenant-group-metadata-1", workspaceId: workspace.id, connectionId: connection.id,
    chatType: "group", externalChatId: "120363999999999999@g.us",
  });
  assert.equal(group.groupName, undefined, "sem metadata ainda — fallback \"Grupo\" no frontend, nunca \"Grupo do WhatsApp\" permanente");

  const provider = {
    async getGroupInfo({ groupJid }) {
      assert.equal(groupJid, "120363999999999999@g.us");
      return { name: "Futebol Terça", participantCount: 18 };
    },
  };
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, connectionRepository: connectionRepo, providers: { wuzapi: provider } };

  const result = await syncGroupMetadata(deps, { tenantId: "tenant-group-metadata-1", workspaceId: workspace.id, connectionId: connection.id, conversationId: group.id });
  assert.equal(result.synced, true);

  const updated = await conversationRepo.getById(group.id);
  assert.equal(updated.groupName, "Futebol Terça");
  assert.equal(updated.groupParticipantCount, 18);
  assert.ok(updated.groupMetadataUpdatedAt);
});

test("GROUP_METADATA: provider sem getGroupInfo (ex. FakeMessagingProvider) nunca lança — synced:false", async () => {
  const workspace = await makeWorkspace("tenant-group-metadata-2");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId: "tenant-group-metadata-2", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const group = await conversationRepo.findOrCreate({ tenantId: "tenant-group-metadata-2", workspaceId: workspace.id, connectionId: connection.id, chatType: "group", externalChatId: "120363888888888888@g.us" });

  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, connectionRepository: connectionRepo, providers: { wuzapi: {} } };
  const result = await syncGroupMetadata(deps, { tenantId: "tenant-group-metadata-2", workspaceId: workspace.id, connectionId: connection.id, conversationId: group.id });
  assert.equal(result.synced, false);
});

test("GROUP_METADATA: Canal/Newsletter do WhatsApp (@newsletter, chatType também \"group\" de propósito) NUNCA chama getGroupInfo — achado ao vivo em produção (WuzAPI trava/500 pra JID de newsletter)", async () => {
  const workspace = await makeWorkspace("tenant-group-metadata-3");
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId: "tenant-group-metadata-3", workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: "sess-group-meta-3" });
  // Canal do WhatsApp — chatType é "group" de propósito (ver wuzapi-event-mapper.ts: nunca vira um
  // InboxContact com telefone fake), mas o JID termina em @newsletter, nunca @g.us.
  const channel = await conversationRepo.findOrCreate({
    tenantId: "tenant-group-metadata-3", workspaceId: workspace.id, connectionId: connection.id,
    chatType: "group", externalChatId: "120363410095637401@newsletter",
  });

  let called = false;
  const provider = { async getGroupInfo() { called = true; return { name: "nunca deveria ser chamado" }; } };
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, connectionRepository: connectionRepo, providers: { wuzapi: provider } };

  const result = await syncGroupMetadata(deps, { tenantId: "tenant-group-metadata-3", workspaceId: workspace.id, connectionId: connection.id, conversationId: channel.id });
  assert.equal(result.synced, false);
  assert.equal(called, false, "getGroupInfo nunca é chamado pra um JID de newsletter — whatsmeow.Client.GetGroupInfo só entende @g.us");
});

test("DELETE_CONVERSATION: exclusão de uma conversa (grupo ou direta) é PERMANENTE e cascateia mensagens/eventos de verdade (FK real, não in-memory)", async () => {
  const tenantId = "tenant-delete-conversation-1";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo };

  // Um grupo real, com 2 mensagens — o cenário que motivou o pedido ("excluir conversas e grupos").
  const r1 = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "120363999888777666@g.us", isGroup: true, groupName: "Grupo de Teste", fromMe: false,
    senderId: "+5511988887777", senderName: "Fulano",
    externalMessageId: "wamid.delete-1", type: "text", body: "Mensagem 1", occurredAt: new Date().toISOString(),
  });
  await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "120363999888777666@g.us", isGroup: true, fromMe: false,
    senderId: "+5511977776666", senderName: "Beltrano",
    externalMessageId: "wamid.delete-2", type: "text", body: "Mensagem 2", occurredAt: new Date().toISOString(),
  });

  const beforeCount = await db.pool.query("select count(*)::int as count from inbox_messages where conversation_id = $1", [r1.conversation.id]);
  assert.equal(beforeCount.rows[0].count, 2, "pré-condição: as 2 mensagens existem antes da exclusão");

  await conversationRepo.delete(r1.conversation.id);

  const gone = await conversationRepo.getById(r1.conversation.id);
  assert.equal(gone, undefined, "a conversa foi realmente removida, nunca um soft-delete/tombstone");

  const afterCount = await db.pool.query("select count(*)::int as count from inbox_messages where conversation_id = $1", [r1.conversation.id]);
  assert.equal(afterCount.rows[0].count, 0, "as mensagens cascateiam junto (FK on delete cascade) — nunca ficam órfãs apontando pra uma conversa inexistente");
});

test("DELETE_CONVERSATION: excluir uma conversa que já não existe (duplo clique/retry) nunca lança — idempotente", async () => {
  const workspace = await makeWorkspace("tenant-delete-conversation-2");
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  await assert.doesNotReject(conversationRepo.delete("inboxconv-nao-existe"));
});

test("UNREAD_URGENT: markUnread reaproveita unread_count (>= 1, nunca reduz uma contagem real maior); markRead sempre zera", async () => {
  const tenantId = "tenant-unread-urgent-1";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo };

  const registered = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511911112222", isGroup: false, fromMe: false,
    senderId: "+5511911112222", senderName: "Cliente",
    externalMessageId: "wamid.unread-1", type: "text", body: "Oi", occurredAt: new Date().toISOString(),
  });
  const conversationId = registered.conversation.id;

  // Já lida (unread_count = 0) — markUnread sobe pra 1, o mínimo pra aparecer no filtro "unread".
  await conversationRepo.markRead(conversationId);
  await conversationRepo.markUnread(conversationId);
  const afterMarkUnread = await conversationRepo.getById(conversationId);
  assert.equal(afterMarkUnread.unreadCount, 1);

  // 2ª mensagem real chega DEPOIS do markUnread manual — unread_count sobe normalmente a partir
  // do que já estava (nunca reseta pra 1 de novo, nunca perde a contagem real).
  await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511911112222", isGroup: false, fromMe: false,
    senderId: "+5511911112222", senderName: "Cliente",
    externalMessageId: "wamid.unread-2", type: "text", body: "Você viu minha mensagem?", occurredAt: new Date().toISOString(),
  });
  const afterSecondMessage = await conversationRepo.getById(conversationId);
  assert.equal(afterSecondMessage.unreadCount, 2);

  // markUnread numa conversa JÁ com contagem real > 1 nunca reduz pra 1.
  await conversationRepo.markUnread(conversationId);
  const afterMarkUnreadAgain = await conversationRepo.getById(conversationId);
  assert.equal(afterMarkUnreadAgain.unreadCount, 2, "markUnread nunca reduz uma contagem real já maior — só garante pelo menos 1");

  await conversationRepo.markRead(conversationId);
  const afterRead = await conversationRepo.getById(conversationId);
  assert.equal(afterRead.unreadCount, 0);
});

test("UNREAD_URGENT: setUrgent liga/desliga a flag e o filtro 'urgent' reflete o estado atual", async () => {
  const tenantId = "tenant-unread-urgent-2";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo };

  const registered = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511922223333", isGroup: false, fromMe: false,
    senderId: "+5511922223333", senderName: "Cliente",
    externalMessageId: "wamid.urgent-1", type: "text", body: "Preciso de ajuda urgente", occurredAt: new Date().toISOString(),
  });
  const conversationId = registered.conversation.id;
  assert.equal(registered.conversation.isUrgent, false, "nasce sem urgência — marcação sempre manual");

  const marked = await conversationRepo.setUrgent(conversationId, true);
  assert.equal(marked.isUrgent, true);

  const urgentList = await conversationRepo.listByWorkspace({ tenantId, workspaceId: workspace.id, filter: "urgent" });
  assert.equal(urgentList.some((item) => item.id === conversationId), true);

  const unmarked = await conversationRepo.setUrgent(conversationId, false);
  assert.equal(unmarked.isUrgent, false);

  const urgentListAfter = await conversationRepo.listByWorkspace({ tenantId, workspaceId: workspace.id, filter: "urgent" });
  assert.equal(urgentListAfter.some((item) => item.id === conversationId), false, "removida do filtro assim que desmarcada");
});

function makeFakeAvatarMediaStorage() {
  const objects = new Map();
  return {
    async health() { return { ok: true }; },
    async put(input) { objects.set(input.key, { body: input.body, contentType: input.contentType }); },
    async get(key) { return objects.get(key); },
    async delete(key) { objects.delete(key); },
    objects,
  };
}

test("FOTOS: syncContactProfilePicture baixa e grava a foto de perfil real, nunca refaz se já sincronizada", async () => {
  const tenantId = "tenant-avatar-contact-1";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const inboxMediaStorage = makeFakeAvatarMediaStorage();

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: "sess-avatar-1" });
  const contact = await contactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: "+5511977778888" });

  let requestedJid;
  const provider = {
    async getProfilePicture({ jid }) { requestedJid = jid; return { body: Buffer.from("foto real"), mimeType: "image/jpeg" }; },
  };
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, connectionRepository: connectionRepo, providers: { wuzapi: provider }, inboxMediaStorage };

  const result = await syncContactProfilePicture(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, contactId: contact.id });
  assert.equal(result.synced, true);
  assert.equal(requestedJid, "+5511977778888");

  const updated = await contactRepo.getById(contact.id);
  assert.ok(updated.profilePictureStorageRef);
  const stored = await inboxMediaStorage.get(updated.profilePictureStorageRef.objectKey);
  assert.equal(stored.body.toString("utf8"), "foto real");
  assert.ok(updated.profilePictureSyncedAt);

  let calledAgain = false;
  const providerSpy = { async getProfilePicture() { calledAgain = true; return { body: Buffer.from("outra"), mimeType: "image/jpeg" }; } };
  await syncContactProfilePicture({ ...deps, providers: { wuzapi: providerSpy } }, { tenantId, workspaceId: workspace.id, connectionId: connection.id, contactId: contact.id });
  assert.equal(calledAgain, false, "já sincronizada — nunca refaz o download");
});

test("FOTOS: syncGroupPicture baixa e grava a foto do grupo, nunca chama pra Canal/Newsletter", async () => {
  const tenantId = "tenant-avatar-group-1";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const inboxMediaStorage = makeFakeAvatarMediaStorage();

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: "sess-avatar-2" });
  const group = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, chatType: "group", externalChatId: "120363555444333222@g.us" });

  const provider = { async getProfilePicture() { return { body: Buffer.from("foto do grupo"), mimeType: "image/jpeg" }; } };
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, connectionRepository: connectionRepo, providers: { wuzapi: provider }, inboxMediaStorage };

  const result = await syncGroupPicture(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, conversationId: group.id });
  assert.equal(result.synced, true);

  const updated = await conversationRepo.getById(group.id);
  assert.ok(updated.groupPictureStorageRef);
  const stored = await inboxMediaStorage.get(updated.groupPictureStorageRef.objectKey);
  assert.equal(stored.body.toString("utf8"), "foto do grupo");

  // Canal/Newsletter — nunca chama getProfilePicture, mesma guarda de syncGroupMetadata.
  const channel = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, chatType: "group", externalChatId: "120363999888777666@newsletter" });
  let calledForChannel = false;
  const providerSpy = { async getProfilePicture() { calledForChannel = true; return { body: Buffer.from("x"), mimeType: "image/jpeg" }; } };
  await syncGroupPicture({ ...deps, providers: { wuzapi: providerSpy } }, { tenantId, workspaceId: workspace.id, connectionId: connection.id, conversationId: channel.id });
  assert.equal(calledForChannel, false);
});

test("FOTOS: pessoa/grupo sem foto de perfil (provider devolve undefined) nunca lança, synced:false", async () => {
  const tenantId = "tenant-avatar-no-picture";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const inboxMediaStorage = makeFakeAvatarMediaStorage();

  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: "sess-avatar-3" });
  const contact = await contactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: "+5511966665555" });

  const provider = { async getProfilePicture() { return undefined; } };
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, connectionRepository: connectionRepo, providers: { wuzapi: provider }, inboxMediaStorage };

  const result = await syncContactProfilePicture(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, contactId: contact.id });
  assert.equal(result.synced, false);
  const updated = await contactRepo.getById(contact.id);
  assert.equal(updated.profilePictureStorageRef, undefined);
});
