import type {
  OperationalBackpressureSignal,
  OperationalCircuitBreakerKey,
  OperationalCircuitBreakerSnapshot,
  OperationalRateLimitBucket,
  SloSnapshot,
} from "../../domain/operations/operations.model.js";

export type OperationalStateRepositoryPort = {
  health(): Promise<{ ok: boolean; latencyMs?: number; safeMessage?: string }>;

  getCircuitBreaker(key: OperationalCircuitBreakerKey): Promise<OperationalCircuitBreakerSnapshot | undefined>;
  upsertCircuitBreaker(snapshot: OperationalCircuitBreakerSnapshot): Promise<OperationalCircuitBreakerSnapshot>;
  listCircuitBreakers(filter?: { tenantId?: string; workspaceId?: string; scope?: OperationalCircuitBreakerKey["scope"] }): Promise<readonly OperationalCircuitBreakerSnapshot[]>;
  resetCircuitBreaker(id: string, now: string): Promise<OperationalCircuitBreakerSnapshot | undefined>;

  getRateLimitBucket(key: string): Promise<OperationalRateLimitBucket | undefined>;
  upsertRateLimitBucket(bucket: OperationalRateLimitBucket): Promise<OperationalRateLimitBucket>;
  listRateLimitBuckets(filter?: { tenantId?: string; principalId?: string; routeGroup?: string; limit?: number }): Promise<readonly OperationalRateLimitBucket[]>;

  recordBackpressureSignal(signal: OperationalBackpressureSignal): Promise<OperationalBackpressureSignal>;
  listBackpressureSignals(filter?: { tenantId?: string; workspaceId?: string; component?: OperationalBackpressureSignal["component"]; activeOnly?: boolean; limit?: number }): Promise<readonly OperationalBackpressureSignal[]>;

  recordSloSnapshot(snapshot: SloSnapshot): Promise<SloSnapshot>;
  listSloSnapshots(filter?: { tenantId?: string; workspaceId?: string; metricId?: string; limit?: number }): Promise<readonly SloSnapshot[]>;
};

