import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { PostgresInboxConversationEventRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-event-repository.js";
import {
  assignConversation,
  closeConversation,
  listConversationEvents,
  listConversations,
  reopenConversation,
  setAiConversationEnabled,
  takeOverConversation,
  transferConversation,
} from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Módulo Conversas — Fase 4 (Atendimento Operacional). Foco no requisito crítico da fase:
 * concorrência real na disputa por "assumir conversa" nunca pode resultar em dois atendentes
 * donos da mesma conversa ao mesmo tempo, e a IA nunca pode ficar ligada numa conversa já assumida.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55662 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function buildDeps(tenantId) {
  return {
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    contactRepository: new PostgresInboxContactRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    workspaceRepository: new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }),
    outboundQueue: { publish: async () => {} },
    provider: undefined,
  };
}

async function makeConversation(tenantId, { aiEnabled = false } = {}) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);

  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const contact = await contactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: `+55119${counter}0000` });
  const conversation = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, contactId: contact.id });
  if (aiEnabled) await conversationRepo.setAiEnabled(conversation.id, true);
  return { workspace, connection, contact, conversation: await conversationRepo.getById(conversation.id) };
}

test("Migration 0084 aplica sem erro; tabela inbox_conversation_events existe", async () => {
  const status = await db.pool.query("select id from schema_migrations where id = $1", ["0084_inbox_conversation_events"]);
  assert.equal(status.rows.length, 1);
});

test("takeOverConversation: assume conversa sem responsável e pausa a IA atomicamente, registrando took_over + ai_paused", async () => {
  const tenantId = "tenant-takeover-1";
  const { workspace, conversation } = await makeConversation(tenantId, { aiEnabled: true });
  const deps = buildDeps(tenantId);

  const updated = await takeOverConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, userId: "user-a" });
  assert.equal(updated.assignedUserId, "user-a");
  assert.equal(updated.aiEnabled, false, "IA deve ser desligada NA MESMA operação de assumir");

  const events = await listConversationEvents(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ["took_over", "ai_paused"], "deve registrar exatamente os dois eventos discretos esperados, na ordem");
  assert.equal(events[0].performedBy, "user-a");
  assert.equal(events[0].toUserId, "user-a");
});

test("takeOverConversation: quando a IA já estava pausada, registra só took_over (sem ai_paused redundante)", async () => {
  const tenantId = "tenant-takeover-2";
  const { workspace, conversation } = await makeConversation(tenantId, { aiEnabled: false });
  const deps = buildDeps(tenantId);

  await takeOverConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, userId: "user-a" });
  const events = await listConversationEvents(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  assert.deepEqual(events.map((e) => e.type), ["took_over"]);
});

test("takeOverConversation: reclique do MESMO atendente é no-op — não gera evento duplicado", async () => {
  const tenantId = "tenant-takeover-3";
  const { workspace, conversation } = await makeConversation(tenantId, { aiEnabled: true });
  const deps = buildDeps(tenantId);

  await takeOverConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, userId: "user-a" });
  const second = await takeOverConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, userId: "user-a" });
  assert.equal(second.assignedUserId, "user-a");

  const events = await listConversationEvents(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  assert.equal(events.length, 2, "took_over + ai_paused da PRIMEIRA chamada, nada da segunda (no-op)");
});

test("CONCORRÊNCIA (requisito crítico): dois atendentes assumindo a mesma conversa ao mesmo tempo — exatamente um vence, o outro recebe 409/erro claro", async () => {
  const tenantId = "tenant-race-1";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps(tenantId);

  const results = await Promise.allSettled([
    takeOverConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, userId: "user-a" }),
    takeOverConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, userId: "user-b" }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exatamente UM dos dois deve ganhar a corrida");
  assert.equal(rejected.length, 1, "o outro deve falhar explicitamente, nunca sobrescrever silenciosamente");
  assert.match(rejected[0].reason.message, /INBOX_CONVERSATION_ALREADY_ASSIGNED/);

  // Estado final no banco tem que bater com quem realmente venceu — nunca os dois, nunca nenhum.
  const winner = fulfilled[0].value.assignedUserId;
  assert.ok(winner === "user-a" || winner === "user-b");
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const finalRow = await conversationRepo.getById(conversation.id);
  assert.equal(finalRow.assignedUserId, winner);

  // Só um evento "took_over" foi gravado — o perdedor nunca escreveu nada.
  const events = await listConversationEvents(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  assert.equal(events.filter((e) => e.type === "took_over").length, 1);
});

test("CONCORRÊNCIA: IA nunca fica ligada numa conversa já assumida, mesmo sob disputa — nenhuma janela de IA+humano juntos", async () => {
  const tenantId = "tenant-race-ai-1";
  const { workspace, conversation } = await makeConversation(tenantId, { aiEnabled: true });
  const deps = buildDeps(tenantId);

  await Promise.allSettled([
    takeOverConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, userId: "user-a" }),
    takeOverConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, userId: "user-b" }),
  ]);

  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const finalRow = await conversationRepo.getById(conversation.id);
  assert.ok(finalRow.assignedUserId, "alguém deve ter assumido");
  assert.equal(finalRow.aiEnabled, false, "IA tem que estar desligada independente de quem ganhou a corrida");
});

test("transferConversation: transfere atomicamente e registra fromUserId/toUserId/performedBy", async () => {
  const tenantId = "tenant-transfer-1";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps(tenantId);
  await takeOverConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, userId: "user-a" });

  const updated = await transferConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, toUserId: "user-b", performedBy: "user-a" });
  assert.equal(updated.assignedUserId, "user-b");

  const events = await listConversationEvents(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  const transferEvent = events.find((e) => e.type === "transferred");
  assert.ok(transferEvent);
  assert.equal(transferEvent.fromUserId, "user-a");
  assert.equal(transferEvent.toUserId, "user-b");
  assert.equal(transferEvent.performedBy, "user-a");
});

test("transferConversation: CONCORRÊNCIA — duas transferências simultâneas da mesma conversa, exatamente uma vence, a outra recebe conflito claro", async () => {
  const tenantId = "tenant-transfer-2";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps(tenantId);
  await takeOverConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, userId: "user-a" });

  // Dois pedidos concorrentes de transferência partindo do mesmo responsável ("user-a") para
  // destinos diferentes — só um pode vencer, o CAS em tryTransfer tem que impedir os dois de
  // "ganharem" e deixar a conversa num estado inconsistente.
  const results = await Promise.allSettled([
    transferConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, toUserId: "user-b", performedBy: "user-a" }),
    transferConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, toUserId: "user-c", performedBy: "user-a" }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exatamente UMA transferência deve vencer");
  assert.equal(rejected.length, 1, "a outra deve falhar explicitamente com conflito, nunca ser perdida silenciosamente");
  assert.match(rejected[0].reason.message, /INBOX_CONVERSATION_TRANSFER_CONFLICT/);

  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const finalRow = await conversationRepo.getById(conversation.id);
  assert.equal(finalRow.assignedUserId, fulfilled[0].value.assignedUserId, "estado final no banco tem que bater com quem realmente venceu");

  const events = await listConversationEvents(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  assert.equal(events.filter((e) => e.type === "transferred").length, 1, "só um evento de transferência gravado — o perdedor nunca escreveu histórico");
});

test("transferConversation: não pode transferir uma conversa sem responsável", async () => {
  const tenantId = "tenant-transfer-3";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps(tenantId);
  await assert.rejects(
    () => transferConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, toUserId: "user-b", performedBy: "user-a" }),
    /INBOX_CONVERSATION_NOT_ASSIGNED/,
  );
});

test("assignConversation: remoção de responsável registra evento unassigned", async () => {
  const tenantId = "tenant-unassign-1";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps(tenantId);
  await takeOverConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, userId: "user-a" });

  const updated = await assignConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, assignedUserId: undefined, performedBy: "user-a" });
  assert.equal(updated.assignedUserId, undefined);

  const events = await listConversationEvents(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  const unassignEvent = events.find((e) => e.type === "unassigned");
  assert.ok(unassignEvent);
  assert.equal(unassignEvent.fromUserId, "user-a");
});

test("closeConversation / reopenConversation: transições de status registradas e idempotentes", async () => {
  const tenantId = "tenant-close-1";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps(tenantId);

  const closed = await closeConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, performedBy: "user-a" });
  assert.equal(closed.status, "resolved");

  // Idempotente: fechar de novo não duplica evento.
  await closeConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, performedBy: "user-a" });

  const reopened = await reopenConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, performedBy: "user-b" });
  assert.equal(reopened.status, "open");

  const events = await listConversationEvents(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  const statusEvents = events.filter((e) => e.type === "status_changed");
  assert.equal(statusEvents.length, 2, "só 2 mudanças reais de status (fechar, reabrir) — o close idempotente não conta");
  assert.deepEqual(statusEvents.map((e) => [e.fromStatus, e.toStatus]), [["open", "resolved"], ["resolved", "open"]]);
});

test("setAiConversationEnabled: pausar/reativar registra ai_paused/ai_resumed e é idempotente", async () => {
  const tenantId = "tenant-ai-1";
  const { workspace, conversation } = await makeConversation(tenantId, { aiEnabled: true });
  const deps = buildDeps(tenantId);

  await setAiConversationEnabled(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, aiEnabled: false, performedBy: "user-a" });
  await setAiConversationEnabled(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, aiEnabled: false, performedBy: "user-a" }); // idempotente
  await setAiConversationEnabled(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, aiEnabled: true, performedBy: "user-a" });

  const events = await listConversationEvents(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  assert.deepEqual(events.map((e) => e.type), ["ai_paused", "ai_resumed"]);
});

test("Filtros: open/pending/resolved/unassigned/mine/unread retornam exatamente o subconjunto esperado", async () => {
  const tenantId = "tenant-filters-1";
  const deps = buildDeps(tenantId);

  const a = await makeConversation(tenantId); // open, sem responsável
  const b = await makeConversation(tenantId);
  await takeOverConversation(deps, { tenantId, workspaceId: b.workspace.id, conversationId: b.conversation.id, userId: "user-a" }); // open, user-a
  const c = await makeConversation(tenantId);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  await conversationRepo.setStatus(c.conversation.id, "pending");
  const d = await makeConversation(tenantId);
  await conversationRepo.setStatus(d.conversation.id, "resolved");

  // Cada conversa está num workspace diferente (makeConversation cria um workspace novo por
  // chamada) — usamos o workspace de "b" pra exercitar "mine"/"unassigned" dentro do MESMO escopo,
  // e testamos "open"/"pending"/"resolved" comparando contagens globais por tenant não é possível
  // (listByWorkspace é por workspace) — então cada assert abaixo é feito no workspace certo.
  const openInB = await listConversations(deps, { tenantId, workspaceId: b.workspace.id, filter: "open" });
  assert.deepEqual(openInB.map((x) => x.id), [b.conversation.id]);

  const mineInB = await listConversations(deps, { tenantId, workspaceId: b.workspace.id, filter: "mine", assignedUserId: "user-a" });
  assert.deepEqual(mineInB.map((x) => x.id), [b.conversation.id]);

  const unassignedInA = await listConversations(deps, { tenantId, workspaceId: a.workspace.id, filter: "unassigned" });
  assert.deepEqual(unassignedInA.map((x) => x.id), [a.conversation.id]);

  const pendingInC = await listConversations(deps, { tenantId, workspaceId: c.workspace.id, filter: "pending" });
  assert.deepEqual(pendingInC.map((x) => x.id), [c.conversation.id]);

  const resolvedInD = await listConversations(deps, { tenantId, workspaceId: d.workspace.id, filter: "resolved" });
  assert.deepEqual(resolvedInD.map((x) => x.id), [d.conversation.id]);

  // Conversa resolvida sem responsável não aparece em "unassigned" (não é mais trabalho pendente).
  const unassignedInD = await listConversations(deps, { tenantId, workspaceId: d.workspace.id, filter: "unassigned" });
  assert.deepEqual(unassignedInD, []);
});

test("Isolamento cross-tenant: take-over/transfer/eventos de um tenant nunca vazam nem afetam outro", async () => {
  const tenantA = "tenant-iso-attend-a";
  const tenantB = "tenant-iso-attend-b";
  const depsA = buildDeps(tenantA);
  const depsB = buildDeps(tenantB);

  const a = await makeConversation(tenantA);
  const b = await makeConversation(tenantB);

  await takeOverConversation(depsA, { tenantId: tenantA, workspaceId: a.workspace.id, conversationId: a.conversation.id, userId: "user-a" });
  await takeOverConversation(depsB, { tenantId: tenantB, workspaceId: b.workspace.id, conversationId: b.conversation.id, userId: "user-b" });

  // Tentar operar a conversa do tenant B usando o contexto (tenantId) do tenant A tem que falhar
  // como "não encontrada" — nunca vazar existência nem permitir a ação.
  await assert.rejects(
    () => transferConversation(depsA, { tenantId: tenantA, workspaceId: b.workspace.id, conversationId: b.conversation.id, toUserId: "user-x", performedBy: "user-a" }),
    /INBOX_CONVERSATION_NOT_FOUND/,
  );

  const eventsA = await listConversationEvents(depsA, { tenantId: tenantA, workspaceId: a.workspace.id, conversationId: a.conversation.id });
  const eventsB = await listConversationEvents(depsB, { tenantId: tenantB, workspaceId: b.workspace.id, conversationId: b.conversation.id });
  assert.equal(eventsA.every((e) => e.tenantId === tenantA), true);
  assert.equal(eventsB.every((e) => e.tenantId === tenantB), true);

  const listInA = await listConversations(depsA, { tenantId: tenantA, workspaceId: a.workspace.id, filter: "all" });
  assert.deepEqual(listInA.map((x) => x.id), [a.conversation.id], "workspace do tenant A nunca pode ver a conversa do tenant B");
});
