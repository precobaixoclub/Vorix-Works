import type { FastifyInstance } from "fastify";
import type { AnalyticsRepositoryPort } from "../../../../application/ports/analytics-repository.port.js";
import type { OperationalAuditRepositoryPort } from "../../../../application/ports/operational-audit-repository.port.js";
import type { AnalyticsAlertService, AnalyticsDataQualityService, AnalyticsEventIngestionService, AnalyticsExportService, AnalyticsHealthService, AnalyticsInsightEngine, AnalyticsQueryService, AnalyticsSnapshotRebuilder } from "../../../../application/analytics/analytics-services.js";
import type { AnalyticsMetricRegistry } from "../../../../application/analytics/analytics-metric-registry.js";
import type { AnalyticsEvent, AnalyticsPeriod, AnalyticsQuery } from "../../../../domain/analytics/analytics.model.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

const WORKSPACE_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    period: { type: "string" },
    timezone: { type: "string" },
    providerId: { type: "string" },
    campaignId: { type: "string" },
    status: { type: "string" },
  },
} as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

export type AnalyticsRoutesDeps = {
  repository: AnalyticsRepositoryPort;
  auditRepository: OperationalAuditRepositoryPort;
  metricRegistry: AnalyticsMetricRegistry;
  ingestionService: AnalyticsEventIngestionService;
  queryService: AnalyticsQueryService;
  snapshotRebuilder: AnalyticsSnapshotRebuilder;
  dataQualityService: AnalyticsDataQualityService;
  insightEngine: AnalyticsInsightEngine;
  alertService: AnalyticsAlertService;
  exportService: AnalyticsExportService;
  healthService: AnalyticsHealthService;
  idGenerator: () => string;
  defaultTimezone: string;
};

export async function registerAnalyticsRoutes(app: FastifyInstance, deps: AnalyticsRoutesDeps): Promise<void> {
  app.get("/analytics/overview", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "analytics:read");
    const query = request.query as AnalyticsWorkspaceQuery;
    const timezone = query.timezone ?? deps.defaultTimezone;
    return successEnvelope(await deps.queryService.overview({ tenantId: principal.tenantId, workspaceId: query.workspaceId, timezone, period: parsePeriod(query.period, timezone) }), request.id);
  });

  app.post("/analytics/query", { schema: { body: analyticsQueryBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "analytics:query");
    const body = request.body as Partial<AnalyticsQuery> & { workspaceId: string };
    return successEnvelope(await deps.queryService.query({
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      metrics: body.metrics ?? ["publication_requested_total"],
      dimensions: body.dimensions,
      filters: body.filters,
      groupBy: body.groupBy,
      orderBy: body.orderBy,
      limit: body.limit,
      period: body.period ?? { preset: "last_30_days", timezone: body.timezone ?? deps.defaultTimezone },
      timezone: body.timezone ?? deps.defaultTimezone,
      comparisonPeriod: body.comparisonPeriod,
    }), request.id);
  });

  app.get("/analytics/metrics", async (request) => {
    requirePermission(request, "analytics:read");
    return successEnvelope(deps.metricRegistry.list(), request.id);
  });

  app.get("/analytics/providers", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "analytics:read");
    const query = request.query as AnalyticsWorkspaceQuery;
    return successEnvelope(await groupedQuery(deps, principal.tenantId, query, ["publication_requested_total", "publication_completed_total", "publication_failed_total", "publication_success_rate", "publication_completion_latency_ms", "provider_rate_limit_total", "credential_failure_total", "schedule_average_delay_ms"], ["provider"]), request.id);
  });

  app.get("/analytics/campaigns", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "analytics:read");
    const query = request.query as AnalyticsWorkspaceQuery;
    return successEnvelope(await groupedQuery(deps, principal.tenantId, query, ["content_items_planned_total", "execution_runs_completed_total", "content_items_scheduled_total", "content_items_published_total", "publication_failed_total", "publication_cancelled_total", "execution_cost_total", "campaign_publication_volume"], ["campaign", "provider"]), request.id);
  });

  app.get("/analytics/scheduling", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "analytics:read");
    const query = request.query as AnalyticsWorkspaceQuery;
    return successEnvelope(await groupedQuery(deps, principal.tenantId, query, ["schedules_created_total", "schedules_active_total", "schedule_occurrences_generated_total", "schedule_occurrences_dispatched_total", "schedule_occurrences_completed_total", "schedule_occurrences_failed_total", "schedule_occurrences_missed_total", "schedule_occurrence_success_rate", "schedule_late_rate", "schedule_average_delay_ms", "schedule_conflict_total", "schedule_dead_letter_total"], ["provider", "scheduleStatus"]), request.id);
  });

  app.get("/analytics/publication", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "analytics:read");
    const query = request.query as AnalyticsWorkspaceQuery;
    return successEnvelope(await groupedQuery(deps, principal.tenantId, query, ["publication_requested_total", "publication_completed_total", "publication_failed_total", "publication_unknown_outcome_total", "publication_reconciled_total", "publication_success_rate", "publication_failure_rate", "publication_reconciliation_rate"], ["provider", "publicationStatus"]), request.id);
  });

  app.get("/analytics/execution", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "analytics:read");
    const query = request.query as AnalyticsWorkspaceQuery;
    return successEnvelope(await groupedQuery(deps, principal.tenantId, query, ["execution_runs_total", "execution_runs_completed_total", "execution_runs_failed_total", "execution_success_rate", "execution_duration_ms", "execution_artifacts_total", "execution_cost_total"], ["executionStatus", "capability"]), request.id);
  });

  app.get("/analytics/funnel", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "analytics:read");
    const query = request.query as AnalyticsWorkspaceQuery;
    const timezone = query.timezone ?? deps.defaultTimezone;
    const result = await deps.queryService.query({
      tenantId: principal.tenantId,
      workspaceId: query.workspaceId,
      timezone,
      period: parsePeriod(query.period, timezone),
      metrics: ["content_items_planned_total", "execution_runs_completed_total", "execution_artifacts_total", "content_items_scheduled_total", "publication_completed_total", "receipt_verified_total"],
    });
    const values = Object.assign({}, ...result.rows.map((row) => row.values));
    const stages = [
      stage("Planning", values.content_items_planned_total),
      stage("Execution", values.execution_runs_completed_total),
      stage("Artifact", values.execution_artifacts_total),
      stage("Scheduling", values.content_items_scheduled_total),
      stage("Publication", values.publication_completed_total),
      stage("Receipt Verified", values.receipt_verified_total),
    ];
    return successEnvelope({ ...result, funnel: stages.map((item, index) => ({ ...item, output: item.input, abandonment: index === 0 ? 0 : Math.max(0, Number(stages[index - 1].input) - Number(item.input)), conversionRate: index === 0 ? 100 : safePercentage(Number(item.input), Number(stages[index - 1].input)), averageStageTimeMs: null })) }, request.id);
  });

  app.get("/analytics/insights", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "analytics:read");
    const query = request.query as AnalyticsWorkspaceQuery;
    const timezone = query.timezone ?? deps.defaultTimezone;
    await deps.insightEngine.generate({ tenantId: principal.tenantId, workspaceId: query.workspaceId, timezone, period: parsePeriod(query.period, timezone) });
    return successEnvelope(await deps.repository.listInsights({ tenantId: principal.tenantId, workspaceId: query.workspaceId, status: "active" }), request.id);
  });

  app.get("/analytics/alerts", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "analytics:alerts:read");
    const query = request.query as AnalyticsWorkspaceQuery;
    const timezone = query.timezone ?? deps.defaultTimezone;
    await deps.alertService.evaluate({ tenantId: principal.tenantId, workspaceId: query.workspaceId, timezone, period: parsePeriod(query.period, timezone) });
    return successEnvelope(await deps.alertService.list({ tenantId: principal.tenantId, workspaceId: query.workspaceId, status: query.status as never }), request.id);
  });

  app.post("/analytics/alerts/:id/acknowledge", { schema: { params: ID_PARAMS_SCHEMA, body: workspaceBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "analytics:alerts:update");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    const updated = await deps.alertService.acknowledge({ tenantId: principal.tenantId, workspaceId, id });
    await audit(deps, principal, workspaceId, "analytics_alert_acknowledged", "analytics_alert", id, request.id);
    return successEnvelope(updated, request.id);
  });

  app.post("/analytics/alerts/:id/resolve", { schema: { params: ID_PARAMS_SCHEMA, body: workspaceBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "analytics:alerts:update");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    const updated = await deps.alertService.resolve({ tenantId: principal.tenantId, workspaceId, id });
    await audit(deps, principal, workspaceId, "analytics_alert_resolved", "analytics_alert", id, request.id);
    return successEnvelope(updated, request.id);
  });

  app.get("/analytics/data-quality", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "analytics:data_quality:read");
    const query = request.query as AnalyticsWorkspaceQuery;
    return successEnvelope(await deps.dataQualityService.report({ tenantId: principal.tenantId, workspaceId: query.workspaceId }), request.id);
  });

  app.post("/analytics/exports", { schema: { body: exportBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "analytics:export");
    const body = request.body as { workspaceId: string; format: "csv" | "json"; query?: Partial<AnalyticsQuery> };
    const timezone = body.query?.timezone ?? deps.defaultTimezone;
    const job = await deps.exportService.requestExport({
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      format: body.format,
      requestedByUserId: principal.userId,
      actor: principal,
      requestId: request.id,
      query: {
        tenantId: principal.tenantId,
        workspaceId: body.workspaceId,
        metrics: body.query?.metrics ?? ["publication_requested_total", "publication_completed_total"],
        dimensions: body.query?.dimensions,
        filters: body.query?.filters,
        groupBy: body.query?.groupBy,
        orderBy: body.query?.orderBy,
        limit: body.query?.limit,
        period: body.query?.period ?? { preset: "last_30_days", timezone },
        timezone,
        comparisonPeriod: body.query?.comparisonPeriod,
      },
    });
    return successEnvelope(job, request.id);
  });

  app.get("/analytics/exports/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "analytics:export");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    const result = await deps.exportService.get({ tenantId: principal.tenantId, workspaceId, id });
    await audit(deps, principal, workspaceId, "analytics_export_downloaded", "analytics_export", id, request.id);
    return successEnvelope(result, request.id);
  });

  app.get("/analytics/health", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "analytics:operate");
    const { workspaceId } = request.query as { workspaceId: string };
    return successEnvelope(await deps.healthService.health({ tenantId: principal.tenantId, workspaceId }), request.id);
  });

  app.post("/analytics/admin/rebuild", { schema: { body: rebuildBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "analytics:rebuild");
    const body = request.body as { workspaceId: string; period?: AnalyticsPeriod; metrics?: string[]; groupBy?: AnalyticsQuery["groupBy"]; granularity?: "hourly" | "daily" | "weekly" | "monthly"; timezone?: string };
    const timezone = body.timezone ?? deps.defaultTimezone;
    const snapshots = await deps.snapshotRebuilder.rebuild({ tenantId: principal.tenantId, workspaceId: body.workspaceId, period: body.period ?? { preset: "last_30_days", timezone }, metrics: body.metrics ?? ["publication_requested_total", "publication_completed_total"], groupBy: body.groupBy, granularity: body.granularity ?? "daily" });
    await audit(deps, principal, body.workspaceId, "analytics_snapshot_rebuilt", "analytics_snapshot", body.workspaceId, request.id);
    return successEnvelope({ rebuilt: snapshots.length, snapshots }, request.id);
  });

  app.post("/analytics/admin/reprocess/:eventId", { schema: { params: { type: "object", required: ["eventId"], properties: { eventId: { type: "string" } } }, body: reprocessBodySchema() } }, async (request) => {
    const principal = requirePermission(request, "analytics:operate");
    const { eventId } = request.params as { eventId: string };
    const body = request.body as { workspaceId: string; event?: AnalyticsEvent };
    const existing = await deps.repository.getEvent({ tenantId: principal.tenantId, eventId });
    const event = body.event ?? existing;
    if (!event) throw new Error("ANALYTICS_EVENT_NOT_FOUND: evento não encontrado para reprocessar.");
    const result = await deps.ingestionService.ingest({ ...event, eventId: event.eventId });
    await audit(deps, principal, body.workspaceId, "analytics_event_reprocessed", "analytics", eventId, request.id);
    return successEnvelope(result, request.id);
  });
}

type AnalyticsWorkspaceQuery = { workspaceId: string; period?: string; timezone?: string; providerId?: string; campaignId?: string; status?: string };

async function groupedQuery(deps: AnalyticsRoutesDeps, tenantId: string, query: AnalyticsWorkspaceQuery, metrics: readonly string[], groupBy: AnalyticsQuery["groupBy"]) {
  const timezone = query.timezone ?? deps.defaultTimezone;
  return deps.queryService.query({
    tenantId,
    workspaceId: query.workspaceId,
    timezone,
    period: parsePeriod(query.period, timezone),
    metrics,
    groupBy,
    filters: [
      ...(query.providerId ? [{ dimension: "provider" as const, operator: "eq" as const, value: query.providerId }] : []),
      ...(query.campaignId ? [{ dimension: "campaign" as const, operator: "eq" as const, value: query.campaignId }] : []),
    ],
  });
}

function parsePeriod(raw: string | undefined, timezone: string): AnalyticsPeriod {
  if (raw?.startsWith("custom:")) {
    const [, from, to] = raw.split(":");
    return { preset: "custom", from, to, timezone };
  }
  const preset = raw ?? "last_30_days";
  return { preset: preset as AnalyticsPeriod["preset"], timezone } as AnalyticsPeriod;
}

function stage(name: string, value: unknown) {
  return { stage: name, input: Number(value ?? 0) };
}

function safePercentage(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 10_000) / 100;
}

async function audit(deps: AnalyticsRoutesDeps, principal: { tenantId: string; userId: string; role: "owner" | "admin" | "editor" | "viewer"; sessionId: string }, workspaceId: string, eventType: string, resourceType: "analytics" | "analytics_export" | "analytics_snapshot" | "analytics_alert", resourceId: string, requestId: string) {
  await deps.auditRepository.record({ id: deps.idGenerator(), tenantId: principal.tenantId, workspaceId, eventType, actor: principal, resource: { type: resourceType, id: resourceId }, context: { requestId }, result: { status: "success" } });
}

function workspaceBodySchema() {
  return { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
}

function analyticsQueryBodySchema() {
  return { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, metrics: { type: "array", items: { type: "string" } }, dimensions: { type: "array", items: { type: "string" } }, groupBy: { type: "array", items: { type: "string" } }, filters: { type: "array", items: { type: "object" } }, limit: { type: "number" }, timezone: { type: "string" }, period: { type: "object" }, comparisonPeriod: { type: "object" } } } as const;
}

function exportBodySchema() {
  return { type: "object", required: ["workspaceId", "format"], properties: { workspaceId: { type: "string" }, format: { type: "string" }, query: { type: "object" } } } as const;
}

function rebuildBodySchema() {
  return { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, period: { type: "object" }, metrics: { type: "array", items: { type: "string" } }, groupBy: { type: "array", items: { type: "string" } }, granularity: { type: "string" }, timezone: { type: "string" } } } as const;
}

function reprocessBodySchema() {
  return { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string" }, event: { type: "object" } } } as const;
}
