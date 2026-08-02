export type CheckStatus = "pass" | "warn" | "fail";
export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export type OperationalCheck = {
  id: string;
  component: string;
  status: CheckStatus;
  safeMessage: string;
  observedAt: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
};

export type OperationalHealth = {
  status: HealthStatus;
  generatedAt: string;
  checks: OperationalCheck[];
  releaseGate: {
    environment: string;
    productionEnabled: boolean;
    providerEnvironment: string;
    canaryEnabled: boolean;
    canaryTenantCount: number;
    canaryWorkspaceCount: number;
    allowedProductionProviders: string[];
  };
  circuitBreakers: CircuitBreaker[];
  backpressure: BackpressureSignal[];
  slo: SloSnapshot[];
};

export type CircuitBreaker = {
  id: string;
  tenantId?: string;
  workspaceId?: string;
  scope: string;
  target: string;
  state: "closed" | "open" | "half_open";
  failureCount: number;
  openedAt?: string;
  halfOpenAt?: string;
  lastFailureCode?: string;
  lastFailureCategory?: string;
  updatedAt: string;
};

export type RateLimitBucket = {
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

export type BackpressureSignal = {
  id: string;
  tenantId?: string;
  workspaceId?: string;
  component: string;
  status: "inactive" | "active";
  severity: "info" | "warning" | "critical";
  reason: string;
  safeMessage: string;
  observedAt: string;
  details?: Record<string, unknown>;
};

export type SloSnapshot = {
  id: string;
  metricId: string;
  objective: number;
  currentValue: number;
  status: "met" | "at_risk" | "breached";
  window: string;
  generatedAt: string;
};

export type QueueSnapshot = {
  publication: {
    localQueueSize: number;
    localJobs: Array<{ id: string; publicationId: string; kind: string; enqueuedAt: string; runAfter?: string }>;
  };
};

export type SecretHealth = {
  ok: boolean;
  provider: "local" | "production" | "not_configured";
  safeMessage?: string;
};

export type BackupRestorePlan = {
  sourceOfTruth: string[];
  derivedData: string[];
  restoreOrder: string[];
  consistencyChecks: string[];
};

