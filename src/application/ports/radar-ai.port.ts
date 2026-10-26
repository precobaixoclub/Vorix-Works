import type { RadarAiAnalysis, RadarAiBlockedReason, RadarRiskLevel } from "../../domain/radar/radar.model.js";

/**
 * Portas da Camada 2 do Radar (diagnóstico profundo por IA, cobrado em créditos). Mesmo racional
 * de `InboxAiResponderPort`: `application/radar/*` nunca importa `AiGatewayPort`, nem o serviço
 * de créditos, nem `prom-client` — só estes contratos.
 */

export type RadarAiAnalystInput = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  /** Chave de idempotência FINANCEIRA (`radar-ai:<conversationId>:<triggerId>`) — a mesma chave
   * nunca debita crédito duas vezes. */
  idempotencyKey: string;
  score: number;
  level: RadarRiskLevel;
  reasons: readonly string[];
  waitingMinutes: number;
  transferCount: number;
  reopenCount: number;
  /** Em ordem cronológica. */
  recentMessages: readonly { direction: "inbound" | "outbound"; body: string }[];
  requestedByUserId?: string;
};

export type RadarAiAnalystResult =
  | {
      ok: true;
      analysis: RadarAiAnalysis;
      provider: string;
      model: string;
      usage: { inputTokens: number; outputTokens: number; estimatedCost: number };
      traceId: string;
    }
  /** `category` é a categoria segura do AI Gateway — `"quota_exceeded"` significa "sem crédito",
   * nunca uma falha operacional. */
  | { ok: false; category: string; message: string };

export type RadarAiAnalystPort = {
  analyze(input: RadarAiAnalystInput): Promise<RadarAiAnalystResult>;
};

export type RadarCreditStatus =
  | { available: true; creditsCost: number; remainingCredits: number }
  | { available: false; reason: RadarAiBlockedReason; creditsCost: number; remainingCredits: number };

/**
 * Consulta de saldo no serviço central de créditos — nunca debita. O débito em si acontece dentro
 * do gateway de IA (`CreditGatedAiGateway`), só depois de uma análise bem-sucedida.
 */
export type RadarCreditGatePort = {
  check(tenantId: string): Promise<RadarCreditStatus>;
};

/** Eventos de tempo real do Radar. Carregam só ids — a UI revalida pelo REST, que aplica o
 * escopo do usuário; nenhum dado da conversa trafega pelo evento. */
export type RadarRealtimeEvent = {
  type: "radar.alert.update" | "radar.ai.updated" | "radar.ai.blocked";
  tenantId: string;
  workspaceId: string;
  conversationId: string;
};

export type RadarRealtimePublisherPort = {
  publish(event: RadarRealtimeEvent): void;
};

/** Métricas globais/infraestrutura (nunca rotuladas por tenant) — mesmo racional de
 * `InboxMetricsRecorder`. */
export type RadarMetricsRecorder = {
  incHeuristicEvaluation(): void;
  incHighRiskConversation(level: "high" | "critical"): void;
  incAiRequested(source: "auto" | "manual"): void;
  incAiCompleted(): void;
  incAiBlockedNoCredits(): void;
  incAiProviderFailure(category: string): void;
  /** Primeira análise concluída depois de um bloqueio por crédito — sinal de recarga convertida. */
  incAiResumedAfterTopUp(): void;
  addCreditsConsumed(credits: number): void;
  observeAiCostUsd(costUsd: number): void;
  observeAiTokens(tokens: number): void;
};
