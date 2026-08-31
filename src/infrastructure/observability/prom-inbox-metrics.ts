import { Counter, Gauge, Histogram, Registry } from "prom-client";
import type { InboxMetricsRecorder } from "../../application/ports/inbox-metrics.port.js";

/**
 * Módulo Conversas — Fase 6. Primeira introdução de `prom-client` no Vorix (auditoria confirmou:
 * nenhuma stack de métricas existia antes desta fase, em nenhum módulo) — deliberadamente
 * estruturado como um `Registry` genérico e reutilizável (não "uma stack só para Inbox"), para
 * outros módulos poderem registrar suas próprias métricas no MESMO registry/endpoint `/metrics`
 * no futuro, em vez de cada um criar seu próprio processo/porta.
 *
 * Métricas são estritamente GLOBAIS/infraestrutura — nunca rotuladas por tenant/workspace (ver
 * `InboxMetricsRecorder`). O `/metrics` é um endpoint de operação (scrape do Prometheus), nunca
 * exposto a um tenant; dado por-tenant de billing/uso já vive corretamente em Postgres
 * (`ai_generation_ledger`, `tenant_ai_usage_monthly`), nunca duplicado aqui.
 */
export const inboxMetricsRegistry = new Registry();

const connectionsConnectedTotal = new Counter({ name: "inbox_connections_connected_total", help: "Total de vezes que uma MessagingConnection ficou connected.", registers: [inboxMetricsRegistry] });
const connectionsDisconnectedTotal = new Counter({ name: "inbox_connections_disconnected_total", help: "Total de vezes que uma MessagingConnection ficou disconnected.", registers: [inboxMetricsRegistry] });
const reconnectTotal = new Counter({ name: "inbox_reconnect_total", help: "Total de transições para o status reconnecting.", registers: [inboxMetricsRegistry] });

const messagesInboundTotal = new Counter({ name: "inbox_messages_inbound_total", help: "Total de mensagens inbound persistidas (excluindo reentregas deduplicadas).", registers: [inboxMetricsRegistry] });
const messagesOutboundTotal = new Counter({ name: "inbox_messages_outbound_total", help: "Total de mensagens outbound enviadas com sucesso ao provider.", registers: [inboxMetricsRegistry] });
const messagesFailedTotal = new Counter({ name: "inbox_messages_failed_total", help: "Total de tentativas de envio outbound que falharam, por categoria.", labelNames: ["category"], registers: [inboxMetricsRegistry] });
const messagesRetryTotal = new Counter({ name: "inbox_messages_retry_total", help: "Total de mensagens outbound requeued para retry (circuit aberto, rate limit local, ou falha do provider).", registers: [inboxMetricsRegistry] });
const dlqTotal = new Counter({ name: "inbox_dlq_total", help: "Total de mensagens que esgotaram a escada de retry e foram para a DLQ.", registers: [inboxMetricsRegistry] });

const queueDepth = new Gauge({ name: "inbox_queue_depth", help: "Profundidade atual de uma fila do módulo Conversas.", labelNames: ["queue"], registers: [inboxMetricsRegistry] });
const oldestQueuedMessageAgeSeconds = new Gauge({ name: "inbox_oldest_queued_message_seconds", help: "Idade (segundos) da mensagem outbound QUEUED mais antiga.", registers: [inboxMetricsRegistry] });

const aiRepliesTotal = new Counter({ name: "inbox_ai_replies_total", help: "Total de respostas de IA enviadas com sucesso.", registers: [inboxMetricsRegistry] });
const aiFailuresTotal = new Counter({ name: "inbox_ai_failures_total", help: "Total de falhas operacionais da IA (nunca inclui crédito insuficiente), por categoria.", labelNames: ["category"], registers: [inboxMetricsRegistry] });
const aiCancelledTotal = new Counter({ name: "inbox_ai_cancelled_total", help: "Total de respostas de IA descartadas por mudança de elegibilidade durante a geração.", registers: [inboxMetricsRegistry] });
const aiSkippedInsufficientCreditsTotal = new Counter({ name: "inbox_ai_skipped_insufficient_credits_total", help: "Total de gerações não realizadas por falta de crédito Vorix.", registers: [inboxMetricsRegistry] });
const aiCostTotalUsd = new Counter({ name: "inbox_ai_cost_total_usd", help: "Custo estimado acumulado (USD) de respostas de IA enviadas.", registers: [inboxMetricsRegistry] });
const aiLatencyMs = new Histogram({ name: "inbox_ai_latency_ms", help: "Latência (ms) de gerações de IA bem-sucedidas.", buckets: [250, 500, 1_000, 2_000, 4_000, 8_000, 12_000, 20_000], registers: [inboxMetricsRegistry] });

export function createPromInboxMetrics(): InboxMetricsRecorder {
  return {
    incConnectionConnected: () => connectionsConnectedTotal.inc(),
    incConnectionDisconnected: () => connectionsDisconnectedTotal.inc(),
    incReconnect: () => reconnectTotal.inc(),
    incMessageInbound: () => messagesInboundTotal.inc(),
    incMessageOutbound: () => messagesOutboundTotal.inc(),
    incMessageFailed: (category) => messagesFailedTotal.inc({ category }),
    incMessageRetry: () => messagesRetryTotal.inc(),
    incDlq: () => dlqTotal.inc(),
    setQueueDepth: (queue, depth) => queueDepth.set({ queue }, depth),
    setOldestQueuedMessageAgeSeconds: (seconds) => oldestQueuedMessageAgeSeconds.set(seconds),
    incAiReply: () => aiRepliesTotal.inc(),
    incAiFailure: (category) => aiFailuresTotal.inc({ category }),
    incAiCancelled: () => aiCancelledTotal.inc(),
    incAiSkippedInsufficientCredits: () => aiSkippedInsufficientCreditsTotal.inc(),
    addAiCostUsd: (amount) => aiCostTotalUsd.inc(amount),
    observeAiLatencyMs: (ms) => aiLatencyMs.observe(ms),
  };
}
