import type { OperationalStateRepositoryPort } from "../../application/ports/operational-state-repository.port.js";
import type {
  OperationalBackpressureSignal,
  OperationalCircuitBreakerKey,
  OperationalCircuitBreakerSnapshot,
  OperationalRateLimitBucket,
  SloSnapshot,
} from "../../domain/operations/operations.model.js";

export class InMemoryOperationalStateRepository implements OperationalStateRepositoryPort {
  private readonly circuitBreakers = new Map<string, OperationalCircuitBreakerSnapshot>();
  private readonly rateLimitBuckets = new Map<string, OperationalRateLimitBucket>();
  private readonly backpressureSignals: OperationalBackpressureSignal[] = [];
  private readonly sloSnapshots: SloSnapshot[] = [];

  async health(): Promise<{ ok: boolean; latencyMs?: number; safeMessage?: string }> {
    return { ok: true, safeMessage: "Repositorio operacional em memoria disponivel." };
  }

  async getCircuitBreaker(key: OperationalCircuitBreakerKey): Promise<OperationalCircuitBreakerSnapshot | undefined> {
    return this.circuitBreakers.get(circuitId(key));
  }

  async upsertCircuitBreaker(snapshot: OperationalCircuitBreakerSnapshot): Promise<OperationalCircuitBreakerSnapshot> {
    this.circuitBreakers.set(snapshot.id, { ...snapshot });
    return { ...snapshot };
  }

  async listCircuitBreakers(filter: { tenantId?: string; workspaceId?: string; scope?: OperationalCircuitBreakerKey["scope"] } = {}): Promise<readonly OperationalCircuitBreakerSnapshot[]> {
    return [...this.circuitBreakers.values()].filter((item) => matchesScope(item, filter)).map((item) => ({ ...item }));
  }

  async resetCircuitBreaker(id: string, now: string): Promise<OperationalCircuitBreakerSnapshot | undefined> {
    const current = this.circuitBreakers.get(id);
    if (!current) return undefined;
    const reset = { ...current, state: "closed" as const, failureCount: 0, openedAt: undefined, halfOpenAt: undefined, lastFailureCode: undefined, lastFailureCategory: undefined, updatedAt: now };
    this.circuitBreakers.set(id, reset);
    return { ...reset };
  }

  async getRateLimitBucket(key: string): Promise<OperationalRateLimitBucket | undefined> {
    const bucket = this.rateLimitBuckets.get(key);
    return bucket ? { ...bucket } : undefined;
  }

  async upsertRateLimitBucket(bucket: OperationalRateLimitBucket): Promise<OperationalRateLimitBucket> {
    this.rateLimitBuckets.set(bucket.key, { ...bucket });
    return { ...bucket };
  }

  async listRateLimitBuckets(filter: { tenantId?: string; principalId?: string; routeGroup?: string; limit?: number } = {}): Promise<readonly OperationalRateLimitBucket[]> {
    return [...this.rateLimitBuckets.values()]
      .filter((item) => (filter.tenantId ? item.tenantId === filter.tenantId : true))
      .filter((item) => (filter.principalId ? item.principalId === filter.principalId : true))
      .filter((item) => (filter.routeGroup ? item.routeGroup === filter.routeGroup : true))
      .slice(0, filter.limit ?? 100)
      .map((item) => ({ ...item }));
  }

  async recordBackpressureSignal(signal: OperationalBackpressureSignal): Promise<OperationalBackpressureSignal> {
    this.backpressureSignals.unshift({ ...signal, details: copy(signal.details) });
    return { ...signal, details: copy(signal.details) };
  }

  async listBackpressureSignals(filter: { tenantId?: string; workspaceId?: string; component?: OperationalBackpressureSignal["component"]; activeOnly?: boolean; limit?: number } = {}): Promise<readonly OperationalBackpressureSignal[]> {
    return this.backpressureSignals
      .filter((item) => (filter.tenantId ? item.tenantId === filter.tenantId : true))
      .filter((item) => (filter.workspaceId ? item.workspaceId === filter.workspaceId : true))
      .filter((item) => (filter.component ? item.component === filter.component : true))
      .filter((item) => (filter.activeOnly ? item.status === "active" : true))
      .slice(0, filter.limit ?? 100)
      .map((item) => ({ ...item, details: copy(item.details) }));
  }

  async recordSloSnapshot(snapshot: SloSnapshot): Promise<SloSnapshot> {
    this.sloSnapshots.unshift({ ...snapshot });
    return { ...snapshot };
  }

  async listSloSnapshots(filter: { tenantId?: string; workspaceId?: string; metricId?: string; limit?: number } = {}): Promise<readonly SloSnapshot[]> {
    return this.sloSnapshots
      .filter((item) => (filter.tenantId ? item.tenantId === filter.tenantId : true))
      .filter((item) => (filter.workspaceId ? item.workspaceId === filter.workspaceId : true))
      .filter((item) => (filter.metricId ? item.metricId === filter.metricId : true))
      .slice(0, filter.limit ?? 100)
      .map((item) => ({ ...item }));
  }
}

function circuitId(key: OperationalCircuitBreakerKey): string {
  return [key.tenantId ?? "global", key.workspaceId ?? "global", key.scope, key.target].join(":");
}

function matchesScope(item: OperationalCircuitBreakerSnapshot, filter: { tenantId?: string; workspaceId?: string; scope?: OperationalCircuitBreakerKey["scope"] }): boolean {
  if (filter.tenantId && item.tenantId !== filter.tenantId) return false;
  if (filter.workspaceId && item.workspaceId !== filter.workspaceId) return false;
  if (filter.scope && item.scope !== filter.scope) return false;
  return true;
}

function copy(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return input ? JSON.parse(JSON.stringify(input)) as Record<string, unknown> : undefined;
}

