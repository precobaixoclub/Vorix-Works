import { test } from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { shouldDeliverInboxNotification } from "../dist/interfaces/api/routes/v1/inbox.route.js";
import { processOutboundMessage, sendInboxMessage } from "../dist/application/inbox/inbox-use-cases.js";

/**
 * Módulo Conversas — Fase 7 (Hardening/Segurança). Auditoria de segurança explícita pedida na
 * fase: para CADA rota `/v1/inbox/*` que aceita um id de recurso (connectionId, conversationId),
 * um principal do Tenant A usando um id REAL do Tenant B tem que falhar — sempre 404 ("não
 * encontrado"), nunca 403 ("proibido") e nunca 200 com dado de outro tenant. Não basta esconder na
 * UI: isto testa a API diretamente, sem o frontend no meio.
 *
 * Também cobre isolamento do SSE (`shouldDeliverInboxNotification`, extraído de `inbox.route.ts`
 * especificamente para ser testado de forma direta e exaustiva) e o kill switch de emergência de
 * envio outbound (Fase 7).
 */

function fakeAuthPortFor(principal) {
  return { async verifyToken() { return { authenticated: true, principal }; } };
}

function principal({ role, userId = "user-a", tenantId }) {
  return { userId, tenantId, role, sessionId: "session-1", isPlatformAdmin: false };
}

async function buildTestApp(container) {
  const config = loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", CONVERSATIONS_MODULE_ENABLED: "true" });
  return buildApp({ config, container });
}

async function seedConversation(app, { tenantId, aiEnabled = false }) {
  const workspace = await app.zunoContainer.workspaceRepository.create({ tenantId, name: "Workspace HTTP" });
  const connection = await app.zunoContainer.messagingConnectionRepository.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const contact = await app.zunoContainer.inboxContactRepository.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: "+5511999990000" });
  const conversation = await app.zunoContainer.inboxConversationRepository.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, contactId: contact.id });
  if (aiEnabled) await app.zunoContainer.inboxConversationRepository.setAiEnabled(conversation.id, true);
  return { workspace, connection, contact, conversationId: conversation.id };
}

// ------------------------------------------------------------------------------------------
// IDOR / cross-tenant — cada rota que aceita um id de recurso
// ------------------------------------------------------------------------------------------

test("IDOR: conexão de outro tenant — GET qr / POST refresh-status / POST disconnect nunca funcionam com um connectionId real de outro tenant", async () => {
  const tenantB = "tenant-idor-conn-b";
  const appB = await buildTestApp({ authPort: fakeAuthPortFor(principal({ role: "admin", tenantId: tenantB })) });
  const { workspace: workspaceB, connection: connectionB } = await seedConversation(appB, { tenantId: tenantB });

  const tenantA = "tenant-idor-conn-a";
  const appA = await buildApp({
    config: loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", CONVERSATIONS_MODULE_ENABLED: "true" }),
    container: { ...appB.zunoContainer, authPort: fakeAuthPortFor(principal({ role: "admin", tenantId: tenantA })) },
  });

  const qr = await appA.inject({ method: "GET", url: `/v1/inbox/connections/${connectionB.id}/qr?workspaceId=${workspaceB.id}` });
  assert.equal(qr.statusCode, 404, "QR de conexão de outro tenant tem que ser 404, nunca vazar o QR real");

  const refresh = await appA.inject({ method: "POST", url: `/v1/inbox/connections/${connectionB.id}/refresh-status`, payload: { workspaceId: workspaceB.id } });
  assert.equal(refresh.statusCode, 404);

  const disconnect = await appA.inject({ method: "POST", url: `/v1/inbox/connections/${connectionB.id}/disconnect`, payload: { workspaceId: workspaceB.id } });
  assert.equal(disconnect.statusCode, 404);

  // Confirma que a conexão de B continua intacta — a tentativa do tenant A não teve efeito nenhum.
  const stillThere = await appB.zunoContainer.messagingConnectionRepository.getById(connectionB.id);
  assert.equal(stillThere.status, connectionB.status);

  await appA.close();
  await appB.close();
});

test("IDOR: mensagens/eventos de uma conversa de outro tenant nunca são lidos (GET messages, GET events)", async () => {
  const tenantB = "tenant-idor-msg-b";
  const appB = await buildTestApp({ authPort: fakeAuthPortFor(principal({ role: "editor", tenantId: tenantB, userId: "user-b" })) });
  const { workspace: workspaceB, conversationId: conversationIdB } = await seedConversation(appB, { tenantId: tenantB });
  // Mensagem real, com conteúdo sensível — nunca deveria vazar para outro tenant.
  await sendInboxMessage(
    {
      conversationRepository: appB.zunoContainer.inboxConversationRepository,
      contactRepository: appB.zunoContainer.inboxContactRepository,
      messageRepository: appB.zunoContainer.inboxMessageRepository,
      connectionRepository: appB.zunoContainer.messagingConnectionRepository,
      workspaceRepository: appB.zunoContainer.workspaceRepository,
      outboundQueue: appB.zunoContainer.inboxOutboundQueue,
      provider: appB.zunoContainer.inboxProvider,
    },
    { tenantId: tenantB, workspaceId: workspaceB.id, conversationId: conversationIdB, body: "Segredo do tenant B — nunca deveria vazar.", sentByUserId: "user-b" },
  );

  const tenantA = "tenant-idor-msg-a";
  const appA = await buildApp({
    config: loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", CONVERSATIONS_MODULE_ENABLED: "true" }),
    container: { ...appB.zunoContainer, authPort: fakeAuthPortFor(principal({ role: "editor", tenantId: tenantA, userId: "user-a" })) },
  });

  const messages = await appA.inject({ method: "GET", url: `/v1/inbox/conversations/${conversationIdB}/messages?workspaceId=${workspaceB.id}` });
  assert.equal(messages.statusCode, 404, "mensagens de conversa de outro tenant nunca são lidas");
  assert.ok(!messages.body.includes("Segredo do tenant B"), "conteúdo sensível de outro tenant nunca aparece na resposta, nem em erro");

  const events = await appA.inject({ method: "GET", url: `/v1/inbox/conversations/${conversationIdB}/events?workspaceId=${workspaceB.id}` });
  assert.equal(events.statusCode, 404, "eventos de conversa de outro tenant nunca são lidos");

  await appA.close();
  await appB.close();
});

test("IDOR: nenhuma ação de escrita numa conversa de outro tenant tem efeito (read, assign, ai, send, close, reopen)", async () => {
  const tenantB = "tenant-idor-write-b";
  const appB = await buildTestApp({ authPort: fakeAuthPortFor(principal({ role: "admin", tenantId: tenantB, userId: "user-b" })) });
  const { workspace: workspaceB, conversationId: conversationIdB } = await seedConversation(appB, { tenantId: tenantB, aiEnabled: true });

  const tenantA = "tenant-idor-write-a";
  const appA = await buildApp({
    config: loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", CONVERSATIONS_MODULE_ENABLED: "true" }),
    container: { ...appB.zunoContainer, authPort: fakeAuthPortFor(principal({ role: "admin", tenantId: tenantA, userId: "user-a" })) },
  });

  const attempts = [
    ["POST", `/v1/inbox/conversations/${conversationIdB}/read`, { workspaceId: workspaceB.id }],
    ["POST", `/v1/inbox/conversations/${conversationIdB}/assign`, { workspaceId: workspaceB.id, assignedUserId: "user-a" }],
    ["POST", `/v1/inbox/conversations/${conversationIdB}/ai`, { workspaceId: workspaceB.id, aiEnabled: false }],
    ["POST", `/v1/inbox/conversations/${conversationIdB}/messages`, { workspaceId: workspaceB.id, body: "Mensagem injetada pelo tenant A" }],
    ["POST", `/v1/inbox/conversations/${conversationIdB}/close`, { workspaceId: workspaceB.id }],
    ["POST", `/v1/inbox/conversations/${conversationIdB}/reopen`, { workspaceId: workspaceB.id }],
    ["POST", `/v1/inbox/conversations/${conversationIdB}/transfer`, { workspaceId: workspaceB.id, toUserId: "user-a" }],
  ];

  for (const [method, url, payload] of attempts) {
    const response = await appA.inject({ method, url, payload });
    assert.equal(response.statusCode, 404, `${method} ${url} deveria ser 404 para um recurso de outro tenant`);
  }

  // Confirma zero efeito colateral: a conversa de B continua exatamente como estava.
  const conversationAfter = await appB.zunoContainer.inboxConversationRepository.getById(conversationIdB);
  assert.equal(conversationAfter.assignedUserId, undefined, "tenant A nunca conseguiu se auto-atribuir à conversa de B");
  assert.equal(conversationAfter.aiEnabled, true, "tenant A nunca conseguiu desligar a IA da conversa de B");
  assert.equal(conversationAfter.status, "open", "tenant A nunca conseguiu fechar/reabrir a conversa de B");
  const messagesAfter = await appB.zunoContainer.inboxMessageRepository.listByConversation({ tenantId: tenantB, workspaceId: workspaceB.id, conversationId: conversationIdB });
  assert.ok(!messagesAfter.some((m) => m.body === "Mensagem injetada pelo tenant A"), "nenhuma mensagem foi injetada na conversa de outro tenant");

  await appA.close();
  await appB.close();
});

// ------------------------------------------------------------------------------------------
// Isolamento do SSE
// ------------------------------------------------------------------------------------------

test("SSE: shouldDeliverInboxNotification isola estritamente por tenant E workspace", () => {
  const scope = { tenantId: "tenant-x", workspaceId: "ws-x" };

  assert.equal(shouldDeliverInboxNotification({ tenantId: "tenant-x", workspaceId: "ws-x", conversationId: "c1" }, scope), true, "mesmo tenant e workspace — entrega");
  assert.equal(shouldDeliverInboxNotification({ tenantId: "tenant-y", workspaceId: "ws-x" }, scope), false, "tenant diferente — nunca entrega, mesmo com o mesmo workspaceId por coincidência");
  assert.equal(shouldDeliverInboxNotification({ tenantId: "tenant-x", workspaceId: "ws-y" }, scope), false, "workspace diferente dentro do MESMO tenant — nunca entrega");
  assert.equal(shouldDeliverInboxNotification({ tenantId: "tenant-y", workspaceId: "ws-y" }, scope), false, "nem tenant nem workspace batem — nunca entrega");
  assert.equal(shouldDeliverInboxNotification({}, scope), false, "notificação sem tenantId/workspaceId nunca é entregue por engano");
});

test("SSE: múltiplos assinantes simultâneos de tenants diferentes nunca recebem a notificação um do outro", () => {
  const subscriberA = { tenantId: "tenant-multi-a", workspaceId: "ws-a" };
  const subscriberB = { tenantId: "tenant-multi-b", workspaceId: "ws-b" };
  const notificationForA = { type: "conversation.updated", tenantId: "tenant-multi-a", workspaceId: "ws-a", conversationId: "conv-a-1", unreadCount: 3 };

  assert.equal(shouldDeliverInboxNotification(notificationForA, subscriberA), true);
  assert.equal(shouldDeliverInboxNotification(notificationForA, subscriberB), false, "assinante B nunca recebe evento/metadata/contador do tenant A, mesmo conectado ao mesmo tempo");
});

// ------------------------------------------------------------------------------------------
// Kill switch de emergência — envio outbound pausado
// ------------------------------------------------------------------------------------------

test("Kill switch: INBOX_OUTBOUND_SEND_PAUSED nunca envia ao provider, mensagem permanece queued para reprocessamento", async () => {
  const app = await buildTestApp({ authPort: fakeAuthPortFor(principal({ role: "editor", tenantId: "tenant-killswitch" })) });
  const { workspace, connection, conversationId } = await seedConversation(app, { tenantId: "tenant-killswitch" });
  await app.zunoContainer.messagingConnectionRepository.updateStatus(connection.id, { status: "connected", externalSessionId: `sess-${connection.id}` });

  const deps = {
    connectionRepository: app.zunoContainer.messagingConnectionRepository,
    contactRepository: app.zunoContainer.inboxContactRepository,
    conversationRepository: app.zunoContainer.inboxConversationRepository,
    conversationEventRepository: app.zunoContainer.inboxConversationEventRepository,
    messageRepository: app.zunoContainer.inboxMessageRepository,
    workspaceRepository: app.zunoContainer.workspaceRepository,
    outboundQueue: { publish: async () => {} },
    provider: app.zunoContainer.inboxProvider,
    outboundSendPaused: true,
  };

  const message = await sendInboxMessage(deps, { tenantId: "tenant-killswitch", workspaceId: workspace.id, conversationId, body: "Mensagem durante incidente", sentByUserId: "user-a" });
  await assert.rejects(() => processOutboundMessage(deps, { messageId: message.id }));

  const afterAttempt = await deps.messageRepository.getById(message.id);
  assert.equal(afterAttempt.status, "queued", "mensagem nunca é perdida nem marcada failed — só aguarda o kill switch ser desativado");
  assert.equal(afterAttempt.failureCategory, "outbound_paused");

  await app.close();
});
