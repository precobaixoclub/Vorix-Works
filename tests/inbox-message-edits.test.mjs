import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mapWuzApiEvent } from "../dist/infrastructure/messaging/wuzapi/wuzapi-event-mapper.js";
import { applyMessageEdit, registerInboundMessage } from "../dist/application/inbox/inbox-use-cases.js";
import { ensureInboxTopology, INBOX_EVENTS_EXCHANGE, INBOX_QUEUES } from "../dist/infrastructure/messaging/rabbitmq/inbox-rabbitmq-topology.js";
import { InMemoryInboxMessageRepository } from "../dist/infrastructure/storage/in-memory-inbox-message-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const editTime = "2026-10-19T23:34:01.234Z";
function rawEdit(content = { conversation: "Teste 2" }, options = {}) {
  const protocolMessage = {
    type: options.enumType ?? 14,
    key: { ID: "original-1", remoteJID: "5511999998888@s.whatsapp.net" },
    editedMessage: content,
    timestampMS: String(Date.parse(editTime)),
    ...options.protocol,
  };
  return {
    type: "Message", instanceName: "conn-edit",
    event: {
      Info: { ID: "edit-event-1", Sender: "5511999998888@s.whatsapp.net", Chat: "5511999998888@s.whatsapp.net", IsFromMe: false, Timestamp: "2026-10-19T20:34:01-03:00", ...options.info },
      IsEdit: true,
      Message: options.wrapped ? { editedMessage: { message: { protocolMessage } } } : { protocolMessage },
    },
  };
}

test("edição vira atualização do ID original, nunca mensagem inbound/other", () => {
  assert.deepEqual(mapWuzApiEvent(rawEdit()), {
    type: "message.edit", tenantId: "", workspaceId: "", connectionId: "conn-edit",
    targetExternalMessageId: "original-1", fromMe: false, body: "Teste 2", occurredAt: editTime,
  });
});

test("edição reconhece wrapper bruto, enum textual e texto estendido do celular pareado", () => {
  const mapped = mapWuzApiEvent(rawEdit({ extendedTextMessage: { text: "Texto corrigido" } }, {
    wrapped: true, enumType: "MESSAGE_EDIT", info: { IsFromMe: true },
  }));
  assert.equal(mapped.type, "message.edit");
  assert.equal(mapped.body, "Texto corrigido");
  assert.equal(mapped.fromMe, true);
  assert.equal(mapped.targetExternalMessageId, "original-1");
});

test("legenda editada e legenda removida são atualizações, inclusive quando caption é omitido", () => {
  for (const kind of ["imageMessage", "videoMessage", "documentMessage"]) {
    for (const [content, expected] of [[{ caption: "Nova legenda" }, "Nova legenda"], [{ caption: "" }, ""], [{}, ""]]) {
      const mapped = mapWuzApiEvent(rawEdit({ [kind]: content }));
      assert.equal(mapped.type, "message.edit");
      assert.equal(mapped.body, expected);
    }
  }
});

test("edição incompleta, protocolo sem conteúdo, status e newsletter não criam bolhas de mídia", () => {
  for (const raw of [
    rawEdit({}, { protocol: { key: undefined } }),
    rawEdit({}, { protocol: { key: { ID: "" } } }),
    rawEdit({}, { protocol: { editedMessage: undefined } }),
    rawEdit({}, { protocol: { type: 0 } }),
    rawEdit({}, { info: { Chat: "status@broadcast" } }),
    rawEdit({}, { info: { Chat: "123@newsletter" } }),
    { ...rawEdit(), event: { ...rawEdit().event, Message: { conversation: "Sem ID do alvo" } } },
  ]) assert.equal(mapWuzApiEvent(raw), undefined);
});

test("sem timestampMS usa o horário do evento, sem confundir segundos e milissegundos", () => {
  for (const timestampMS of [undefined, "inválido", 0]) {
    assert.equal(mapWuzApiEvent(rawEdit(undefined, { protocol: { timestampMS } })).occurredAt, "2026-10-19T23:34:01.000Z");
  }
});

test("evento de edição tem fila persistente com retry e roteamento próprio", async () => {
  const queues = [];
  const bindings = [];
  await ensureInboxTopology({
    async assertQueue(name, options) { queues.push({ name, options }); },
    async assertExchange() {},
    async bindQueue(...args) { bindings.push(args); },
  });
  assert.ok(bindings.some((args) => args[0] === INBOX_QUEUES.edit && args[1] === INBOX_EVENTS_EXCHANGE && args[2] === "message.edit"));
  assert.ok(queues.some(({ name, options }) => name === INBOX_QUEUES.edit && options.durable));
  assert.ok(queues.some(({ name }) => name === `${INBOX_QUEUES.edit}.retry-5000ms`));
});

let db;
let workspace;
let connection;
let postgresDeps;
before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, join(process.cwd(), "db", "migrations"));
  workspace = await new PostgresWorkspaceRepository(db.pool).create({ tenantId: "tenant-edit", name: "Edições" });
  connection = await new PostgresMessagingConnectionRepository(db.pool).create({ tenantId: workspace.tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "WhatsApp" });
  postgresDeps = {
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    contactRepository: new PostgresInboxContactRepository(db.pool),
  };
});
after(async () => { await db?.stop(); });

for (const driver of ["postgres", "memory"]) {
  test(`${driver}: edição preserva ID, horário, anexo, reações e contador de mensagens`, async () => {
    const repo = driver === "postgres" ? postgresDeps.messageRepository : new InMemoryInboxMessageRepository();
    const seed = await registerInboundMessage(postgresDeps, {
      tenantId: workspace.tenantId, workspaceId: workspace.id, connectionId: connection.id,
      chatId: "+5511999998888", isGroup: false, fromMe: false, senderId: "+5511999998888",
      externalMessageId: `seed-${driver}`, type: "text", body: "Teste", occurredAt: editTime,
    });
    const { message } = await repo.create({
      tenantId: workspace.tenantId, workspaceId: workspace.id, connectionId: connection.id,
      conversationId: seed.conversation.id, externalMessageId: `original-${driver}`, direction: "inbound",
      type: "image", body: "Legenda anterior", metadata: { fileName: "foto.jpg" },
      mediaStorageRef: { provider: "inbox-media", objectKey: "foto.jpg" },
      quotedMessage: { body: "Citação", externalMessageId: "quoted-1", type: "text" },
    });
    await repo.setReaction(message.id, { reactorId: "atendente", emoji: "👍" });
    const before = await repo.getById(message.id);
    const beforeConversation = await postgresDeps.conversationRepository.getById(seed.conversation.id);
    const count = await repo.countByConversation({ conversationId: message.conversationId });
    const edit = {
      ...mapWuzApiEvent(rawEdit()), tenantId: workspace.tenantId, workspaceId: workspace.id,
      connectionId: connection.id, targetExternalMessageId: message.externalMessageId,
    };
    const result = await applyMessageEdit({ messageRepository: repo }, edit);
    assert.equal(result.applied, true);
    assert.equal(result.conversationId, message.conversationId);
    const updated = await repo.getById(message.id);
    assert.deepEqual(updated, { ...before, body: "Teste 2", metadata: { ...before.metadata, editedAt: editTime } });
    assert.equal(await repo.countByConversation({ conversationId: message.conversationId }), count);

    assert.equal((await applyMessageEdit({ messageRepository: repo }, edit)).applied, false, "reentrega é idempotente");
    assert.equal((await applyMessageEdit({ messageRepository: repo }, { ...edit, body: "Edição antiga", occurredAt: "2026-10-19T23:34:00.000Z" })).applied, false);
    assert.equal((await repo.getById(message.id)).body, "Teste 2");
    assert.equal((await applyMessageEdit({ messageRepository: repo }, { ...edit, body: "", occurredAt: "2026-10-19T23:34:02.000Z" })).applied, true);
    assert.equal((await repo.getById(message.id)).body, "", "permite remover legenda");
    assert.deepEqual(await postgresDeps.conversationRepository.getById(seed.conversation.id), beforeConversation, "edição não altera não lidas nem lastMessageAt");
  });

  test(`${driver}: edição do próprio celular atualiza outbound e mantém isolamento`, async () => {
    const repo = driver === "postgres" ? postgresDeps.messageRepository : new InMemoryInboxMessageRepository();
    const seed = await registerInboundMessage(postgresDeps, {
      tenantId: workspace.tenantId, workspaceId: workspace.id, connectionId: connection.id,
      chatId: "+5511888887777", isGroup: false, fromMe: true, senderId: "+5511777776666",
      externalMessageId: `self-${driver}`, type: "text", body: "Original", occurredAt: editTime,
    });
    if (driver === "memory") await repo.create({ ...seed.message });
    const edit = {
      tenantId: workspace.tenantId, workspaceId: workspace.id, connectionId: connection.id,
      targetExternalMessageId: seed.message.externalMessageId, fromMe: true, body: "Corrigida", occurredAt: editTime,
    };
    for (const override of [{ tenantId: "outro" }, { workspaceId: "outro" }, { fromMe: false }]) {
      assert.equal((await applyMessageEdit({ messageRepository: repo }, { ...edit, ...override })).applied, false);
    }
    assert.equal((await applyMessageEdit({ messageRepository: repo }, edit)).applied, true);
    const updated = await repo.findByExternalId({ connectionId: connection.id, externalMessageId: edit.targetExternalMessageId });
    assert.equal(updated.body, "Corrigida");
    assert.equal(updated.direction, "outbound");
    assert.equal(updated.status, seed.message.status);
    for (const override of [{ targetExternalMessageId: "desconhecido" }, { connectionId: "outra-conexao" }]) {
      await assert.rejects(applyMessageEdit({ messageRepository: repo }, { ...edit, ...override }), /INBOX_EDIT_TARGET_NOT_FOUND/);
    }
  });
}
