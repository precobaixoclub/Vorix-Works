import type pg from "pg";
import type { AnalyticsHealthService } from "../analytics/analytics-services.js";
import type { PublicationMetrics } from "../publication/publication-observability.js";
import type { PublicationQueuePort } from "../publication/publication-queue.js";
import type { PublicationSecretStoragePort, PublicationSecretRecord } from "../publication/publication-secret-store.js";
import type { PublicationResolvedSecret } from "../publication/publication-secret-resolver.js";
import type { AnalyticsRepositoryPort } from "../ports/analytics-repository.port.js";
import type { OperationalStateRepositoryPort } from "../ports/operational-state-repository.port.js";
import type { PublicationRepositoryPort } from "../ports/publication-repository.port.js";
import type { SchedulingRepositoryPort } from "../ports/scheduling-repository.port.js";
import type { SecretManagerPort } from "../ports/secret-manager.port.js";
import type { SchedulingHealthService } from "../scheduling/scheduling-health-service.js";
import type { PublicationProvider } from "../../domain/publication/publication.model.js";
import type {
  OperationalBackpressureSignal,
  OperationalCheck,
  OperationalCircuitBreakerKey,
  OperationalCircuitBreakerSnapshot,
  OperationalHealthReport,
  OperationalLivenessReport,
  OperationalRateLimitBucket,
  OperationalReadinessReport,
  ReleaseGateDecision,
  SecretManagerHealth,
  SecretValue,
  SloSnapshot,
} from "../../domain/operations/operations.model.js";

const SENSITIVE_KEY_RE = /(token|secret|password|authorization|cookie|oauth|header|payload|raw|credential)/i;

export type EnvironmentPolicy = {
  environment: "development" | "test" | "staging" | "production";
  productionEnabled: boolean;
  providerEnvironment: "sandbox" | "production";
  canaryEnabled: boolean;
  canaryTenantIds: readonly string[];
  canaryWorkspaceIds: readonly string[];
  allowedProductionProviders: readonly PublicationProvider[];
};

export class ProductionGuard {
  constructor(private readonly policy: EnvironmentPolicy, private readonly secretManager: SecretManagerPort) {}

  async decide(input: { tenantId: string; workspaceId: string; providerId?: PublicationProvider; requiresExternalSideEffect?: boolean }): Promise<ReleaseGateDecision> {
    if (!input.requiresExternalSideEffect) return { allowed: true, reason: "allowed", safeMessage: "Operacao sem side effect externo." };
    if (this.policy.environment === "development" || this.policy.environment === "test") return { allowed: true, reason: "allowed", safeMessage: "Ambiente local/teste permitido." };
    if (this.policy.providerEnvironment !== "production") return { allowed: true, reason: "allowed", safeMessage: "Provider environment sandbox." };
    if (!this.policy.productionEnabled) return { allowed: false, reason: "production_disabled", safeMessage: "Production permanece bloqueado por configuracao." };
    if (!this.policy.canaryEnabled) return { allowed: false, reason: "canary_disabled", safeMessage: "Canario de producao desabilitado." };
    if (!this.policy.canaryTenantIds.includes(input.tenantId)) return { allowed: false, reason: "tenant_not_allowed", safeMessage: "Tenant fora do canario de producao." };
    if (!this.policy.canaryWorkspaceIds.includes(input.workspaceId)) return { allowed: false, reason: "workspace_not_allowed", safeMessage: "Workspace fora do canario de producao." };
    if (input.providerId && !this.policy.allowedProductionProviders.includes(input.providerId)) return { allowed: false, reason: "provider_not_allowed", safeMessage: "Provider fora da lista de producao permitida." };
    const secretHealth = await this.secretManager.health();
    if (!secretHealth.ok || secretHealth.provider !== "production") return { allowed: false, reason: "secret_manager_not_ready", safeMessage: "Secret Manager de producao indisponivel." };
    return { allowed: true, reason: "allowed", safeMessage: "Release gate aprovado para canario controlado." };
  }

  snapshot() {
    return {
      environment: this.policy.environment,
      productionEnabled: this.policy.productionEnabled,
      providerEnvironment: this.policy.providerEnvironment,
      canaryEnabled: this.policy.canaryEnabled,
      canaryTenantCount: this.policy.canaryTenantIds.length,
      canaryWorkspaceCount: this.policy.canaryWorkspaceIds.length,
      allowedProductionProviders: [...this.policy.allowedProductionProviders],
    };
  }
}

export class OperationalCircuitBreaker {
  constructor(
    private readonly repository: OperationalStateRepositoryPort,
    private readonly options: { failureThreshold?: number; cooldownMs?: number; now?: () => Date; idGenerator?: () => string } = {},
  ) {}

  async canExecute(key: OperationalCircuitBreakerKey): Promise<{ allowed: boolean; snapshot: OperationalCircuitBreakerSnapshot }> {
    const current = await this.repository.getCircuitBreaker(key) ?? this.closed(key);
    if (current.state === "open" && current.openedAt && this.now().getTime() - Date.parse(current.openedAt) >= (this.options.cooldownMs ?? 60_000)) {
      const halfOpen = await this.repository.upsertCircuitBreaker({ ...current, state: "half_open", halfOpenAt: this.nowIso(), updatedAt: this.nowIso() });
      return { allowed: true, snapshot: halfOpen };
    }
    return { allowed: current.state !== "open", snapshot: current };
  }

  async recordSuccess(key: OperationalCircuitBreakerKey): Promise<OperationalCircuitBreakerSnapshot> {
    return this.repository.upsertCircuitBreaker(this.closed(key));
  }

  async recordFailure(key: OperationalCircuitBreakerKey, failure: { code: string; category: string; retryable?: boolean }): Promise<OperationalCircuitBreakerSnapshot> {
    if (!countsForCircuit(failure.category)) return await this.repository.getCircuitBreaker(key) ?? this.closed(key);
    const current = await this.repository.getCircuitBreaker(key) ?? this.closed(key);
    const failureCount = failure.category === "authentication" ? (this.options.failureThreshold ?? 2) : current.failureCount + 1;
    const shouldOpen = failureCount >= (this.options.failureThreshold ?? 2) || failure.category === "authentication";
    return this.repository.upsertCircuitBreaker({
      ...current,
      ...key,
      state: shouldOpen ? "open" : "closed",
      failureCount,
      openedAt: shouldOpen ? this.nowIso() : current.openedAt,
      halfOpenAt: current.state === "half_open" ? current.halfOpenAt : undefined,
      lastFailureCode: failure.code,
      lastFailureCategory: failure.category,
      updatedAt: this.nowIso(),
    });
  }

  list(filter?: { tenantId?: string; workspaceId?: string; scope?: OperationalCircuitBreakerKey["scope"] }) {
    return this.repository.listCircuitBreakers(filter);
  }

  reset(id: string) {
    return this.repository.resetCircuitBreaker(id, this.nowIso());
  }

  private closed(key: OperationalCircuitBreakerKey): OperationalCircuitBreakerSnapshot {
    return {
      id: circuitId(key),
      ...key,
      state: "closed",
      failureCount: 0,
      updatedAt: this.nowIso(),
    };
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

export class OperationalRateLimiter {
  constructor(
    private readonly repository: OperationalStateRepositoryPort,
    private readonly options: { defaultLimit: number; windowMs: number; now?: () => Date },
  ) {}

  async consume(input: { routeGroup: string; tenantId?: string; principalId?: string; ip?: string; limit?: number }): Promise<{ allowed: boolean; bucket: OperationalRateLimitBucket; retryAfterMs?: number }> {
    const limit = input.limit ?? this.options.defaultLimit;
    const now = this.now();
    const key = rateLimitKey(input);
    const existing = await this.repository.getRateLimitBucket(key);
    const resetAt = existing ? new Date(existing.resetAt) : new Date(now.getTime() + this.options.windowMs);
    const expired = !existing || resetAt.getTime() <= now.getTime();
    const remainingBefore = expired ? limit : existing.remaining;
    const allowed = remainingBefore > 0;
    const bucket: OperationalRateLimitBucket = {
      key,
      routeGroup: input.routeGroup,
      tenantId: input.tenantId,
      principalId: input.principalId,
      ip: input.ip,
      limit,
      remaining: allowed ? remainingBefore - 1 : 0,
      resetAt: expired ? new Date(now.getTime() + this.options.windowMs).toISOString() : existing.resetAt,
      updatedAt: now.toISOString(),
    };
    const saved = await this.repository.upsertRateLimitBucket(bucket);
    return { allowed, bucket: saved, retryAfterMs: allowed ? undefined : Math.max(0, Date.parse(saved.resetAt) - now.getTime()) };
  }
 
  list(filter?: { tenantId?: string; principalId?: string; routeGroup?: string; limit?: number }) {
    return this.repository.listRateLimitBuckets(filter);
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }
}

export class BackpressureController {
  constructor(
    private readonly repository: OperationalStateRepositoryPort,
    private readonly options: {
      publicationQueueMax: number;
      publicationOutboxPendingMax: number;
      publicationDeadLetterMax: number;
      schedulingLateMsMax: number;
      analyticsDeadLetterMax: number;
      now?: () => Date;
      idGenerator?: () => string;
    },
  ) {}

  async evaluatePublication(input: { tenantId?: string; workspaceId?: string; metrics: PublicationMetrics }): Promise<OperationalBackpressureSignal> {
    const reasons: string[] = [];
    if (input.metrics.queueSize > this.options.publicationQueueMax) reasons.push("publication_queue_high");
    if (input.metrics.outboxPending > this.options.publicationOutboxPendingMax) reasons.push("publication_outbox_high");
    if (input.metrics.deadLetters > this.options.publicationDeadLetterMax) reasons.push("publication_dead_letters_high");
    const active = reasons.length > 0;
    return this.record({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      component: "publication",
      status: active ? "active" : "inactive",
      severity: active ? "critical" : "info",
      reason: active ? reasons.join(",") : "within_thresholds",
      safeMessage: active ? "Backpressure ativo para Publication." : "Publication dentro dos limites operacionais.",
      details: sanitizeDetails(input.metrics as unknown as Record<string, unknown>),
    });
  }

  async evaluateScheduling(input: { tenantId?: string; workspaceId?: string; lateDelayMs?: number; deadLetters?: number }): Promise<OperationalBackpressureSignal> {
    const active = (input.lateDelayMs ?? 0) > this.options.schedulingLateMsMax || (input.deadLetters ?? 0) > 0;
    return this.record({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      component: "scheduling",
      status: active ? "active" : "inactive",
      severity: active ? "warning" : "info",
      reason: active ? "scheduling_lag_or_dead_letters" : "within_thresholds",
      safeMessage: active ? "Backpressure preventivo para Scheduling." : "Scheduling dentro dos limites operacionais.",
      details: sanitizeDetails({ lateDelayMs: input.lateDelayMs ?? 0, deadLetters: input.deadLetters ?? 0 }),
    });
  }

  async evaluateAnalytics(input: { tenantId?: string; workspaceId?: string; deadLetters?: number; queryLatencyMs?: number }): Promise<OperationalBackpressureSignal> {
    const active = (input.deadLetters ?? 0) > this.options.analyticsDeadLetterMax;
    return this.record({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      component: "analytics",
      status: active ? "active" : "inactive",
      severity: active ? "warning" : "info",
      reason: active ? "analytics_dead_letters_high" : "within_thresholds",
      safeMessage: active ? "Backpressure preventivo para Analytics." : "Analytics dentro dos limites operacionais.",
      details: sanitizeDetails({ deadLetters: input.deadLetters ?? 0, queryLatencyMs: input.queryLatencyMs ?? 0 }),
    });
  }

  list(filter?: { tenantId?: string; workspaceId?: string; component?: OperationalBackpressureSignal["component"]; activeOnly?: boolean; limit?: number }) {
    return this.repository.listBackpressureSignals(filter);
  }

  private record(input: Omit<OperationalBackpressureSignal, "id" | "observedAt">) {
    return this.repository.recordBackpressureSignal({
      id: this.options.idGenerator?.() ?? `backpressure-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      observedAt: this.nowIso(),
      ...input,
    });
  }

  private nowIso(): string {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }
}

export class InMemoryTtlCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now().getTime()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.entries.set(key, { value, expiresAt: this.now().getTime() + ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  stats() {
    return { entries: this.entries.size };
  }
}

export class SecretManagerPublicationSecretStore implements PublicationSecretStoragePort {
  constructor(private readonly secretManager: SecretManagerPort) {}

  health(): Promise<SecretManagerHealth> {
    return this.secretManager.health();
  }

  put(input: PublicationSecretRecord): Promise<void> {
    return this.secretManager.put(secretReference(input), { value: input.value, expiresAt: input.expiresAt });
  }

  async get(input: { tenantId: string; workspaceId: string; providerId: PublicationProvider; credentialReferenceId: string }): Promise<PublicationResolvedSecret | undefined> {
    const secret = await this.secretManager.get(secretReference(input));
    if (!secret) return undefined;
    return { credentialReferenceId: input.credentialReferenceId, providerId: input.providerId, expiresAt: secret.expiresAt, value: { ...secret.value } };
  }

  delete(input: { tenantId: string; workspaceId: string; providerId: PublicationProvider; credentialReferenceId: string }): Promise<void> {
    return this.secretManager.delete(secretReference(input));
  }
}

export class OperationalHealthService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly deps: {
      repository: OperationalStateRepositoryPort;
      secretManager: SecretManagerPort;
      productionGuard: ProductionGuard;
      publicationQueue: PublicationQueuePort;
      pool?: pg.Pool;
      persistenceDriver: "memory" | "postgres";
      migrationsExpected?: readonly string[];
      publicationRepository: PublicationRepositoryPort;
      schedulingRepository: SchedulingRepositoryPort;
      analyticsRepository: AnalyticsRepositoryPort;
      schedulingHealthService: SchedulingHealthService;
      analyticsHealthService: AnalyticsHealthService;
      now?: () => Date;
    },
  ) {}

  liveness(): OperationalLivenessReport {
    return { alive: true, status: "ok", uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000), generatedAt: this.nowIso() };
  }

  async readiness(input: { tenantId?: string; workspaceId?: string } = {}): Promise<OperationalReadinessReport> {
    const checks: OperationalCheck[] = [];
    checks.push(await this.databaseCheck());
    checks.push(await this.secretCheck());
    checks.push(await this.operationalStateCheck());
    checks.push(this.productionGuardCheck());
    checks.push(await this.queueCheck());
    if (input.tenantId && input.workspaceId) {
      checks.push(await this.schedulingCheck(input.tenantId, input.workspaceId));
      checks.push(await this.analyticsCheck(input.tenantId, input.workspaceId));
    }
    const status = rollupStatus(checks);
    return { ready: status !== "unhealthy", status, generatedAt: this.nowIso(), checks };
  }

  async systemHealth(input: { tenantId?: string; workspaceId?: string } = {}): Promise<OperationalHealthReport & { releaseGate: ReturnType<ProductionGuard["snapshot"]>; circuitBreakers: readonly OperationalCircuitBreakerSnapshot[]; backpressure: readonly OperationalBackpressureSignal[]; slo: readonly SloSnapshot[] }> {
    const readiness = await this.readiness(input);
    return {
      status: readiness.status,
      generatedAt: readiness.generatedAt,
      checks: readiness.checks,
      releaseGate: this.deps.productionGuard.snapshot(),
      circuitBreakers: await this.deps.repository.listCircuitBreakers({ tenantId: input.tenantId, workspaceId: input.workspaceId }),
      backpressure: await this.deps.repository.listBackpressureSignals({ tenantId: input.tenantId, workspaceId: input.workspaceId, limit: 50 }),
      slo: await this.deps.repository.listSloSnapshots({ tenantId: input.tenantId, workspaceId: input.workspaceId, limit: 20 }),
    };
  }

  private async databaseCheck(): Promise<OperationalCheck> {
    const started = Date.now();
    if (this.deps.persistenceDriver === "memory") return check("database", "database", "pass", "Persistencia em memoria disponivel.", started, this.nowIso());
    if (!this.deps.pool) return check("database", "database", "fail", "PostgreSQL configurado sem pool disponivel.", started, this.nowIso());
    try {
      await this.deps.pool.query("select 1");
      return check("database", "database", "pass", "PostgreSQL acessivel.", started, this.nowIso());
    } catch {
      return check("database", "database", "fail", "PostgreSQL indisponivel.", started, this.nowIso());
    }
  }

  private async secretCheck(): Promise<OperationalCheck> {
    const started = Date.now();
    const health = await this.deps.secretManager.health();
    return check("secret_manager", "secrets", health.ok ? "pass" : "fail", health.safeMessage ?? "Secret Manager verificado.", started, this.nowIso(), { provider: health.provider });
  }

  private async operationalStateCheck(): Promise<OperationalCheck> {
    const started = Date.now();
    const result = await this.deps.repository.health();
    return check("operational_state", "operations", result.ok ? "pass" : "fail", result.safeMessage ?? "Repositorio operacional verificado.", started, this.nowIso());
  }

  private productionGuardCheck(): OperationalCheck {
    const snapshot = this.deps.productionGuard.snapshot();
    return { id: "production_guard", component: "release", status: snapshot.productionEnabled ? "warn" : "pass", safeMessage: snapshot.productionEnabled ? "Production habilitado por configuracao." : "Production bloqueado por padrao.", observedAt: this.nowIso(), details: sanitizeDetails(snapshot) };
  }

  private async queueCheck(): Promise<OperationalCheck> {
    const started = Date.now();
    const size = await this.deps.publicationQueue.size();
    return check("publication_queue", "publication", size > 1000 ? "warn" : "pass", `Fila local de publication com ${size} jobs.`, started, this.nowIso(), { size });
  }

  private async schedulingCheck(tenantId: string, workspaceId: string): Promise<OperationalCheck> {
    const started = Date.now();
    const health = await this.deps.schedulingHealthService.health({ tenantId, workspaceId });
    return check("scheduling", "scheduling", health.status === "unhealthy" ? "fail" : health.status === "degraded" ? "warn" : "pass", `Scheduling ${health.status}.`, started, this.nowIso(), { status: health.status });
  }

  private async analyticsCheck(tenantId: string, workspaceId: string): Promise<OperationalCheck> {
    const started = Date.now();
    const health = await this.deps.analyticsHealthService.health({ tenantId, workspaceId });
    return check("analytics", "analytics", health.status === "unhealthy" ? "fail" : health.status === "degraded" ? "warn" : "pass", `Analytics ${health.status}.`, started, this.nowIso(), { status: health.status });
  }

  private nowIso(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }
}

export class BackupRestorePlanner {
  describePlan() {
    return {
      sourceOfTruth: ["publication_outbox", "publication_receipts", "schedule_occurrences", "analytics_events", "operational_audit_logs", "credentials"],
      derivedData: ["analytics_snapshots", "analytics_aggregations", "health_summaries"],
      restoreOrder: ["schema_migrations", "identity", "workspace", "credentials", "publication", "scheduling", "webhooks", "analytics_events", "operational_state", "derived_rebuild"],
      consistencyChecks: ["analytics snapshot rebuild", "outbox no duplicate dispatch", "scheduling fencing preserved", "secret values never exported"],
    };
  }
}

export function redactOperationalValue<T>(input: T): T {
  if (Array.isArray(input)) return input.map((item) => redactOperationalValue(item)) as T;
  if (input && typeof input === "object") {
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, SENSITIVE_KEY_RE.test(key) ? "[REDACTED]" : redactOperationalValue(value)])) as T;
  }
  return input;
}

function circuitId(key: OperationalCircuitBreakerKey): string {
  return [key.tenantId ?? "global", key.workspaceId ?? "global", key.scope, key.target].join(":");
}

function rateLimitKey(input: { routeGroup: string; tenantId?: string; principalId?: string; ip?: string }): string {
  return [input.routeGroup, input.tenantId ?? "anonymous", input.principalId ?? "anonymous", input.ip ?? "unknown"].join(":");
}

function secretReference(input: { tenantId: string; workspaceId: string; providerId: PublicationProvider; credentialReferenceId: string }): string {
  return `publication/${input.tenantId}/${input.workspaceId}/${input.providerId}/${input.credentialReferenceId}`;
}

function countsForCircuit(category: string): boolean {
  return category === "timeout" || category === "provider_unavailable" || category === "rate_limited" || category === "authentication";
}

function check(id: string, component: string, status: OperationalCheck["status"], safeMessage: string, started: number, observedAt: string, details?: Record<string, unknown>): OperationalCheck {
  return { id, component, status, safeMessage, observedAt, latencyMs: Math.max(0, Date.now() - started), details: details ? sanitizeDetails(details) : undefined };
}

function rollupStatus(checks: readonly OperationalCheck[]): OperationalHealthReport["status"] {
  if (checks.some((item) => item.status === "fail")) return "unhealthy";
  if (checks.some((item) => item.status === "warn")) return "degraded";
  return "healthy";
}

function sanitizeDetails(input: Record<string, unknown>): Record<string, unknown> {
  return redactOperationalValue(input);
}
