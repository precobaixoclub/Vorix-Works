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
import { PostgresTeamRepository, PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import { PostgresPlatformBillingRepository } from "../dist/infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { PostgresAiProvidersRepository } from "../dist/infrastructure/storage/postgres/postgres-ai-providers-repository.js";
import { PostgresRadarRepository } from "../dist/infrastructure/storage/postgres/postgres-radar-repository.js";
import { CreditAccountingService } from "../dist/application/ai-providers/credit-accounting.service.js";
import { CreditGatedAiGateway } from "../dist/application/ai-gateway/credit-gated-ai-gateway.js";
import { AiGatewayRadarAnalyst } from "../dist/infrastructure/ai-gateway/radar-ai-analyst-adapter.js";
import { CreditAccountingRadarCreditGate } from "../dist/infrastructure/radar/credit-accounting-radar-credit-gate.js";
import { periodOf } from "../dist/domain/platform-billing/tenant-billing.model.js";
import { registerInboundMessage } from "../dist/application/inbox/inbox-use-cases.js";
import {
  dismissRadarAlert,
  evaluateRadarForMessage,
  getRadarAlertDetail,
  getRadarCredits,
  getRadarStats,
  listRadarAlerts,
  listRadarKeywords,
  reactivateRadarAlert,
  reanalyzeRadarAlert,
  reprocessRadarWithTranscription,
  resolveRadarScope,
  setRadarTeamEnabled,
  updateRadarSettings,
  upsertRadarKeyword,
} from "../dist/application/radar/radar-use-cases.js";
import { readableTeamIds, resolveAccessContext, scopeFor as accessScopeFor } from "../dist/application/identity/access-control-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Radar de Sentimento com créditos de IA — integração real: Postgres de verdade (PGlite), o
 * repositório real do Radar e o serviço CENTRAL de créditos real (`CreditAccountingService` +
 * `CreditGatedAiGateway` sobre `tenant_billing`/`ai_generation_ledger`). Só o provider de IA é
 * falso — e conta cada chamada, que é exatamente o que os testes de crédito precisam provar
 * ("sem saldo, provider NÃO é chamado").
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
const OPERATION = "sentiment_radar_analysis";
const MINUTE = 60_000;

let db;
before(async () => {
  db = await startTestPostgres({ port: 55731 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

const ANALYSIS_OUTPUT = {
  schemaVersion: 1,
  diagnostico: "Cliente insatisfeito ameaça cancelar.",
  causaRaiz: "Demora no retorno do atendimento.",
  riscoPrincipal: "churn",
  acaoImediata: "Ligar para o cliente agora e oferecer solução.",
  prioridade: "alta",
  resumoParaGestor: "Risco real de cancelamento por demora.",
};

/** Provider de IA falso — a ÚNICA peça simulada. `calls` é o contador de chamadas ao provider. */
function makeFakeProviderGateway() {
  const gateway = {
    calls: 0,
    mode: "ok",
    delayMs: 0,
    requests: [],
    async execute(request) {
      gateway.calls += 1;
      gateway.requests.push(request);
      if (gateway.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, gateway.delayMs));
      if (gateway.mode === "fail") return { ok: false, error: { category: "provider_unavailable", message: "provider fora do ar", retryable: false, provider: "anthropic", model: "claude-haiku-4-5-20251001" } };
      return {
        ok: true,
        data: {
          operation: request.operation,
          provider: "anthropic",
          model: "claude-haiku-4-5-20251001",
          output: { ...ANALYSIS_OUTPUT, diagnostico: `${ANALYSIS_OUTPUT.diagnostico} #${gateway.calls}` },
          validated: true,
          usage: { inputTokens: 300, outputTokens: 120, totalTokens: 420, estimatedCost: 0.0009, currency: "USD", providerReported: true },
          latencyMs: 40,
          finishReason: "stop",
          warnings: [],
          traceId: `trace-${gateway.calls}`,
        },
      };
    },
  };
  return gateway;
}

let sequence = 0;

/** Um tenant isolado por teste, com `credits` créditos de IA disponíveis no mês. */
async function makeSetup(name, { credits = 10 } = {}) {
  sequence += 1;
  const tenantId = `tenant-radar-${name}-${sequence}`;
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `ws-${tenantId}-${Math.random().toString(36).slice(2, 8)}` });
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Canal" });
  const inboxDeps = {
    contactRepository: new PostgresInboxContactRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool),
  };

  const billingRepo = new PostgresPlatformBillingRepository(db.pool);
  await billingRepo.ensureTenantBilling({ tenantId, now: new Date().toISOString() });
  await billingRepo.updateTenantBilling({ tenantId, patch: { monthlyCreditsQuota: credits, subscriptionStatus: "active" }, now: new Date().toISOString() });

  const creditAccounting = new CreditAccountingService({
    platformBillingRepository: billingRepo,
    aiProvidersRepository: new PostgresAiProvidersRepository(db.pool),
    idGenerator: (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  });

  const clock = { offsetMs: 0, now: () => new Date(Date.now() + clock.offsetMs), advanceMinutes: (minutes) => { clock.offsetMs += minutes * MINUTE; } };
  const provider = makeFakeProviderGateway();
  const events = [];
  const metrics = { counts: {} };
  const count = (key) => () => { metrics.counts[key] = (metrics.counts[key] ?? 0) + 1; };
  const radarRepository = new PostgresRadarRepository(db.pool);
  const deps = {
    radarRepository,
    aiAnalyst: new AiGatewayRadarAnalyst(new CreditGatedAiGateway({ inner: provider, creditAccounting, now: clock.now })),
    creditGate: new CreditAccountingRadarCreditGate({ creditAccounting, now: clock.now }),
    realtimePublisher: { publish: (event) => events.push(event) },
    metrics: {
      incHeuristicEvaluation: count("heuristic"),
      incHighRiskConversation: count("highRisk"),
      incAiRequested: count("aiRequested"),
      incAiCompleted: count("aiCompleted"),
      incAiBlockedNoCredits: count("aiBlocked"),
      incAiProviderFailure: count("aiFailed"),
      incAiResumedAfterTopUp: count("aiResumed"),
      addCreditsConsumed: (credits_) => { metrics.counts.credits = (metrics.counts.credits ?? 0) + credits_; },
      observeAiCostUsd: () => {},
      observeAiTokens: () => {},
    },
    now: clock.now,
  };

  let messageSequence = 0;
  const ctx = {
    tenantId,
    workspace,
    connection,
    deps,
    provider,
    events,
    metrics,
    clock,
    billingRepo,
    radarRepository,
    scope: { tenantId, workspaceId: workspace.id },

    async newConversation({ group = false } = {}) {
      messageSequence += 1;
      const chatId = group ? `1203630${sequence}${messageSequence}@g.us` : `+55119${String(10_000_000 + sequence * 1000 + messageSequence)}`;
      const registered = await registerInboundMessage(inboxDeps, {
        tenantId, workspaceId: workspace.id, connectionId: connection.id,
        chatId, isGroup: group, groupName: group ? "Grupo" : undefined, fromMe: false,
        senderId: group ? "+5511900000000" : chatId, senderName: "Cliente",
        externalMessageId: `ext-${tenantId}-${messageSequence}`, type: "text", body: "Olá", occurredAt: new Date().toISOString(),
      });
      return { conversation: registered.conversation, firstMessage: registered.message, chatId };
    },

    /** Persiste uma mensagem do cliente (como o worker faria) e roda o Radar sobre ela. */
    async inbound(conv, text, { type = "text", evaluate = true } = {}) {
      messageSequence += 1;
      const registered = await registerInboundMessage(inboxDeps, {
        tenantId, workspaceId: workspace.id, connectionId: connection.id,
        chatId: conv.chatId, isGroup: conv.conversation.chatType === "group", fromMe: false,
        senderId: conv.conversation.chatType === "group" ? "+5511900000000" : conv.chatId, senderName: "Cliente",
        externalMessageId: `ext-${tenantId}-${messageSequence}`, type, body: text, occurredAt: new Date().toISOString(),
      });
      if (!evaluate) return { message: registered.message };
      const result = await evaluateRadarForMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conv.conversation.id, messageId: registered.message.id, direction: "inbound", text });
      return { message: registered.message, result };
    },

    async agentReply(conv, text = "Já estamos verificando.") {
      messageSequence += 1;
      const id = `out-${tenantId}-${messageSequence}`;
      await db.pool.query(
        `insert into inbox_messages (id, tenant_id, workspace_id, conversation_id, connection_id, direction, type, status, body, sent_at)
         values ($1, $2, $3, $4, $5, 'outbound', 'text', 'sent', $6, now())`,
        [id, tenantId, workspace.id, conv.conversation.id, connection.id, text],
      );
      return evaluateRadarForMessage(deps, { tenantId, workspaceId: workspace.id, conversationId: conv.conversation.id, messageId: id, direction: "outbound" });
    },

    async risk(conv) {
      return radarRepository.getByConversationId(conv.conversation.id);
    },

    /** Usuário real — o ledger central referencia `users(id)` em `requested_by_user_id`. */
    async createUser(label) {
      const id = `user-${label}-${tenantId}`;
      await db.pool.query(`insert into users (id, email, password_hash, name, status, created_at, updated_at) values ($1, $2, 'x', $3, 'active', now(), now())`, [id, `${id}@example.com`, label]);
      return id;
    },

    async setCredits(quota) {
      await billingRepo.updateTenantBilling({ tenantId, patch: { monthlyCreditsQuota: quota }, now: new Date().toISOString() });
    },

    async creditsConsumed() {
      const usage = await billingRepo.getAiUsage({ tenantId, period: periodOf(clock.now()) });
      return usage?.creditsConsumed ?? 0;
    },

    async ledger() {
      const result = await db.pool.query(`select idempotency_key, credits_consumed, status from ai_generation_ledger where tenant_id = $1 and operation_type_code = $2 order by occurred_at`, [tenantId, OPERATION]);
      return result.rows;
    },

    async logs(conv) {
      return radarRepository.listAiAnalysisLogs({ tenantId, workspaceId: workspace.id, conversationId: conv.conversation.id, limit: 50 });
    },
  };
  return ctx;
}

// ================================================================================================
// A–L — testes de crédito obrigatórios
// ================================================================================================

test("A) saldo > 0 + gatilho de IA → reserva → provider → consumo", async () => {
  const ctx = await makeSetup("a", { credits: 5 });
  const conv = await ctx.newConversation();
  const { result } = await ctx.inbound(conv, "Quero cancelar meu contrato agora");

  assert.equal(result.aiOutcome, "completed");
  assert.equal(ctx.provider.calls, 1);
  assert.equal(await ctx.creditsConsumed(), 1);

  const risk = await ctx.risk(conv);
  assert.equal(risk.aiStatus, "ANALYZED");
  assert.equal(risk.aiAnalysis.riscoPrincipal, "churn");
  assert.ok(risk.aiAnalyzedAt);
  assert.equal(risk.aiPendingSince, undefined, "a reserva é liberada ao concluir");

  // Auditoria completa do consumo.
  const [log] = await ctx.logs(conv);
  assert.equal(log.status, "completed");
  assert.equal(log.idempotencyKey, `radar-ai:${conv.conversation.id}:${log.triggerId}`);
  assert.equal(risk.aiCreditTransactionId, log.creditTransactionId);
  assert.equal(log.feature, "sentiment_radar");
  assert.equal(log.tenantId, ctx.tenantId);
  assert.equal(log.creditsReserved, 1);
  assert.equal(log.creditsConsumed, 1);
  assert.equal(log.provider, "anthropic");
  assert.equal(log.model, "claude-haiku-4-5-20251001");
  assert.equal(log.inputTokens, 300);
  assert.equal(log.outputTokens, 120);
  assert.equal(log.estimatedCostUsd, 0.0009);
  assert.equal(log.triggerSource, "auto");
  assert.equal(log.triggerReason, "direct_critical");
  assert.equal(log.score, risk.score);
  assert.ok(log.createdAt);

  // A transação no ledger CENTRAL é localizável pela chave gravada no Radar.
  const ledger = await ctx.ledger();
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].idempotency_key, log.creditTransactionId);
  assert.equal(ledger[0].credits_consumed, 1);

  // A IA recebeu a chave idempotente e a operação cobrável do Radar.
  assert.equal(ctx.provider.requests[0].operation, OPERATION);
  assert.equal(ctx.provider.requests[0].metadata.idempotencyKey, log.idempotencyKey);
  assert.ok(ctx.events.some((event) => event.type === "radar.ai.updated"));
});

test("B) saldo = 0 → provider NÃO é chamado, nenhum crédito consumido", async () => {
  const ctx = await makeSetup("b", { credits: 0 });
  const conv = await ctx.newConversation();
  const { result } = await ctx.inbound(conv, "Vou acionar o Procon e meu advogado");

  assert.equal(result.aiOutcome, "blocked_no_credits");
  assert.equal(ctx.provider.calls, 0, "PROVIDER_CALL = 0");
  assert.equal(await ctx.creditsConsumed(), 0, "CREDIT_CONSUMED = 0");
  assert.equal((await ctx.ledger()).length, 0);

  const risk = await ctx.risk(conv);
  assert.equal(risk.aiStatus, "BLOCKED_NO_CREDITS");
  assert.equal(risk.aiBlockedReason, "no_credits");
  assert.ok(risk.aiLastAttemptAt);
  assert.equal(risk.aiCooldownUntil, undefined, "bloqueio por crédito não arma cooldown");

  const [log] = await ctx.logs(conv);
  assert.equal(log.status, "blocked_no_credits");
  assert.equal(log.creditsReserved, 0);
  assert.equal(log.creditsConsumed, 0);
  assert.ok(ctx.events.some((event) => event.type === "radar.ai.blocked"));
});

test("C) saldo = 0 → score heurístico continua funcionando, de LOW a CRITICAL", async () => {
  const ctx = await makeSetup("c", { credits: 0 });
  const conv = await ctx.newConversation();
  await ctx.agentReply(conv, "Olá! Como posso ajudar?");
  const levels = [];
  for (const text of ["isso foi propaganda enganosa", "quero falar com o gerente", "vou rescindir o contrato", "e vou no procon também"]) {
    const { result } = await ctx.inbound(conv, text);
    levels.push(result.risk.level);
  }
  assert.equal(levels[0], "low");
  assert.equal(levels.at(-1), "critical");
  assert.equal(ctx.provider.calls, 0);
  assert.equal(await ctx.creditsConsumed(), 0);

  const [alert] = await listRadarAlerts(ctx.deps, { scope: ctx.scope });
  assert.equal(alert.level, "critical");
  assert.ok(alert.reasons.length >= 3, "motivos e keywords continuam sendo atualizados sem crédito");
  assert.ok(alert.signals.keywordMatches.length >= 4);
});

test("D) saldo = 0 + diagnóstico anterior → diagnóstico preservado e marcado como desatualizado", async () => {
  const ctx = await makeSetup("d", { credits: 1 });
  const conv = await ctx.newConversation();
  await ctx.inbound(conv, "Quero cancelar");
  const analyzed = await ctx.risk(conv);
  assert.equal(analyzed.aiStatus, "ANALYZED");
  assert.equal(await ctx.creditsConsumed(), 1);

  // O único crédito acabou. Passado o cooldown, a conversa piora.
  ctx.clock.advanceMinutes(31);
  const { result } = await ctx.inbound(conv, "Vou procurar um advogado");
  assert.equal(result.aiOutcome, "blocked_no_credits");
  assert.equal(ctx.provider.calls, 1, "nenhuma chamada nova ao provider");
  assert.equal(await ctx.creditsConsumed(), 1);

  const blocked = await ctx.risk(conv);
  assert.equal(blocked.aiStatus, "BLOCKED_NO_CREDITS");
  assert.deepEqual(blocked.aiAnalysis, analyzed.aiAnalysis, "ai_analysis intocado");
  assert.equal(blocked.aiAnalyzedAt, analyzed.aiAnalyzedAt, "ai_analyzed_at intocado");
  assert.ok(blocked.score > analyzed.score, "o score heurístico seguiu subindo");

  const { alert } = await getRadarAlertDetail(ctx.deps, { scope: ctx.scope, conversationId: conv.conversation.id });
  assert.equal(alert.aiDisplayStatus, "BLOCKED_NO_CREDITS");
  assert.equal(alert.aiStale, true, "DIAGNÓSTICO NÃO ATUALIZADO");
  assert.equal(alert.aiAnalysis.diagnostico, analyzed.aiAnalysis.diagnostico);
});

test("E) saldo = 0 + nunca analisado → os dados da tela informam a indisponibilidade", async () => {
  const ctx = await makeSetup("e", { credits: 0 });
  const conv = await ctx.newConversation();
  await ctx.inbound(conv, "Quero cancelar");

  const { alert } = await getRadarAlertDetail(ctx.deps, { scope: ctx.scope, conversationId: conv.conversation.id });
  assert.equal(alert.aiAnalysis, undefined);
  assert.equal(alert.aiAnalyzedAt, undefined);
  assert.equal(alert.aiStatus, "BLOCKED_NO_CREDITS", "estado explícito — nunca inferido pela ausência de JSON");
  assert.equal(alert.aiDisplayStatus, "BLOCKED_NO_CREDITS");
  assert.equal(alert.aiStale, false);
  assert.ok(alert.score > 0, "o alerta existe e tem score");

  const credits = await getRadarCredits(ctx.deps, { tenantId: ctx.tenantId });
  assert.deepEqual(credits, { aiConfigured: true, available: false, remainingCredits: 0, creditsCost: 0, blockedReason: "no_credits" });
  const stats = await getRadarStats(ctx.deps, { scope: ctx.scope });
  assert.equal(stats.aiBlockedNoCredits, 1);
});

test("F) provider falha → nenhum crédito é debitado e o diagnóstico anterior é preservado", async () => {
  const ctx = await makeSetup("f", { credits: 5 });
  const conv = await ctx.newConversation();
  await ctx.inbound(conv, "Quero cancelar");
  const analyzed = await ctx.risk(conv);
  assert.equal(await ctx.creditsConsumed(), 1);

  ctx.clock.advanceMinutes(31);
  ctx.provider.mode = "fail";
  const { result } = await ctx.inbound(conv, "Vou no procon");
  assert.equal(result.aiOutcome, "failed_provider");
  assert.equal(ctx.provider.calls, 2, "o provider foi tentado");
  assert.equal(await ctx.creditsConsumed(), 1, "a falha não debita crédito");

  const failed = await ctx.risk(conv);
  assert.equal(failed.aiStatus, "FAILED_PROVIDER");
  assert.equal(failed.aiPendingSince, undefined, "a reserva foi liberada");
  assert.deepEqual(failed.aiAnalysis, analyzed.aiAnalysis);
  assert.equal(failed.aiAnalyzedAt, analyzed.aiAnalyzedAt);

  const log = (await ctx.logs(conv)).find((entry) => entry.status === "failed_provider");
  assert.equal(log.creditsReserved, 1);
  assert.equal(log.creditsConsumed, 0);
  assert.equal(log.errorCategory, "provider_unavailable");

  // Passado o backoff curto, o provider volta e a próxima mensagem analisa de novo.
  ctx.clock.advanceMinutes(6);
  ctx.provider.mode = "ok";
  const retry = await ctx.inbound(conv, "alguém?");
  assert.equal(retry.result.aiOutcome, "completed");
  assert.equal(await ctx.creditsConsumed(), 2);
});

test("G) duas execuções concorrentes → um único débito", async () => {
  const ctx = await makeSetup("g", { credits: 5 });
  const conv = await ctx.newConversation();
  // Camada 1 primeiro, com a IA "desligada", para ter um alerta sem diagnóstico.
  await updateRadarSettings(ctx.deps, { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, patch: { aiAnalysisEnabled: false } });
  await ctx.inbound(conv, "Quero cancelar");
  assert.equal(ctx.provider.calls, 0);
  await updateRadarSettings(ctx.deps, { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, patch: { aiAnalysisEnabled: true } });
  const userId = await ctx.createUser("gestora");

  ctx.provider.delayMs = 60;
  const outcomes = await Promise.all([
    reanalyzeRadarAlert(ctx.deps, { scope: ctx.scope, conversationId: conv.conversation.id, userId }),
    reanalyzeRadarAlert(ctx.deps, { scope: ctx.scope, conversationId: conv.conversation.id, userId }),
    reanalyzeRadarAlert(ctx.deps, { scope: ctx.scope, conversationId: conv.conversation.id, userId }),
  ]);
  assert.deepEqual(outcomes.map((entry) => entry.outcome).sort(), ["completed", "cooldown", "cooldown"]);
  assert.equal(ctx.provider.calls, 1, "cliques duplicados nunca viram duas chamadas");
  assert.equal(await ctx.creditsConsumed(), 1);
  assert.equal((await ctx.ledger()).length, 1);
});

test("G2) a mesma chave idempotente nunca debita duas vezes, mesmo se o provider rodar de novo", async () => {
  const ctx = await makeSetup("g2", { credits: 5 });
  const input = { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, conversationId: "conv-x", idempotencyKey: `radar-ai:conv-x:msg:${ctx.tenantId}`, score: 70, level: "high", reasons: ["Ameaça de cancelamento"], waitingMinutes: 0, transferCount: 0, reopenCount: 0, recentMessages: [] };
  assert.equal((await ctx.deps.aiAnalyst.analyze(input)).ok, true);
  assert.equal((await ctx.deps.aiAnalyst.analyze(input)).ok, true);
  assert.equal(ctx.provider.calls, 2);
  assert.equal(await ctx.creditsConsumed(), 1, "reprocessar o mesmo diagnóstico não cobra de novo");
  assert.equal((await ctx.ledger()).length, 1);
});

test("H) cooldown → não executa outra análise nem consome novo crédito", async () => {
  const ctx = await makeSetup("h", { credits: 5 });
  const conv = await ctx.newConversation();
  await ctx.inbound(conv, "Quero cancelar");
  assert.equal(ctx.provider.calls, 1);

  ctx.clock.advanceMinutes(10);
  const during = await ctx.inbound(conv, "Vou no procon agora mesmo");
  assert.equal(during.result.aiOutcome, "cooldown");
  assert.equal(ctx.provider.calls, 1);
  assert.equal(await ctx.creditsConsumed(), 1);
  const stale = (await listRadarAlerts(ctx.deps, { scope: ctx.scope }))[0];
  assert.equal(stale.aiDisplayStatus, "COOLDOWN");
  assert.equal(stale.aiStale, true);

  // "Analisar agora" também respeita o cooldown.
  const manual = await reanalyzeRadarAlert(ctx.deps, { scope: ctx.scope, conversationId: conv.conversation.id, userId: "user-qualquer" });
  assert.equal(manual.outcome, "cooldown");
  assert.equal(ctx.provider.calls, 1);

  // Passados os 30 minutos, o próximo gatilho analisa de novo.
  ctx.clock.advanceMinutes(21);
  const after = await ctx.inbound(conv, "Chama o gerente");
  assert.equal(after.result.aiOutcome, "completed");
  assert.equal(ctx.provider.calls, 2);
  assert.equal(await ctx.creditsConsumed(), 2);
});

test("I/J) abrir a tela, listar, filtrar e ver o diagnóstico anterior → nunca consomem crédito", async () => {
  const ctx = await makeSetup("ij", { credits: 5 });
  const conv = await ctx.newConversation();
  await ctx.inbound(conv, "Quero cancelar");
  const callsBefore = ctx.provider.calls;
  const consumedBefore = await ctx.creditsConsumed();
  const logsBefore = (await ctx.logs(conv)).length;

  for (let round = 0; round < 5; round += 1) {
    await listRadarAlerts(ctx.deps, { scope: ctx.scope });
    await listRadarAlerts(ctx.deps, { scope: ctx.scope, filter: { level: "medium", minScore: 10 } });
    await listRadarAlerts(ctx.deps, { scope: ctx.scope, filter: { dismissed: true } });
    await getRadarStats(ctx.deps, { scope: ctx.scope });
    await getRadarCredits(ctx.deps, { tenantId: ctx.tenantId });
    await listRadarKeywords(ctx.deps, { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id });
    const detail = await getRadarAlertDetail(ctx.deps, { scope: ctx.scope, conversationId: conv.conversation.id });
    assert.ok(detail.alert.aiAnalysis, "o diagnóstico anterior é exibido a partir do banco");
  }

  assert.equal(ctx.provider.calls, callsBefore);
  assert.equal(await ctx.creditsConsumed(), consumedBefore);
  assert.equal((await ctx.logs(conv)).length, logsBefore);
  assert.equal((await ctx.ledger()).length, 1);
});

test("K) eventos de tempo real → nunca consomem crédito e só carregam ids", async () => {
  const ctx = await makeSetup("k", { credits: 5 });
  await updateRadarSettings(ctx.deps, { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, patch: { aiAnalysisEnabled: false } });
  const conv = await ctx.newConversation();
  await ctx.inbound(conv, "isso é um absurdo");
  await ctx.inbound(conv, "ninguém responde");
  await ctx.agentReply(conv);

  assert.ok(ctx.events.length >= 2);
  for (const event of ctx.events) {
    assert.deepEqual(Object.keys(event).sort(), ["conversationId", "tenantId", "type", "workspaceId"], "evento só com ids — a UI revalida pelo REST escopado");
    assert.equal(event.type, "radar.alert.update");
  }
  assert.equal(ctx.provider.calls, 0);
  assert.equal(await ctx.creditsConsumed(), 0);
});

test("L) recarga de créditos → a próxima oportunidade analisa, sem limpar score nem recriar alerta", async () => {
  const ctx = await makeSetup("l", { credits: 0 });
  const conv = await ctx.newConversation();
  await ctx.inbound(conv, "Quero cancelar");
  const blocked = await ctx.risk(conv);
  assert.equal(blocked.aiStatus, "BLOCKED_NO_CREDITS");
  assert.equal(ctx.provider.calls, 0);

  // Sem crédito, mensagens seguintes não inundam a auditoria com bloqueios repetidos.
  await ctx.inbound(conv, "oi?");
  assert.equal((await ctx.logs(conv)).filter((entry) => entry.status === "blocked_no_credits").length, 1);

  // Top-up de créditos avulsos pelo fluxo central de billing.
  await ctx.billingRepo.applyCreditDelta({ id: `topup-${ctx.tenantId}`, tenantId: ctx.tenantId, deltaCredits: 3, reason: "manual_adjustment", now: new Date().toISOString() });
  assert.equal((await getRadarCredits(ctx.deps, { tenantId: ctx.tenantId })).available, true);

  // Uma mensagem neutra já é a "próxima oportunidade válida".
  const { result } = await ctx.inbound(conv, "tem alguém aí?");
  assert.equal(result.aiOutcome, "completed");
  assert.equal(ctx.provider.calls, 1);
  const after = await ctx.risk(conv);
  assert.equal(after.id, blocked.id, "o mesmo alerta, nunca recriado");
  assert.equal(after.aiStatus, "ANALYZED");
  assert.equal(after.aiBlockedReason, undefined);
  assert.ok(after.aiAnalysis);
  assert.equal(ctx.metrics.counts.aiResumed, 1, "métrica de recarga convertida");
  assert.equal(await ctx.creditsConsumed(), 1);
});

test("L2) recarga + 'Analisar agora' → executa na hora, com RBAC e sem depender de nova mensagem", async () => {
  const ctx = await makeSetup("l2", { credits: 0 });
  const conv = await ctx.newConversation();
  await ctx.inbound(conv, "Quero cancelar");
  const userId = await ctx.createUser("atendente");

  const noCredits = await reanalyzeRadarAlert(ctx.deps, { scope: ctx.scope, conversationId: conv.conversation.id, userId });
  assert.equal(noCredits.outcome, "blocked_no_credits");
  assert.equal(ctx.provider.calls, 0);

  await ctx.setCredits(2);
  const withCredits = await reanalyzeRadarAlert(ctx.deps, { scope: ctx.scope, conversationId: conv.conversation.id, userId });
  assert.equal(withCredits.outcome, "completed");
  assert.equal(withCredits.alert.aiDisplayStatus, "ANALYZED");
  assert.equal(ctx.provider.calls, 1);
  assert.equal(await ctx.creditsConsumed(), 1);
  const manualLog = (await ctx.logs(conv)).find((entry) => entry.status === "completed");
  assert.equal(manualLog.triggerSource, "manual");
  assert.equal(manualLog.requestedByUserId, userId);

  // Fora do escopo do usuário: "not found", e nenhuma análise roda.
  const foreignScope = { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, teamIds: [], agentId: "outro-agente" };
  await assert.rejects(() => reanalyzeRadarAlert(ctx.deps, { scope: foreignScope, conversationId: conv.conversation.id, userId: "outro-agente" }), /RADAR_ALERT_NOT_FOUND/);
  assert.equal(ctx.provider.calls, 1);
});

// ================================================================================================
// Radar — persistência, áudio, flags, grupos, RBAC, dismiss
// ================================================================================================

test("SEM_KEYWORD: conversa comum com espera longa nunca vira alerta nem gasta crédito", async () => {
  const ctx = await makeSetup("nokw", { credits: 5 });
  const conv = await ctx.newConversation();
  await db.pool.query(`update inbox_messages set created_at = now() - interval '90 minutes' where conversation_id = $1`, [conv.conversation.id]);
  const { result } = await ctx.inbound(conv, "boa tarde, podem me ajudar com meu cadastro?");
  assert.equal(result.evaluated, true);
  assert.equal(result.risk, undefined, "nenhuma linha de risco é criada");
  assert.equal(await ctx.risk(conv), undefined);
  assert.equal((await listRadarAlerts(ctx.deps, { scope: ctx.scope })).length, 0);
  assert.equal(ctx.provider.calls, 0);
});

test("PERSISTENCIA: espera real, SLA, reabertura e transferências entram no score depois da keyword", async () => {
  const ctx = await makeSetup("persist", { credits: 0 });
  const conv = await ctx.newConversation();
  await db.pool.query(`update inbox_messages set created_at = now() - interval '70 minutes' where conversation_id = $1`, [conv.conversation.id]);
  for (const [index, type] of ["transferred", "transferred", "status_changed"].entries()) {
    await db.pool.query(
      `insert into inbox_conversation_events (id, tenant_id, workspace_id, conversation_id, type, performed_by, from_status, to_status)
       values ($1, $2, $3, $4, $5, 'user-1', $6, $7)`,
      [`evt-${ctx.tenantId}-${index}`, ctx.tenantId, ctx.workspace.id, conv.conversation.id, type, type === "status_changed" ? "resolved" : null, type === "status_changed" ? "open" : null],
    );
  }

  const { result } = await ctx.inbound(conv, "vou rescindir");
  const risk = result.risk;
  assert.equal(risk.hasKeywordTrigger, true);
  assert.equal(risk.hasCancellation, true);
  assert.ok(risk.waitingMinutes >= 69 && risk.waitingMinutes <= 71);
  assert.equal(risk.transferCount, 2);
  assert.equal(risk.reopenCount, 1);
  assert.equal(risk.inboundCount, 2);
  assert.equal(risk.signals.slaBreached, true);
  // 35 (cancelamento) + 25 (espera) + 20 (SLA) + 10 (2 transferências) + 15 (reaberta) + 10 (2 sem resposta)
  assert.equal(risk.score, 100);
  assert.equal(risk.level, "critical");
  assert.ok(risk.conversationContext.includes("vou rescindir"));

  const [alert] = await listRadarAlerts(ctx.deps, { scope: ctx.scope });
  assert.ok(alert.liveWaitingMinutes >= 69);
  const stats = await getRadarStats(ctx.deps, { scope: ctx.scope });
  assert.equal(stats.critical, 1);
  assert.equal(stats.slaBreached, 1);
  assert.equal(stats.withCancellation, 1);

  // O atendimento responde: a espera zera na leitura ao vivo e o score decai.
  const reply = await ctx.agentReply(conv);
  assert.equal(reply.risk.score, 95);
  assert.equal((await listRadarAlerts(ctx.deps, { scope: ctx.scope }))[0].liveWaitingMinutes, 0);
});

test("AUDIO: roda sem texto na chegada, reprocessa com a transcrição e nunca cobra duas vezes pelo mesmo áudio", async () => {
  const ctx = await makeSetup("audio", { credits: 5 });
  const conv = await ctx.newConversation();
  const arrival = await ctx.inbound(conv, undefined, { type: "audio" });
  assert.equal(arrival.result.evaluated, true);
  assert.equal(await ctx.risk(conv), undefined, "áudio sem texto não dispara nada");
  assert.equal(ctx.provider.calls, 0);

  const reprocess = { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, conversationId: conv.conversation.id, messageId: arrival.message.id, transcriptionText: "olha, eu quero cancelar esse serviço" };
  const first = await reprocessRadarWithTranscription(ctx.deps, reprocess);
  assert.equal(first.aiOutcome, "completed");
  assert.equal(first.risk.hasCancellation, true);
  assert.equal(ctx.provider.calls, 1);
  assert.equal((await ctx.logs(conv))[0].triggerId, `msg:${arrival.message.id}`, "o gatilho é a própria mensagem de áudio");

  // A mesma transcrição chegando de novo (retry do pipeline) é um no-op.
  const scoreBefore = (await ctx.risk(conv)).score;
  const second = await reprocessRadarWithTranscription(ctx.deps, reprocess);
  assert.equal(second.skippedReason, "already_evaluated");
  assert.equal((await ctx.risk(conv)).score, scoreBefore);
  assert.equal(ctx.provider.calls, 1);
  assert.equal(await ctx.creditsConsumed(), 1);
});

test("GRUPOS: conversa de grupo (@g.us) nunca gera score", async () => {
  const ctx = await makeSetup("group", { credits: 5 });
  const group = await ctx.newConversation({ group: true });
  const { result } = await ctx.inbound(group, "quero cancelar e vou no procon");
  assert.equal(result.evaluated, false);
  assert.equal(result.skippedReason, "group_chat");
  assert.equal(await ctx.risk(group), undefined);
  assert.equal(ctx.provider.calls, 0);
});

test("FEATURE_FLAG: Radar desligado no workspace ou na equipe não processa nada", async () => {
  const ctx = await makeSetup("flag", { credits: 5 });
  const team = await new PostgresTeamRepository(db.pool).create({ tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, name: "Suporte" });

  const byTeam = await ctx.newConversation();
  await db.pool.query(`update inbox_conversations set current_team_id = $2 where id = $1`, [byTeam.conversation.id, team.id]);
  await setRadarTeamEnabled(ctx.deps, { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, teamId: team.id, enabled: false });
  assert.equal((await ctx.inbound(byTeam, "quero cancelar")).result.skippedReason, "radar_disabled");
  assert.equal(await ctx.risk(byTeam), undefined);

  await setRadarTeamEnabled(ctx.deps, { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, teamId: team.id, enabled: true });
  assert.equal((await ctx.inbound(byTeam, "quero cancelar")).result.evaluated, true);

  await updateRadarSettings(ctx.deps, { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, patch: { radarEnabled: false } });
  const other = await ctx.newConversation();
  assert.equal((await ctx.inbound(other, "vou no procon")).result.skippedReason, "radar_disabled");

  await assert.rejects(() => setRadarTeamEnabled(ctx.deps, { tenantId: "outro-tenant", workspaceId: ctx.workspace.id, teamId: team.id, enabled: false }), /RADAR_TEAM_NOT_FOUND/);
  await assert.rejects(() => updateRadarSettings(ctx.deps, { tenantId: "outro-tenant", workspaceId: ctx.workspace.id, patch: { radarEnabled: true } }), /RADAR_WORKSPACE_NOT_FOUND/);
});

test("KEYWORDS_PERSISTIDAS: keyword própria do workspace dispara; default desabilitado deixa de disparar", async () => {
  const ctx = await makeSetup("kw", { credits: 0 });
  await upsertRadarKeyword(ctx.deps, { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, keyword: "Voltar pro sistema antigo", category: "cancellation" });
  await upsertRadarKeyword(ctx.deps, { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, keyword: "urgente", category: "complaint", enabled: false });

  const custom = await ctx.newConversation();
  const hit = await ctx.inbound(custom, "acho que vou voltar pro sistema antigo");
  assert.equal(hit.result.risk.hasCancellation, true);

  const disabled = await ctx.newConversation();
  assert.equal((await ctx.inbound(disabled, "é urgente")).result.risk, undefined);

  const view = await listRadarKeywords(ctx.deps, { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id });
  assert.equal(view.overrides.length, 2);
  assert.ok(view.effective.some((keyword) => keyword.keyword === "voltar pro sistema antigo"));
  assert.ok(!view.effective.some((keyword) => keyword.keyword === "urgente"));
  assert.ok(view.defaults.some((keyword) => keyword.keyword === "urgente"));

  await assert.rejects(() => upsertRadarKeyword(ctx.deps, { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, keyword: "x", category: "legal" }), /RADAR_INVALID_KEYWORD/);
  await assert.rejects(() => upsertRadarKeyword(ctx.deps, { tenantId: "outro-tenant", workspaceId: ctx.workspace.id, keyword: "intruso", category: "legal" }), /RADAR_WORKSPACE_NOT_FOUND/);
});

test("RBAC: escopo do Radar = escopo da Inbox (Administrador tudo, Gerente as equipes que gerencia, Atendente as próprias)", async () => {
  const ctx = await makeSetup("rbac", { credits: 0 });
  const teamRepo = new PostgresTeamRepository(db.pool);
  const membershipRepo = new PostgresTeamMembershipRepository(db.pool);
  const teamA = await teamRepo.create({ tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, name: "Equipe A" });
  const teamB = await teamRepo.create({ tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, name: "Equipe B" });
  await membershipRepo.add({ teamId: teamA.id, userId: "gestora", role: "admin" });
  await membershipRepo.add({ teamId: teamB.id, userId: "gestora", role: "editor" });
  await membershipRepo.add({ teamId: teamA.id, userId: "agente", role: "editor" });

  const inA = await ctx.newConversation();
  const inB = await ctx.newConversation();
  const unassigned = await ctx.newConversation();
  await db.pool.query(`update inbox_conversations set current_team_id = $2, assigned_user_id = 'agente' where id = $1`, [inA.conversation.id, teamA.id]);
  await db.pool.query(`update inbox_conversations set current_team_id = $2, assigned_user_id = 'outra-pessoa' where id = $1`, [inB.conversation.id, teamB.id]);
  for (const conv of [inA, inB, unassigned]) await ctx.inbound(conv, "quero cancelar");

  const scopeFor = async (userId, role) => {
    const context = await resolveAccessContext({ teamMembershipRepository: membershipRepo }, { tenantId: ctx.tenantId, userId, role });
    const level = accessScopeFor(context, "inbox");
    return resolveRadarScope({ tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, userId, level, teamIds: level === "team" ? readableTeamIds(context) : [] });
  };
  const idsFor = async (scope) => (await listRadarAlerts(ctx.deps, { scope })).map((alert) => alert.conversationId).sort();

  const all = [inA, inB, unassigned].map((conv) => conv.conversation.id).sort();
  assert.deepEqual(await idsFor(await scopeFor("dona", "owner")), all);
  assert.deepEqual(await idsFor(await scopeFor("gerente-sem-equipe", "admin")), [], "Gerente não vê a conta inteira: só as equipes que gerencia");
  assert.deepEqual(await idsFor(await scopeFor("gestora", "admin")), [inA.conversation.id], "só a equipe em que é gestora (A), não a que é só membro (B)");
  assert.deepEqual(await idsFor(await scopeFor("agente", "editor")), [inA.conversation.id], "só a conversa atribuída a ele");
  assert.deepEqual(await idsFor(await scopeFor("visualizador", "viewer")), all, "Visualizador legado tem inbox:view_all, como na Inbox");

  // Stats e detalhe respeitam o mesmo escopo.
  assert.equal((await getRadarStats(ctx.deps, { scope: await scopeFor("gestora", "admin") })).totalActive, 1);
  const agentScope = await scopeFor("agente", "editor");
  await assert.rejects(() => getRadarAlertDetail(ctx.deps, { scope: agentScope, conversationId: inB.conversation.id }), /RADAR_ALERT_NOT_FOUND/);

  // Transferida para outro agente, sai do escopo do anterior (escopo usa a atribuição ao vivo).
  await db.pool.query(`update inbox_conversations set assigned_user_id = 'outra-pessoa', current_team_id = $2 where id = $1`, [inA.conversation.id, teamB.id]);
  assert.deepEqual(await idsFor(await scopeFor("agente", "editor")), []);

  // Outro tenant/workspace nunca enxerga nada.
  assert.deepEqual(await idsFor({ tenantId: "outro-tenant", workspaceId: ctx.workspace.id }), []);
  assert.deepEqual(await idsFor({ tenantId: ctx.tenantId, workspaceId: "outro-workspace" }), []);
});

test("DISMISS_REACTIVATE: arquivar tira da lista, reativar devolve, e um score maior reativa sozinho", async () => {
  const ctx = await makeSetup("dismiss", { credits: 0 });
  const conv = await ctx.newConversation();
  await ctx.inbound(conv, "que absurdo");
  const id = conv.conversation.id;

  const dismissed = await dismissRadarAlert(ctx.deps, { scope: ctx.scope, conversationId: id, userId: "gestora", note: "  Já tratado por telefone  " });
  assert.equal(dismissed.isDismissed, true);
  assert.equal(dismissed.dismissedBy, "gestora");
  assert.equal(dismissed.dismissedNote, "Já tratado por telefone");
  assert.equal((await listRadarAlerts(ctx.deps, { scope: ctx.scope })).length, 0);
  assert.equal((await listRadarAlerts(ctx.deps, { scope: ctx.scope, filter: { dismissed: true } })).length, 1);

  const reactivated = await reactivateRadarAlert(ctx.deps, { scope: ctx.scope, conversationId: id, userId: "gestora" });
  assert.equal(reactivated.isDismissed, false);
  assert.equal(reactivated.dismissedNote, undefined);
  assert.equal((await listRadarAlerts(ctx.deps, { scope: ctx.scope })).length, 1);

  await dismissRadarAlert(ctx.deps, { scope: ctx.scope, conversationId: id, userId: "gestora" });
  await ctx.inbound(conv, "vou rescindir o contrato");
  assert.equal((await ctx.risk(conv)).isDismissed, false, "score maior reativa um alerta arquivado");

  const { dismissalLog } = await getRadarAlertDetail(ctx.deps, { scope: ctx.scope, conversationId: id });
  assert.deepEqual(dismissalLog.map((entry) => entry.action).sort(), ["dismissed", "dismissed", "reactivated"]);

  const foreignScope = { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, teamIds: [], agentId: "outro-agente" };
  await assert.rejects(() => dismissRadarAlert(ctx.deps, { scope: foreignScope, conversationId: id, userId: "outro-agente" }), /RADAR_ALERT_NOT_FOUND/);
});

test("SEM_CAMADA_2: sem analyst/gate configurados o Radar heurístico funciona e nada é cobrado", async () => {
  const ctx = await makeSetup("nolayer2", { credits: 5 });
  const heuristicOnly = { radarRepository: ctx.radarRepository, now: ctx.clock.now };
  const conv = await ctx.newConversation();
  const registered = await ctx.inbound(conv, "quero cancelar", { evaluate: false });
  const result = await evaluateRadarForMessage(heuristicOnly, { tenantId: ctx.tenantId, workspaceId: ctx.workspace.id, conversationId: conv.conversation.id, messageId: registered.message.id, direction: "inbound", text: "quero cancelar" });
  assert.equal(result.aiOutcome, "disabled");
  assert.equal(result.risk.aiStatus, "NEVER_ANALYZED");
  assert.ok(result.risk.score >= 35);
  assert.deepEqual(await getRadarCredits(heuristicOnly, { tenantId: ctx.tenantId }), { aiConfigured: false, available: false });
  assert.equal(ctx.provider.calls, 0);
});
