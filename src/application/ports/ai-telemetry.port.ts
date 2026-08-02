import type { AiFailureCategory, AiOperation, AiUsage } from "./ai-gateway.port.js";

/**
 * Telemetria de IA — Sprint 08 (Fase 17). Mesmo espírito de `AuditLogPort` (Sprint 05): grava o
 * evento, sem dashboard/alerta embutido. Nunca carrega prompt, resposta, ou qualquer dado de
 * negócio do usuário — só metadados operacionais (operação, provider, outcome, latência, tokens,
 * ids de correlação). `correlationId`/`traceId` sempre presentes para conseguir seguir uma chamada
 * ponta a ponta sem expor conteúdo.
 */
export const AI_TELEMETRY_OUTCOMES = [
  "succeeded",
  "failed",
  "skipped_deterministic_sufficient",
  "skipped_feature_disabled",
  "skipped_rate_limited",
  "skipped_not_applicable",
] as const;
export type AiTelemetryOutcome = (typeof AI_TELEMETRY_OUTCOMES)[number];

export type AiTelemetryEvent = {
  operation: AiOperation;
  outcome: AiTelemetryOutcome;
  tenantId: string;
  workspaceId: string;
  correlationId: string;
  traceId?: string;
  provider?: string;
  model?: string;
  failureCategory?: AiFailureCategory;
  retryCount?: number;
  providerFallbackUsed?: boolean;
  latencyMs?: number;
  usage?: AiUsage;
};

export type AiTelemetryPort = {
  record(event: AiTelemetryEvent): void;
};
