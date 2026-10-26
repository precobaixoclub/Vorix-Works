import type { ScopeLevel } from "../identity/access-control-use-cases.js";
import {
  deriveRadarAiDisplayStatus,
  isRadarAiAnalysisStale,
  isRadarGroupChat,
  RADAR_AI_PENDING_LEASE_MS,
  RADAR_KEYWORD_CATEGORIES,
  type ConversationRiskScore,
  type RadarAiBlockedReason,
  type RadarAiStatus,
  type RadarKeywordCategory,
  type RadarSettings,
} from "../../domain/radar/radar.model.js";
import { DEFAULT_RADAR_KEYWORDS, normalizeRadarKeyword, resolveRadarKeywords, type RadarKeyword, type RadarKeywordOverride } from "../../domain/radar/radar-keywords.js";
import { evaluateRadarRisk } from "../../domain/radar/risk-score.js";
import type { RadarAiAnalystPort, RadarCreditGatePort, RadarCreditStatus, RadarMetricsRecorder, RadarRealtimePublisherPort } from "../ports/radar-ai.port.js";
import type { RadarAiAnalysisLog, RadarDismissalLogEntry, RadarListFilter, RadarListItem, RadarRepositoryPort, RadarScope, RadarStats } from "../ports/radar-repository.port.js";

/**
 * Casos de uso do Radar de Sentimento (réplica adaptada do CMDesk, pedido explícito do usuário),
 * com controle comercial por créditos de IA.
 *
 * PRINCÍPIO DE CUSTO — duas camadas que nunca se misturam:
 *   Camada 1 (`evaluateRadarForMessage`): keywords, classificador léxico, sinais operacionais,
 *     score e nível. Roda por mensagem e NUNCA consulta nem consome crédito.
 *   Camada 2 (`requestRadarAiAnalysis`): diagnóstico profundo por LLM. É o ÚNICO ponto que gasta
 *     crédito, sempre pelo serviço central de créditos (via `RadarCreditGatePort` para o saldo e
 *     via gateway de IA para o débito) — nunca uma carteira própria do Radar.
 *
 * Sem crédito a Camada 1 segue normal (uma conversa pode ir de LOW a CRITICAL); só o NOVO
 * diagnóstico de IA fica suspenso, e o último diagnóstico é preservado.
 *
 * Erros são `Error` com prefixo `RADAR_*`, traduzidos para HTTP em `radar.route.ts`. Recurso fora
 * do escopo do usuário responde "not found", nunca "forbidden".
 */
export type RadarUseCaseDeps = {
  radarRepository: RadarRepositoryPort;
  /** `undefined` = Camada 2 não configurada neste processo; o Radar heurístico funciona igual. */
  aiAnalyst?: RadarAiAnalystPort;
  /** Sem gate de crédito a Camada 2 NUNCA roda — análise profunda sempre consome crédito. */
  creditGate?: RadarCreditGatePort;
  realtimePublisher?: RadarRealtimePublisherPort;
  metrics?: RadarMetricsRecorder;
  now?: () => Date;
};

/** Backoff depois de falha de provider/sistema — evita martelar um provider fora do ar a cada
 * mensagem, sem prender a conversa pelo cooldown inteiro (nenhum crédito foi gasto). */
const AI_FAILURE_BACKOFF_MS = 5 * 60_000;
const AI_CONTEXT_MESSAGE_LIMIT = 12;
const AI_CONTEXT_MESSAGE_MAX_CHARS = 600;

function currentDate(deps: RadarUseCaseDeps): Date {
  return deps.now ? deps.now() : new Date();
}

export type RadarAiOutcome = "completed" | "blocked_no_credits" | "failed_provider" | "cooldown" | "disabled";

export type RadarAlertView = RadarListItem & {
  /** Estado da Camada 2 para exibição (inclui `COOLDOWN`, que nunca é persistido). */
  aiDisplayStatus: RadarAiStatus;
  /** Há diagnóstico, mas a conversa mudou depois dele. */
  aiStale: boolean;
};

function toAlertView(item: RadarListItem, now: Date): RadarAlertView {
  return { ...item, aiDisplayStatus: deriveRadarAiDisplayStatus(item, now), aiStale: isRadarAiAnalysisStale(item) };
}

// ---------------------------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------------------------

/**
 * Escopo de leitura do Radar = o MESMO escopo de conversas da Inbox (`scopeFor(context, "inbox")`,
 * 0173), nunca o nome do perfil:
 *   - `all` (`inbox:view_all`): tudo do workspace;
 *   - `team` (`inbox:view_team`): as equipes legíveis (`readableTeamIds`), mais as conversas
 *     atribuídas à pessoa;
 *   - `own`: só as conversas atribuídas à pessoa.
 */
export function resolveRadarScope(input: {
  tenantId: string;
  workspaceId: string;
  userId: string;
  level: ScopeLevel;
  teamIds: readonly string[];
}): RadarScope {
  if (input.level === "all") return { tenantId: input.tenantId, workspaceId: input.workspaceId };
  return { tenantId: input.tenantId, workspaceId: input.workspaceId, teamIds: input.level === "team" ? [...input.teamIds] : [], agentId: input.userId };
}

// ---------------------------------------------------------------------------------------------
// Camada 1 — heurística gratuita
// ---------------------------------------------------------------------------------------------

export type EvaluateRadarForMessageInput = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  direction: "inbound" | "outbound";
  /** Corpo/legenda da mensagem. Áudio recém-chegado vem sem texto — o Radar roda assim mesmo. */
  text?: string;
  /** Preenchido quando esta chamada é o REPROCESSAMENTO de um áudio já avaliado na chegada, agora
   * com a transcrição disponível. Só a transcrição é avaliada (a legenda já foi). */
  transcriptionText?: string;
};

export type EvaluateRadarForMessageResult = {
  evaluated: boolean;
  skippedReason?: "conversation_not_found" | "group_chat" | "radar_disabled" | "no_active_alert" | "already_evaluated";
  risk?: ConversationRiskScore;
  aiOutcome?: RadarAiOutcome;
};

function waitingMinutesSince(oldestUnansweredInboundAt: string | undefined, now: Date): number {
  if (!oldestUnansweredInboundAt) return 0;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(oldestUnansweredInboundAt)) / 60_000));
}

const AI_STATUSES_WITHOUT_CURRENT_DIAGNOSIS: readonly RadarAiStatus[] = ["NEVER_ANALYZED", "BLOCKED_NO_CREDITS", "FAILED_PROVIDER"];

/**
 * Ponto de entrada do Radar — chamado para cada mensagem persistida da Inbox e de novo quando a
 * transcrição de um áudio fica disponível. Nunca consome crédito por si só; só dispara a Camada 2
 * quando há gatilho suficiente.
 */
export async function evaluateRadarForMessage(deps: RadarUseCaseDeps, input: EvaluateRadarForMessageInput): Promise<EvaluateRadarForMessageResult> {
  const snapshot = await deps.radarRepository.loadConversationSnapshot(input.conversationId);
  if (!snapshot || snapshot.tenantId !== input.tenantId || snapshot.workspaceId !== input.workspaceId) return { evaluated: false, skippedReason: "conversation_not_found" };
  if (isRadarGroupChat(snapshot)) return { evaluated: false, skippedReason: "group_chat" };

  const settings = await deps.radarRepository.getSettings(input.workspaceId);
  if (!settings.radarEnabled || !snapshot.teamRadarEnabled) return { evaluated: false, skippedReason: "radar_disabled" };

  const previous = await deps.radarRepository.getByConversationId(input.conversationId);
  // Resposta do atendimento só interessa a conversas que já têm alerta (zera sinais de espera e
  // aplica decaimento) — nunca cria um alerta.
  if (input.direction === "outbound" && !previous?.hasKeywordTrigger) return { evaluated: false, skippedReason: "no_active_alert" };

  const isTranscriptionReprocess = input.transcriptionText !== undefined;
  const evaluationKey = isTranscriptionReprocess ? `${input.messageId}#transcribed` : input.messageId;
  if (previous?.lastEvaluatedMessageId === evaluationKey) return { evaluated: false, skippedReason: "already_evaluated", risk: previous };

  const overrides = await deps.radarRepository.listKeywordOverrides({ tenantId: input.tenantId, workspaceId: input.workspaceId });
  const now = currentDate(deps);
  const result = evaluateRadarRisk(
    {
      direction: input.direction,
      text: isTranscriptionReprocess ? undefined : input.text,
      transcriptionText: input.transcriptionText,
      keywords: resolveRadarKeywords(overrides, snapshot.teamId),
      waitingMinutes: waitingMinutesSince(snapshot.oldestUnansweredInboundAt, now),
      slaMinutes: settings.slaMinutes,
      transferCount: snapshot.transferCount,
      reopenCount: snapshot.reopenCount,
      unansweredInboundCount: snapshot.unansweredInboundCount,
    },
    previous ? { score: previous.score, hasKeywordTrigger: previous.hasKeywordTrigger, signals: previous.signals } : undefined,
  );
  deps.metrics?.incHeuristicEvaluation();

  // Conversa comum, sem keyword crítica e sem alerta anterior: nada a persistir.
  if (!previous && !result.signals.hasKeywordTrigger) return { evaluated: true };

  const risk = await deps.radarRepository.saveEvaluation({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    teamId: snapshot.teamId,
    agentId: snapshot.agentId,
    contactId: snapshot.contactId,
    score: result.score,
    level: result.level,
    reasons: result.reasons,
    signals: result.signals,
    waitingMinutes: result.signals.waitingMinutes,
    messageCount: snapshot.messageCount,
    inboundCount: snapshot.inboundCount,
    transferCount: snapshot.transferCount,
    reopenCount: snapshot.reopenCount,
    conversationContext: snapshot.recentInboundContext,
    lastEvaluatedMessageId: evaluationKey,
    scoreChanged: !previous || result.delta > 0,
    now: now.toISOString(),
  });

  if (risk.level !== previous?.level && (risk.level === "high" || risk.level === "critical")) deps.metrics?.incHighRiskConversation(risk.level);
  if (!previous || risk.score !== previous.score || risk.level !== "low") {
    deps.realtimePublisher?.publish({ type: "radar.alert.update", tenantId: input.tenantId, workspaceId: input.workspaceId, conversationId: input.conversationId });
  }

  if (input.direction !== "inbound") return { evaluated: true, risk };

  const thresholdReached = risk.score >= settings.aiTriggerThreshold;
  const hasStandingDirectCritical = risk.hasCancellation || risk.hasLegalThreat || risk.hasManagerRequest;
  const freshTrigger = result.delta > 0 && (thresholdReached || result.isDirectCritical);
  // Tentativa anterior bloqueada/falha (ou nunca analisada) com risco ainda de pé: esta mensagem
  // é a "próxima oportunidade válida" — é assim que a IA volta sozinha depois de uma recarga.
  const pendingDiagnosis = AI_STATUSES_WITHOUT_CURRENT_DIAGNOSIS.includes(risk.aiStatus) && (thresholdReached || hasStandingDirectCritical);
  if (!freshTrigger && !pendingDiagnosis) return { evaluated: true, risk };

  const aiOutcome = await requestRadarAiAnalysis(deps, {
    risk,
    settings,
    // O mesmo áudio (chegada + transcrição) compartilha o gatilho: nunca dois débitos por ele.
    triggerId: `msg:${input.messageId}`,
    source: "auto",
    triggerReason: result.isDirectCritical ? "direct_critical" : thresholdReached ? "score_threshold" : "pending_diagnosis",
  });
  return { evaluated: true, risk: (await deps.radarRepository.getByConversationId(input.conversationId)) ?? risk, aiOutcome };
}

/**
 * Reprocessa o Radar para um áudio cuja transcrição acabou de ficar disponível. Na chegada o áudio
 * já foi avaliado sem texto; aqui só a transcrição é avaliada. O gatilho de IA é o MESMO da
 * chegada (`msg:<messageId>`) e a reserva/cooldown por conversa continuam valendo, então o mesmo
 * áudio nunca gera dois débitos. Idempotente: reprocessar a mesma transcrição de novo é um no-op.
 */
export async function reprocessRadarWithTranscription(
  deps: RadarUseCaseDeps,
  input: { tenantId: string; workspaceId: string; conversationId: string; messageId: string; transcriptionText: string },
): Promise<EvaluateRadarForMessageResult> {
  return evaluateRadarForMessage(deps, { ...input, direction: "inbound" });
}

// ---------------------------------------------------------------------------------------------
// Camada 2 — diagnóstico profundo por IA (consome crédito)
// ---------------------------------------------------------------------------------------------

export type RequestRadarAiAnalysisInput = {
  risk: ConversationRiskScore;
  settings: RadarSettings;
  triggerId: string;
  source: "auto" | "manual";
  triggerReason?: string;
  requestedByUserId?: string;
};

export function buildRadarAiIdempotencyKey(conversationId: string, triggerId: string): string {
  return `radar-ai:${conversationId}:${triggerId}`;
}

/**
 * Fluxo de cobrança segura:
 *   1. feature habilitada (workspace + processo);
 *   2. RESERVA atômica do direito de analisar (CAS por conversa + cooldown) — duas execuções
 *      concorrentes nunca passam ambas daqui, então nunca há dois débitos;
 *   3. saldo consultado no serviço central — sem saldo: provider NÃO é chamado, nada é debitado,
 *      a reserva é liberada e o último diagnóstico é preservado;
 *   4. IA chamada com chave idempotente (`radar-ai:<conversationId>:<triggerId>`);
 *   5. sucesso: o gateway confirma o consumo no ledger central (idempotente pela chave);
 *   6. falha de provider/sistema: nada é debitado e a reserva é liberada.
 * Nunca lança por falha esperada — devolve o desfecho.
 */
export async function requestRadarAiAnalysis(deps: RadarUseCaseDeps, input: RequestRadarAiAnalysisInput): Promise<RadarAiOutcome> {
  const { risk, settings } = input;
  if (!settings.aiAnalysisEnabled || !deps.aiAnalyst || !deps.creditGate) return "disabled";

  const now = currentDate(deps);
  const nowIso = now.toISOString();
  const claimed = await deps.radarRepository.tryClaimAiAnalysis({
    conversationId: risk.conversationId,
    triggerId: input.triggerId,
    now: nowIso,
    stalePendingBefore: new Date(now.getTime() - RADAR_AI_PENDING_LEASE_MS).toISOString(),
    cooldownUntil: new Date(now.getTime() + settings.aiCooldownMinutes * 60_000).toISOString(),
  });
  // Em cooldown ou com outra análise em andamento: nenhuma chamada de IA, nenhum crédito.
  if (!claimed) return "cooldown";

  deps.metrics?.incAiRequested(input.source);
  const idempotencyKey = buildRadarAiIdempotencyKey(risk.conversationId, input.triggerId);
  const event = { tenantId: risk.tenantId, workspaceId: risk.workspaceId, conversationId: risk.conversationId };
  const logBase = {
    ...event,
    triggerId: input.triggerId,
    triggerSource: input.source,
    triggerReason: input.triggerReason,
    idempotencyKey,
    score: claimed.score,
    level: claimed.level,
    requestedByUserId: input.requestedByUserId,
  };

  const block = async (reason: RadarAiBlockedReason, credit: Pick<RadarCreditStatus, "creditsCost">): Promise<RadarAiOutcome> => {
    await deps.radarRepository.blockAiAnalysis({ conversationId: risk.conversationId, triggerId: input.triggerId, reason, now: nowIso });
    // Sem crédito, toda mensagem nova tentaria de novo: só a TRANSIÇÃO para bloqueado (ou um
    // pedido manual) vira registro/evento, para não inundar a auditoria nem a UI.
    if (risk.aiStatus !== "BLOCKED_NO_CREDITS" || input.source === "manual") {
      await deps.radarRepository.recordAiAnalysisLog({ ...logBase, status: "blocked_no_credits", creditsReserved: 0, creditsConsumed: 0, errorCategory: reason, now: nowIso });
      deps.metrics?.incAiBlockedNoCredits();
      deps.realtimePublisher?.publish({ type: "radar.ai.blocked", ...event });
    }
    return "blocked_no_credits";
  };

  const fail = async (category: string, creditsReserved: number): Promise<RadarAiOutcome> => {
    await deps.radarRepository.failAiAnalysis({
      conversationId: risk.conversationId,
      triggerId: input.triggerId,
      now: nowIso,
      retryAfter: new Date(now.getTime() + AI_FAILURE_BACKOFF_MS).toISOString(),
    });
    await deps.radarRepository.recordAiAnalysisLog({ ...logBase, status: "failed_provider", creditsReserved, creditsConsumed: 0, errorCategory: category, now: nowIso });
    deps.metrics?.incAiProviderFailure(category);
    deps.realtimePublisher?.publish({ type: "radar.alert.update", ...event });
    return "failed_provider";
  };

  let credit: RadarCreditStatus;
  try {
    credit = await deps.creditGate.check(risk.tenantId);
  } catch {
    // Sem conseguir consultar o saldo, nunca se chama o provider "no escuro".
    return fail("credit_check_failed", 0);
  }
  if (!credit.available) return block(credit.reason, credit);

  try {
    const recent = await deps.radarRepository.listRecentMessages(risk.conversationId, AI_CONTEXT_MESSAGE_LIMIT);
    const result = await deps.aiAnalyst.analyze({
      tenantId: risk.tenantId,
      workspaceId: risk.workspaceId,
      conversationId: risk.conversationId,
      idempotencyKey,
      score: claimed.score,
      level: claimed.level,
      reasons: claimed.reasons,
      waitingMinutes: claimed.waitingMinutes,
      transferCount: claimed.transferCount,
      reopenCount: claimed.reopenCount,
      recentMessages: [...recent].reverse().map((message) => ({ direction: message.direction, body: message.body.slice(0, AI_CONTEXT_MESSAGE_MAX_CHARS) })),
      requestedByUserId: input.requestedByUserId,
    });

    if (!result.ok) {
      // O saldo acabou entre a consulta e a chamada (o gateway confere de novo antes do provider).
      if (result.category === "quota_exceeded") return block("no_credits", credit);
      return fail(result.category, credit.creditsCost);
    }

    await deps.radarRepository.completeAiAnalysis({
      conversationId: risk.conversationId,
      triggerId: input.triggerId,
      analysis: result.analysis,
      analyzedAt: currentDate(deps).toISOString(),
      analyzedScore: claimed.score,
      creditTransactionId: idempotencyKey,
    });
    await deps.radarRepository.recordAiAnalysisLog({
      ...logBase,
      status: "completed",
      creditTransactionId: idempotencyKey,
      creditsReserved: credit.creditsCost,
      creditsConsumed: credit.creditsCost,
      provider: result.provider,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostUsd: result.usage.estimatedCost,
      now: nowIso,
    });
    deps.metrics?.incAiCompleted();
    deps.metrics?.addCreditsConsumed(credit.creditsCost);
    deps.metrics?.observeAiCostUsd(result.usage.estimatedCost);
    deps.metrics?.observeAiTokens(result.usage.inputTokens + result.usage.outputTokens);
    if (risk.aiStatus === "BLOCKED_NO_CREDITS") deps.metrics?.incAiResumedAfterTopUp();
    deps.realtimePublisher?.publish({ type: "radar.ai.updated", ...event });
    return "completed";
  } catch (error) {
    console.error("[radar] falha inesperada na análise profunda:", error instanceof Error ? error.message : error);
    return fail("internal_error", credit.creditsCost);
  }
}

// ---------------------------------------------------------------------------------------------
// Leitura (nunca consome crédito)
// ---------------------------------------------------------------------------------------------

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export async function listRadarAlerts(deps: RadarUseCaseDeps, input: { scope: RadarScope; filter?: RadarListFilter }): Promise<RadarAlertView[]> {
  const filter = input.filter ?? {};
  const items = await deps.radarRepository.list(input.scope, { ...filter, limit: Math.min(Math.max(filter.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT), offset: Math.max(filter.offset ?? 0, 0) });
  const now = currentDate(deps);
  return items.map((item) => toAlertView(item, now));
}

export async function getRadarStats(deps: RadarUseCaseDeps, input: { scope: RadarScope; filter?: Pick<RadarListFilter, "teamId" | "agentId"> }): Promise<RadarStats> {
  return deps.radarRepository.stats(input.scope, input.filter ?? {});
}

export type RadarAlertDetail = { alert: RadarAlertView; aiAnalysisLogs: RadarAiAnalysisLog[]; dismissalLog: RadarDismissalLogEntry[] };

async function mustGetAlertInScope(deps: RadarUseCaseDeps, scope: RadarScope, conversationId: string): Promise<RadarListItem> {
  const item = await deps.radarRepository.getDetail(scope, conversationId);
  if (!item) throw new Error(`RADAR_ALERT_NOT_FOUND: alerta da conversa "${conversationId}" não existe.`);
  return item;
}

export async function getRadarAlertDetail(deps: RadarUseCaseDeps, input: { scope: RadarScope; conversationId: string }): Promise<RadarAlertDetail> {
  const item = await mustGetAlertInScope(deps, input.scope, input.conversationId);
  const [aiAnalysisLogs, dismissalLog] = await Promise.all([
    deps.radarRepository.listAiAnalysisLogs({ tenantId: input.scope.tenantId, workspaceId: input.scope.workspaceId, conversationId: input.conversationId, limit: 20 }),
    deps.radarRepository.listDismissalLog({ tenantId: input.scope.tenantId, workspaceId: input.scope.workspaceId, conversationId: input.conversationId }),
  ]);
  return { alert: toAlertView(item, currentDate(deps)), aiAnalysisLogs, dismissalLog };
}

export type RadarCreditsView = {
  /** `false` = Camada 2 não configurada neste ambiente (nada a ver com saldo). */
  aiConfigured: boolean;
  available: boolean;
  remainingCredits?: number;
  creditsCost?: number;
  blockedReason?: RadarAiBlockedReason;
};

/** Saldo de créditos de IA para o banner/indicador da tela — só leitura, nunca debita. */
export async function getRadarCredits(deps: RadarUseCaseDeps, input: { tenantId: string }): Promise<RadarCreditsView> {
  if (!deps.creditGate || !deps.aiAnalyst) return { aiConfigured: false, available: false };
  const credit = await deps.creditGate.check(input.tenantId);
  return {
    aiConfigured: true,
    available: credit.available,
    remainingCredits: credit.remainingCredits,
    creditsCost: credit.creditsCost,
    blockedReason: credit.available ? undefined : credit.reason,
  };
}

// ---------------------------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------------------------

export async function dismissRadarAlert(deps: RadarUseCaseDeps, input: { scope: RadarScope; conversationId: string; userId: string; note?: string }): Promise<RadarAlertView> {
  await mustGetAlertInScope(deps, input.scope, input.conversationId);
  const now = currentDate(deps);
  await deps.radarRepository.dismiss({ tenantId: input.scope.tenantId, workspaceId: input.scope.workspaceId, conversationId: input.conversationId, userId: input.userId, note: input.note?.trim() || undefined, now: now.toISOString() });
  deps.realtimePublisher?.publish({ type: "radar.alert.update", tenantId: input.scope.tenantId, workspaceId: input.scope.workspaceId, conversationId: input.conversationId });
  return toAlertView(await mustGetAlertInScope(deps, input.scope, input.conversationId), now);
}

export async function reactivateRadarAlert(deps: RadarUseCaseDeps, input: { scope: RadarScope; conversationId: string; userId: string }): Promise<RadarAlertView> {
  await mustGetAlertInScope(deps, input.scope, input.conversationId);
  const now = currentDate(deps);
  await deps.radarRepository.reactivate({ tenantId: input.scope.tenantId, workspaceId: input.scope.workspaceId, conversationId: input.conversationId, userId: input.userId, now: now.toISOString() });
  deps.realtimePublisher?.publish({ type: "radar.alert.update", tenantId: input.scope.tenantId, workspaceId: input.scope.workspaceId, conversationId: input.conversationId });
  return toAlertView(await mustGetAlertInScope(deps, input.scope, input.conversationId), now);
}

/**
 * "Analisar agora" — mesma Camada 2 do gatilho automático, só que pedida por um usuário: confere
 * escopo, saldo e cooldown, e é serializada pela mesma reserva atômica (cliques duplicados nunca
 * viram duas análises nem dois débitos).
 */
export async function reanalyzeRadarAlert(deps: RadarUseCaseDeps, input: { scope: RadarScope; conversationId: string; userId: string }): Promise<{ outcome: RadarAiOutcome; alert: RadarAlertView }> {
  const item = await mustGetAlertInScope(deps, input.scope, input.conversationId);
  const settings = await deps.radarRepository.getSettings(input.scope.workspaceId);
  const now = currentDate(deps);
  const outcome = await requestRadarAiAnalysis(deps, {
    risk: item,
    settings,
    triggerId: `manual:${now.getTime()}`,
    source: "manual",
    triggerReason: "manual_reanalyze",
    requestedByUserId: input.userId,
  });
  return { outcome, alert: toAlertView(await mustGetAlertInScope(deps, input.scope, input.conversationId), currentDate(deps)) };
}

// ---------------------------------------------------------------------------------------------
// Configuração (feature flag + keywords)
// ---------------------------------------------------------------------------------------------

export type RadarSettingsView = { settings: RadarSettings; teams: { teamId: string; teamName: string; radarEnabled: boolean }[] };

export async function getRadarSettings(deps: RadarUseCaseDeps, input: { tenantId: string; workspaceId: string }): Promise<RadarSettingsView> {
  const [settings, teams] = await Promise.all([deps.radarRepository.getSettings(input.workspaceId), deps.radarRepository.listTeamFlags(input)]);
  return { settings, teams };
}

function assertIntegerInRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`RADAR_INVALID_SETTINGS: "${name}" deve ser um inteiro entre ${min} e ${max}.`);
}

export async function updateRadarSettings(deps: RadarUseCaseDeps, input: { tenantId: string; workspaceId: string; patch: Partial<RadarSettings> }): Promise<RadarSettings> {
  const { patch } = input;
  if (patch.aiTriggerThreshold !== undefined) assertIntegerInRange("aiTriggerThreshold", patch.aiTriggerThreshold, 1, 100);
  if (patch.aiCooldownMinutes !== undefined) assertIntegerInRange("aiCooldownMinutes", patch.aiCooldownMinutes, 1, 1440);
  if (patch.slaMinutes !== undefined) assertIntegerInRange("slaMinutes", patch.slaMinutes, 1, 10_080);
  return deps.radarRepository.upsertSettings(input);
}

export async function setRadarTeamEnabled(deps: RadarUseCaseDeps, input: { tenantId: string; workspaceId: string; teamId: string; enabled: boolean }): Promise<void> {
  const updated = await deps.radarRepository.setTeamRadarEnabled(input);
  if (!updated) throw new Error(`RADAR_TEAM_NOT_FOUND: equipe "${input.teamId}" não existe.`);
}

export type RadarKeywordsView = { defaults: readonly RadarKeyword[]; overrides: RadarKeywordOverride[]; effective: RadarKeyword[] };

export async function listRadarKeywords(deps: RadarUseCaseDeps, input: { tenantId: string; workspaceId: string; teamId?: string }): Promise<RadarKeywordsView> {
  const overrides = await deps.radarRepository.listKeywordOverrides({ tenantId: input.tenantId, workspaceId: input.workspaceId });
  return { defaults: DEFAULT_RADAR_KEYWORDS, overrides, effective: resolveRadarKeywords(overrides, input.teamId) };
}

/** Adiciona uma keyword, ou ajusta uma existente (inclusive uma padrão): categoria, peso,
 * habilitada/desabilitada. */
export async function upsertRadarKeyword(
  deps: RadarUseCaseDeps,
  input: { tenantId: string; workspaceId: string; teamId?: string; keyword: string; category: RadarKeywordCategory; weight?: number; enabled?: boolean },
): Promise<RadarKeywordOverride> {
  const keyword = normalizeRadarKeyword(input.keyword);
  if (keyword.length < 2 || keyword.length > 80) throw new Error("RADAR_INVALID_KEYWORD: a palavra-chave deve ter entre 2 e 80 caracteres.");
  if (!RADAR_KEYWORD_CATEGORIES.includes(input.category)) throw new Error(`RADAR_INVALID_KEYWORD: categoria "${input.category}" não existe.`);
  if (input.weight !== undefined) {
    if (!Number.isInteger(input.weight) || input.weight < 0 || input.weight > 100) throw new Error("RADAR_INVALID_KEYWORD: o peso deve ser um inteiro entre 0 e 100.");
  }
  return deps.radarRepository.upsertKeywordOverride({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    teamId: input.teamId,
    keyword,
    category: input.category,
    weight: input.weight,
    enabled: input.enabled ?? true,
  });
}

/** Remove um AJUSTE — a keyword volta ao comportamento padrão do sistema (se for uma padrão). */
export async function deleteRadarKeyword(deps: RadarUseCaseDeps, input: { tenantId: string; workspaceId: string; id: string }): Promise<void> {
  const deleted = await deps.radarRepository.deleteKeywordOverride(input);
  if (!deleted) throw new Error(`RADAR_KEYWORD_NOT_FOUND: ajuste de palavra-chave "${input.id}" não existe.`);
}
