/**
 * Domínio do Radar de Sentimento / Radar Operacional (réplica adaptada do CMDesk, pedido explícito
 * do usuário). Bounded context próprio, sem import de `src/domain/inbox` — o Radar só conhece ids
 * de conversa/contato/equipe como strings soltas, nunca as entidades da Inbox.
 *
 * Duas camadas com custo deliberadamente separado:
 *   - Camada 1 (gratuita): keywords + classificador léxico + sinais operacionais → score 0..100.
 *   - Camada 2 (créditos): diagnóstico profundo via LLM, só com gatilho suficiente.
 * O score é SEMPRE da Camada 1 — nunca se gasta crédito só para calcular score.
 */

export const RADAR_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RadarRiskLevel = (typeof RADAR_RISK_LEVELS)[number];

/** 0–24 LOW · 25–49 MEDIUM · 50–74 HIGH · 75–100 CRITICAL. */
export function scoreToRiskLevel(score: number): RadarRiskLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export const RADAR_KEYWORD_CATEGORIES = ["cancellation", "legal", "manager", "complaint"] as const;
export type RadarKeywordCategory = (typeof RADAR_KEYWORD_CATEGORIES)[number];

/** Peso padrão de cada categoria no score — uma keyword pode sobrescrever o seu (ver
 * `RadarKeywordOverride.weight`). */
export const RADAR_CATEGORY_WEIGHTS: Record<RadarKeywordCategory, number> = {
  cancellation: 35,
  legal: 35,
  manager: 25,
  complaint: 20,
};

/** Categorias que disparam a análise profunda diretamente, sem esperar o limiar de score. */
export const RADAR_DIRECT_CRITICAL_CATEGORIES: readonly RadarKeywordCategory[] = ["cancellation", "legal", "manager"];

/**
 * Estado persistido da Camada 2 para uma conversa — nunca inferido pela ausência de `aiAnalysis`.
 * `COOLDOWN` nunca é gravado (gravá-lo apagaria a informação de que já existe um diagnóstico);
 * é um estado DERIVADO para a UI, ver `deriveRadarAiDisplayStatus`.
 */
export const RADAR_AI_STATUSES = ["NEVER_ANALYZED", "ANALYZED", "PENDING", "BLOCKED_NO_CREDITS", "FAILED_PROVIDER", "COOLDOWN"] as const;
export type RadarAiStatus = (typeof RADAR_AI_STATUSES)[number];

/** Uma análise `PENDING` mais velha que isto é considerada abandonada e pode ser reivindicada de
 * novo — cobre com folga o timeout do gateway de IA e seus retries. */
export const RADAR_AI_PENDING_LEASE_MS = 120_000;

export const RADAR_AI_BLOCKED_REASONS =["no_credits", "account_blocked", "billing_not_configured"] as const;
export type RadarAiBlockedReason = (typeof RADAR_AI_BLOCKED_REASONS)[number];

/** Pontos já contabilizados por família de sinal operacional. O score é incremental, então cada
 * sinal estrutural só pode somar a DIFERENÇA em relação ao que já somou antes — sem isto, "cliente
 * esperando há 60 min" somaria de novo a cada mensagem. */
export type RadarAppliedSignalPoints = {
  wait: number;
  sla: number;
  transfer: number;
  reopen: number;
  noReply: number;
  burst: number;
};

export const EMPTY_APPLIED_SIGNAL_POINTS: RadarAppliedSignalPoints = { wait: 0, sla: 0, transfer: 0, reopen: 0, noReply: 0, burst: 0 };

export type RadarSignals = {
  sentiment: "positive" | "neutral" | "negative";
  /** -1 a 1, do classificador léxico. */
  sentimentScore: number;
  urgency: "low" | "medium" | "high";
  hasKeywordTrigger: boolean;
  hasCancellation: boolean;
  hasLegalThreat: boolean;
  hasManagerRequest: boolean;
  hasComplaint: boolean;
  hasUrgency: boolean;
  /** Keywords detectadas na conversa até agora (acumuladas, sem repetição). */
  keywordMatches: { keyword: string; category: RadarKeywordCategory }[];
  waitingMinutes: number;
  slaBreached: boolean;
  transferCount: number;
  reopenCount: number;
  noAgentResponse: boolean;
  inboundBurst: boolean;
  applied: RadarAppliedSignalPoints;
};

export type RadarAiAnalysis = {
  diagnostico: string;
  causaRaiz: string;
  riscoPrincipal: "churn" | "insatisfacao" | "escalamento" | "financeiro" | "outro";
  acaoImediata: string;
  prioridade: "critica" | "alta" | "media";
  resumoParaGestor: string;
};

export type ConversationRiskScore = {
  id: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  teamId?: string;
  agentId?: string;
  contactId?: string;
  score: number;
  level: RadarRiskLevel;
  reasons: string[];
  signals: RadarSignals;
  hasKeywordTrigger: boolean;
  hasCancellation: boolean;
  hasLegalThreat: boolean;
  hasManagerRequest: boolean;
  hasComplaint: boolean;
  hasUrgency: boolean;
  waitingMinutes: number;
  messageCount: number;
  inboundCount: number;
  transferCount: number;
  reopenCount: number;
  conversationContext?: string;
  lastEvaluatedMessageId?: string;
  scoreChangedAt: string;
  aiAnalysis?: RadarAiAnalysis;
  aiAnalyzedAt?: string;
  aiAnalyzedScore?: number;
  aiStatus: RadarAiStatus;
  aiBlockedReason?: RadarAiBlockedReason;
  aiLastAttemptAt?: string;
  aiCreditTransactionId?: string;
  aiPendingSince?: string;
  aiTriggerId?: string;
  aiCooldownUntil?: string;
  isDismissed: boolean;
  dismissedAt?: string;
  dismissedBy?: string;
  dismissedNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type RadarSettings = {
  radarEnabled: boolean;
  aiAnalysisEnabled: boolean;
  aiTriggerThreshold: number;
  aiCooldownMinutes: number;
  slaMinutes: number;
};

export const DEFAULT_RADAR_SETTINGS: RadarSettings = {
  radarEnabled: true,
  aiAnalysisEnabled: true,
  aiTriggerThreshold: 60,
  aiCooldownMinutes: 30,
  slaMinutes: 30,
};

/**
 * Diagnóstico desatualizado = existe um diagnóstico, mas a conversa ganhou sinal novo depois dele
 * (`scoreChangedAt` só avança quando uma avaliação soma pontos) ou o score subiu acima do que foi
 * analisado. Decaimento sozinho nunca torna um diagnóstico desatualizado.
 */
export function isRadarAiAnalysisStale(risk: Pick<ConversationRiskScore, "aiAnalyzedAt" | "scoreChangedAt" | "aiAnalyzedScore" | "score">): boolean {
  if (!risk.aiAnalyzedAt) return false;
  if (risk.aiAnalyzedScore !== undefined && risk.score > risk.aiAnalyzedScore) return true;
  return Date.parse(risk.scoreChangedAt) > Date.parse(risk.aiAnalyzedAt);
}

/** Estado da Camada 2 como a UI deve mostrar. `COOLDOWN` só aparece quando há um diagnóstico
 * desatualizado que ainda não pode ser refeito por causa do cooldown. */
export function deriveRadarAiDisplayStatus(
  risk: Pick<ConversationRiskScore, "aiStatus" | "aiAnalyzedAt" | "scoreChangedAt" | "aiAnalyzedScore" | "score" | "aiCooldownUntil" | "aiPendingSince">,
  now: Date,
): RadarAiStatus {
  if (risk.aiStatus === "BLOCKED_NO_CREDITS" || risk.aiStatus === "FAILED_PROVIDER") return risk.aiStatus;
  // Uma análise "em andamento" há mais tempo que o lease foi abandonada (processo caiu no meio) —
  // nunca fica presa em PENDING na tela.
  if (risk.aiStatus === "PENDING" && risk.aiPendingSince && now.getTime() - Date.parse(risk.aiPendingSince) < RADAR_AI_PENDING_LEASE_MS) return "PENDING";
  if (!risk.aiAnalyzedAt) return "NEVER_ANALYZED";
  if (isRadarAiAnalysisStale(risk) && risk.aiCooldownUntil && Date.parse(risk.aiCooldownUntil) > now.getTime()) return "COOLDOWN";
  return "ANALYZED";
}

/** Conversas de grupo do WhatsApp nunca entram no Radar. */
export function isRadarGroupChat(input: { chatType?: string; externalChatId?: string }): boolean {
  return input.chatType === "group" || (input.externalChatId ?? "").toLowerCase().includes("@g.us");
}
