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
import { PostgresOperationalStateRepository } from "../dist/infrastructure/storage/postgres/postgres-operational-state-repository.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresAiProvidersRepository } from "../dist/infrastructure/storage/postgres/postgres-ai-providers-repository.js";
import { OperationalCircuitBreaker, OperationalRateLimiter } from "../dist/application/operations/operational-services.js";
import { CreditAccountingService } from "../dist/application/ai-providers/credit-accounting.service.js";
import { CreditGatedAiGateway } from "../dist/application/ai-gateway/credit-gated-ai-gateway.js";
import { AiGateway } from "../dist/application/ai-gateway/ai-gateway.js";
import { InMemoryAiRateLimiter } from "../dist/infrastructure/ai-gateway/in-memory-ai-rate-limiter.js";
import { InMemoryAiCircuitBreaker } from "../dist/infrastructure/ai-gateway/in-memory-ai-circuit-breaker.js";
import { InMemoryAiTelemetry } from "../dist/infrastructure/ai-gateway/in-memory-ai-telemetry.js";
import { InMemoryAiExecutionRepository } from "../dist/infrastructure/storage/in-memory-ai-execution-repository.js";
import { AiGatewayInboxResponder } from "../dist/infrastructure/ai-gateway/inbox-ai-responder-adapter.js";
import { MessagingProviderError } from "../dist/application/ports/messaging-provider.port.js";
import {
  applyConnectionStateChanged,
  maybeGenerateAiResponse,
  processOutboundMessage,
  reconcileConnectionsHealth,
  registerInboundMessage,
  sendInboxMessage,
} from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Módulo Conversas — Fase 6 (Resiliência/Observabilidade/Controle Operacional). Cobre: lease
 * recuperável do lock/claim de IA, circuit breaker + rate limiting do outbound (reaproveitando
 * `OperationalCircuitBreaker`/`OperationalRateLimiter` já existentes), categorização de falha para
 * DLQ, monitor de saúde de conexão, evento de crédito insuficiente, métricas, e isolamento
 * cross-tenant do novo estado persistente (circuit breaker/rate limiter).
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55690 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function makeFakeMessagingProvider(overrides = {}) {
  return {
    sentMessages: [],
    async connect() { return {}; },
    async disconnect() {},
    async logout() {},
    async getConnectionStatus(input) {
      if (overrides.getConnectionStatus) return overrides.getConnectionStatus(input);
      return { status: "connected" };
    },
    async getQrCode() { return { qrCode: "fake", expiresAt: new Date().toISOString() }; },
    async sendText(input) {
      if (overrides.sendText) return overrides.sendText(input, this);
      this.sentMessages.push(input);
      return { externalMessageId: `fake-wa-${this.sentMessages.length}` };
    },
  };
}

function makeFakeMetrics() {
  const calls = [];
  const recorder = new Proxy(
    {},
    {
      get: (_target, prop) => (...args) => calls.push({ method: prop, args }),
    },
  );
  return { recorder, calls };
}

function buildDeps(tenantId, overrides = {}) {
  return {
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    contactRepository: new PostgresInboxContactRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    workspaceRepository: new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }),
    outboundQueue: { published: [], publish: async function publish(input) { this.published.push(input); } },
    provider: makeFakeMessagingProvider(),
    ...overrides,
  };
}

async function makeConversation(tenantId, { aiEnabled = false } = {}) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);

  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: `sess-${connection.id}` });
  const phone = `+55119${++counter}0000`;
  const contact = await contactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: phone, name: "Cliente Teste" });
  const conversation = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, contactId: contact.id });
  if (aiEnabled) await conversationRepo.setAiEnabled(conversation.id, true);
  return { workspace, connection: await connectionRepo.getById(connection.id), contact, phone, conversation: await conversationRepo.getById(conversation.id) };
}

// ------------------------------------------------------------------------------------------
// Lease recuperável do lock de IA (conversa) e do claim (mensagem)
// ------------------------------------------------------------------------------------------

test("Lock de IA abandonado (lease expirado) é recuperado — nunca trava a conversa para sempre", async () => {
  const tenantId = "tenant-res-lock-1";
  const { workspace, connection, phone, conversation } = await makeConversation(tenantId, { aiEnabled: true });
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);

  // Simula um processo que morreu segurando o lock: seta `ai_processing_since` no passado distante.
  const staleOwnedAt = new Date(Date.now() - 10 * 60_000).toISOString();
  const acquired = await conversationRepo.tryAcquireAiLock(conversation.id, staleOwnedAt, new Date(Date.now() + 10_000).toISOString());
  assert.ok(acquired, "consegue adquirir o lock inicialmente (staleBefore no futuro só para o setup)");
  assert.equal((await conversationRepo.getById(conversation.id)).aiProcessingSince, staleOwnedAt);

  // Agora, com um staleBefore REAL (baseado no TTL), uma nova tentativa deve recuperar o lock —
  // nunca ficar bloqueada porque o dono anterior nunca liberou.
  const recovered = await conversationRepo.tryAcquireAiLock(conversation.id, new Date().toISOString(), new Date(Date.now() - 60_000).toISOString());
  assert.ok(recovered, "lock com lease expirado é recuperável — nunca trava a conversa para sempre");
});

test("CONCORRÊNCIA: dois processos nunca recuperam o MESMO lock abandonado simultaneamente", async () => {
  const tenantId = "tenant-res-lock-2";
  const { conversation } = await makeConversation(tenantId, { aiEnabled: true });
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);

  const staleOwnedAt = new Date(Date.now() - 10 * 60_000).toISOString();
  await conversationRepo.tryAcquireAiLock(conversation.id, staleOwnedAt, new Date(Date.now() + 10_000).toISOString());

  const staleBeforeIso = new Date(Date.now() - 60_000).toISOString();
  const results = await Promise.allSettled([
    conversationRepo.tryAcquireAiLock(conversation.id, new Date().toISOString(), staleBeforeIso),
    conversationRepo.tryAcquireAiLock(conversation.id, new Date().toISOString(), staleBeforeIso),
  ]);

  const winners = results.filter((r) => r.status === "fulfilled" && r.value !== undefined);
  assert.equal(winners.length, 1, "exatamente um processo recupera o lock abandonado — nunca dois donos válidos simultâneos");
});

test("Claim de mensagem abandonado (lease expirado) é recuperado pelo drenador de IA", async () => {
  const tenantId = "tenant-res-lock-3";
  const { workspace, connection, phone, conversation } = await makeConversation(tenantId, { aiEnabled: true });
  const depsSetup = buildDeps(tenantId);
  const { message } = await registerInboundMessage(depsSetup, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-stuck-claim", type: "text", body: "Oi", occurredAt: new Date().toISOString(),
  });

  // Simula um processo que reivindicou a mensagem e morreu antes de resolver o claim.
  await depsSetup.messageRepository.tryClaimForAiResponse(message.id, new Date(Date.now() - 10 * 60_000).toISOString(), new Date(Date.now() + 10_000).toISOString());
  const stuckMessage = await depsSetup.messageRepository.getById(message.id);
  assert.equal(stuckMessage.aiClaimStatus, "processing");

  const aiResponder = { async generateReply() { return { ok: true, reply: "Recuperado!", provider: "fake", model: "fake", latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0 }, traceId: "t" }; } };
  const deps = buildDeps(tenantId, { aiResponder });

  await maybeGenerateAiResponse(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, triggeringMessageId: message.id });

  const recoveredMessage = await deps.messageRepository.getById(message.id);
  assert.equal(recoveredMessage.aiClaimStatus, "answered", "claim abandonado foi recuperado e respondido — nunca fica preso em 'processing' para sempre");
});

// ------------------------------------------------------------------------------------------
// Circuit breaker do WuzAPI (reaproveitando OperationalCircuitBreaker)
// ------------------------------------------------------------------------------------------

test("Circuit breaker: WuzAPI indisponível abre o circuito, e enquanto aberto o outbound permanece QUEUED (nunca perdido)", async () => {
  const tenantId = "tenant-res-cb-1";
  const { workspace, connection, phone, conversation } = await makeConversation(tenantId);
  const circuitBreaker = new OperationalCircuitBreaker(new PostgresOperationalStateRepository(db.pool), { failureThreshold: 2, cooldownMs: 200 });
  const failingProvider = makeFakeMessagingProvider({ sendText: async () => { throw new MessagingProviderError("transient", "WuzAPI inalcançável (simulado)."); } });
  const deps = buildDeps(tenantId, { provider: failingProvider, circuitBreaker });

  const message = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Mensagem 1", sentByUserId: "user-a" });
  await assert.rejects(() => processOutboundMessage(deps, { messageId: message.id }));
  const message2 = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Mensagem 2", sentByUserId: "user-a" });
  await assert.rejects(() => processOutboundMessage(deps, { messageId: message2.id })); // 2ª falha — atinge o threshold, circuito abre.

  // Com o circuito aberto, uma 3ª mensagem NUNCA deveria sequer chamar o provider.
  const message3 = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Mensagem 3", sentByUserId: "user-a" });
  await assert.rejects(() => processOutboundMessage(deps, { messageId: message3.id }));
  assert.equal(failingProvider.sentMessages.length, 0, "provider nunca chamado com sucesso (simulado sempre falha)");

  const [m1, m2, m3] = await Promise.all([message.id, message2.id, message3.id].map((id) => deps.messageRepository.getById(id)));
  for (const m of [m1, m2, m3]) {
    assert.equal(m.status, "queued", "outbound NUNCA perdido — continua queued mesmo com circuito aberto");
  }
  assert.equal(m3.failureCategory, "circuit_open", "a 3ª tentativa é categorizada como bloqueio pelo circuit breaker, não como erro do provider");
});

test("Circuit breaker: recupera (half-open → closed) depois do cooldown, com sucesso real", async () => {
  const tenantId = "tenant-res-cb-2";
  const { workspace, connection, phone, conversation } = await makeConversation(tenantId);
  const circuitBreaker = new OperationalCircuitBreaker(new PostgresOperationalStateRepository(db.pool), { failureThreshold: 1, cooldownMs: 50 });
  let shouldFail = true;
  const provider = makeFakeMessagingProvider({
    sendText: async (input, self) => {
      if (shouldFail) throw new MessagingProviderError("transient", "Falha simulada.");
      self.sentMessages.push(input);
      return { externalMessageId: "fake-recovered" };
    },
  });
  const deps = buildDeps(tenantId, { provider, circuitBreaker });

  const message = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Falha", sentByUserId: "user-a" });
  await assert.rejects(() => processOutboundMessage(deps, { messageId: message.id })); // abre o circuito (threshold=1).

  await new Promise((resolve) => setTimeout(resolve, 80)); // espera o cooldown passar.
  shouldFail = false;

  const message2 = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Recuperada", sentByUserId: "user-a" });
  const sent = await processOutboundMessage(deps, { messageId: message2.id });
  assert.equal(sent.status, "sent", "depois do cooldown (half-open) uma tentativa real é permitida, e o sucesso fecha o circuito de novo");
});

// ------------------------------------------------------------------------------------------
// Rate limiting por conexão
// ------------------------------------------------------------------------------------------

test("Rate limiting: limite atingido nunca perde a mensagem — permanece QUEUED para processamento posterior", async () => {
  const tenantId = "tenant-res-rl-1";
  const { workspace, connection, phone, conversation } = await makeConversation(tenantId);
  const rateLimiter = new OperationalRateLimiter(new PostgresOperationalStateRepository(db.pool), { defaultLimit: 1, windowMs: 60_000 });
  const provider = makeFakeMessagingProvider();
  const deps = buildDeps(tenantId, { provider, rateLimiter });

  const message1 = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Primeira", sentByUserId: "user-a" });
  const sent1 = await processOutboundMessage(deps, { messageId: message1.id });
  assert.equal(sent1.status, "sent");

  const message2 = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Segunda", sentByUserId: "user-a" });
  await assert.rejects(() => processOutboundMessage(deps, { messageId: message2.id }));
  const stillQueued = await deps.messageRepository.getById(message2.id);
  assert.equal(stillQueued.status, "queued", "mensagem além do limite nunca desaparece — fica queued");
  assert.equal(stillQueued.failureCategory, "rate_limited_local");
  assert.equal(provider.sentMessages.length, 1, "o provider nunca foi chamado para a mensagem além do limite");
});

// ------------------------------------------------------------------------------------------
// DLQ / failureCategory
// ------------------------------------------------------------------------------------------

test("Falha de envio grava failureCategory correspondente ao MessagingProviderErrorKind (diagnóstico sem reabrir logs)", async () => {
  const tenantId = "tenant-res-dlq-1";
  const { workspace, connection, phone, conversation } = await makeConversation(tenantId);
  const provider = makeFakeMessagingProvider({ sendText: async () => { throw new MessagingProviderError("session_logged_out", "Sessão perdida (simulado)."); } });
  const deps = buildDeps(tenantId, { provider });

  const message = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Oi", sentByUserId: "user-a" });
  await assert.rejects(() => processOutboundMessage(deps, { messageId: message.id }));

  const afterAttempt = await deps.messageRepository.getById(message.id);
  assert.equal(afterAttempt.failureCategory, "session_logged_out");

  // Simula o worker esgotando a escada de retry e marcando failed (mesma chamada que `onDeadLetter` faz).
  const failed = await deps.messageRepository.markFailed(message.id, { lastError: afterAttempt.lastError, failedAt: new Date().toISOString(), failureCategory: afterAttempt.failureCategory });
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureCategory, "session_logged_out", "mensagem na DLQ fica com categoria diagnosticável, sem precisar reabrir log bruto");
});

// ------------------------------------------------------------------------------------------
// Monitor de saúde de conexão
// ------------------------------------------------------------------------------------------

// `reconcileConnectionsHealth` é deliberadamente GLOBAL (todas as conexões ativas de todos os
// tenants, ver comentário no caso de uso) — então estes dois testes nunca assumem contagens
// agregadas (`checked`/`healthy`/`unhealthy`), que dependem de quantas conexões OUTROS testes
// deste arquivo já criaram na mesma base compartilhada. Em vez disso, o fake provider só reage à
// sessão da conexão DESTE teste especificamente; para qualquer outra, devolve sucesso benigno —
// e as asserções checam sempre a LINHA específica da conexão testada, nunca o total do tick.

test("Monitor de saúde: sucesso marca healthy e limpa erro anterior; falha transitória marca gateway_unavailable sem tocar em status", async () => {
  const tenantId = "tenant-res-health-1";
  const { connection } = await makeConversation(tenantId);
  let shouldFail = true;
  const provider = makeFakeMessagingProvider({
    getConnectionStatus: async (input) => {
      if (input.externalSessionId === connection.externalSessionId && shouldFail) throw new MessagingProviderError("transient", "WuzAPI inalcançável (simulado).");
      return { status: "connected" };
    },
  });
  const deps = buildDeps(tenantId, { provider });

  await reconcileConnectionsHealth(deps);
  const afterFailure = await deps.connectionRepository.getById(connection.id);
  assert.equal(afterFailure.connectionHealth, "gateway_unavailable");
  assert.equal(afterFailure.lastConnectionError, "transient");
  assert.equal(afterFailure.status, "connected", "falha de checagem NUNCA reescreve o status da sessão — só reflete quando a checagem tem sucesso");

  shouldFail = false;
  await reconcileConnectionsHealth(deps);
  const afterSuccess = await deps.connectionRepository.getById(connection.id);
  assert.equal(afterSuccess.connectionHealth, "healthy");
  assert.equal(afterSuccess.lastConnectionError, undefined, "sucesso limpa o erro anterior");
});

test("Monitor de saúde nunca checa (nem toca) conexões em status terminal — logout/revogação não pode entrar em loop", async () => {
  const tenantId = "tenant-res-health-2";
  const { connection } = await makeConversation(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  await connectionRepo.updateStatus(connection.id, { status: "logged_out" });

  const checkedSessionIds = new Set();
  const provider = makeFakeMessagingProvider({ getConnectionStatus: async (input) => { checkedSessionIds.add(input.externalSessionId); return { status: "connected" }; } });
  const deps = buildDeps(tenantId, { provider });

  await reconcileConnectionsHealth(deps);
  assert.equal(checkedSessionIds.has(connection.externalSessionId), false, "getConnectionStatus nunca chamado para uma sessão já revogada — nunca reautentica sozinho");

  const afterTick = await deps.connectionRepository.getById(connection.id);
  assert.equal(afterTick.status, "logged_out", "conexão terminal permanece intocada pelo monitor de saúde");
  assert.equal(afterTick.connectionHealth, "unknown", "connectionHealth também nunca é escrito para uma conexão terminal");
});

// ------------------------------------------------------------------------------------------
// Crédito insuficiente (evento humano-visível, IA nunca desliga a Inbox)
// ------------------------------------------------------------------------------------------

test("Crédito insuficiente: IA não gera resposta, evento distinto registrado, conversa disponível para humano", async () => {
  const tenantId = "tenant-res-credit-1";
  const { workspace, connection, phone, conversation } = await makeConversation(tenantId, { aiEnabled: true });
  const aiResponder = { async generateReply() { return { ok: false, category: "quota_exceeded", message: "Créditos insuficientes (simulado)." }; } };
  const deps = buildDeps(tenantId, { aiResponder });

  const { message } = await registerInboundMessage(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-no-credit", type: "text", body: "Oi", occurredAt: new Date().toISOString() });
  await maybeGenerateAiResponse(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, triggeringMessageId: message.id });

  const events = await deps.conversationEventRepository.listByConversation({ tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  assert.deepEqual(events.map((e) => e.type), ["ai_response_skipped_insufficient_credits"]);
  assert.equal(events[0].performedBy, "ai");

  const inboundMsg = await deps.messageRepository.getById(message.id);
  assert.equal(inboundMsg.aiClaimStatus, "skipped");

  // Conversa continua disponível — IA/crédito insuficiente NUNCA desliga a Inbox nem impede humano.
  const humanReply = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Um atendente já te ajuda.", sentByUserId: "user-human" });
  assert.equal(humanReply.status, "queued");
});

// ------------------------------------------------------------------------------------------
// Billing real (CreditGatedAiGateway + AiGateway + AiGatewayInboxResponder)
// ------------------------------------------------------------------------------------------

function makeFakeAiModelProvider(reply) {
  return {
    id: "anthropic",
    capabilities: ["free_text", "structured_text", "tool_calling"],
    isConfigured: () => true,
    async execute() {
      return { ok: true, rawOutput: { schemaVersion: 1, reply }, usage: { inputTokens: 12, outputTokens: 6, providerReported: true }, finishReason: "stop", latencyMs: 8 };
    },
    async healthCheck() { return { ok: true }; },
  };
}

function buildGatedInboxResponder(reply) {
  const aiGateway = new AiGateway({
    providers: [makeFakeAiModelProvider(reply)],
    bindings: { inbox_auto_reply: { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" } },
    rateLimiter: new InMemoryAiRateLimiter(),
    circuitBreaker: new InMemoryAiCircuitBreaker(),
    executionRepository: new InMemoryAiExecutionRepository(),
    telemetry: new InMemoryAiTelemetry(),
  });
  const creditAccounting = new CreditAccountingService({
    platformBillingRepository: new PostgresPlatformBillingRepository(db.pool),
    aiProvidersRepository: new PostgresAiProvidersRepository(db.pool),
    idGenerator: (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  });
  const gated = new CreditGatedAiGateway({ inner: aiGateway, creditAccounting, now: () => new Date() });
  return new AiGatewayInboxResponder(gated);
}

test("Billing real: tenant sem billing configurado nunca chama o provider de IA (nunca gera resposta sem crédito verificável)", async () => {
  const tenantId = "tenant-res-billing-nobilling";
  const responder = buildGatedInboxResponder("Não deveria ser usada");
  const result = await responder.generateReply({ tenantId, workspaceId: "ws-x", conversationId: "conv-x", contactPhone: "+5511900000000", recentMessages: [], idempotencyKey: "inbox_auto_reply:msg-nobilling" });
  assert.equal(result.ok, false);
  assert.equal(result.category, "quota_exceeded");
});

test("Billing real: com crédito suficiente, a IA responde e o consumo é registrado uma única vez", async () => {
  const tenantId = "tenant-res-billing-ok";
  const billingRepo = new PostgresPlatformBillingRepository(db.pool);
  await billingRepo.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  await billingRepo.updateTenantBilling({ tenantId, patch: { subscriptionStatus: "active", monthlyCreditsQuota: 1000 }, now: new Date().toISOString() });

  const responder = buildGatedInboxResponder("Resposta cobrada corretamente.");
  const result = await responder.generateReply({ tenantId, workspaceId: "ws-x", conversationId: "conv-x", contactPhone: "+5511900000000", recentMessages: [], idempotencyKey: "inbox_auto_reply:msg-billing-ok" });
  assert.equal(result.ok, true);
  assert.equal(result.reply, "Resposta cobrada corretamente.");

  const usageAfterOne = await billingRepo.getAiUsage({ tenantId, period: new Date().toISOString().slice(0, 7) });
  assert.ok(usageAfterOne.creditsConsumed >= 1, "consumo de crédito real registrado após uma geração bem-sucedida");
});

// ------------------------------------------------------------------------------------------
// Fase 7 — Idempotência FINANCEIRA forte: o claim CAS operacional (Fase 5/6) impede duas
// GERAÇÕES concorrentes, mas sozinho não impede cobrar duas vezes se a MESMA geração for
// reprocessada depois de já ter sido cobrada (crash entre debitar e resolver o claim, claim
// expira pelo lease, reprocessamento). A chave de idempotência (`inbox_auto_reply:<messageId>`)
// fecha exatamente essa lacuna, na PRÓPRIA tabela `ai_generation_ledger` (nunca um ledger paralelo).
// ------------------------------------------------------------------------------------------

test("Idempotência financeira: CreditAccountingService.recordSuccess chamado duas vezes com a MESMA chave cobra exatamente uma vez", async () => {
  const tenantId = "tenant-res-fin-idem-1";
  const billingRepo = new PostgresPlatformBillingRepository(db.pool);
  const aiProvidersRepo = new PostgresAiProvidersRepository(db.pool);
  await billingRepo.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  await billingRepo.updateTenantBilling({ tenantId, patch: { subscriptionStatus: "active", monthlyCreditsQuota: 1000 }, now: new Date().toISOString() });

  const creditAccounting = new CreditAccountingService({ platformBillingRepository: billingRepo, aiProvidersRepository: aiProvidersRepo, idGenerator: (p) => `${p}-${Math.random().toString(36).slice(2, 8)}` });
  const operationType = await aiProvidersRepo.getOperationType("inbox_auto_reply");
  const availability = await creditAccounting.checkAvailability(tenantId, "inbox_auto_reply", new Date());
  assert.equal(availability.ok, true);

  const chargeInput = {
    tenantId,
    operationType,
    providerCode: "anthropic",
    modelId: "claude-haiku-4-5-20251001",
    providerCostUsd: 0.001,
    priceMultiplier: 1,
    monthlyRemainingBefore: availability.monthlyRemainingBefore,
    creditsExtraBefore: availability.creditsExtraBefore,
    tokens: { inputTokens: 10, outputTokens: 5 },
    idempotencyKey: "inbox_auto_reply:msg-crash-scenario",
    now: new Date(),
  };

  // 1ª chamada: debita normalmente. Simula então "processo morreu antes de resolver o claim" —
  // uma 2ª chamada com a MESMA chave chega depois (claim expirou pelo lease, Fase 6, e a mensagem
  // foi reprocessada) — nunca pode debitar de novo.
  await creditAccounting.recordSuccess(chargeInput);
  await creditAccounting.recordSuccess(chargeInput);

  const usage = await billingRepo.getAiUsage({ tenantId, period: new Date().toISOString().slice(0, 7) });
  assert.equal(usage.creditsConsumed, operationType.creditsCost, "exatamente UMA cobrança, mesmo com recordSuccess chamado duas vezes com a mesma chave");
  assert.equal(usage.requestsCount, 1, "requestsCount também nunca duplica");

  const ledger = await aiProvidersRepo.listGenerations({ tenantId, limit: 10 });
  const forThisKey = ledger.filter((entry) => entry.idempotencyKey === "inbox_auto_reply:msg-crash-scenario");
  assert.equal(forThisKey.length, 1, "só UMA linha no ledger para esta chave — nunca um ledger paralelo, nunca duplicidade na MESMA tabela");
});

test("Idempotência financeira: reprocessamento via AiGatewayInboxResponder (mesma chave) nunca cobra duas vezes, mesmo gerando de novo", async () => {
  const tenantId = "tenant-res-fin-idem-2";
  const billingRepo = new PostgresPlatformBillingRepository(db.pool);
  await billingRepo.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  await billingRepo.updateTenantBilling({ tenantId, patch: { subscriptionStatus: "active", monthlyCreditsQuota: 1000 }, now: new Date().toISOString() });

  const sameIdempotencyKey = "inbox_auto_reply:msg-reprocessed-after-crash";
  const responder = buildGatedInboxResponder("Resposta da tentativa.");

  // Tentativa 1 (bem-sucedida, cobra).
  const first = await responder.generateReply({ tenantId, workspaceId: "ws-x", conversationId: "conv-x", contactPhone: "+5511900000000", recentMessages: [], idempotencyKey: sameIdempotencyKey });
  assert.equal(first.ok, true);

  // Tentativa 2: simula o claim expirado reprocessando a MESMA mensagem (mesma chave) — a IA
  // ainda gera uma resposta (a geração em si não é bloqueada), mas a cobrança tem que ser um no-op.
  const second = await responder.generateReply({ tenantId, workspaceId: "ws-x", conversationId: "conv-x", contactPhone: "+5511900000000", recentMessages: [], idempotencyKey: sameIdempotencyKey });
  assert.equal(second.ok, true);

  const usage = await billingRepo.getAiUsage({ tenantId, period: new Date().toISOString().slice(0, 7) });
  assert.equal(usage.creditsConsumed, 1, "exatamente uma cobrança, mesmo com duas gerações reais completadas para a mesma chave");
});

// ------------------------------------------------------------------------------------------
// Isolamento cross-tenant do novo estado persistente (circuit breaker / rate limiter)
// ------------------------------------------------------------------------------------------

test("Isolamento cross-tenant: circuit breaker de um tenant nunca abre o de outro, mesmo com o MESMO target", async () => {
  const repo = new PostgresOperationalStateRepository(db.pool);
  const breaker = new OperationalCircuitBreaker(repo, { failureThreshold: 1, cooldownMs: 60_000 });
  const sameTarget = "conn-shared-target-for-test";

  await breaker.recordFailure({ tenantId: "tenant-cross-a", scope: "messaging_provider", target: sameTarget }, { code: "transient", category: "provider_unavailable" });

  const { allowed: allowedForA } = await breaker.canExecute({ tenantId: "tenant-cross-a", scope: "messaging_provider", target: sameTarget });
  const { allowed: allowedForB } = await breaker.canExecute({ tenantId: "tenant-cross-b", scope: "messaging_provider", target: sameTarget });

  assert.equal(allowedForA, false, "circuito do tenant A está aberto (a falha foi dele)");
  assert.equal(allowedForB, true, "circuito do tenant B continua fechado — nunca compartilha estado com outro tenant, mesmo com o mesmo target");
});

test("Isolamento cross-tenant: rate limiter de um tenant nunca consome a cota de outro, mesmo com o MESMO connectionId", async () => {
  const repo = new PostgresOperationalStateRepository(db.pool);
  const limiter = new OperationalRateLimiter(repo, { defaultLimit: 1, windowMs: 60_000 });
  const sameConnectionId = "conn-shared-rl-for-test";

  const first = await limiter.consume({ routeGroup: "inbox_outbound", tenantId: "tenant-cross-rl-a", principalId: sameConnectionId });
  assert.equal(first.allowed, true);
  const second = await limiter.consume({ routeGroup: "inbox_outbound", tenantId: "tenant-cross-rl-a", principalId: sameConnectionId });
  assert.equal(second.allowed, false, "tenant A já esgotou sua cota");

  const thirdForOtherTenant = await limiter.consume({ routeGroup: "inbox_outbound", tenantId: "tenant-cross-rl-b", principalId: sameConnectionId });
  assert.equal(thirdForOtherTenant.allowed, true, "tenant B tem sua PRÓPRIA cota, mesmo usando o mesmo connectionId — nunca compartilha estado entre tenants");
});

// ------------------------------------------------------------------------------------------
// Métricas
// ------------------------------------------------------------------------------------------

test("Métricas: fluxo completo (inbound, outbound, falha, IA) chama os contadores esperados", async () => {
  const tenantId = "tenant-res-metrics-1";
  const { workspace, connection, phone, conversation } = await makeConversation(tenantId, { aiEnabled: true });
  const { recorder: metrics, calls } = makeFakeMetrics();
  const aiResponder = { async generateReply() { return { ok: true, reply: "Resposta.", provider: "fake", model: "fake", latencyMs: 42, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCost: 0.01 }, traceId: "t" }; } };
  const deps = buildDeps(tenantId, { aiResponder, metrics });

  const { message, wasCreated } = await registerInboundMessage(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, fromPhone: phone, externalMessageId: "wa-metrics", type: "text", body: "Oi", occurredAt: new Date().toISOString() });
  assert.ok(wasCreated);
  await maybeGenerateAiResponse(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, triggeringMessageId: message.id });

  const outboundMessages = await deps.messageRepository.listByConversation({ tenantId, workspaceId: workspace.id, conversationId: conversation.id });
  const outbound = outboundMessages.find((m) => m.direction === "outbound");
  await processOutboundMessage(deps, { messageId: outbound.id });

  const methodNames = calls.map((c) => c.method);
  assert.ok(methodNames.includes("incMessageInbound"), "inbound contabilizada");
  assert.ok(methodNames.includes("incAiReply"), "resposta de IA contabilizada");
  assert.ok(methodNames.includes("addAiCostUsd"), "custo de IA contabilizado");
  assert.ok(methodNames.includes("observeAiLatencyMs"), "latência de IA contabilizada");
  assert.ok(methodNames.includes("incMessageOutbound"), "envio outbound bem-sucedido contabilizado");
});

// ------------------------------------------------------------------------------------------
// Fase 7 — achado crítico de auditoria: envio duplicado ao WhatsApp em caso de crash do worker
// entre `provider.sendText` suceder e `markSent` commitar. Corrigido com um claim atômico
// (`tryMarkSending`, CAS `queued -> sending`) ANTES de chamar o provider — ver `processOutboundMessage`.
// ------------------------------------------------------------------------------------------

test("Claim atômico: tryMarkSending só permite UMA execução concorrente reivindicar a mesma mensagem queued", async () => {
  const tenantId = "tenant-res-claim-1";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps(tenantId);
  const message = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Msg", sentByUserId: "user-a" });

  const first = await deps.messageRepository.tryMarkSending(message.id);
  assert.ok(first, "primeira reivindicação vence a corrida");
  assert.equal(first.status, "sending");

  const second = await deps.messageRepository.tryMarkSending(message.id);
  assert.equal(second, undefined, "segunda reivindicação concorrente da MESMA mensagem perde a corrida (undefined, nunca reenvia)");
});

test("Crash simulado: mensagem travada em 'sending' (crash entre sendText e markSent) NUNCA é reenviada numa redelivery", async () => {
  const tenantId = "tenant-res-crash-1";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps(tenantId);
  const message = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Mensagem crítica", sentByUserId: "user-a" });

  // Simula o crash: o processo anterior reivindicou o claim e chamou `provider.sendText` (que pode
  // ou não ter chegado a executar de verdade no WhatsApp), mas morreu antes de `markSent` commitar.
  await deps.messageRepository.tryMarkSending(message.id);

  // Redelivery (mesma messageId, via RabbitMQ) chega numa NOVA execução de `processOutboundMessage`.
  const result = await processOutboundMessage(deps, { messageId: message.id });

  assert.equal(deps.provider.sentMessages.length, 0, "o provider NUNCA é chamado de novo para uma mensagem já 'sending' — isso é o que evita o envio duplicado");
  assert.equal(result.status, "sending", "a mensagem fica parada em 'sending' para reconciliação manual, nunca é reenviada nem perdida");
});

test("Falha transitória capturada normalmente (sem crash) continua reprocessando via a escada de retry, sem regressão", async () => {
  const tenantId = "tenant-res-transient-retry-1";
  const { workspace, conversation } = await makeConversation(tenantId);
  let attempts = 0;
  const provider = makeFakeMessagingProvider({
    sendText(input, self) {
      attempts += 1;
      if (attempts === 1) throw new MessagingProviderError("transient", "Falha simulada na 1ª tentativa.");
      self.sentMessages.push(input);
      return { externalMessageId: `fake-wa-${self.sentMessages.length}` };
    },
  });
  const deps = buildDeps(tenantId, { provider });
  const message = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Retry normal", sentByUserId: "user-a" });

  await assert.rejects(() => processOutboundMessage(deps, { messageId: message.id }));
  const afterFailure = await deps.messageRepository.getById(message.id);
  assert.equal(afterFailure.status, "queued", "erro capturado DENTRO do processo (não um crash) reverte pra 'queued' — a escada de retry do worker continua funcionando normalmente");

  const sent = await processOutboundMessage(deps, { messageId: message.id });
  assert.equal(sent.status, "sent", "a retentativa seguinte (mesma mensagem, agora 'queued' de novo) é processada e enviada com sucesso");
  assert.equal(provider.sentMessages.length, 1);
});

test("markSent recusa transicionar uma mensagem que ainda não passou pelo claim (ainda 'queued')", async () => {
  const tenantId = "tenant-res-marksent-guard-1";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps(tenantId);
  const message = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Sem claim", sentByUserId: "user-a" });

  const result = await deps.messageRepository.markSent(message.id, { externalMessageId: "wa-x", sentAt: new Date().toISOString() });
  assert.equal(result.status, "queued", "markSent exige status 'sending' (pós-claim) — nunca aplica a transição a partir de 'queued' diretamente");
});

test("Kill switch de outbound pausado lança MessagingProviderError com kind 'operator_paused' (nunca 'transient')", async () => {
  const tenantId = "tenant-res-paused-kind-1";
  const { workspace, conversation } = await makeConversation(tenantId);
  const deps = buildDeps(tenantId, { outboundSendPaused: true });
  const message = await sendInboxMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, body: "Pausada", sentByUserId: "user-a" });

  try {
    await processOutboundMessage(deps, { messageId: message.id });
    assert.fail("deveria ter lançado");
  } catch (error) {
    assert.ok(error instanceof MessagingProviderError);
    assert.equal(error.kind, "operator_paused", "kind distinto de 'transient' — é isso que impede o worker de esgotar a escada de retry e mandar pra DLQ enquanto a pausa durar (ver inbox-worker.ts)");
  }
  assert.equal(deps.provider.sentMessages.length, 0);
});

// ------------------------------------------------------------------------------------------
// Fase 7 — achado de auditoria: `applyConnectionStateChanged` não podia "ressuscitar" uma conexão
// já num estado terminal (`logged_out`/`requires_repair`) por causa de um evento de fila
// atrasado/reentregue com um estado antigo (ex.: "connected" de antes do logout).
// ------------------------------------------------------------------------------------------

test("applyConnectionStateChanged nunca reverte um estado terminal (logged_out) por um evento de fila atrasado", async () => {
  const tenantId = "tenant-res-terminal-1";
  const { workspace, connection } = await makeConversation(tenantId);
  const deps = buildDeps(tenantId);

  await deps.connectionRepository.updateStatus(connection.id, { status: "logged_out" });
  const beforeEvent = await deps.connectionRepository.getById(connection.id);
  assert.equal(beforeEvent.status, "logged_out");

  // Evento de fila atrasado/reentregue, carregando um estado ANTERIOR ao logout.
  await applyConnectionStateChanged(deps, { connectionId: connection.id, status: "connected" });

  const afterEvent = await deps.connectionRepository.getById(connection.id);
  assert.equal(afterEvent.status, "logged_out", "estado terminal nunca é sobrescrito por um evento de fila atrasado — precisa de um novo pareamento explícito");
});

test("applyConnectionStateChanged aplica normalmente transições que NÃO partem de um estado terminal", async () => {
  const tenantId = "tenant-res-terminal-2";
  const { workspace, connection } = await makeConversation(tenantId);
  const deps = buildDeps(tenantId);

  await deps.connectionRepository.updateStatus(connection.id, { status: "reconnecting" });
  await applyConnectionStateChanged(deps, { connectionId: connection.id, status: "connected" });

  const after = await deps.connectionRepository.getById(connection.id);
  assert.equal(after.status, "connected", "transições normais (não-terminais) continuam funcionando sem regressão");
});
