/**
 * Módulo Conversas — Fase 6 (Observabilidade). Porta pequena e específica, mesmo racional de
 * `InboxAiResponderPort` (Fase 5): `application/inbox/*` nunca importa `prom-client` nem qualquer
 * biblioteca de métricas diretamente — só este contrato. A implementação real
 * (`infrastructure/observability/prom-inbox-metrics.ts`) é quem sabe traduzir isto em
 * Counter/Histogram/Gauge do Prometheus.
 *
 * `undefined` como valor de `InboxUseCaseDeps.metrics` (nunca uma exceção) é o sinal de "métricas
 * não configuradas neste processo" — todo caso de uso trata isso como no-op opcional, nunca
 * bloqueia nem lança. Métricas são estritamente globais/infraestrutura (nunca rotuladas por
 * tenant/workspace) — ver justificativa no relatório da Fase 6: evita explosão de cardinalidade e
 * mantém o `/metrics` como um endpoint de infraestrutura, nunca uma fonte de dado por tenant.
 */
export type InboxMetricsRecorder = {
  incConnectionConnected(): void;
  incConnectionDisconnected(): void;
  incReconnect(): void;
  incMessageInbound(): void;
  incMessageOutbound(): void;
  incMessageFailed(category: string): void;
  incMessageRetry(): void;
  incDlq(): void;
  setQueueDepth(queue: string, depth: number): void;
  setOldestQueuedMessageAgeSeconds(seconds: number): void;
  incAiReply(): void;
  incAiFailure(category: string): void;
  incAiCancelled(): void;
  incAiSkippedInsufficientCredits(): void;
  addAiCostUsd(amount: number): void;
  observeAiLatencyMs(ms: number): void;
};
