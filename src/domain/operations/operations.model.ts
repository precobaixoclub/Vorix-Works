export const OPERATIONAL_HEALTH_STATUSES = ["healthy", "degraded", "unhealthy"] as const;
export type OperationalHealthStatus = (typeof OPERATIONAL_HEALTH_STATUSES)[number];

export const OPERATIONAL_CHECK_STATUSES = ["pass", "warn", "fail"] as const;
export type OperationalCheckStatus = (typeof OPERATIONAL_CHECK_STATUSES)[number];

export type OperationalCheck = {
  id: string;
  component: string;
  status: OperationalCheckStatus;
  safeMessage: string;
  observedAt: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
};

export type OperationalHealthReport = {
  status: OperationalHealthStatus;
  generatedAt: string;
  checks: readonly OperationalCheck[];
};

export type OperationalReadinessReport = OperationalHealthReport & {
  ready: boolean;
};

export type OperationalLivenessReport = {
  alive: true;
  status: "ok";
  uptimeSeconds: number;
  generatedAt: string;
};

export const CIRCUIT_BREAKER_STATES = ["closed", "open", "half_open"] as const;
export type OperationalCircuitBreakerState = (typeof CIRCUIT_BREAKER_STATES)[number];

export type OperationalCircuitBreakerKey = {
  tenantId?: string;
  workspaceId?: string;
  /** `messaging_provider` (Fase 6, Módulo Conversas) — chamadas HTTP ao gateway de mensageria
   * (WuzAPI), `target` = `connectionId`. Reaproveita este circuit breaker operacional já existente
   * em vez de uma segunda stack só para Inbox — ver `db/migrations/0086_inbox_resilience.sql`. */
  scope: "publication_provider" | "execution_handler" | "webhook" | "analytics" | "system" | "messaging_provider";
  target: string;
};

export type OperationalCircuitBreakerSnapshot = OperationalCircuitBreakerKey & {
  id: string;
  state: OperationalCircuitBreakerState;
  failureCount: number;
  openedAt?: string;
  halfOpenAt?: string;
  lastFailureCode?: string;
  lastFailureCategory?: string;
  updatedAt: string;
};

export type OperationalRateLimitBucket = {
  key: string;
  routeGroup: string;
  tenantId?: string;
  principalId?: string;
  ip?: string;
  limit: number;
  remaining: number;
  resetAt: string;
  updatedAt: string;
};

export type OperationalBackpressureSignal = {
  id: string;
  tenantId?: string;
  workspaceId?: string;
  component: "publication" | "scheduling" | "analytics" | "webhook" | "system";
  status: "inactive" | "active";
  severity: "info" | "warning" | "critical";
  reason: string;
  safeMessage: string;
  observedAt: string;
  details?: Record<string, unknown>;
};

export type ReleaseGateDecision =
  | { allowed: true; reason: "allowed"; safeMessage: string }
  | { allowed: false; reason: "production_disabled" | "canary_disabled" | "tenant_not_allowed" | "workspace_not_allowed" | "provider_not_allowed" | "secret_manager_not_ready" | "environment_blocked"; safeMessage: string };

export type SecretManagerHealth = {
  ok: boolean;
  provider: "local" | "production" | "not_configured";
  safeMessage?: string;
};

export type SecretValue = {
  value: Record<string, string>;
  expiresAt?: string;
};

export type SloSnapshot = {
  id: string;
  tenantId?: string;
  workspaceId?: string;
  metricId: string;
  objective: number;
  currentValue: number;
  status: "met" | "at_risk" | "breached";
  window: string;
  generatedAt: string;
};

