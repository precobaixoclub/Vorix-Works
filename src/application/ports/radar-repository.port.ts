import type { ConversationRiskScore, RadarAiAnalysis, RadarAiBlockedReason, RadarKeywordCategory, RadarRiskLevel, RadarSettings, RadarSignals } from "../../domain/radar/radar.model.js";
import type { RadarKeywordOverride } from "../../domain/radar/radar-keywords.js";

/**
 * Porta de persistência do Radar de Sentimento. Adapter concreto: `PostgresRadarRepository`.
 * Nenhuma regra de negócio aqui — score, gatilhos e política de crédito vivem em
 * `domain/radar/*` e `application/radar/radar-use-cases.ts`.
 */

/** Fatos operacionais da conversa lidos das tabelas da Inbox — tudo que a Camada 1 precisa além
 * do texto da mensagem. */
export type RadarConversationSnapshot = {
  conversationId: string;
  tenantId: string;
  workspaceId: string;
  chatType: string;
  externalChatId: string;
  contactId?: string;
  agentId?: string;
  teamId?: string;
  /** `false` quando a equipe responsável desligou o Radar (`teams.radar_enabled`). */
  teamRadarEnabled: boolean;
  messageCount: number;
  inboundCount: number;
  /** Mensagens do cliente desde a última resposta do atendimento. */
  unansweredInboundCount: number;
  oldestUnansweredInboundAt?: string;
  transferCount: number;
  reopenCount: number;
  /** Últimas mensagens do cliente, resumidas — contexto exibido no alerta. */
  recentInboundContext?: string;
};

export type RadarRecentMessage = { direction: "inbound" | "outbound"; body: string; createdAt: string };

/**
 * Escopo de leitura do usuário autenticado. Sem `teamIds` nem `agentId` = tudo do workspace
 * (owner/admin). Com eles, só conversas de uma das equipes gerenciadas OU atribuídas ao próprio
 * usuário. `tenantId`/`workspaceId` são sempre obrigatórios — nenhuma consulta do Radar roda sem
 * os dois.
 */
export type RadarScope = {
  tenantId: string;
  workspaceId: string;
  teamIds?: readonly string[];
  agentId?: string;
};

export type RadarListFilter = {
  level?: RadarRiskLevel;
  teamId?: string;
  agentId?: string;
  minScore?: number;
  /** `true` = só arquivados; default = só ativos. */
  dismissed?: boolean;
  limit?: number;
  offset?: number;
};

export type RadarListItem = ConversationRiskScore & {
  contactName?: string;
  contactPhone?: string;
  agentName?: string;
  teamName?: string;
  conversationStatus?: string;
  lastMessageAt?: string;
  /** Tempo sem resposta calculado na hora da consulta (não o congelado na última avaliação). */
  liveWaitingMinutes: number;
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

export type SaveRadarEvaluationInput = {
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
  waitingMinutes: number;
  messageCount: number;
  inboundCount: number;
  transferCount: number;
  reopenCount: number;
  conversationContext?: string;
  lastEvaluatedMessageId?: string;
  /** `true` quando o score ou os sinais mudaram — avança `score_changed_at`. */
  scoreChanged: boolean;
  now: string;
};

export type RadarAiAnalysisLogStatus = "completed" | "blocked_no_credits" | "failed_provider";

export type RadarAiAnalysisLogEntry = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  triggerId: string;
  triggerSource: "auto" | "manual";
  triggerReason?: string;
  idempotencyKey: string;
  score: number;
  level: RadarRiskLevel;
  status: RadarAiAnalysisLogStatus;
  creditTransactionId?: string;
  creditsReserved: number;
  creditsConsumed: number;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  errorCategory?: string;
  requestedByUserId?: string;
  now: string;
};

export type RadarAiAnalysisLog = Omit<RadarAiAnalysisLogEntry, "now"> & { id: string; feature: string; createdAt: string };

export type RadarDismissalLogEntry = { id: string; conversationId: string; action: "dismissed" | "reactivated"; userId?: string; note?: string; createdAt: string };

export type UpsertRadarKeywordInput = {
  tenantId: string;
  workspaceId: string;
  teamId?: string;
  keyword: string;
  category: RadarKeywordCategory;
  weight?: number;
  enabled: boolean;
};

export type RadarRepositoryPort = {
  getSettings(workspaceId: string): Promise<RadarSettings>;
  upsertSettings(input: { tenantId: string; workspaceId: string; patch: Partial<RadarSettings> }): Promise<RadarSettings>;
  /** `false` se a equipe não existe neste tenant/workspace. */
  setTeamRadarEnabled(input: { tenantId: string; workspaceId: string; teamId: string; enabled: boolean }): Promise<boolean>;
  listTeamFlags(input: { tenantId: string; workspaceId: string }): Promise<{ teamId: string; teamName: string; radarEnabled: boolean }[]>;

  listKeywordOverrides(input: { tenantId: string; workspaceId: string }): Promise<RadarKeywordOverride[]>;
  upsertKeywordOverride(input: UpsertRadarKeywordInput): Promise<RadarKeywordOverride>;
  deleteKeywordOverride(input: { tenantId: string; workspaceId: string; id: string }): Promise<boolean>;

  loadConversationSnapshot(conversationId: string): Promise<RadarConversationSnapshot | undefined>;
  /** Mais recentes primeiro. */
  listRecentMessages(conversationId: string, limit: number): Promise<RadarRecentMessage[]>;

  getByConversationId(conversationId: string): Promise<ConversationRiskScore | undefined>;
  /** Grava só os campos da Camada 1 — NUNCA toca em `ai_analysis`/`ai_analyzed_at`/`ai_status`.
   * Um score maior que o anterior reativa um alerta arquivado. */
  saveEvaluation(input: SaveRadarEvaluationInput): Promise<ConversationRiskScore>;

  /**
   * Reserva atômica (CAS) do direito de rodar UMA análise profunda para a conversa. Só devolve a
   * linha quando: não há outra análise em andamento (ou a que há é mais velha que
   * `stalePendingBefore`) E o cooldown já passou. Duas chamadas concorrentes nunca recebem ambas
   * a linha. Marca `ai_status = 'PENDING'` e arma o cooldown.
   */
  tryClaimAiAnalysis(input: { conversationId: string; triggerId: string; now: string; stalePendingBefore: string; cooldownUntil: string }): Promise<ConversationRiskScore | undefined>;
  completeAiAnalysis(input: { conversationId: string; triggerId: string; analysis: RadarAiAnalysis; analyzedAt: string; analyzedScore: number; creditTransactionId: string }): Promise<ConversationRiskScore | undefined>;
  /** Bloqueio por crédito: libera a reserva e o cooldown (a próxima oportunidade pode tentar de
   * novo) e preserva o diagnóstico anterior. */
  blockAiAnalysis(input: { conversationId: string; triggerId: string; reason: RadarAiBlockedReason; now: string }): Promise<ConversationRiskScore | undefined>;
  /** Falha de provider/sistema: libera a reserva, preserva o diagnóstico anterior e deixa só um
   * backoff curto (`retryAfter`). */
  failAiAnalysis(input: { conversationId: string; triggerId: string; now: string; retryAfter: string }): Promise<ConversationRiskScore | undefined>;
  recordAiAnalysisLog(entry: RadarAiAnalysisLogEntry): Promise<void>;
  listAiAnalysisLogs(input: { tenantId: string; workspaceId: string; conversationId: string; limit: number }): Promise<RadarAiAnalysisLog[]>;

  list(scope: RadarScope, filter: RadarListFilter): Promise<RadarListItem[]>;
  stats(scope: RadarScope, filter: Pick<RadarListFilter, "teamId" | "agentId">): Promise<RadarStats>;
  getDetail(scope: RadarScope, conversationId: string): Promise<RadarListItem | undefined>;

  dismiss(input: { tenantId: string; workspaceId: string; conversationId: string; userId: string; note?: string; now: string }): Promise<ConversationRiskScore | undefined>;
  reactivate(input: { tenantId: string; workspaceId: string; conversationId: string; userId: string; now: string }): Promise<ConversationRiskScore | undefined>;
  listDismissalLog(input: { tenantId: string; workspaceId: string; conversationId: string }): Promise<RadarDismissalLogEntry[]>;
};
