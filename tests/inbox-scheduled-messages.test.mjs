import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { cancelScheduledInboxMessage, dispatchDueScheduledMessages, sendInboxMessage } from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Bloco "mensagens agendadas" (migration 0136) — cobre: (1) `sendInboxMessage` com `scheduledAt`
 * persiste sem publicar na fila; (2) rejeita horário passado/inválido; (3) `dispatchDueScheduledMessages`
 * libera só quem já venceu, nunca quem ainda está no futuro; (4) `cancelScheduledInboxMessage` remove
 * uma mensagem ainda agendada e rejeita quem já foi liberada; (5) concorrência real — dois workers
 * chamando o dispatcher ao mesmo tempo nunca despacham a MESMA mensagem duas vezes (`FOR UPDATE SKIP
 * LOCKED`, `postgres-inbox-message-repository.ts:claimDueScheduledMessages`).
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55706 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function makeFakeMessagingProvider() {
  return {
    sent: [],
    async sendText(input) { this.sent.push({ method: "sendText", input }); return { externalMessageId: `fake-text-${this.sent.length}` }; },
  };
}

function buildDeps(provider, outboundQueue) {
  return {
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    outboundQueue: outboundQueue ?? { published: [], async publish(input) { this.published.push(input); } },
    providers: { wuzapi: provider ?? makeFakeMessagingProvider() },
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
  const phone = `+55119${String(++counter).padStart(8, "0")}`;
  const contact = await contactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: phone });
  const conversation = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, chatType: "direct", externalChatId: phone, contactId: contact.id });
  return { workspace, conversation };
}

const FUTURE = () => new Date(Date.now() + 3_600_000).toISOString();
const PAST = () => new Date(Date.now() - 60_000).toISOString();

test("sendInboxMessage com scheduledAt no futuro: persiste queued com scheduledAt, NUNCA publica na fila", async () => {
  const tenantId = "tenant-sched-1";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps();

  const message = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Bom dia!", scheduledAt: FUTURE() });

  assert.equal(message.status, "queued");
  assert.ok(message.scheduledAt);
  assert.equal(deps.outboundQueue.published.length, 0, "mensagem agendada nunca entra na fila RabbitMQ na hora do envio");
});

test("sendInboxMessage rejeita scheduledAt no passado", async () => {
  const tenantId = "tenant-sched-2";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps();

  await assert.rejects(
    () => sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Atrasada", scheduledAt: PAST() }),
    /INBOX_SCHEDULE_TIME_INVALID/,
  );
});

test("sendInboxMessage rejeita scheduledAt inválido (string não-data)", async () => {
  const tenantId = "tenant-sched-3";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps();

  await assert.rejects(
    () => sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Zoado", scheduledAt: "não-é-uma-data" }),
    /INBOX_SCHEDULE_TIME_INVALID/,
  );
});

test("dispatchDueScheduledMessages libera só quem já venceu, nunca quem ainda está no futuro", async () => {
  const tenantId = "tenant-sched-4";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps();

  const due = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Vencida", scheduledAt: new Date(Date.now() + 200).toISOString() });
  const notDue = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "No futuro", scheduledAt: FUTURE() });

  // Margem generosa (não só alguns ms) — suíte completa roda sob carga real de milhares de outros
  // testes, um `setTimeout` justo demais aqui flakava intermitentemente (achado ao vivo).
  await new Promise((resolve) => setTimeout(resolve, 500)); // garante que `due` já passou do horário

  const result = await dispatchDueScheduledMessages(deps);
  assert.equal(result.dispatched, 1);
  assert.equal(result.failed, 0);
  assert.equal(deps.outboundQueue.published.length, 1);
  assert.equal(deps.outboundQueue.published[0].messageId, due.id);

  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const dueReloaded = await messageRepo.getById(due.id);
  assert.equal(dueReloaded.scheduledAt, undefined, "scheduledAt some depois de despachada");

  const notDueReloaded = await messageRepo.getById(notDue.id);
  assert.ok(notDueReloaded.scheduledAt, "mensagem no futuro continua agendada, intocada");
  assert.equal(deps.outboundQueue.published.find((p) => p.messageId === notDue.id), undefined);
});

test("CONCORRÊNCIA: dois dispatchers rodando ao mesmo tempo nunca despacham a MESMA mensagem duas vezes", async () => {
  const tenantId = "tenant-sched-5";
  const { workspace, conversation } = await makeConversation(tenantId);
  const provider = makeFakeMessagingProvider();
  const outboundQueue = { published: [], async publish(input) { this.published.push(input); } };
  const deps = buildDeps(provider, outboundQueue);

  const due = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Corrida", scheduledAt: new Date(Date.now() + 200).toISOString() });
  await new Promise((resolve) => setTimeout(resolve, 500));

  const [resultA, resultB] = await Promise.all([dispatchDueScheduledMessages(deps), dispatchDueScheduledMessages(deps)]);
  const totalDispatched = resultA.dispatched + resultB.dispatched;
  assert.equal(totalDispatched, 1, "exatamente UM dos dois dispatchers deve reivindicar a mensagem (FOR UPDATE SKIP LOCKED)");
  assert.equal(outboundQueue.published.filter((p) => p.messageId === due.id).length, 1, "nunca publicado duas vezes");
});

test("cancelScheduledInboxMessage remove uma mensagem ainda agendada", async () => {
  const tenantId = "tenant-sched-6";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps();

  const message = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Cancelável", scheduledAt: FUTURE() });
  await cancelScheduledInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, messageId: message.id });

  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const reloaded = await messageRepo.getById(message.id);
  assert.equal(reloaded, undefined, "mensagem agendada cancelada é removida, nunca fica como rascunho fantasma");
});

test("cancelScheduledInboxMessage rejeita mensagem que não está mais agendada (já enviada/nunca agendada)", async () => {
  const tenantId = "tenant-sched-7";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps();

  const message = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Normal, sem agendamento" });

  await assert.rejects(
    () => cancelScheduledInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, messageId: message.id }),
    /INBOX_MESSAGE_NOT_SCHEDULED/,
  );
});

test("cancelScheduledInboxMessage rejeita mensagem de outra conversa/tenant (isolamento)", async () => {
  const tenantId = "tenant-sched-8";
  const { workspace, conversation } = await makeConversation(tenantId);
  const other = await makeConversation("tenant-sched-8-outro");
  const deps = buildDeps();

  const message = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Minha", scheduledAt: FUTURE() });

  await assert.rejects(
    () => cancelScheduledInboxMessage(deps, { tenantId: "tenant-sched-8-outro", workspaceId: other.workspace.id, conversationId: other.conversation.id, messageId: message.id }),
    /INBOX_MESSAGE_NOT_FOUND/,
  );
});
