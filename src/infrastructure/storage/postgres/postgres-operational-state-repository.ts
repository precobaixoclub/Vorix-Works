import type pg from "pg";
import type { OperationalStateRepositoryPort } from "../../../application/ports/operational-state-repository.port.js";
import type {
  OperationalBackpressureSignal,
  OperationalCircuitBreakerKey,
  OperationalCircuitBreakerSnapshot,
  OperationalRateLimitBucket,
  SloSnapshot,
} from "../../../domain/operations/operations.model.js";

export class PostgresOperationalStateRepository implements OperationalStateRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async health(): Promise<{ ok: boolean; latencyMs?: number; safeMessage?: string }> {
    const started = Date.now();
    try {
      await this.pool.query("select 1");
      return { ok: true, latencyMs: Date.now() - started, safeMessage: "Repositorio operacional PostgreSQL disponivel." };
    } catch {
      return { ok: false, latencyMs: Date.now() - started, safeMessage: "Repositorio operacional PostgreSQL indisponivel." };
    }
  }

  async getCircuitBreaker(key: OperationalCircuitBreakerKey): Promise<OperationalCircuitBreakerSnapshot | undefined> {
    const result = await this.pool.query<CircuitBreakerRow>(
      `select * from operational_circuit_breakers
       where coalesce(tenant_id, '') = coalesce($1, '')
         and coalesce(workspace_id, '') = coalesce($2, '')
         and scope = $3
         and target = $4
       limit 1`,
      [key.tenantId, key.workspaceId, key.scope, key.target],
    );
    return result.rows[0] ? mapCircuitBreaker(result.rows[0]) : undefined;
  }

  async upsertCircuitBreaker(snapshot: OperationalCircuitBreakerSnapshot): Promise<OperationalCircuitBreakerSnapshot> {
    const result = await this.pool.query<CircuitBreakerRow>(
      `insert into operational_circuit_breakers (id, tenant_id, workspace_id, scope, target, state, failure_count, opened_at, half_open_at, last_failure_code, last_failure_category, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (id) do update set
         tenant_id = excluded.tenant_id,
         workspace_id = excluded.workspace_id,
         scope = excluded.scope,
         target = excluded.target,
         state = excluded.state,
         failure_count = excluded.failure_count,
         opened_at = excluded.opened_at,
         half_open_at = excluded.half_open_at,
         last_failure_code = excluded.last_failure_code,
         last_failure_category = excluded.last_failure_category,
         updated_at = excluded.updated_at
       returning *`,
      [snapshot.id, snapshot.tenantId, snapshot.workspaceId, snapshot.scope, snapshot.target, snapshot.state, snapshot.failureCount, snapshot.openedAt, snapshot.halfOpenAt, snapshot.lastFailureCode, snapshot.lastFailureCategory, snapshot.updatedAt],
    );
    return mapCircuitBreaker(result.rows[0]);
  }

  async listCircuitBreakers(filter: { tenantId?: string; workspaceId?: string; scope?: OperationalCircuitBreakerKey["scope"] } = {}): Promise<readonly OperationalCircuitBreakerSnapshot[]> {
    const result = await this.pool.query<CircuitBreakerRow>(
      `select * from operational_circuit_breakers
       where ($1::text is null or tenant_id = $1)
         and ($2::text is null or workspace_id = $2)
         and ($3::text is null or scope = $3)
       order by updated_at desc
       limit 200`,
      [filter.tenantId, filter.workspaceId, filter.scope],
    );
    return result.rows.map(mapCircuitBreaker);
  }

  async resetCircuitBreaker(id: string, now: string): Promise<OperationalCircuitBreakerSnapshot | undefined> {
    const result = await this.pool.query<CircuitBreakerRow>(
      `update operational_circuit_breakers
       set state = 'closed', failure_count = 0, opened_at = null, half_open_at = null, last_failure_code = null, last_failure_category = null, updated_at = $2
       where id = $1
       returning *`,
      [id, now],
    );
    return result.rows[0] ? mapCircuitBreaker(result.rows[0]) : undefined;
  }

  async getRateLimitBucket(key: string): Promise<OperationalRateLimitBucket | undefined> {
    const result = await this.pool.query<RateLimitRow>("select * from operational_rate_limit_buckets where bucket_key = $1", [key]);
    return result.rows[0] ? mapRateLimit(result.rows[0]) : undefined;
  }

  async upsertRateLimitBucket(bucket: OperationalRateLimitBucket): Promise<OperationalRateLimitBucket> {
    const result = await this.pool.query<RateLimitRow>(
      `insert into operational_rate_limit_buckets (bucket_key, route_group, tenant_id, principal_id, ip, limit_value, remaining, reset_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (bucket_key) do update set
         route_group = excluded.route_group,
         tenant_id = excluded.tenant_id,
         principal_id = excluded.principal_id,
         ip = excluded.ip,
         limit_value = excluded.limit_value,
         remaining = excluded.remaining,
         reset_at = excluded.reset_at,
         updated_at = excluded.updated_at
       returning *`,
      [bucket.key, bucket.routeGroup, bucket.tenantId, bucket.principalId, bucket.ip, bucket.limit, bucket.remaining, bucket.resetAt, bucket.updatedAt],
    );
    return mapRateLimit(result.rows[0]);
  }

  async listRateLimitBuckets(filter: { tenantId?: string; principalId?: string; routeGroup?: string; limit?: number } = {}): Promise<readonly OperationalRateLimitBucket[]> {
    const result = await this.pool.query<RateLimitRow>(
      `select * from operational_rate_limit_buckets
       where ($1::text is null or tenant_id = $1)
         and ($2::text is null or principal_id = $2)
         and ($3::text is null or route_group = $3)
       order by updated_at desc
       limit $4`,
      [filter.tenantId, filter.principalId, filter.routeGroup, filter.limit ?? 100],
    );
    return result.rows.map(mapRateLimit);
  }

  async recordBackpressureSignal(signal: OperationalBackpressureSignal): Promise<OperationalBackpressureSignal> {
    const result = await this.pool.query<BackpressureRow>(
      `insert into operational_backpressure_signals (id, tenant_id, workspace_id, component, status, severity, reason, safe_message, observed_at, details)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning *`,
      [signal.id, signal.tenantId, signal.workspaceId, signal.component, signal.status, signal.severity, signal.reason, signal.safeMessage, signal.observedAt, JSON.stringify(signal.details ?? {})],
    );
    return mapBackpressure(result.rows[0]);
  }

  async listBackpressureSignals(filter: { tenantId?: string; workspaceId?: string; component?: OperationalBackpressureSignal["component"]; activeOnly?: boolean; limit?: number } = {}): Promise<readonly OperationalBackpressureSignal[]> {
    const result = await this.pool.query<BackpressureRow>(
      `select * from operational_backpressure_signals
       where ($1::text is null or tenant_id = $1)
         and ($2::text is null or workspace_id = $2)
         and ($3::text is null or component = $3)
         and ($4::boolean = false or status = 'active')
       order by observed_at desc
       limit $5`,
      [filter.tenantId, filter.workspaceId, filter.component, filter.activeOnly === true, filter.limit ?? 100],
    );
    return result.rows.map(mapBackpressure);
  }

  async recordSloSnapshot(snapshot: SloSnapshot): Promise<SloSnapshot> {
    const result = await this.pool.query<SloRow>(
      `insert into operational_slo_snapshots (id, tenant_id, workspace_id, metric_id, objective, current_value, status, window_label, generated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning *`,
      [snapshot.id, snapshot.tenantId, snapshot.workspaceId, snapshot.metricId, snapshot.objective, snapshot.currentValue, snapshot.status, snapshot.window, snapshot.generatedAt],
    );
    return mapSlo(result.rows[0]);
  }

  async listSloSnapshots(filter: { tenantId?: string; workspaceId?: string; metricId?: string; limit?: number } = {}): Promise<readonly SloSnapshot[]> {
    const result = await this.pool.query<SloRow>(
      `select * from operational_slo_snapshots
       where ($1::text is null or tenant_id = $1)
         and ($2::text is null or workspace_id = $2)
         and ($3::text is null or metric_id = $3)
       order by generated_at desc
       limit $4`,
      [filter.tenantId, filter.workspaceId, filter.metricId, filter.limit ?? 100],
    );
    return result.rows.map(mapSlo);
  }
}

type CircuitBreakerRow = {
  id: string;
  tenant_id: string | null;
  workspace_id: string | null;
  scope: OperationalCircuitBreakerKey["scope"];
  target: string;
  state: OperationalCircuitBreakerSnapshot["state"];
  failure_count: number;
  opened_at: Date | string | null;
  half_open_at: Date | string | null;
  last_failure_code: string | null;
  last_failure_category: string | null;
  updated_at: Date | string;
};

type RateLimitRow = {
  bucket_key: string;
  route_group: string;
  tenant_id: string | null;
  principal_id: string | null;
  ip: string | null;
  limit_value: number;
  remaining: number;
  reset_at: Date | string;
  updated_at: Date | string;
};

type BackpressureRow = {
  id: string;
  tenant_id: string | null;
  workspace_id: string | null;
  component: OperationalBackpressureSignal["component"];
  status: OperationalBackpressureSignal["status"];
  severity: OperationalBackpressureSignal["severity"];
  reason: string;
  safe_message: string;
  observed_at: Date | string;
  details: Record<string, unknown> | string | null;
};

type SloRow = {
  id: string;
  tenant_id: string | null;
  workspace_id: string | null;
  metric_id: string;
  objective: number | string;
  current_value: number | string;
  status: SloSnapshot["status"];
  window_label: string;
  generated_at: Date | string;
};

function mapCircuitBreaker(row: CircuitBreakerRow): OperationalCircuitBreakerSnapshot {
  return {
    id: row.id,
    tenantId: row.tenant_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    scope: row.scope,
    target: row.target,
    state: row.state,
    failureCount: Number(row.failure_count),
    openedAt: iso(row.opened_at),
    halfOpenAt: iso(row.half_open_at),
    lastFailureCode: row.last_failure_code ?? undefined,
    lastFailureCategory: row.last_failure_category ?? undefined,
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  };
}

function mapRateLimit(row: RateLimitRow): OperationalRateLimitBucket {
  return {
    key: row.bucket_key,
    routeGroup: row.route_group,
    tenantId: row.tenant_id ?? undefined,
    principalId: row.principal_id ?? undefined,
    ip: row.ip ?? undefined,
    limit: Number(row.limit_value),
    remaining: Number(row.remaining),
    resetAt: iso(row.reset_at) ?? new Date().toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  };
}

function mapBackpressure(row: BackpressureRow): OperationalBackpressureSignal {
  return {
    id: row.id,
    tenantId: row.tenant_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    component: row.component,
    status: row.status,
    severity: row.severity,
    reason: row.reason,
    safeMessage: row.safe_message,
    observedAt: iso(row.observed_at) ?? new Date().toISOString(),
    details: parseJson(row.details),
  };
}

function mapSlo(row: SloRow): SloSnapshot {
  return {
    id: row.id,
    tenantId: row.tenant_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    metricId: row.metric_id,
    objective: Number(row.objective),
    currentValue: Number(row.current_value),
    status: row.status,
    window: row.window_label,
    generatedAt: iso(row.generated_at) ?? new Date().toISOString(),
  };
}

function iso(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseJson(value: Record<string, unknown> | string | null): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

