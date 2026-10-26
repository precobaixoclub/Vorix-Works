/** Radar de Sentimento (réplica adaptada do CMDesk) — espelha `RadarAlertView` do backend
 * (`src/application/radar/radar-use-cases.ts`). SCORE do Radar (heurístico, sempre atualizado) e
 * DIAGNÓSTICO da IA (consome crédito, pode estar desatualizado) são coisas distintas — os tipos
 * mantêm os dois separados de propósito. */

export type RadarRiskLevel = "low" | "medium" | "high" | "critical";
export type RadarKeywordCategory = "cancellation" | "legal" | "manager" | "complaint";
export type RadarAiStatus = "NEVER_ANALYZED" | "ANALYZED" | "PENDING" | "BLOCKED_NO_CREDITS" | "FAILED_PROVIDER" | "COOLDOWN";
export type RadarAiBlockedReason = "no_credits" | "account_blocked" | "billing_not_configured";

export type RadarSignals = {
  sentiment?: "positive" | "neutral" | "negative";
  urgency?: "low" | "medium" | "high";
  keywordMatches?: { keyword: string; category: RadarKeywordCategory }[];
  waitingMinutes?: number;
  slaBreached?: boolean;
  transferCount?: number;
  reopenCount?: number;
  noAgentResponse?: boolean;
  inboundBurst?: boolean;
};

export type RadarAiAnalysis = {
  diagnostico: string;
  causaRaiz: string;
  riscoPrincipal: "churn" | "insatisfacao" | "escalamento" | "financeiro" | "outro";
  acaoImediata: string;
  prioridade: "critica" | "alta" | "media";
  resumoParaGestor: string;
};

export type RadarAlert = {
  id: string;
  conversationId: string;
  teamId?: string;
  agentId?: string;
  contactId?: string;
  contactName?: string;
  contactPhone?: string;
  agentName?: string;
  teamName?: string;
  conversationStatus?: string;
  lastMessageAt?: string;
  score: number;
  level: RadarRiskLevel;
  reasons: string[];
  signals: RadarSignals;
  hasCancellation: boolean;
  hasLegalThreat: boolean;
  hasManagerRequest: boolean;
  hasComplaint: boolean;
  hasUrgency: boolean;
  waitingMinutes: number;
  liveWaitingMinutes: number;
  messageCount: number;
  inboundCount: number;
  transferCount: number;
  reopenCount: number;
  conversationContext?: string;
  aiAnalysis?: RadarAiAnalysis;
  aiAnalyzedAt?: string;
  aiStatus: RadarAiStatus;
  /** Estado para exibição — inclui `COOLDOWN`, que o backend só deriva. */
  aiDisplayStatus: RadarAiStatus;
  /** Há diagnóstico, mas a conversa ganhou sinal novo depois dele. */
  aiStale: boolean;
  aiBlockedReason?: RadarAiBlockedReason;
  aiLastAttemptAt?: string;
  aiCooldownUntil?: string;
  isDismissed: boolean;
  dismissedAt?: string;
  dismissedNote?: string;
  updatedAt: string;
};

export type RadarStats = {
  totalActive: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  slaBreached: number;
  withCancellation: number;
  withLegalThreat: number;
  avgScore: number;
  aiBlockedNoCredits: number;
  backlogByTeam: { teamId: string; teamName: string; count: number; avgScore: number }[];
};

export type RadarCredits = {
  /** `false` = diagnóstico por IA não habilitado neste ambiente (nada a ver com saldo). */
  aiConfigured: boolean;
  available: boolean;
  remainingCredits?: number;
  creditsCost?: number;
  blockedReason?: RadarAiBlockedReason;
};

export type RadarAiAnalysisLog = {
  id: string;
  status: "completed" | "blocked_no_credits" | "failed_provider";
  triggerSource: "auto" | "manual";
  score: number;
  creditsConsumed: number;
  createdAt: string;
};

export type RadarAlertDetail = {
  alert: RadarAlert;
  aiAnalysisLogs: RadarAiAnalysisLog[];
  dismissalLog: { id: string; action: "dismissed" | "reactivated"; userId?: string; note?: string; createdAt: string }[];
};

export type RadarAiOutcome = "completed" | "blocked_no_credits" | "failed_provider" | "cooldown" | "disabled";

export type RadarListFilter = { level?: RadarRiskLevel; teamId?: string; dismissed?: boolean };
