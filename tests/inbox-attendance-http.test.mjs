import { test } from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";

/**
 * Módulo Conversas — Fase 4, nível HTTP: garante que o RBAC das novas rotas operacionais está de
 * fato amarrado (`requirePermission`) e que a ação, uma vez persistida, dispara a notificação
 * realtime (SSE) com o payload esperado — sem depender de RabbitMQ real (usa um
 * `InboxRealtimeSubscriber` fake injetado via `buildApp({ container })`).
 */

function fakeAuthPortFor(principal) {
  return {
    async verifyToken() {
      return { authenticated: true, principal };
    },
  };
}

function principal({ role, userId = "user-a", tenantId = "tenant-http-1" }) {
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

test("RBAC: viewer (só inbox:read) recebe 403 ao tentar assumir/transferir/finalizar/reabrir uma conversa", async () => {
  const tenantId = "tenant-http-rbac";
  const app = await buildTestApp({ authPort: fakeAuthPortFor(principal({ role: "viewer", tenantId })) });
  const { workspace, conversationId } = await seedConversation(app, { tenantId });

  const takeOver = await app.inject({ method: "POST", url: `/v1/inbox/conversations/${conversationId}/take-over`, payload: { workspaceId: workspace.id } });
  assert.equal(takeOver.statusCode, 403, "viewer não tem inbox:assign — take-over deve ser barrado");

  const transfer = await app.inject({ method: "POST", url: `/v1/inbox/conversations/${conversationId}/transfer`, payload: { workspaceId: workspace.id, toUserId: "user-b" } });
  assert.equal(transfer.statusCode, 403);

  const close = await app.inject({ method: "POST", url: `/v1/inbox/conversations/${conversationId}/close`, payload: { workspaceId: workspace.id } });
  assert.equal(close.statusCode, 403);

  const reopen = await app.inject({ method: "POST", url: `/v1/inbox/conversations/${conversationId}/reopen`, payload: { workspaceId: workspace.id } });
  assert.equal(reopen.statusCode, 403);

  // Leitura continua permitida — viewer TEM inbox:read.
  const list = await app.inject({ method: "GET", url: `/v1/inbox/conversations?workspaceId=${workspace.id}` });
  assert.equal(list.statusCode, 200);

  await app.close();
});

test("RBAC: editor (inbox:assign) consegue assumir, transferir, finalizar e reabrir com sucesso", async () => {
  const tenantId = "tenant-http-rbac-2";
  const app = await buildTestApp({ authPort: fakeAuthPortFor(principal({ role: "editor", tenantId, userId: "user-a" })) });
  const { workspace, conversationId } = await seedConversation(app, { tenantId });

  const takeOver = await app.inject({ method: "POST", url: `/v1/inbox/conversations/${conversationId}/take-over`, payload: { workspaceId: workspace.id } });
  assert.equal(takeOver.statusCode, 200);
  assert.equal(takeOver.json().data.assignedUserId, "user-a");

  const transfer = await app.inject({ method: "POST", url: `/v1/inbox/conversations/${conversationId}/transfer`, payload: { workspaceId: workspace.id, toUserId: "user-b" } });
  assert.equal(transfer.statusCode, 200);
  assert.equal(transfer.json().data.assignedUserId, "user-b");

  const close = await app.inject({ method: "POST", url: `/v1/inbox/conversations/${conversationId}/close`, payload: { workspaceId: workspace.id } });
  assert.equal(close.statusCode, 200);
  assert.equal(close.json().data.status, "resolved");

  const reopen = await app.inject({ method: "POST", url: `/v1/inbox/conversations/${conversationId}/reopen`, payload: { workspaceId: workspace.id } });
  assert.equal(reopen.statusCode, 200);
  assert.equal(reopen.json().data.status, "open");

  await app.close();
});

test("Concorrência via HTTP: duas requisições de take-over simultâneas na mesma conversa — só uma retorna 200, a outra 409", async () => {
  const tenantId = "tenant-http-race";
  const appA = await buildTestApp({ authPort: fakeAuthPortFor(principal({ role: "editor", tenantId, userId: "user-a" })) });
  // Precisamos que as duas requisições compartilhem o MESMO container (mesmo repositório
  // in-memory) — construímos um segundo app "vestindo" outro principal mas apontando pro mesmo
  // zunoContainer da primeira instância, replicando duas conexões HTTP concorrentes na mesma API.
  const sharedContainer = appA.zunoContainer;
  const appB = await buildApp({
    config: loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", CONVERSATIONS_MODULE_ENABLED: "true" }),
    container: { ...sharedContainer, authPort: fakeAuthPortFor(principal({ role: "editor", tenantId, userId: "user-b" })) },
  });

  const { workspace, conversationId } = await seedConversation(appA, { tenantId });

  const [resA, resB] = await Promise.all([
    appA.inject({ method: "POST", url: `/v1/inbox/conversations/${conversationId}/take-over`, payload: { workspaceId: workspace.id } }),
    appB.inject({ method: "POST", url: `/v1/inbox/conversations/${conversationId}/take-over`, payload: { workspaceId: workspace.id } }),
  ]);

  const statusCodes = [resA.statusCode, resB.statusCode].sort();
  assert.deepEqual(statusCodes, [200, 409], "exatamente uma das duas requisições HTTP concorrentes deve vencer, a outra deve ver o conflito (409)");

  await appA.close();
  await appB.close();
});

test("SSE: ações operacionais publicam notificação realtime com tenantId/workspaceId/conversationId corretos", async () => {
  const tenantId = "tenant-http-sse";
  const published = [];
  const fakeRealtimeSubscriber = { publish: (notification) => published.push(notification) };
  const app = await buildTestApp({
    authPort: fakeAuthPortFor(principal({ role: "editor", tenantId, userId: "user-a" })),
    inboxRealtimeSubscriber: fakeRealtimeSubscriber,
  });
  const { workspace, conversationId } = await seedConversation(app, { tenantId });

  await app.inject({ method: "POST", url: `/v1/inbox/conversations/${conversationId}/take-over`, payload: { workspaceId: workspace.id } });
  await app.inject({ method: "POST", url: `/v1/inbox/conversations/${conversationId}/close`, payload: { workspaceId: workspace.id } });

  assert.equal(published.length, 2, "take-over e close devem, cada um, disparar exatamente uma notificação");
  for (const notification of published) {
    assert.equal(notification.type, "conversation.updated");
    assert.equal(notification.tenantId, tenantId);
    assert.equal(notification.workspaceId, workspace.id);
    assert.equal(notification.conversationId, conversationId);
  }

  await app.close();
});

test("Isolamento cross-tenant via HTTP: principal de um tenant não enxerga nem opera conversa de outro tenant (404, nunca 403 — não revela existência)", async () => {
  const tenantA = "tenant-http-iso-a";
  const tenantB = "tenant-http-iso-b";
  const appB = await buildTestApp({ authPort: fakeAuthPortFor(principal({ role: "editor", tenantId: tenantB, userId: "user-b" })) });
  const { workspace: workspaceB, conversationId: conversationIdB } = await seedConversation(appB, { tenantId: tenantB });

  const appA = await buildApp({
    config: loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", CONVERSATIONS_MODULE_ENABLED: "true" }),
    container: { ...appB.zunoContainer, authPort: fakeAuthPortFor(principal({ role: "editor", tenantId: tenantA, userId: "user-a" })) },
  });

  const takeOver = await appA.inject({ method: "POST", url: `/v1/inbox/conversations/${conversationIdB}/take-over`, payload: { workspaceId: workspaceB.id } });
  assert.equal(takeOver.statusCode, 404);

  const list = await appA.inject({ method: "GET", url: `/v1/inbox/conversations?workspaceId=${workspaceB.id}` });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json().data.conversations, [], "workspace de outro tenant nunca aparece — nem existência é revelada");

  await appA.close();
  await appB.close();
});
