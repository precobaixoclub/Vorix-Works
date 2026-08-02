import type { ClockPort } from "../ports/clock.port.js";
import type { OperationalAuditRepositoryPort } from "../ports/operational-audit-repository.port.js";
import type { AnalyticsRepositoryPort } from "../ports/analytics-repository.port.js";
import {
  ANALYTICS_DIMENSIONS,
  ANALYTICS_EVENT_TYPES,
  type AnalyticsAlertOccurrence,
  type AnalyticsAggregation,
  type AnalyticsDataQualityIssue,
  type AnalyticsDataQualityReport,
  type AnalyticsDimensionId,
  type AnalyticsEvent,
  type AnalyticsEventType,
  type AnalyticsExportJob,
  type AnalyticsFilter,
  type AnalyticsHealth,
  type AnalyticsInsight,
  type AnalyticsPeriod,
  type AnalyticsPeriodGranularity,
  type AnalyticsQuery,
  type AnalyticsQueryResult,
  type AnalyticsSeriesPoint,
  type AnalyticsSnapshot,
  type ProviderMetricSnapshot,
} from "../../domain/analytics/analytics.model.js";
import type { AuditActor } from "../../domain/credential/credential.model.js";
import type { PublicationProvider } from "../../domain/publication/publication.model.js";
import { assertIanaTimezone, zonedTimeToUtc } from "../scheduling/timezone.js";
import { AnalyticsMetricRegistry } from "./analytics-metric-registry.js";

export type AnalyticsServicesDeps = {
  repository: AnalyticsRepositoryPort;
  auditRepository: OperationalAuditRepositoryPort;
  clock: ClockPort;
  metricRegistry: AnalyticsMetricRegistry;
  idGenerator: () => string;
  maxQueryDays?: number;
};

export class AnalyticsEventValidator {
  constructor(private readonly registry: AnalyticsMetricRegistry) {}

  validate(event: AnalyticsEvent): readonly string[] {
    const issues: string[] = [];
    if (!event.eventId) issues.push("eventId ausente");
    if (!(ANALYTICS_EVENT_TYPES as readonly string[]).includes(event.eventType)) issues.push(`eventType invalido: ${event.eventType}`);
    if (!Number.isInteger(event.eventVersion) || event.eventVersion < 1) issues.push("eventVersion invalido");
    if (Number.isNaN(new Date(event.occurredAt).getTime())) issues.push("occurredAt invalido");
    if (Number.isNaN(new Date(event.ingestedAt).getTime())) issues.push("ingestedAt invalido");
    if (!event.tenantId) issues.push("tenantId ausente");
    if (!event.workspaceId) issues.push("workspaceId ausente");
    if (!event.correlationId) issues.push("correlationId ausente");
    if (event.schemaVersion !== 1) issues.push(`schemaVersion nao suportada: ${event.schemaVersion}`);
    for (const key of Object.keys(event.dimensions ?? {})) {
      if (!(ANALYTICS_DIMENSIONS as readonly string[]).includes(key)) issues.push(`dimension nao registrada: ${key}`);
    }
    for (const [key, value] of Object.entries(event.measurements ?? {})) {
      if (!Number.isFinite(value)) issues.push(`measurement invalida: ${key}`);
    }
    for (const key of Object.keys(event.metadata ?? {})) {
      if (SENSITIVE_KEY_RE.test(key)) issues.push(`metadata sensivel rejeitada: ${key}`);
    }
    return issues;
  }
}

export class AnalyticsEventDeduplicator {
  constructor(private readonly repository: AnalyticsRepositoryPort) {}

  async isDuplicate(event: AnalyticsEvent): Promise<boolean> {
    return Boolean(await this.repository.getEvent({ tenantId: event.tenantId, eventId: event.eventId }));
  }
}

export class AnalyticsDeadLetterService {
  constructor(private readonly deps: Pick<AnalyticsServicesDeps, "repository" | "clock" | "idGenerator">) {}

  async deadLetter(input: { tenantId: string; workspaceId?: string; eventId?: string; reason: string; safeMessage: string; payload?: unknown }) {
    return this.deps.repository.createDeadLetter({
      id: this.deps.idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      eventId: input.eventId,
      reason: input.reason,
      safeMessage: input.safeMessage,
      payloadDigest: input.payload ? digestPayload(input.payload) : undefined,
      status: "pending",
    });
  }

  list(input: { tenantId: string; workspaceId?: string; status?: "pending" | "reprocessed" | "ignored"; limit?: number }) {
    return this.deps.repository.listDeadLetters(input);
  }

  reprocess(input: { tenantId: string; id: string }) {
    return this.deps.repository.reprocessDeadLetter({ ...input, now: this.deps.clock.now().toISOString() });
  }
}

export class AnalyticsEventIngestionService {
  private readonly validator: AnalyticsEventValidator;
  private readonly deduplicator: AnalyticsEventDeduplicator;
  readonly deadLetters: AnalyticsDeadLetterService;

  constructor(private readonly deps: AnalyticsServicesDeps) {
    this.validator = new AnalyticsEventValidator(deps.metricRegistry);
    this.deduplicator = new AnalyticsEventDeduplicator(deps.repository);
    this.deadLetters = new AnalyticsDeadLetterService(deps);
  }

  async ingest(input: Omit<AnalyticsEvent, "ingestedAt" | "schemaVersion"> & { ingestedAt?: string; schemaVersion?: number }): Promise<{ accepted: boolean; duplicate: boolean; event?: AnalyticsEvent; deadLetterId?: string; issues: readonly string[] }> {
    const now = this.deps.clock.now().toISOString();
    const event: AnalyticsEvent = {
      ...input,
      ingestedAt: input.ingestedAt ?? now,
      schemaVersion: input.schemaVersion ?? 1,
      dimensions: sanitizeDimensions(input.dimensions ?? {}),
      measurements: input.measurements ?? {},
      metadata: sanitizeMetadata(input.metadata ?? {}),
    };
    const issues = this.validator.validate(event);
    if (issues.length > 0) {
      const deadLetter = await this.deadLetters.deadLetter({ tenantId: event.tenantId || "unknown", workspaceId: event.workspaceId, eventId: event.eventId, reason: "validation_failed", safeMessage: issues.join("; "), payload: event });
      return { accepted: false, duplicate: false, deadLetterId: deadLetter.id, issues };
    }
    if (await this.deduplicator.isDuplicate(event)) return { accepted: true, duplicate: true, event, issues: [] };
    const result = await this.deps.repository.appendEvent(event);
    return { accepted: true, duplicate: result.duplicate, event: result.event, issues: [] };
  }

  async replay(events: readonly AnalyticsEvent[]): Promise<{ accepted: number; duplicated: number; rejected: number }> {
    let accepted = 0;
    let duplicated = 0;
    let rejected = 0;
    for (const event of events) {
      const result = await this.ingest(event);
      if (!result.accepted) rejected += 1;
      else if (result.duplicate) duplicated += 1;
      else accepted += 1;
    }
    return { accepted, duplicated, rejected };
  }
}

export class AnalyticsEventConsumer {
  constructor(private readonly ingestion: AnalyticsEventIngestionService) {}

  consume(event: Omit<AnalyticsEvent, "ingestedAt" | "schemaVersion"> & { ingestedAt?: string; schemaVersion?: number }) {
    return this.ingestion.ingest(event);
  }
}

export class AnalyticsAggregationService {
  constructor(private readonly registry: AnalyticsMetricRegistry) {}

  aggregate(events: readonly AnalyticsEvent[], query: Pick<AnalyticsQuery, "metrics" | "groupBy" | "filters">): readonly AnalyticsAggregation[] {
    const filtered = applyFilters(events, query.filters ?? []);
    const groups = new Map<string, { dimensions: Record<string, string>; events: AnalyticsEvent[] }>();
    for (const event of filtered) {
      const dimensions = Object.fromEntries((query.groupBy ?? []).map((dimension) => [dimension, event.dimensions[dimension] ?? dimensionValue(event, dimension) ?? "unknown"]));
      const key = stableKey(dimensions);
      const group = groups.get(key) ?? { dimensions, events: [] };
      group.events.push(event);
      groups.set(key, group);
    }
    if (groups.size === 0) groups.set("{}", { dimensions: {}, events: [] });
    const aggregations: AnalyticsAggregation[] = [];
    for (const group of groups.values()) {
      for (const metricId of query.metrics) {
        this.registry.require(metricId);
        aggregations.push({ metricId, dimensions: group.dimensions, value: computeMetric(metricId, group.events), sourceEventCount: group.events.length });
      }
    }
    return aggregations;
  }
}

export class AnalyticsSnapshotBuilder {
  private readonly aggregation: AnalyticsAggregationService;

  constructor(private readonly deps: Pick<AnalyticsServicesDeps, "repository" | "metricRegistry" | "clock" | "idGenerator">) {
    this.aggregation = new AnalyticsAggregationService(deps.metricRegistry);
  }

  async build(input: { tenantId: string; workspaceId: string; period: AnalyticsPeriod; metrics: readonly string[]; groupBy?: readonly AnalyticsDimensionId[]; granularity: AnalyticsPeriodGranularity }): Promise<AnalyticsSnapshot[]> {
    const resolved = resolvePeriod(input.period, input.period.timezone);
    const events = await this.deps.repository.listEvents({ tenantId: input.tenantId, workspaceId: input.workspaceId, from: resolved.from, to: resolved.to, limit: 1_000_000 });
    const aggregations = this.aggregation.aggregate(events, { metrics: input.metrics, groupBy: input.groupBy, filters: [] });
    const snapshots = aggregations.map((aggregation) => ({
      id: this.deps.idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      snapshotPeriod: input.granularity,
      periodStartUtc: resolved.from,
      periodEndUtc: resolved.to,
      timezone: resolved.timezone,
      metricId: aggregation.metricId,
      dimensions: aggregation.dimensions,
      value: aggregation.value,
      sourceEventCount: aggregation.sourceEventCount,
      rebuiltAt: this.deps.clock.now().toISOString(),
    }));
    return this.deps.repository.upsertSnapshots(snapshots);
  }
}

export class AnalyticsSnapshotRebuilder {
  constructor(private readonly builder: AnalyticsSnapshotBuilder, private readonly repository: AnalyticsRepositoryPort) {}

  async rebuild(input: { tenantId: string; workspaceId: string; period: AnalyticsPeriod; metrics: readonly string[]; groupBy?: readonly AnalyticsDimensionId[]; granularity: AnalyticsPeriodGranularity }) {
    const resolved = resolvePeriod(input.period, input.period.timezone);
    await this.repository.deleteSnapshots({ tenantId: input.tenantId, workspaceId: input.workspaceId, from: resolved.from, to: resolved.to, snapshotPeriod: input.granularity });
    return this.builder.build(input);
  }
}

export class AnalyticsQueryValidator {
  constructor(private readonly registry: AnalyticsMetricRegistry, private readonly maxQueryDays = 370) {}

  validate(query: AnalyticsQuery): { from: string; to: string; timezone: string } {
    if (!query.tenantId || !query.workspaceId) throw new Error("ANALYTICS_QUERY_SCOPE_REQUIRED: tenantId/workspaceId obrigatorios.");
    assertIanaTimezone(query.timezone);
    for (const metricId of query.metrics) this.registry.require(metricId);
    for (const dimension of [...(query.dimensions ?? []), ...(query.groupBy ?? [])]) this.registry.assertDimension(dimension);
    for (const filter of query.filters ?? []) {
      if (filter.dimension !== "metricId" && filter.dimension !== "eventType") this.registry.assertDimension(filter.dimension);
    }
    const resolved = resolvePeriod(query.period, query.timezone);
    const days = (new Date(resolved.to).getTime() - new Date(resolved.from).getTime()) / 86_400_000;
    if (days > this.maxQueryDays) throw new Error(`ANALYTICS_QUERY_RANGE_TOO_LARGE: limite de ${this.maxQueryDays} dias excedido.`);
    return resolved;
  }
}

export class AnalyticsQueryPlanner {
  plan(query: AnalyticsQuery) {
    return { useEvents: true, groupBy: query.groupBy ?? query.dimensions ?? [], limit: Math.max(1, Math.min(query.limit ?? 100, 500)) };
  }
}

export class AnalyticsQueryService {
  private readonly validator: AnalyticsQueryValidator;
  private readonly planner = new AnalyticsQueryPlanner();
  private readonly aggregation: AnalyticsAggregationService;

  constructor(private readonly deps: AnalyticsServicesDeps) {
    this.validator = new AnalyticsQueryValidator(deps.metricRegistry, deps.maxQueryDays ?? 370);
    this.aggregation = new AnalyticsAggregationService(deps.metricRegistry);
  }

  async query(input: AnalyticsQuery): Promise<AnalyticsQueryResult> {
    const started = this.deps.clock.now().getTime();
    const resolved = this.validator.validate(input);
    const plan = this.planner.plan(input);
    const events = await this.deps.repository.listEvents({ tenantId: input.tenantId, workspaceId: input.workspaceId, from: resolved.from, to: resolved.to, limit: 1_000_000 });
    const rows = aggregationsToPoints(resolved, this.aggregation.aggregate(events, { metrics: input.metrics, groupBy: plan.groupBy, filters: input.filters ?? [] }))
      .slice(0, plan.limit);
    const comparisons = input.comparisonPeriod ? await this.compare(input, rows) : [];
    const unavailableMetrics = input.metrics.filter((metricId) => metricId.includes("cost") && !events.some((event) => event.measurements.cost !== undefined));
    await this.ingestOperationalMetric(input.tenantId, input.workspaceId, "analytics_query_total", 1, started);
    return {
      metrics: input.metrics.map((metricId) => this.deps.metricRegistry.require(metricId)),
      period: resolved,
      rows,
      series: { granularity: chooseGranularity(resolved.from, resolved.to), points: rows },
      comparisons,
      dataFreshness: {
        generatedAt: this.deps.clock.now().toISOString(),
        partialData: unavailableMetrics.length > 0,
        staleData: false,
        unavailableMetrics,
      },
    };
  }

  async overview(input: { tenantId: string; workspaceId: string; period: AnalyticsPeriod; timezone: string }) {
    return this.query({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      timezone: input.timezone,
      period: input.period,
      metrics: [
        "publication_requested_total",
        "publication_completed_total",
        "publication_failed_total",
        "publication_success_rate",
        "publication_completion_latency_ms",
        "schedules_active_total",
        "schedule_occurrences_missed_total",
        "publication_dead_letter_total",
        "publication_reconciled_total",
        "execution_cost_total",
        "credential_failure_total",
      ],
    });
  }

  async compare(input: AnalyticsQuery, currentRows?: readonly AnalyticsSeriesPoint[]) {
    const current = currentRows ?? (await this.query({ ...input, comparisonPeriod: undefined })).rows;
    if (!input.comparisonPeriod) return [];
    const previousResult = await this.query({ ...input, period: input.comparisonPeriod, comparisonPeriod: undefined });
    const previousByMetric = new Map<string, number>();
    for (const row of previousResult.rows) for (const [metricId, value] of Object.entries(row.values)) previousByMetric.set(metricId, Number(value ?? 0));
    return current.flatMap((row) => Object.entries(row.values).map(([metricId, value]) => {
      const currentValue = Number(value ?? 0);
      const previousValue = previousByMetric.get(metricId) ?? 0;
      const absoluteDifference = currentValue - previousValue;
      return {
        metricId,
        dimensions: row.dimensions,
        currentValue,
        previousValue,
        absoluteDifference,
        percentageDifference: previousValue === 0 ? null : (absoluteDifference / previousValue) * 100,
        trend: previousValue === 0 && currentValue > 0 ? "new" as const : absoluteDifference > 0 ? "up" as const : absoluteDifference < 0 ? "down" as const : "flat" as const,
      };
    }));
  }

  private async ingestOperationalMetric(tenantId: string, workspaceId: string, metricId: string, value: number, started: number) {
    const now = this.deps.clock.now().toISOString();
    await this.deps.repository.appendEvent({
      eventId: `${metricId}:${now}:${Math.random().toString(36).slice(2, 8)}`,
      eventType: "analytics_compensation",
      eventVersion: 1,
      occurredAt: now,
      ingestedAt: now,
      tenantId,
      workspaceId,
      correlationId: metricId,
      dimensions: { tenant: tenantId, workspace: workspaceId },
      measurements: { [metricId]: value, analytics_query_latency_ms: this.deps.clock.now().getTime() - started },
      source: "analytics_query_service",
      sourceType: "internal",
      schemaVersion: 1,
    });
  }
}

export class AnalyticsDataQualityService {
  constructor(private readonly deps: Pick<AnalyticsServicesDeps, "repository" | "clock" | "idGenerator">) {}

  async report(input: { tenantId: string; workspaceId: string; from?: string; to?: string }): Promise<AnalyticsDataQualityReport> {
    const events = await this.deps.repository.listEvents({ tenantId: input.tenantId, workspaceId: input.workspaceId, from: input.from, to: input.to, limit: 1_000_000 });
    const issues: AnalyticsDataQualityIssue[] = [];
    const seen = new Set<string>();
    let previous = "";
    for (const event of events.sort((a, b) => a.ingestedAt.localeCompare(b.ingestedAt))) {
      if (seen.has(event.eventId)) issues.push({ code: "duplicate_event", severity: "warning", safeMessage: `Evento duplicado: ${event.eventId}` });
      seen.add(event.eventId);
      if (previous && event.occurredAt < previous) issues.push({ code: "out_of_order_event", severity: "warning", safeMessage: "Evento fora de ordem detectado.", evidence: { eventId: event.eventId } });
      previous = event.occurredAt;
      if (!event.workspaceId || !event.tenantId) issues.push({ code: "missing_scope", severity: "critical", safeMessage: "Evento sem escopo tenant/workspace.", evidence: { eventId: event.eventId } });
      if (event.eventType === "receipt_created" && !event.publicationId) issues.push({ code: "receipt_without_publication", severity: "critical", safeMessage: "Receipt sem publication.", evidence: { eventId: event.eventId } });
      if (event.eventType === "schedule_created" && !events.some((candidate) => candidate.scheduleId === event.scheduleId && candidate.eventType === "schedule_occurrence_generated")) issues.push({ code: "schedule_without_occurrence", severity: "warning", safeMessage: "Schedule sem occurrence gerada.", evidence: { scheduleId: event.scheduleId } });
      if (event.eventType === "schedule_occurrence_generated" && !events.some((candidate) => candidate.occurrenceId === event.occurrenceId && candidate.eventType === "schedule_occurrence_dispatched")) issues.push({ code: "occurrence_without_dispatch", severity: "warning", safeMessage: "Occurrence sem dispatch.", evidence: { occurrenceId: event.occurrenceId } });
    }
    const staleExternal = await this.deps.repository.listProviderMetricSnapshots({ tenantId: input.tenantId, workspaceId: input.workspaceId, limit: 1000 });
    const staleThreshold = this.deps.clock.now().getTime() - 7 * 86_400_000;
    if (staleExternal.some((snapshot) => new Date(snapshot.capturedAt).getTime() < staleThreshold)) issues.push({ code: "stale_external_metrics", severity: "warning", safeMessage: "Metricas externas simuladas desatualizadas." });
    const status = issues.some((issue) => issue.severity === "critical") ? "critical" : issues.length > 0 ? "warning" : "healthy";
    return this.deps.repository.saveDataQualityReport({ id: this.deps.idGenerator(), tenantId: input.tenantId, workspaceId: input.workspaceId, status, issues });
  }
}

export class AnalyticsInsightEngine {
  constructor(private readonly deps: Pick<AnalyticsServicesDeps, "repository" | "clock" | "idGenerator" | "metricRegistry">) {}

  async generate(input: { tenantId: string; workspaceId: string; period: AnalyticsPeriod; timezone: string }): Promise<AnalyticsInsight[]> {
    const queryService = new AnalyticsQueryService({ ...this.deps, auditRepository: noopAuditRepository(), maxQueryDays: 370 });
    const result = await queryService.query({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      timezone: input.timezone,
      period: input.period,
      metrics: ["publication_failure_rate", "schedule_late_rate", "credential_failure_total", "publication_dead_letter_total", "publication_reconciliation_rate"],
    });
    const values = Object.assign({}, ...result.rows.map((row) => row.values));
    const insights: AnalyticsInsight[] = [];
    const period = result.period;
    if (Number(values.publication_failure_rate ?? 0) >= 25) insights.push(this.insight(input, "failure_rate_high", "critical", "Falhas de publicacao elevadas", "A taxa de falha de publicacao passou do limite operacional.", ["publication_failure_rate"], period, { value: values.publication_failure_rate }));
    if (Number(values.schedule_late_rate ?? 0) >= 25) insights.push(this.insight(input, "schedule_delay_high", "warning", "Atraso crescente no calendario", "A taxa de atraso de occurrences esta elevada.", ["schedule_late_rate"], period, { value: values.schedule_late_rate }));
    if (Number(values.credential_failure_total ?? 0) > 0) insights.push(this.insight(input, "credential_failure", "critical", "Falhas de credencial detectadas", "Eventos de falha de credencial foram ingeridos no periodo.", ["credential_failure_total"], period, { value: values.credential_failure_total }));
    if (Number(values.publication_dead_letter_total ?? 0) > 0) insights.push(this.insight(input, "dead_letters_increase", "warning", "Dead letters aumentaram", "Ha dead letters de publicacao no periodo.", ["publication_dead_letter_total"], period, { value: values.publication_dead_letter_total }));
    return this.deps.repository.saveInsights(insights);
  }

  private insight(input: { tenantId: string; workspaceId: string }, type: string, severity: AnalyticsInsight["severity"], title: string, description: string, metricReferences: readonly string[], period: AnalyticsInsight["period"], evidence: Record<string, unknown>): AnalyticsInsight {
    return { insightId: this.deps.idGenerator(), tenantId: input.tenantId, workspaceId: input.workspaceId, type, severity, title, description, evidence, metricReferences, period, generatedAt: this.deps.clock.now().toISOString(), status: "active" };
  }
}

export class AnalyticsAlertService {
  constructor(private readonly deps: Pick<AnalyticsServicesDeps, "repository" | "clock" | "idGenerator" | "metricRegistry">) {}

  async evaluate(input: { tenantId: string; workspaceId: string; period: AnalyticsPeriod; timezone: string }): Promise<AnalyticsAlertOccurrence[]> {
    let rules = await this.deps.repository.listAlertRules({ tenantId: input.tenantId, workspaceId: input.workspaceId, enabledOnly: true });
    if (rules.length === 0) {
      rules = [
        await this.deps.repository.createAlertRule({ id: this.deps.idGenerator(), tenantId: input.tenantId, workspaceId: input.workspaceId, metricId: "publication_failure_rate", threshold: 25, comparison: "gte", severity: "critical", enabled: true }),
        await this.deps.repository.createAlertRule({ id: this.deps.idGenerator(), tenantId: input.tenantId, workspaceId: input.workspaceId, metricId: "publication_dead_letter_total", threshold: 0, comparison: "gt", severity: "warning", enabled: true }),
      ];
    }
    const queryService = new AnalyticsQueryService({ ...this.deps, auditRepository: noopAuditRepository(), maxQueryDays: 370 });
    const result = await queryService.query({ tenantId: input.tenantId, workspaceId: input.workspaceId, timezone: input.timezone, period: input.period, metrics: rules.map((rule) => rule.metricId) });
    const values = Object.assign({}, ...result.rows.map((row) => row.values));
    const occurrences: AnalyticsAlertOccurrence[] = [];
    for (const rule of rules) {
      const value = Number(values[rule.metricId] ?? 0);
      if (compare(value, rule.comparison, rule.threshold)) {
        occurrences.push(await this.deps.repository.upsertAlertOccurrence({
          id: this.deps.idGenerator(),
          ruleId: rule.id,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          status: "active",
          severity: rule.severity,
          title: `Alerta: ${rule.metricId}`,
          description: `Valor ${value} ultrapassou limite ${rule.comparison} ${rule.threshold}.`,
          metricId: rule.metricId,
          value,
        }));
      }
    }
    return occurrences;
  }

  list(input: { tenantId: string; workspaceId: string; status?: AnalyticsAlertOccurrence["status"]; limit?: number }) {
    return this.deps.repository.listAlertOccurrences(input);
  }

  acknowledge(input: { tenantId: string; workspaceId: string; id: string }) {
    return this.deps.repository.updateAlertOccurrence({ ...input, status: "acknowledged", now: this.deps.clock.now().toISOString() });
  }

  resolve(input: { tenantId: string; workspaceId: string; id: string }) {
    return this.deps.repository.updateAlertOccurrence({ ...input, status: "resolved", now: this.deps.clock.now().toISOString() });
  }
}

export class AnalyticsExportService {
  constructor(private readonly deps: AnalyticsServicesDeps) {}

  async requestExport(input: { tenantId: string; workspaceId: string; format: "csv" | "json"; query: AnalyticsQuery; requestedByUserId: string; actor: AuditActor; requestId?: string }): Promise<AnalyticsExportJob> {
    const job = await this.deps.repository.createExportJob({ id: this.deps.idGenerator(), tenantId: input.tenantId, workspaceId: input.workspaceId, format: input.format, filters: input.query, requestedByUserId: input.requestedByUserId });
    await this.deps.auditRepository.record({ id: this.deps.idGenerator(), tenantId: input.tenantId, workspaceId: input.workspaceId, eventType: "analytics_export_requested", actor: input.actor, resource: { type: "analytics" as never, id: job.id }, context: { requestId: input.requestId }, result: { status: "success" } });
    const result = await new AnalyticsQueryService(this.deps).query(input.query);
    const body = input.format === "json" ? JSON.stringify(result.rows, null, 2) : toCsv(result.rows);
    const completed = await this.deps.repository.completeExportJob({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      id: job.id,
      now: this.deps.clock.now().toISOString(),
      artifact: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        contentType: input.format === "json" ? "application/json" : "text/csv",
        body,
        expiresAt: new Date(this.deps.clock.now().getTime() + 7 * 86_400_000).toISOString(),
      },
    });
    await this.deps.auditRepository.record({ id: this.deps.idGenerator(), tenantId: input.tenantId, workspaceId: input.workspaceId, eventType: "analytics_export_completed", actor: input.actor, resource: { type: "analytics" as never, id: completed.job.id }, context: { requestId: input.requestId }, result: { status: "success" } });
    return completed.job;
  }

  get(input: { tenantId: string; workspaceId: string; id: string }) {
    return this.deps.repository.getExportJob(input);
  }
}

export class AnalyticsRetentionService {
  constructor(private readonly deps: Pick<AnalyticsServicesDeps, "auditRepository" | "clock" | "idGenerator">) {}

  async describePolicy(input: { tenantId: string; workspaceId: string }) {
    return {
      tenantId: input.tenantId,
      rawEventsDays: 400,
      aggregationsDays: 730,
      snapshotsDays: 730,
      exportsDays: 7,
      deadLettersDays: 180,
      providerMetricSnapshotsDays: 400,
    };
  }
}

export class AnalyticsHealthService {
  constructor(private readonly deps: Pick<AnalyticsServicesDeps, "repository" | "clock">) {}

  async health(input: { tenantId: string; workspaceId: string }): Promise<AnalyticsHealth> {
    const metrics = await this.deps.repository.metrics({ tenantId: input.tenantId, workspaceId: input.workspaceId });
    const deadLetters = await this.deps.repository.listDeadLetters({ tenantId: input.tenantId, workspaceId: input.workspaceId, status: "pending" });
    const latestDq = await this.deps.repository.getLatestDataQualityReport(input);
    const checks = [
      { id: "database", status: "pass" as const, safeMessage: "Repositorio analytics acessivel." },
      { id: "event_ingestion", status: (metrics.analytics_events_rejected_total ?? 0) > 0 ? "warn" as const : "pass" as const, safeMessage: "Ingestao operacional." },
      { id: "dead_letters", status: deadLetters.length > 0 ? "warn" as const : "pass" as const, safeMessage: `${deadLetters.length} dead letters pendentes.` },
      { id: "data_quality", status: latestDq?.status === "critical" ? "fail" as const : latestDq?.status === "warning" ? "warn" as const : "pass" as const, safeMessage: latestDq ? `Qualidade: ${latestDq.status}.` : "Sem relatorio de qualidade ainda." },
      { id: "query_service", status: "pass" as const, safeMessage: "Query service disponivel." },
      { id: "snapshot_builder", status: "pass" as const, safeMessage: "Snapshot builder disponivel." },
      { id: "export_jobs", status: "pass" as const, safeMessage: "Export jobs disponiveis." },
    ];
    const status = checks.some((check) => check.status === "fail") ? "unhealthy" : checks.some((check) => check.status === "warn") ? "degraded" : "healthy";
    return { status, checks, metrics, lastSuccessfulAggregationAt: this.deps.clock.now().toISOString(), lastSuccessfulSnapshotAt: this.deps.clock.now().toISOString() };
  }
}

export function createAnalyticsEvent(input: {
  eventId: string;
  eventType: AnalyticsEventType;
  tenantId: string;
  workspaceId: string;
  occurredAt: string;
  correlationId?: string;
  campaignId?: string;
  planningId?: string;
  executionRunId?: string;
  publicationId?: string;
  publicationReceiptId?: string;
  scheduleId?: string;
  occurrenceId?: string;
  providerId?: PublicationProvider;
  targetId?: string;
  source?: string;
  sourceType?: AnalyticsEvent["sourceType"];
  dimensions?: AnalyticsEvent["dimensions"];
  measurements?: AnalyticsEvent["measurements"];
  causationId?: string;
  metadata?: Record<string, unknown>;
  ingestedAt?: string;
}): AnalyticsEvent {
  return {
    eventId: input.eventId,
    eventType: input.eventType,
    eventVersion: 1,
    occurredAt: input.occurredAt,
    ingestedAt: input.ingestedAt ?? new Date().toISOString(),
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    planningId: input.planningId,
    executionRunId: input.executionRunId,
    publicationId: input.publicationId,
    publicationReceiptId: input.publicationReceiptId,
    scheduleId: input.scheduleId,
    occurrenceId: input.occurrenceId,
    providerId: input.providerId,
    targetId: input.targetId,
    correlationId: input.correlationId ?? input.eventId,
    causationId: input.causationId,
    dimensions: sanitizeDimensions({
      tenant: input.tenantId,
      workspace: input.workspaceId,
      campaign: input.campaignId,
      provider: input.providerId,
      target: input.targetId,
      ...input.dimensions,
    }),
    measurements: input.measurements ?? {},
    source: input.source ?? "manual",
    sourceType: input.sourceType ?? "internal",
    schemaVersion: 1,
    metadata: sanitizeMetadata(input.metadata ?? {}),
  };
}

export function resolvePeriod(period: AnalyticsPeriod, timezone: string, baseDate = new Date()): { from: string; to: string; timezone: string } {
  assertIanaTimezone(timezone);
  if (period.preset === "custom") {
    if (!period.from || !period.to) throw new Error("ANALYTICS_PERIOD_CUSTOM_REQUIRED: from/to/timezone obrigatorios.");
    return { from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(), timezone };
  }
  const parts = localParts(baseDate, timezone);
  const date = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  const todayStart = zonedTimeToUtc(`${date}T00:00:00`, timezone);
  const today = new Date(todayStart);
  const startOfDay = (offsetDays: number) => new Date(today.getTime() + offsetDays * 86_400_000).toISOString();
  switch (period.preset) {
    case "today": return { from: startOfDay(0), to: startOfDay(1), timezone };
    case "yesterday": return { from: startOfDay(-1), to: startOfDay(0), timezone };
    case "last_7_days": return { from: startOfDay(-6), to: startOfDay(1), timezone };
    case "last_30_days": return { from: startOfDay(-29), to: startOfDay(1), timezone };
    case "current_week": {
      const dow = parts.weekday;
      return { from: startOfDay(-dow), to: startOfDay(7 - dow), timezone };
    }
    case "previous_week": {
      const dow = parts.weekday;
      return { from: startOfDay(-dow - 7), to: startOfDay(-dow), timezone };
    }
    case "current_month": {
      const from = zonedTimeToUtc(`${parts.year}-${pad(parts.month)}-01T00:00:00`, timezone);
      const toDate = new Date(Date.UTC(parts.year, parts.month, 1));
      return { from, to: zonedTimeToUtc(`${toDate.getUTCFullYear()}-${pad(toDate.getUTCMonth() + 1)}-01T00:00:00`, timezone), timezone };
    }
    case "previous_month": {
      const fromDate = new Date(Date.UTC(parts.year, parts.month - 2, 1));
      const toDate = new Date(Date.UTC(parts.year, parts.month - 1, 1));
      return { from: zonedTimeToUtc(`${fromDate.getUTCFullYear()}-${pad(fromDate.getUTCMonth() + 1)}-01T00:00:00`, timezone), to: zonedTimeToUtc(`${toDate.getUTCFullYear()}-${pad(toDate.getUTCMonth() + 1)}-01T00:00:00`, timezone), timezone };
    }
  }
}

function computeMetric(metricId: string, events: readonly AnalyticsEvent[]): number {
  if (metricId in DIRECT_MEASUREMENT_METRICS) return aggregateMeasurement(events, DIRECT_MEASUREMENT_METRICS[metricId], metricId.endsWith("_average") || metricId.endsWith("_latency_ms") || metricId.includes("average") || metricId.includes("duration"));
  const eventType = EVENT_COUNT_METRICS[metricId];
  if (eventType) return events.filter((event) => event.eventType === eventType).length + events.reduce((sum, event) => sum + (event.measurements[metricId] ?? 0), 0);
  switch (metricId) {
    case "publication_success_rate": return percentage(computeMetric("publication_completed_total", events), computeMetric("publication_requested_total", events));
    case "publication_failure_rate": return percentage(computeMetric("publication_failed_total", events), computeMetric("publication_requested_total", events));
    case "publication_reconciliation_rate": return percentage(computeMetric("publication_reconciled_total", events), computeMetric("publication_unknown_outcome_total", events));
    case "schedule_occurrence_success_rate": return percentage(computeMetric("schedule_occurrences_completed_total", events), computeMetric("schedule_occurrences_dispatched_total", events));
    case "schedule_on_time_rate": return percentage(events.filter((event) => event.measurements.scheduleDelayMs !== undefined && event.measurements.scheduleDelayMs <= 0).length, computeMetric("schedule_occurrences_dispatched_total", events));
    case "schedule_late_rate": return percentage(events.filter((event) => event.measurements.scheduleDelayMs !== undefined && event.measurements.scheduleDelayMs > 0).length, computeMetric("schedule_occurrences_dispatched_total", events));
    case "execution_success_rate": return percentage(computeMetric("execution_runs_completed_total", events), computeMetric("execution_runs_total", events));
    case "planning_to_publication_conversion_rate": return percentage(computeMetric("content_items_published_total", events), computeMetric("content_items_planned_total", events));
    case "campaign_completion_rate": return percentage(computeMetric("publication_completed_total", events), computeMetric("content_items_planned_total", events));
    case "schedules_active_total": return events.filter((event) => event.eventType === "schedule_created" && event.dimensions.scheduleStatus !== "cancelled").length;
    case "campaign_publication_volume": return computeMetric("publication_completed_total", events);
    case "content_items_published_total": return computeMetric("publication_completed_total", events);
    case "content_items_scheduled_total": return computeMetric("schedules_created_total", events);
    case "content_items_cancelled_total": return computeMetric("publication_cancelled_total", events);
    default: return events.reduce((sum, event) => sum + (event.measurements[metricId] ?? 0), 0);
  }
}

const EVENT_COUNT_METRICS: Record<string, AnalyticsEventType> = {
  publication_requested_total: "publication_requested",
  publication_completed_total: "publication_completed",
  publication_failed_total: "publication_failed",
  publication_unknown_outcome_total: "publication_unknown_outcome",
  publication_reconciled_total: "publication_reconciled",
  publication_cancelled_total: "publication_cancelled",
  receipt_created_total: "receipt_created",
  receipt_verified_total: "receipt_verified",
  schedules_created_total: "schedule_created",
  schedule_occurrences_generated_total: "schedule_occurrence_generated",
  schedule_occurrences_dispatched_total: "schedule_occurrence_dispatched",
  schedule_occurrences_completed_total: "schedule_occurrence_completed",
  schedule_occurrences_failed_total: "schedule_occurrence_failed",
  schedule_occurrences_missed_total: "schedule_occurrence_missed",
  schedule_occurrences_cancelled_total: "schedule_occurrence_cancelled",
  execution_runs_total: "execution_started",
  execution_runs_completed_total: "execution_completed",
  execution_runs_failed_total: "execution_failed",
  content_items_planned_total: "planning_created",
  content_items_generated_total: "execution_completed",
  content_items_approved_total: "planning_completed",
  content_items_rejected_total: "governance_denied",
  webhook_received_total: "webhook_received" as AnalyticsEventType,
  credential_failure_total: "credential_failure",
  governance_denial_total: "governance_denied",
};

const DIRECT_MEASUREMENT_METRICS: Record<string, string> = {
  publication_dispatch_latency_ms: "publicationDispatchLatencyMs",
  publication_completion_latency_ms: "publicationCompletionLatencyMs",
  publication_queue_wait_ms: "publicationQueueWaitMs",
  publication_retry_total: "publicationRetryTotal",
  publication_dead_letter_total: "publicationDeadLetterTotal",
  provider_error_total: "providerErrorTotal",
  provider_rate_limit_total: "providerRateLimitTotal",
  schedule_average_delay_ms: "scheduleDelayMs",
  schedule_conflict_total: "scheduleConflictTotal",
  schedule_dead_letter_total: "scheduleDeadLetterTotal",
  execution_duration_ms: "executionDurationMs",
  execution_task_duration_ms: "executionTaskDurationMs",
  execution_retry_total: "executionRetryTotal",
  execution_cost_total: "cost",
  execution_cost_average: "cost",
  execution_artifacts_total: "executionArtifactsTotal",
  execution_artifact_failure_total: "executionArtifactFailureTotal",
  average_planning_to_publication_time: "planningToPublicationMs",
  average_execution_to_publication_time: "executionToPublicationMs",
  average_schedule_lead_time: "scheduleLeadTimeMs",
};

function aggregateMeasurement(events: readonly AnalyticsEvent[], measurement: string, average: boolean): number {
  const values = events.map((event) => event.measurements[measurement]).filter((value): value is number => Number.isFinite(value));
  if (values.length === 0) return 0;
  const sum = values.reduce((total, value) => total + value, 0);
  return average ? sum / values.length : sum;
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : (numerator / denominator) * 100;
}

function applyFilters(events: readonly AnalyticsEvent[], filters: readonly AnalyticsFilter[]): AnalyticsEvent[] {
  return events.filter((event) => filters.every((filter) => {
    const expected = Array.isArray(filter.value) ? filter.value : [filter.value];
    const actual = filter.dimension === "eventType" ? event.eventType : filter.dimension === "metricId" ? Object.keys(event.measurements) : event.dimensions[filter.dimension];
    if (Array.isArray(actual)) return actual.some((value) => expected.includes(value));
    return expected.includes(String(actual ?? ""));
  }));
}

function dimensionValue(event: AnalyticsEvent, dimension: string): string | undefined {
  if (dimension === "provider") return event.providerId;
  if (dimension === "target") return event.targetId;
  if (dimension === "campaign") return event.campaignId;
  if (dimension === "tenant") return event.tenantId;
  if (dimension === "workspace") return event.workspaceId;
  return undefined;
}

function toPoint(period: { from: string; to: string; timezone: string }, aggregation: AnalyticsAggregation): AnalyticsSeriesPoint {
  return { key: `${aggregation.metricId}:${stableKey(aggregation.dimensions)}`, from: period.from, to: period.to, values: { [aggregation.metricId]: round(aggregation.value) }, dimensions: aggregation.dimensions };
}

function aggregationsToPoints(period: { from: string; to: string; timezone: string }, aggregations: readonly AnalyticsAggregation[]): AnalyticsSeriesPoint[] {
  const grouped = new Map<string, AnalyticsSeriesPoint>();
  for (const aggregation of aggregations) {
    const key = stableKey(aggregation.dimensions);
    const current = grouped.get(key) ?? { key, from: period.from, to: period.to, values: {}, dimensions: aggregation.dimensions };
    current.values[aggregation.metricId] = round(aggregation.value);
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

function chooseGranularity(from: string, to: string): AnalyticsPeriodGranularity {
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
  if (days <= 2) return "hourly";
  if (days <= 45) return "daily";
  if (days <= 180) return "weekly";
  return "monthly";
}

function sanitizeDimensions(input: Record<string, string | undefined>): AnalyticsEvent["dimensions"] {
  const output: Partial<Record<(typeof ANALYTICS_DIMENSIONS)[number], string>> = {};
  for (const [key, value] of Object.entries(input)) {
    if ((ANALYTICS_DIMENSIONS as readonly string[]).includes(key) && value !== undefined) output[key as keyof typeof output] = String(value);
  }
  return output as AnalyticsEvent["dimensions"];
}

function sanitizeMetadata(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => !SENSITIVE_KEY_RE.test(key) && typeof value !== "function"));
}

const SENSITIVE_KEY_RE = /(token|secret|password|authorization|cookie|oauth|header|payload|raw)/i;

function digestPayload(payload: unknown): string {
  const text = JSON.stringify(payload);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  return `digest-${Math.abs(hash).toString(16)}`;
}

function stableKey(input: Record<string, string>): string {
  return JSON.stringify(Object.keys(input).sort().map((key) => [key, input[key]]));
}

function localParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
  const mapped = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(mapped.weekday);
  return { year: Number(mapped.year), month: Number(mapped.month), day: Number(mapped.day), weekday: Math.max(0, weekday) };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function compare(value: number, comparison: "gt" | "gte" | "lt" | "lte", threshold: number): boolean {
  if (comparison === "gt") return value > threshold;
  if (comparison === "gte") return value >= threshold;
  if (comparison === "lt") return value < threshold;
  return value <= threshold;
}

function toCsv(rows: readonly AnalyticsSeriesPoint[]): string {
  const metricIds = [...new Set(rows.flatMap((row) => Object.keys(row.values)))];
  const dimensionIds = [...new Set(rows.flatMap((row) => Object.keys(row.dimensions)))];
  const header = ["key", "from", "to", ...dimensionIds, ...metricIds];
  const lines = rows.map((row) => header.map((key) => csvCell(key === "key" || key === "from" || key === "to" ? row[key] : row.dimensions[key] ?? row.values[key] ?? "")).join(","));
  return [header.join(","), ...lines].join("\n");
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function noopAuditRepository(): OperationalAuditRepositoryPort {
  return {
    async record(input) { return { ...input, createdAt: new Date().toISOString() }; },
    async list() { return []; },
    async export() { return { contentType: "application/json", body: "[]" }; },
  };
}
