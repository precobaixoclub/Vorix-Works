import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { FixedClock, MutableTestClock } from "../dist/application/ports/clock.port.js";
import { AnalyticsMetricRegistry } from "../dist/application/analytics/analytics-metric-registry.js";
import { AnalyticsAlertService, AnalyticsDataQualityService, AnalyticsEventIngestionService, AnalyticsExportService, AnalyticsHealthService, AnalyticsInsightEngine, AnalyticsQueryService, AnalyticsSnapshotBuilder, AnalyticsSnapshotRebuilder, createAnalyticsEvent } from "../dist/application/analytics/analytics-services.js";
import { InMemoryAnalyticsRepository } from "../dist/infrastructure/storage/in-memory-analytics-repository.js";

function buildDeps(clock = new MutableTestClock(new Date("2026-07-30T12:00:00.000Z"))) {
  const repository = new InMemoryAnalyticsRepository();
  const metricRegistry = new AnalyticsMetricRegistry();
  let id = 0;
  const idGenerator = () => `analytics-test-${++id}`;
  const auditEvents = [];
  const auditRepository = {
    record: async (input) => {
      const event = { ...input, createdAt: clock.nowIso() };
      auditEvents.push(event);
      return event;
    },
    list: async () => auditEvents,
    export: async () => ({ contentType: "application/json", body: JSON.stringify(auditEvents) }),
  };
  const deps = { repository, metricRegistry, clock, auditRepository, idGenerator, maxQueryDays: 370 };
  return {
    ...deps,
    auditEvents,
    ingestion: new AnalyticsEventIngestionService(deps),
    query: new AnalyticsQueryService(deps),
    snapshotBuilder: new AnalyticsSnapshotBuilder(deps),
    snapshotRebuilder: new AnalyticsSnapshotRebuilder(new AnalyticsSnapshotBuilder(deps), repository),
    dataQuality: new AnalyticsDataQualityService(deps),
    insights: new AnalyticsInsightEngine(deps),
    alerts: new AnalyticsAlertService(deps),
    exports: new AnalyticsExportService(deps),
    health: new AnalyticsHealthService(deps),
  };
}

function event(overrides) {
  return createAnalyticsEvent({
    eventId: overrides.eventId,
    eventType: overrides.eventType,
    tenantId: overrides.tenantId ?? "tenant-analytics",
    workspaceId: overrides.workspaceId ?? "workspace-analytics",
    occurredAt: overrides.occurredAt ?? "2026-07-30T10:00:00.000Z",
    correlationId: overrides.correlationId ?? "corr-analytics",
    campaignId: overrides.campaignId,
    planningId: overrides.planningId,
    executionRunId: overrides.executionRunId,
    publicationId: overrides.publicationId,
    publicationReceiptId: overrides.publicationReceiptId,
    scheduleId: overrides.scheduleId,
    occurrenceId: overrides.occurrenceId,
    providerId: overrides.providerId,
    targetId: overrides.targetId,
    dimensions: overrides.dimensions,
    measurements: overrides.measurements,
    source: overrides.source ?? "test",
    sourceType: overrides.sourceType ?? "internal",
    metadata: overrides.metadata,
    ingestedAt: overrides.ingestedAt,
  });
}

test("Analytics ingestion: valida schema, remove metadata sensivel, deduplica e replay nao altera contagens", async () => {
  const deps = buildDeps();
  const input = event({ eventId: "evt-publication-requested", eventType: "publication_requested", providerId: "linkedin_sandbox", metadata: { token: "secret", safeCode: "ok" } });
  const first = await deps.ingestion.ingest(input);
  const duplicate = await deps.ingestion.ingest(input);
  const replay = await deps.ingestion.replay([input, event({ eventId: "evt-publication-completed", eventType: "publication_completed", providerId: "linkedin_sandbox" })]);

  assert.equal(first.accepted, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(replay.accepted, 1);
  assert.equal(replay.duplicated, 1);
  const events = await deps.repository.listEvents({ tenantId: "tenant-analytics", workspaceId: "workspace-analytics" });
  assert.equal(events.length, 2);
  assert.equal(events[0].metadata.token, undefined);

  const invalid = await deps.ingestion.ingest({ ...input, eventId: "", eventType: "not_real" });
  assert.equal(invalid.accepted, false);
  assert.equal((await deps.repository.listDeadLetters({ tenantId: "tenant-analytics", workspaceId: "workspace-analytics" })).length, 1);
});

test("Analytics query: agregacoes, rates, percentuais, comparacoes, timezone e DST", async () => {
  const deps = buildDeps(new FixedClock(new Date("2026-03-09T12:00:00.000Z")));
  await deps.ingestion.replay([
    event({ eventId: "plan-1", eventType: "planning_created", planningId: "planning-1", campaignId: "campaign-a", occurredAt: "2026-03-08T03:30:00.000Z" }),
    event({ eventId: "exec-start-1", eventType: "execution_started", executionRunId: "execution-1", campaignId: "campaign-a", occurredAt: "2026-03-08T04:00:00.000Z" }),
    event({ eventId: "exec-ok-1", eventType: "execution_completed", executionRunId: "execution-1", providerId: "linkedin_sandbox", campaignId: "campaign-a", occurredAt: "2026-03-08T04:05:00.000Z", measurements: { executionDurationMs: 300000, executionArtifactsTotal: 1, cost: 2.5 } }),
    event({ eventId: "schedule-1", eventType: "schedule_created", scheduleId: "schedule-1", providerId: "linkedin_sandbox", campaignId: "campaign-a", occurredAt: "2026-03-08T05:00:00.000Z" }),
    event({ eventId: "occ-gen-1", eventType: "schedule_occurrence_generated", scheduleId: "schedule-1", occurrenceId: "occurrence-1", providerId: "linkedin_sandbox", campaignId: "campaign-a", occurredAt: "2026-03-08T05:01:00.000Z" }),
    event({ eventId: "occ-dispatch-1", eventType: "schedule_occurrence_dispatched", scheduleId: "schedule-1", occurrenceId: "occurrence-1", providerId: "linkedin_sandbox", campaignId: "campaign-a", occurredAt: "2026-03-08T13:00:00.000Z", measurements: { scheduleDelayMs: 0 } }),
    event({ eventId: "pub-request-1", eventType: "publication_requested", publicationId: "publication-1", providerId: "linkedin_sandbox", campaignId: "campaign-a", occurredAt: "2026-03-08T13:00:01.000Z" }),
    event({ eventId: "pub-complete-1", eventType: "publication_completed", publicationId: "publication-1", providerId: "linkedin_sandbox", campaignId: "campaign-a", occurredAt: "2026-03-08T13:00:03.000Z", measurements: { publicationCompletionLatencyMs: 2000 } }),
    event({ eventId: "receipt-1", eventType: "receipt_verified", publicationId: "publication-1", publicationReceiptId: "receipt-1", providerId: "linkedin_sandbox", campaignId: "campaign-a", occurredAt: "2026-03-08T13:00:04.000Z" }),
    event({ eventId: "pub-request-prev", eventType: "publication_requested", publicationId: "publication-prev", providerId: "x_sandbox", campaignId: "campaign-b", occurredAt: "2026-03-01T13:00:00.000Z" }),
  ]);

  const result = await deps.query.query({
    tenantId: "tenant-analytics",
    workspaceId: "workspace-analytics",
    timezone: "America/New_York",
    period: { preset: "custom", from: "2026-03-08T00:00:00.000Z", to: "2026-03-09T00:00:00.000Z", timezone: "America/New_York" },
    comparisonPeriod: { preset: "custom", from: "2026-03-01T00:00:00.000Z", to: "2026-03-02T00:00:00.000Z", timezone: "America/New_York" },
    metrics: ["publication_requested_total", "publication_completed_total", "publication_success_rate", "execution_duration_ms", "execution_cost_total", "receipt_verified_total"],
    groupBy: ["provider"],
  });

  const linkedin = result.rows.find((row) => row.dimensions.provider === "linkedin_sandbox");
  assert.equal(linkedin.values.publication_requested_total, 1);
  assert.equal(linkedin.values.publication_completed_total, 1);
  assert.equal(linkedin.values.publication_success_rate, 100);
  assert.equal(linkedin.values.execution_duration_ms, 300000);
  assert.equal(linkedin.values.execution_cost_total, 2.5);
  assert.equal(linkedin.values.receipt_verified_total, 1);
  assert.equal(result.comparisons.some((comparison) => comparison.metricId === "publication_requested_total"), true);

  await assert.rejects(() => deps.query.query({ tenantId: "tenant-analytics", workspaceId: "workspace-analytics", timezone: "UTC+3", period: { preset: "today", timezone: "UTC+3" }, metrics: ["publication_requested_total"] }), /SCHEDULE_TIMEZONE_INVALID/);
});

test("Analytics snapshots: build e rebuild sao reconstruiveis a partir dos eventos", async () => {
  const deps = buildDeps();
  await deps.ingestion.replay([
    event({ eventId: "s1", eventType: "publication_requested", providerId: "meta_pages_sandbox" }),
    event({ eventId: "s2", eventType: "publication_completed", providerId: "meta_pages_sandbox" }),
  ]);
  const period = { preset: "custom", from: "2026-07-30T00:00:00.000Z", to: "2026-07-31T00:00:00.000Z", timezone: "America/Sao_Paulo" };
  const first = await deps.snapshotBuilder.build({ tenantId: "tenant-analytics", workspaceId: "workspace-analytics", period, metrics: ["publication_requested_total", "publication_completed_total"], groupBy: ["provider"], granularity: "daily" });
  const rebuilt = await deps.snapshotRebuilder.rebuild({ tenantId: "tenant-analytics", workspaceId: "workspace-analytics", period, metrics: ["publication_requested_total", "publication_completed_total"], groupBy: ["provider"], granularity: "daily" });
  assert.equal(first.length, 2);
  assert.equal(rebuilt.length, 2);
  const stored = await deps.repository.listSnapshots({ tenantId: "tenant-analytics", workspaceId: "workspace-analytics", snapshotPeriod: "daily" });
  assert.equal(stored.length, 2);
});

test("Analytics data quality: eventos fora de ordem, referencias ausentes e metricas simuladas desatualizadas geram warning/critical", async () => {
  const deps = buildDeps();
  await deps.ingestion.replay([
    event({ eventId: "late-ingested", eventType: "publication_completed", publicationId: "publication-late", occurredAt: "2026-07-30T09:00:00.000Z", ingestedAt: "2026-07-30T12:00:00.000Z" }),
    event({ eventId: "early-ingested", eventType: "receipt_created", publicationReceiptId: "receipt-broken", occurredAt: "2026-07-29T09:00:00.000Z", ingestedAt: "2026-07-30T12:01:00.000Z" }),
    event({ eventId: "schedule-no-occurrence", eventType: "schedule_created", scheduleId: "schedule-broken", occurredAt: "2026-07-30T10:00:00.000Z" }),
  ]);
  await deps.repository.createProviderMetricSnapshot({ tenantId: "tenant-analytics", workspaceId: "workspace-analytics", providerId: "x_sandbox", externalPublicationId: "external-1", metricName: "impressions", metricValue: 10, metricUnit: "count", capturedAt: "2026-07-01T00:00:00.000Z", isEstimated: true, isFinal: false, metadata: { simulated: true } });
  const report = await deps.dataQuality.report({ tenantId: "tenant-analytics", workspaceId: "workspace-analytics" });
  assert.equal(report.status, "critical");
  assert.equal(report.issues.some((issue) => issue.code === "out_of_order_event"), true);
  assert.equal(report.issues.some((issue) => issue.code === "receipt_without_publication"), true);
  assert.equal(report.issues.some((issue) => issue.code === "stale_external_metrics"), true);
});

test("Analytics insights, alertas, exports, health e auditoria operam sem IA generativa", async () => {
  const deps = buildDeps();
  await deps.ingestion.replay([
    event({ eventId: "pub-req-a", eventType: "publication_requested", providerId: "linkedin_sandbox" }),
    event({ eventId: "pub-fail-a", eventType: "publication_failed", providerId: "linkedin_sandbox" }),
    event({ eventId: "cred-fail-a", eventType: "credential_failure", providerId: "linkedin_sandbox" }),
  ]);
  await deps.repository.appendEvent(event({ eventId: "dead-letter-measure", eventType: "analytics_compensation", measurements: { publicationDeadLetterTotal: 1 } }));

  const period = { preset: "custom", from: "2026-07-30T00:00:00.000Z", to: "2026-07-31T00:00:00.000Z", timezone: "America/Sao_Paulo" };
  const insights = await deps.insights.generate({ tenantId: "tenant-analytics", workspaceId: "workspace-analytics", period, timezone: "America/Sao_Paulo" });
  const alerts = await deps.alerts.evaluate({ tenantId: "tenant-analytics", workspaceId: "workspace-analytics", period, timezone: "America/Sao_Paulo" });
  const job = await deps.exports.requestExport({ tenantId: "tenant-analytics", workspaceId: "workspace-analytics", format: "csv", requestedByUserId: "user-owner", actor: { userId: "user-owner", role: "owner" }, query: { tenantId: "tenant-analytics", workspaceId: "workspace-analytics", timezone: "America/Sao_Paulo", period, metrics: ["publication_requested_total", "publication_failed_total"] } });
  const detail = await deps.exports.get({ tenantId: "tenant-analytics", workspaceId: "workspace-analytics", id: job.id });
  const health = await deps.health.health({ tenantId: "tenant-analytics", workspaceId: "workspace-analytics" });

  assert.equal(insights.some((insight) => insight.type === "failure_rate_high"), true);
  assert.equal(alerts.some((alert) => alert.metricId === "publication_failure_rate"), true);
  assert.equal(job.status, "completed");
  assert.equal(detail.artifact.contentType, "text/csv");
  assert.equal(deps.auditEvents.some((item) => item.eventType === "analytics_export_requested"), true);
  assert.equal(["healthy", "degraded"].includes(health.status), true);
});

test("Analytics performance: 10 mil eventos, consulta 30 dias e agregacao diaria", async () => {
  const deps = buildDeps();
  const batch = [];
  for (let index = 0; index < 10_000; index += 1) {
    batch.push(event({ eventId: `perf-${index}`, eventType: index % 10 === 0 ? "publication_failed" : "publication_completed", providerId: index % 2 === 0 ? "linkedin_sandbox" : "x_sandbox", occurredAt: new Date(Date.UTC(2026, 6, 1 + (index % 30), 12, 0, 0)).toISOString() }));
  }
  const replay = await deps.ingestion.replay(batch);
  const result = await deps.query.query({ tenantId: "tenant-analytics", workspaceId: "workspace-analytics", timezone: "America/Sao_Paulo", period: { preset: "custom", from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T00:00:00.000Z", timezone: "America/Sao_Paulo" }, metrics: ["publication_completed_total", "publication_failed_total", "publication_failure_rate"], groupBy: ["provider"] });
  assert.equal(replay.accepted, 10_000);
  assert.equal(result.rows.reduce((sum, row) => sum + Number(row.values.publication_completed_total ?? 0), 0), 9000);
  assert.equal(result.rows.reduce((sum, row) => sum + Number(row.values.publication_failed_total ?? 0), 0), 1000);
});

test("Analytics API: dashboard, query, snapshot rebuild, insight, alert, export, audit, isolamento e RBAC", async () => {
  const ownerApp = await buildTestApp("owner");
  const workspaceId = "workspace-analytics-api";
  await ownerApp.zunoContainer.analyticsIngestionService.replay([
    event({ tenantId: "tenant-analytics-api", workspaceId, eventId: "api-planning", eventType: "planning_created", planningId: "planning-api", campaignId: "campaign-api" }),
    event({ tenantId: "tenant-analytics-api", workspaceId, eventId: "api-execution", eventType: "execution_completed", executionRunId: "execution-api", campaignId: "campaign-api", measurements: { executionDurationMs: 1000, executionArtifactsTotal: 1 } }),
    event({ tenantId: "tenant-analytics-api", workspaceId, eventId: "api-schedule", eventType: "schedule_created", scheduleId: "schedule-api", providerId: "linkedin_sandbox", campaignId: "campaign-api" }),
    event({ tenantId: "tenant-analytics-api", workspaceId, eventId: "api-occurrence", eventType: "schedule_occurrence_dispatched", scheduleId: "schedule-api", occurrenceId: "occ-api", providerId: "linkedin_sandbox", campaignId: "campaign-api", measurements: { scheduleDelayMs: 100 } }),
    event({ tenantId: "tenant-analytics-api", workspaceId, eventId: "api-publication-request", eventType: "publication_requested", publicationId: "publication-api", providerId: "linkedin_sandbox", campaignId: "campaign-api" }),
    event({ tenantId: "tenant-analytics-api", workspaceId, eventId: "api-publication-complete", eventType: "publication_completed", publicationId: "publication-api", providerId: "linkedin_sandbox", campaignId: "campaign-api" }),
    event({ tenantId: "tenant-analytics-api", workspaceId, eventId: "api-receipt", eventType: "receipt_verified", publicationId: "publication-api", publicationReceiptId: "receipt-api", providerId: "linkedin_sandbox", campaignId: "campaign-api" }),
    event({ tenantId: "tenant-analytics-api", workspaceId: "workspace-other", eventId: "api-other", eventType: "publication_requested", providerId: "x_sandbox" }),
  ]);

  const overview = await ownerApp.inject({ method: "GET", url: `/v1/analytics/overview?workspaceId=${workspaceId}&period=last_30_days&timezone=America/Sao_Paulo` });
  assert.equal(overview.statusCode, 200);
  assert.equal(overview.json().data.rows.some((row) => row.values.publication_completed_total === 1), true);

  const query = await ownerApp.inject({ method: "POST", url: "/v1/analytics/query", payload: { workspaceId, timezone: "America/Sao_Paulo", period: { preset: "last_30_days", timezone: "America/Sao_Paulo" }, metrics: ["publication_requested_total"], groupBy: ["provider"] } });
  assert.equal(query.statusCode, 200);
  assert.equal(query.json().data.rows.some((row) => row.dimensions.provider === "linkedin_sandbox" && row.values.publication_requested_total === 1), true);
  assert.equal(query.json().data.rows.some((row) => row.dimensions.provider === "x_sandbox"), false);

  const rebuild = await ownerApp.inject({ method: "POST", url: "/v1/analytics/admin/rebuild", payload: { workspaceId, timezone: "America/Sao_Paulo", metrics: ["publication_requested_total"], groupBy: ["provider"], granularity: "daily" } });
  assert.equal(rebuild.statusCode, 200);
  assert.equal(rebuild.json().data.rebuilt >= 1, true);

  const insight = await ownerApp.inject({ method: "GET", url: `/v1/analytics/insights?workspaceId=${workspaceId}&period=last_30_days&timezone=America/Sao_Paulo` });
  assert.equal(insight.statusCode, 200);

  const alert = await ownerApp.inject({ method: "GET", url: `/v1/analytics/alerts?workspaceId=${workspaceId}&period=last_30_days&timezone=America/Sao_Paulo` });
  assert.equal(alert.statusCode, 200);

  const dq = await ownerApp.inject({ method: "GET", url: `/v1/analytics/data-quality?workspaceId=${workspaceId}` });
  assert.equal(dq.statusCode, 200);

  const exportCsv = await ownerApp.inject({ method: "POST", url: "/v1/analytics/exports", payload: { workspaceId, format: "csv", query: { timezone: "America/Sao_Paulo", period: { preset: "last_30_days", timezone: "America/Sao_Paulo" }, metrics: ["publication_requested_total"] } } });
  assert.equal(exportCsv.statusCode, 200);
  const exportDetail = await ownerApp.inject({ method: "GET", url: `/v1/analytics/exports/${exportCsv.json().data.id}?workspaceId=${workspaceId}` });
  assert.equal(exportDetail.statusCode, 200);
  assert.equal(exportDetail.json().data.artifact.contentType, "text/csv");

  const health = await ownerApp.inject({ method: "GET", url: `/v1/analytics/health?workspaceId=${workspaceId}` });
  assert.equal(health.statusCode, 200);

  const audit = await ownerApp.inject({ method: "GET", url: `/v1/audit?workspaceId=${workspaceId}` });
  assert.equal(audit.json().data.some((item) => item.eventType === "analytics_snapshot_rebuilt"), true);
  assert.equal(audit.json().data.some((item) => item.eventType === "analytics_export_completed"), true);

  await ownerApp.close();

  const viewerApp = await buildTestApp("viewer");
  const denied = await viewerApp.inject({ method: "POST", url: "/v1/analytics/admin/rebuild", payload: { workspaceId } });
  assert.equal(denied.statusCode, 403);
  await viewerApp.close();
});

function buildTestApp(role) {
  return buildApp({
    config: loadApiConfig({
      AUTH_MODE: "noop",
      DEV_PRINCIPAL_TENANT_ID: "tenant-analytics-api",
      DEV_PRINCIPAL_USER_ID: `user-${role}`,
      DEV_PRINCIPAL_ROLE: role,
      ZUNO_LOG_LEVEL: "silent",
      ANALYTICS_DEFAULT_TIMEZONE: "America/Sao_Paulo",
    }),
  });
}
