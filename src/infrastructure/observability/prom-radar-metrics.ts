import { Counter, Histogram } from "prom-client";
import type { RadarMetricsRecorder } from "../../application/ports/radar-ai.port.js";
import { inboxMetricsRegistry } from "./prom-inbox-metrics.js";

/**
 * Métricas do Radar de Sentimento — registradas no MESMO registry/endpoint `/metrics` do módulo
 * Conversas (ver `prom-inbox-metrics.ts`: o registry foi criado para ser compartilhado). Globais,
 * nunca rotuladas por tenant; o dado por tenant vive em `radar_ai_analysis_logs` e no ledger
 * central de créditos.
 */
const heuristicEvaluationsTotal = new Counter({ name: "radar_heuristic_evaluations_total", help: "Total de avaliações heurísticas (camada gratuita) do Radar.", registers: [inboxMetricsRegistry] });
const highRiskConversationsTotal = new Counter({ name: "radar_high_risk_conversations_total", help: "Total de conversas que entraram em nível high/critical.", labelNames: ["level"], registers: [inboxMetricsRegistry] });
const aiRequestedTotal = new Counter({ name: "radar_ai_analyses_requested_total", help: "Total de análises profundas iniciadas (reserva obtida), por origem.", labelNames: ["source"], registers: [inboxMetricsRegistry] });
const aiCompletedTotal = new Counter({ name: "radar_ai_analyses_completed_total", help: "Total de análises profundas concluídas.", registers: [inboxMetricsRegistry] });
const aiBlockedNoCreditsTotal = new Counter({ name: "radar_ai_analyses_blocked_no_credits_total", help: "Total de análises profundas bloqueadas por falta de crédito (transições para bloqueado).", registers: [inboxMetricsRegistry] });
const aiProviderFailuresTotal = new Counter({ name: "radar_ai_provider_failures_total", help: "Total de análises profundas que falharam, por categoria.", labelNames: ["category"], registers: [inboxMetricsRegistry] });
const aiResumedAfterTopUpTotal = new Counter({ name: "radar_ai_resumed_after_top_up_total", help: "Total de conversas cuja análise voltou a rodar depois de um bloqueio por crédito.", registers: [inboxMetricsRegistry] });
const creditsConsumedTotal = new Counter({ name: "radar_credits_consumed_total", help: "Créditos de IA consumidos pelo Radar.", registers: [inboxMetricsRegistry] });
const aiCostUsd = new Histogram({ name: "radar_ai_cost_usd", help: "Custo estimado (USD) por análise profunda concluída.", buckets: [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05], registers: [inboxMetricsRegistry] });
const aiTokens = new Histogram({ name: "radar_ai_tokens", help: "Tokens (entrada + saída) por análise profunda concluída.", buckets: [200, 400, 800, 1_200, 2_000, 3_000, 5_000], registers: [inboxMetricsRegistry] });

export function createPromRadarMetrics(): RadarMetricsRecorder {
  return {
    incHeuristicEvaluation: () => heuristicEvaluationsTotal.inc(),
    incHighRiskConversation: (level) => highRiskConversationsTotal.inc({ level }),
    incAiRequested: (source) => aiRequestedTotal.inc({ source }),
    incAiCompleted: () => aiCompletedTotal.inc(),
    incAiBlockedNoCredits: () => aiBlockedNoCreditsTotal.inc(),
    incAiProviderFailure: (category) => aiProviderFailuresTotal.inc({ category }),
    incAiResumedAfterTopUp: () => aiResumedAfterTopUpTotal.inc(),
    addCreditsConsumed: (credits) => creditsConsumedTotal.inc(credits),
    observeAiCostUsd: (costUsd) => aiCostUsd.observe(costUsd),
    observeAiTokens: (tokens) => aiTokens.observe(tokens),
  };
}
