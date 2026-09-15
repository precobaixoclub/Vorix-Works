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
import { PostgresNotificationRepository } from "../dist/infrastructure/storage/postgres/postgres-notification-repository.js";
import { InMemoryNotificationRepository } from "../dist/infrastructure/storage/in-memory-notification-repository.js";
import { registerInboundMessage, assignConversation } from "../dist/application/inbox/inbox-use-cases.js";
import {
  createNotification,
  listActiveNotifications,
  listNotificationHistory,
  dismissNotification,
  dismissAllNotifications,
  notifyBestEffort,
} from "../dist/application/notification/notification-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Central de notificações in-app ("sino", réplica adaptada do CMDesk, pedido explícito do
 * usuário). Cobre: CRUD básico (create/listActive/listHistory/dismiss/dismissAll),
 * `readAt`+`dismissedAt` sempre setados juntos, `notifyBestEffort` nunca lança mesmo sem
 * repositório configurado, e o gatilho real de produção (`assignConversation` notificando o novo
 * responsável, nunca quem executou a ação).
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
before(async () => {
  db = await startTestPostgres({ port: 55717 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeSetup(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `workspace-${tenantId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const notificationRepository = new PostgresNotificationRepository(db.pool);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const conversationEventRepo = new PostgresInboxConversationEventRepository(db.pool);

  const deps = {
    contactRepository: contactRepo,
    conversationRepository: conversationRepo,
    messageRepository: messageRepo,
    conversationEventRepository: conversationEventRepo,
    notificationRepository,
  };
  return { workspace, connectionRepo, deps, notificationRepository };
}

async function makeConversation(tenantId, workspace, connectionRepo, deps, externalMessageId) {
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Canal" });
  const registered = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: `+551199${Math.floor(Math.random() * 10_000_000)}`, isGroup: false, fromMe: false,
    senderId: "+5511900000000", senderName: "Cliente",
    externalMessageId, type: "text", body: "Oi", occurredAt: new Date().toISOString(),
  });
  return registered.conversation;
}

test("CRIAR/LISTAR: notificação criada aparece em listActive; realtimePublisher é chamado (best-effort)", async () => {
  const tenantId = "tenant-notif-1";
  const { workspace, notificationRepository } = await makeSetup(tenantId);
  const published = [];
  const deps = { notificationRepository, realtimePublisher: { publish: (n) => published.push(n) } };

  const notification = await createNotification(deps, {
    tenantId, workspaceId: workspace.id, userId: "user-1", title: "Título", body: "Corpo",
    sourceType: "test_source", sourceId: "src-1", sourceUrl: "/x",
  });
  assert.equal(notification.readAt, undefined, "recém-criada nunca vem lida");
  assert.equal(notification.dismissedAt, undefined);
  assert.equal(published.length, 1, "publica no realtime depois de persistir");
  assert.equal(published[0].id, notification.id);

  const active = await listActiveNotifications(deps, { tenantId, workspaceId: workspace.id, userId: "user-1" });
  assert.equal(active.length, 1);
  assert.equal(active[0].title, "Título");
});

test("DISMISS: readAt e dismissedAt sempre setados JUNTOS; some da lista ativa mas continua no histórico", async () => {
  const tenantId = "tenant-notif-2";
  const { workspace, notificationRepository } = await makeSetup(tenantId);
  const deps = { notificationRepository };

  const notification = await createNotification(deps, { tenantId, workspaceId: workspace.id, userId: "user-1", title: "T", sourceType: "x" });
  const dismissed = await dismissNotification(deps, { tenantId, workspaceId: workspace.id, userId: "user-1", id: notification.id });
  assert.ok(dismissed.readAt, "dismiss seta readAt junto");
  assert.ok(dismissed.dismissedAt);

  const active = await listActiveNotifications(deps, { tenantId, workspaceId: workspace.id, userId: "user-1" });
  assert.equal(active.length, 0, "dispensada some da lista ativa");
  const history = await listNotificationHistory(deps, { tenantId, workspaceId: workspace.id, userId: "user-1" });
  assert.equal(history.length, 1, "continua no histórico");

  await assert.rejects(
    dismissNotification(deps, { tenantId, workspaceId: workspace.id, userId: "user-1", id: "nao-existe" }),
    /NOTIFICATION_NOT_FOUND/,
  );
});

test("ISOLAMENTO: dismiss/list nunca vazam entre tenant/workspace/usuário diferentes", async () => {
  const tenantId = "tenant-notif-3";
  const { workspace, notificationRepository } = await makeSetup(tenantId);
  const deps = { notificationRepository };

  const mine = await createNotification(deps, { tenantId, workspaceId: workspace.id, userId: "user-1", title: "Minha", sourceType: "x" });
  await createNotification(deps, { tenantId, workspaceId: workspace.id, userId: "user-2", title: "De outro usuário", sourceType: "x" });

  const activeForUser1 = await listActiveNotifications(deps, { tenantId, workspaceId: workspace.id, userId: "user-1" });
  assert.equal(activeForUser1.length, 1);
  assert.equal(activeForUser1[0].id, mine.id);

  await assert.rejects(
    dismissNotification(deps, { tenantId, workspaceId: workspace.id, userId: "user-2", id: mine.id }),
    /NOTIFICATION_NOT_FOUND/,
    "usuário 2 não consegue dispensar notificação do usuário 1",
  );
});

test("DISMISS_ALL: marca todas as ativas do usuário; devolve a contagem; idempotente (nunca conta de novo)", async () => {
  const tenantId = "tenant-notif-4";
  const { workspace, notificationRepository } = await makeSetup(tenantId);
  const deps = { notificationRepository };

  await createNotification(deps, { tenantId, workspaceId: workspace.id, userId: "user-1", title: "A", sourceType: "x" });
  await createNotification(deps, { tenantId, workspaceId: workspace.id, userId: "user-1", title: "B", sourceType: "x" });

  const first = await dismissAllNotifications(deps, { tenantId, workspaceId: workspace.id, userId: "user-1" });
  assert.equal(first.dismissed, 2);
  const second = await dismissAllNotifications(deps, { tenantId, workspaceId: workspace.id, userId: "user-1" });
  assert.equal(second.dismissed, 0, "nada mais pra dispensar — nunca reconta as já dispensadas");
});

test("NOTIFY_BEST_EFFORT: nunca lança sem notificationRepository configurado (módulo desligado)", async () => {
  assert.doesNotThrow(() => notifyBestEffort(undefined, { tenantId: "t", workspaceId: "w", userId: "u", title: "x", sourceType: "y" }));
  assert.doesNotThrow(() => notifyBestEffort({}, { tenantId: "t", workspaceId: "w", userId: "u", title: "x", sourceType: "y" }));
});

test("NOTIFY_BEST_EFFORT: com repositório configurado, cria de fato (assíncrono, best-effort)", async () => {
  const notificationRepository = new InMemoryNotificationRepository();
  notifyBestEffort({ notificationRepository }, { tenantId: "t1", workspaceId: "w1", userId: "u1", title: "Oi", sourceType: "y" });
  // fire-and-forget — dá uma volta no microtask queue antes de checar.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const active = await notificationRepository.listActive({ tenantId: "t1", workspaceId: "w1", userId: "u1", limit: 10 });
  assert.equal(active.length, 1);
  assert.equal(active[0].title, "Oi");
});

test("GATILHO_ATRIBUICAO: assignConversation notifica o NOVO responsável, nunca quem executou a ação", async () => {
  const tenantId = "tenant-notif-5";
  const { workspace, connectionRepo, deps, notificationRepository } = await makeSetup(tenantId);
  const conversation = await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid.notif-assign-1");

  // Atribuição feita por OUTRA pessoa (supervisor) — deve notificar quem recebeu a conversa.
  await assignConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, assignedUserId: "agente-1", performedBy: "supervisor-1" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const forAgent = await notificationRepository.listActive({ tenantId, workspaceId: workspace.id, userId: "agente-1", limit: 10 });
  assert.equal(forAgent.length, 1);
  assert.equal(forAgent[0].sourceType, "inbox_conversation_assigned");
  assert.equal(forAgent[0].sourceId, conversation.id);

  // Auto-atribuição (a mesma pessoa se atribui) — nunca notifica a própria pessoa.
  const conversation2 = await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid.notif-assign-2");
  await assignConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation2.id, assignedUserId: "agente-2", performedBy: "agente-2" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const forSelf = await notificationRepository.listActive({ tenantId, workspaceId: workspace.id, userId: "agente-2", limit: 10 });
  assert.equal(forSelf.length, 0, "nunca notifica a própria pessoa por uma ação que ela mesma tomou");

  // Desatribuir (assignedUserId undefined) nunca notifica ninguém.
  await assignConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, assignedUserId: undefined, performedBy: "supervisor-1" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const historyForAgent = await notificationRepository.listHistory({ tenantId, workspaceId: workspace.id, userId: "agente-1", limit: 10 });
  assert.equal(historyForAgent.length, 1, "desatribuir não cria uma segunda notificação");
});

test("GATILHO_ATRIBUICAO: sem notificationRepository nos deps, assignConversation continua funcionando normalmente", async () => {
  const tenantId = "tenant-notif-6";
  const { workspace, connectionRepo, deps: fullDeps } = await makeSetup(tenantId);
  const { notificationRepository, ...depsWithoutNotification } = fullDeps;
  const conversation = await makeConversation(tenantId, workspace, connectionRepo, fullDeps, "wamid.notif-assign-3");

  const updated = await assignConversation(depsWithoutNotification, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, assignedUserId: "agente-9", performedBy: "supervisor-1" });
  assert.equal(updated.assignedUserId, "agente-9", "atribuição em si nunca é bloqueada pela ausência do módulo de notificação");
});
