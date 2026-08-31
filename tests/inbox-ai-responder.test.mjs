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
  maybeGenerateAiResponse,
  registerInboundMessage,
  sendInboxMessage,
  setAiConversationEnabled,
  takeOverConversation,
} from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Módulo Conversas — Fase 5 (IA de Atendimento). Cobre o requisito central da fase: a IA responde
 * de forma segura, individual por conversa, sem nunca competir com um humano nem duplicar
 * respostas sob concorrência real. Usa um `InboxAiResponderPort` FAKE (determinístico, sem custo,
 * sem rede) — o AI Gateway em si já tem sua própria suíte (`ai-gateway-*.test.mjs`); aqui o alvo é
 * a integração do módulo Conversas com a PORTA, nunca o Gateway por dentro.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55663 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function makeFakeMessagingProvider() {
  return {
    sentMessages: [],
    async connect() { return {}; },
    async disconnect() {},
    async logout() {},
    async getConnectionStatus() { return { status: "connected" }; },
    async getQrCode() { return { qrCode: "fake", expiresAt: new Date().toISOString() }; },
    async sendText(input) {
      this.sentMessages.push(input);
      return { externalMessageId: `fake-wa-${this.sentMessages.length}` };
    },
  };
}

function makeFakeAiResponder(options = {}) {
  const { reply = "Obrigado pelo contato! Como posso ajudar?", onGenerate, shouldFail = false, failCategory = "timeout" } = options;
  const calls = [];
  const state = { callCount: 0, activeCount: 0, maxActiveCount: 0 };
  return {
    calls,
    state,
    async generateReply(input) {
      state.callCount += 1;
      state.activeCount += 1;
      state.maxActiveCount = Math.max(state.maxActiveCount, state.activeCount);
      calls.push(input);
      try {
        if (onGenerate) await onGenerate(input);
        if (shouldFail) return { ok: false, category: failCategory, message: "Falha simulada do provider de IA." };
        return {
          ok: true,
          reply,
          provider: "fake-provider",
          model: "fake-model",
          latencyMs: 12,
          usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28, estimatedCost: 0.0004 },
          traceId: `fake-trace-${state.callCount}`,
        };
      } finally {
        state.activeCount -= 1;
      }
    },
  };
}

function buildDeps(tenantId, { aiResponder, outboundQueue, provider } = {}) {
  return {
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    contactRepository: new PostgresInboxContactRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    workspaceRepository: new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }),
    outboundQueue: outboundQueue ?? { published: [], publish: async function publish(input) { this.published.push(input); } },
    provider: provider ?? makeFakeMessagingProvider(),
    aiResponder,
  };
}

/**
 * Cria workspace/conexão/contato/conversa. IMPORTANTE (achado ao vivo escrevendo esta suíte):
 * `registerInboundMessage` deduplica contato por telefone NORMALIZADO (`upsertByPhone`) — todo
 * `receiveInboundAndMaybeRespond` desta conversa TEM que reusar o `phone` devolvido aqui, senão
 * cria um contato/conversa diferente por engano (telefone diferente nunca bate com o
 * `(connection_id, contact_id)` já existente).
 */
async function makeConversation(tenantId, { aiEnabled = false } = {}) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);

  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  const phone = `+55119${++counter}0000`;
  const contact = await contactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: phone, name: "Cliente Teste" });
  const conversation = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, contactId: contact.id });
  if (aiEnabled) await conversationRepo.setAiEnabled(conversation.id, true);
  return { workspace, connection, contact, phone, conversation: await conversationRepo.getById(conversation.id) };
}

async function receiveInboundAndMaybeRespond(deps, { tenantId, workspaceId, connectionId, fromPhone, externalMessageId, body }) {
  const { conversation, message, wasCreated } = await registerInboundMessage(deps, {
    tenantId, workspaceId, connectionId, fromPhone, externalMessageId, type: "text", body, occurredAt: new Date().toISOString(),
  });
  if (wasCreated) {
    await maybeGenerateAiResponse(deps, { tenantId, workspaceId, conversationId: conversation.id, triggeringMessageId: message.id });
  }
  return { conversation, message, wasCreated };
}

test("Inbound com IA ativa gera exatamente uma resposta, que passa pela fila outbound (nunca chama o provider diretamente)", async () => {
  const tenantId = "tenant-ai-1";
  const { workspace, connection, phone } = await makeConversation(tenantId, { aiEnabled: true });
  const aiResponder = makeFakeAiResponder({ reply: "Olá! Já te ajudo." });
  const deps = buildDeps(tenantId, { aiResponder });

  const { conversation } = await receiveInboundAndMaybeRespond(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-1", body: "Oi, tudo bem?",
  });

  assert.equal(aiResponder.state.callCount, 1, "exatamente uma geração de IA");
  assert.equal(deps.provider.sentMessages.length, 0, "IA NUNCA chama o MessagingProvider diretamente");
  assert.equal(deps.outboundQueue.published.length, 1, "a resposta da IA passa pela MESMA fila outbound que uma mensagem humana");

  const messages = await deps.messageRepository.listByConversation({ tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  const outbound = messages.find((m) => m.direction === "outbound");
  assert.ok(outbound);
  assert.equal(outbound.sentByAi, true);
  assert.equal(outbound.body, "Olá! Já te ajudo.");
  assert.equal(outbound.status, "queued", "outbound sempre nasce QUEUED — quem envia de fato é o worker, nunca o caso de uso de IA");

  const events = await deps.conversationEventRepository.listByConversation({ tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  const sentEvent = events.find((e) => e.type === "ai_response_sent");
  assert.ok(sentEvent);
  assert.equal(sentEvent.performedBy, "ai");
  assert.equal(sentEvent.metadata.outboundMessageId, outbound.id);
  assert.deepEqual(sentEvent.metadata.inboundMessageIds, [messages.find((m) => m.direction === "inbound").id]);
});

test("Inbound com IA pausada não gera nenhuma resposta", async () => {
  const tenantId = "tenant-ai-2";
  const { workspace, connection, phone } = await makeConversation(tenantId, { aiEnabled: false });
  const aiResponder = makeFakeAiResponder();
  const deps = buildDeps(tenantId, { aiResponder });

  await receiveInboundAndMaybeRespond(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-2", body: "Oi" });

  assert.equal(aiResponder.state.callCount, 0);
  assert.equal(deps.outboundQueue.published.length, 0);
});

test("Conversa assumida por humano (mesmo sem take-over, atribuição direta) nunca gera resposta de IA", async () => {
  const tenantId = "tenant-ai-3";
  const { workspace, connection, phone, conversation } = await makeConversation(tenantId, { aiEnabled: true });
  const aiResponder = makeFakeAiResponder();
  const deps = buildDeps(tenantId, { aiResponder });

  // Atribuição DIRETA (Fase 4) nunca desliga `aiEnabled` sozinha — o gate de elegibilidade da IA
  // tem que checar `assignedUserId` por conta própria, não confiar só em `aiEnabled`.
  await assignConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, assignedUserId: "user-human", performedBy: "user-human" });

  await receiveInboundAndMaybeRespond(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-3", body: "Oi" });

  assert.equal(aiResponder.state.callCount, 0, "conversa com responsável humano nunca aciona a IA, mesmo com aiEnabled=true");
});

test("CRÍTICO: humano assume ENQUANTO a IA está gerando — a resposta é descartada e nunca entra na outbound queue", async () => {
  const tenantId = "tenant-ai-4";
  const { workspace, connection, phone, conversation } = await makeConversation(tenantId, { aiEnabled: true });
  const deps0 = buildDeps(tenantId); // só pra ter acesso aos repos fora do fluxo de IA
  const aiResponder = makeFakeAiResponder({
    reply: "Resposta que nunca deveria ser enviada.",
    onGenerate: async () => {
      // Simula o exemplo literal do pedido: atendente assume no MEIO da geração.
      await takeOverConversation(buildDeps(tenantId), { tenantId, workspaceId: workspace.id, conversationId: conversation.id, userId: "user-human" });
    },
  });
  const deps = buildDeps(tenantId, { aiResponder });

  await receiveInboundAndMaybeRespond(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-4", body: "Preciso de ajuda" });

  assert.equal(deps.outboundQueue.published.length, 0, "a resposta gerada nunca pode entrar na fila outbound");
  const messages = await deps0.messageRepository.listByConversation({ tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  assert.equal(messages.filter((m) => m.direction === "outbound").length, 0, "nenhuma mensagem outbound foi criada");

  const inboundMsg = messages.find((m) => m.direction === "inbound");
  assert.equal(inboundMsg.aiClaimStatus, "skipped");

  const events = await deps0.conversationEventRepository.listByConversation({ tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  const cancelled = events.find((e) => e.type === "ai_response_cancelled");
  assert.ok(cancelled);
  assert.equal(cancelled.metadata.reason, "human_took_over_during_generation");

  const finalConversation = await deps0.conversationRepository.getById(conversation.id);
  assert.equal(finalConversation.assignedUserId, "user-human");
  assert.equal(finalConversation.aiEnabled, false);
});

test("Evento inbound DUPLICADO (reentrega) nunca gera duas respostas de IA", async () => {
  const tenantId = "tenant-ai-5";
  const { workspace, connection, phone } = await makeConversation(tenantId, { aiEnabled: true });
  const aiResponder = makeFakeAiResponder();
  const deps = buildDeps(tenantId, { aiResponder });

  const input = { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-duplicated", body: "Oi" };
  await receiveInboundAndMaybeRespond(deps, input);
  await receiveInboundAndMaybeRespond(deps, input); // reentrega do MESMO evento (mesmo externalMessageId)

  assert.equal(aiResponder.state.callCount, 1, "wasCreated=false na reentrega — a IA nunca é sequer chamada de novo");
  assert.equal(deps.outboundQueue.published.length, 1);
});

test("CONCORRÊNCIA: duas mensagens simultâneas na mesma conversa nunca disparam gerações de IA em paralelo", async () => {
  const tenantId = "tenant-ai-6";
  const { workspace, connection, phone } = await makeConversation(tenantId, { aiEnabled: true });
  const aiResponder = makeFakeAiResponder({ onGenerate: async () => { await new Promise((resolve) => setTimeout(resolve, 60)); } });
  const deps = buildDeps(tenantId, { aiResponder });

  await Promise.all([
    receiveInboundAndMaybeRespond(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-race-1", body: "Mensagem 1" }),
    receiveInboundAndMaybeRespond(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-race-2", body: "Mensagem 2" }),
  ]);

  assert.equal(aiResponder.state.maxActiveCount, 1, "nunca duas gerações de IA em voo ao mesmo tempo para a mesma conversa (serialização por lock)");
  assert.ok(deps.outboundQueue.published.length >= 1, "pelo menos uma resposta foi enviada");
  assert.ok(deps.outboundQueue.published.length <= 2, "no máximo uma resposta por mensagem — nunca mais que isso");
});

test("Restart/reentrega: duas invocações concorrentes de maybeGenerateAiResponse para a MESMA mensagem já persistida nunca duplicam a resposta", async () => {
  const tenantId = "tenant-ai-7";
  const { workspace, connection, phone, conversation } = await makeConversation(tenantId, { aiEnabled: true });
  const depsSetup = buildDeps(tenantId);
  const { message } = await registerInboundMessage(depsSetup, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-restart", type: "text", body: "Oi", occurredAt: new Date().toISOString(),
  });

  const aiResponder = makeFakeAiResponder();
  const deps = buildDeps(tenantId, { aiResponder });

  // Simula duas "instâncias de worker" processando o mesmo disparo (ex.: reentrega bem próxima de
  // um crash/restart) — o claim atômico por mensagem tem que impedir a duplicidade mesmo aqui.
  await Promise.allSettled([
    maybeGenerateAiResponse(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, triggeringMessageId: message.id }),
    maybeGenerateAiResponse(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, triggeringMessageId: message.id }),
  ]);

  assert.equal(aiResponder.state.callCount, 1);
  assert.equal(deps.outboundQueue.published.length, 1);
});

test("Provider de IA indisponível (timeout/falha) nunca derruba a Inbox — mensagem fica disponível para atendimento manual", async () => {
  const tenantId = "tenant-ai-8";
  const { workspace, connection, phone, conversation } = await makeConversation(tenantId, { aiEnabled: true });
  const aiResponder = makeFakeAiResponder({ shouldFail: true, failCategory: "provider_unavailable" });
  const deps = buildDeps(tenantId, { aiResponder });

  await assert.doesNotReject(() =>
    receiveInboundAndMaybeRespond(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-fail-1", body: "Oi" }),
  );

  assert.equal(deps.outboundQueue.published.length, 0, "nunca envia uma resposta genérica/vazia em caso de falha");

  const messages = await deps.messageRepository.listByConversation({ tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  const inboundMsg = messages.find((m) => m.direction === "inbound");
  assert.equal(inboundMsg.aiClaimStatus, "failed");

  const events = await deps.conversationEventRepository.listByConversation({ tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  const failedEvent = events.find((e) => e.type === "ai_response_failed");
  assert.ok(failedEvent);
  assert.equal(failedEvent.metadata.errorCategory, "provider_unavailable");

  // Conversa continua 100% disponível para atendimento manual — o lock foi liberado, humano pode
  // responder normalmente pelo MESMO pipeline outbound.
  const conversationAfter = await deps.conversationRepository.getById(conversation.id);
  assert.equal(conversationAfter.aiProcessingSince, undefined, "o lock de geração foi liberado mesmo após a falha");

  const humanReply = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Um atendente já vai te ajudar.", sentByUserId: "user-human" });
  assert.equal(humanReply.status, "queued");
  assert.equal(deps.outboundQueue.published.length, 1);
});

test("Reativação da IA não responde retroativamente ao backlog acumulado durante a pausa — só mensagens novas", async () => {
  const tenantId = "tenant-ai-9";
  const { workspace, connection, phone, conversation } = await makeConversation(tenantId, { aiEnabled: false });
  const aiResponder = makeFakeAiResponder();
  const deps = buildDeps(tenantId, { aiResponder });

  // Duas mensagens chegam enquanto a IA está pausada.
  await receiveInboundAndMaybeRespond(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-backlog-1", body: "Mensagem antiga 1" });
  await receiveInboundAndMaybeRespond(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-backlog-2", body: "Mensagem antiga 2" });
  assert.equal(aiResponder.state.callCount, 0);

  // Reativa a IA — isto sozinho NUNCA deve disparar nenhuma geração para o backlog.
  await setAiConversationEnabled(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, aiEnabled: true, performedBy: "user-human" });
  assert.equal(aiResponder.state.callCount, 0, "reativar a IA não processa o backlog anterior por si só");

  // Só uma mensagem NOVA, chegada depois da reativação, deve gerar uma resposta.
  await receiveInboundAndMaybeRespond(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-new-after-reactivation", body: "Mensagem nova" });
  assert.equal(aiResponder.state.callCount, 1, "só a mensagem chegada após a reativação gera resposta");

  const messages = await deps.messageRepository.listByConversation({ tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  const backlogMessages = messages.filter((m) => m.externalMessageId === "wa-backlog-1" || m.externalMessageId === "wa-backlog-2");
  assert.ok(backlogMessages.every((m) => m.aiClaimStatus === "skipped"), "mensagens do backlog ficam marcadas como skipped, nunca respondidas depois");
});

test("Isolamento cross-tenant: a IA só recebe contexto do MESMO tenant/workspace/conversa — nunca mistura conversas de tenants diferentes", async () => {
  const tenantA = "tenant-ai-iso-a";
  const tenantB = "tenant-ai-iso-b";
  const { workspace: workspaceA, connection: connectionA, phone: phoneA } = await makeConversation(tenantA, { aiEnabled: true });
  const { workspace: workspaceB, connection: connectionB, phone: phoneB } = await makeConversation(tenantB, { aiEnabled: true });

  const aiResponder = makeFakeAiResponder();
  const depsA = buildDeps(tenantA, { aiResponder });
  const depsB = buildDeps(tenantB, { aiResponder });

  await receiveInboundAndMaybeRespond(depsA, { tenantId: tenantA, workspaceId: workspaceA.id, connectionId: connectionA.id, fromPhone: phoneA, externalMessageId: "wa-iso-a", body: "Mensagem do tenant A" });
  await receiveInboundAndMaybeRespond(depsB, { tenantId: tenantB, workspaceId: workspaceB.id, connectionId: connectionB.id, fromPhone: phoneB, externalMessageId: "wa-iso-b", body: "Mensagem do tenant B" });

  assert.equal(aiResponder.calls.length, 2);
  assert.equal(aiResponder.calls[0].tenantId, tenantA);
  assert.equal(aiResponder.calls[0].workspaceId, workspaceA.id);
  assert.ok(aiResponder.calls[0].recentMessages.every((m) => m.body !== "Mensagem do tenant B"), "contexto da IA do tenant A nunca inclui mensagem do tenant B");
  assert.equal(aiResponder.calls[1].tenantId, tenantB);
  assert.equal(aiResponder.calls[1].workspaceId, workspaceB.id);
  assert.ok(aiResponder.calls[1].recentMessages.every((m) => m.body !== "Mensagem do tenant A"), "contexto da IA do tenant B nunca inclui mensagem do tenant A");
});
