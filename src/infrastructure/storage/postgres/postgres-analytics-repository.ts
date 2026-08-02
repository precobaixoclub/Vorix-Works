import type pg from "pg";
import type {
  AnalyticsAlertOccurrence,
  AnalyticsAlertRule,
  AnalyticsDataQualityReport,
  AnalyticsDeadLetter,
  AnalyticsEvent,
  AnalyticsExportArtifact,
  AnalyticsExportJob,
  AnalyticsInsight,
  AnalyticsSnapshot,
  ProviderMetricSnapshot,
} from "../../../domain/analytics/analytics.model.js";
import type { AnalyticsEventFilter, AnalyticsRepositoryPort, AnalyticsSnapshotFilter } from "../../../application/ports/analytics-repository.port.js";
import type { PublicationProvider } from "../../../domain/publication/publication.model.js";

export class PostgresAnalyticsRepository implements AnalyticsRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async appendEvent(event: AnalyticsEvent): Promise<{ event: AnalyticsEvent; duplicate: boolean }> {
    const result = await this.pool.query<EventRow>(
      `insert into analytics_events (event_id,event_type,event_version,occurred_at,ingested_at,tenant_id,workspace_id,campaign_id,planning_id,execution_run_id,publication_id,publication_receipt_id,schedule_id,occurrence_id,provider_id,target_id,correlation_id,causation_id,dimensions,measurements,source,source_type,schema_version,compensates_event_id,metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       on conflict (tenant_id, event_id) do nothing returning *`,
      [event.eventId, event.eventType, event.eventVersion, event.occurredAt, event.ingestedAt, event.tenantId, event.workspaceId, event.campaignId ?? null, event.planningId ?? null, event.executionRunId ?? null, event.publicationId ?? null, event.publicationReceiptId ?? null, event.scheduleId ?? null, event.occurrenceId ?? null, event.providerId ?? null, event.targetId ?? null, event.correlationId, event.causationId ?? null, JSON.stringify(event.dimensions), JSON.stringify(event.measurements), event.source, event.sourceType, event.schemaVersion, event.compensatesEventId ?? null, JSON.stringify(event.metadata ?? {})],
    );
    if (result.rows[0]) return { event: toEvent(result.rows[0]), duplicate: false };
    const existing = await this.getEvent({ tenantId: event.tenantId, eventId: event.eventId });
    return { event: existing ?? event, duplicate: true };
  }

  async getEvent(input: { tenantId: string; eventId: string }): Promise<AnalyticsEvent | undefined> {
    const result = await this.pool.query<EventRow>("select * from analytics_events where tenant_id = $1 and event_id = $2", [input.tenantId, input.eventId]);
    return result.rows[0] ? toEvent(result.rows[0]) : undefined;
  }

  async listEvents(filter: AnalyticsEventFilter): Promise<AnalyticsEvent[]> {
    const result = await this.pool.query<EventRow>(
      `select * from analytics_events
       where tenant_id = $1
         and ($2::text is null or workspace_id = $2)
         and ($3::text is null or event_type = $3)
         and ($4::timestamptz is null or occurred_at >= $4)
         and ($5::timestamptz is null or occurred_at < $5)
         and ($6::text is null or provider_id = $6)
         and ($7::text is null or campaign_id = $7)
         and ($8::text is null or publication_id = $8)
         and ($9::text is null or schedule_id = $9)
       order by occurred_at asc
       limit $10`,
      [filter.tenantId, filter.workspaceId ?? null, filter.eventType ?? null, filter.from ?? null, filter.to ?? null, filter.providerId ?? null, filter.campaignId ?? null, filter.publicationId ?? null, filter.scheduleId ?? null, filter.limit ?? 1000],
    );
    return result.rows.map(toEvent);
  }

  async countEvents(filter: AnalyticsEventFilter): Promise<number> {
    return (await this.listEvents({ ...filter, limit: Number.MAX_SAFE_INTEGER })).length;
  }

  async createDeadLetter(input: Omit<AnalyticsDeadLetter, "createdAt">): Promise<AnalyticsDeadLetter> {
    const result = await this.pool.query<DeadLetterRow>(
      "insert into analytics_dead_letters (id,tenant_id,workspace_id,event_id,reason,safe_message,payload_digest,status,reprocessed_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *",
      [input.id, input.tenantId, input.workspaceId ?? null, input.eventId ?? null, input.reason, input.safeMessage, input.payloadDigest ?? null, input.status, input.reprocessedAt ?? null],
    );
    return toDeadLetter(result.rows[0]);
  }

  async listDeadLetters(filter: { tenantId: string; workspaceId?: string; status?: AnalyticsDeadLetter["status"]; limit?: number }): Promise<AnalyticsDeadLetter[]> {
    const result = await this.pool.query<DeadLetterRow>("select * from analytics_dead_letters where tenant_id = $1 and ($2::text is null or workspace_id = $2) and ($3::text is null or status = $3) order by created_at desc limit $4", [filter.tenantId, filter.workspaceId ?? null, filter.status ?? null, filter.limit ?? 500]);
    return result.rows.map(toDeadLetter);
  }

  async reprocessDeadLetter(input: { tenantId: string; id: string; now: string }): Promise<AnalyticsDeadLetter | undefined> {
    const result = await this.pool.query<DeadLetterRow>("update analytics_dead_letters set status = 'reprocessed', reprocessed_at = $3 where tenant_id = $1 and id = $2 returning *", [input.tenantId, input.id, input.now]);
    return result.rows[0] ? toDeadLetter(result.rows[0]) : undefined;
  }

  async upsertSnapshots(snapshots: readonly Omit<AnalyticsSnapshot, "createdAt">[]): Promise<AnalyticsSnapshot[]> {
    const saved: AnalyticsSnapshot[] = [];
    for (const snapshot of snapshots) {
      const dimensionsHash = JSON.stringify(Object.entries(snapshot.dimensions).sort());
      const result = await this.pool.query<SnapshotRow>(
        `insert into analytics_snapshots (id,tenant_id,workspace_id,snapshot_period,period_start_utc,period_end_utc,timezone,metric_id,dimensions,dimensions_hash,value,source_event_count,rebuilt_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (tenant_id, workspace_id, snapshot_period, period_start_utc, metric_id, dimensions_hash)
         do update set period_end_utc = excluded.period_end_utc, timezone = excluded.timezone, dimensions = excluded.dimensions, value = excluded.value, source_event_count = excluded.source_event_count, rebuilt_at = excluded.rebuilt_at
         returning *`,
        [snapshot.id, snapshot.tenantId, snapshot.workspaceId, snapshot.snapshotPeriod, snapshot.periodStartUtc, snapshot.periodEndUtc, snapshot.timezone, snapshot.metricId, JSON.stringify(snapshot.dimensions), dimensionsHash, snapshot.value, snapshot.sourceEventCount, snapshot.rebuiltAt ?? null],
      );
      saved.push(toSnapshot(result.rows[0]));
    }
    return saved;
  }

  async listSnapshots(filter: AnalyticsSnapshotFilter): Promise<AnalyticsSnapshot[]> {
    const result = await this.pool.query<SnapshotRow>(
      "select * from analytics_snapshots where tenant_id = $1 and workspace_id = $2 and ($3::text is null or snapshot_period = $3) and ($4::text is null or metric_id = $4) and ($5::timestamptz is null or period_start_utc >= $5) and ($6::timestamptz is null or period_start_utc < $6) order by period_start_utc asc",
      [filter.tenantId, filter.workspaceId, filter.snapshotPeriod ?? null, filter.metricId ?? null, filter.from ?? null, filter.to ?? null],
    );
    return result.rows.map(toSnapshot);
  }

  async deleteSnapshots(filter: AnalyticsSnapshotFilter): Promise<number> {
    const result = await this.pool.query("delete from analytics_snapshots where tenant_id = $1 and workspace_id = $2 and ($3::text is null or snapshot_period = $3) and ($4::text is null or metric_id = $4) and ($5::timestamptz is null or period_start_utc >= $5) and ($6::timestamptz is null or period_start_utc < $6)", [filter.tenantId, filter.workspaceId, filter.snapshotPeriod ?? null, filter.metricId ?? null, filter.from ?? null, filter.to ?? null]);
    return result.rowCount ?? 0;
  }

  async createProviderMetricSnapshot(input: Omit<ProviderMetricSnapshot, "id"> & { id?: string }): Promise<ProviderMetricSnapshot> {
    const id = input.id ?? `provider-metric-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await this.pool.query<ProviderMetricRow>(
      "insert into analytics_provider_metric_snapshots (id,tenant_id,workspace_id,provider_id,external_publication_id,metric_name,metric_value,metric_unit,captured_at,source_timestamp,is_estimated,is_final,metadata) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *",
      [id, input.tenantId, input.workspaceId, input.providerId, input.externalPublicationId, input.metricName, input.metricValue, input.metricUnit, input.capturedAt, input.sourceTimestamp ?? null, input.isEstimated, input.isFinal, JSON.stringify(input.metadata)],
    );
    return toProviderMetric(result.rows[0]);
  }

  async listProviderMetricSnapshots(filter: { tenantId: string; workspaceId: string; providerId?: string; from?: string; to?: string; limit?: number }): Promise<ProviderMetricSnapshot[]> {
    const result = await this.pool.query<ProviderMetricRow>("select * from analytics_provider_metric_snapshots where tenant_id = $1 and workspace_id = $2 and ($3::text is null or provider_id = $3) and ($4::timestamptz is null or captured_at >= $4) and ($5::timestamptz is null or captured_at < $5) order by captured_at desc limit $6", [filter.tenantId, filter.workspaceId, filter.providerId ?? null, filter.from ?? null, filter.to ?? null, filter.limit ?? 500]);
    return result.rows.map(toProviderMetric);
  }

  async saveInsights(insights: readonly AnalyticsInsight[]): Promise<AnalyticsInsight[]> {
    for (const insight of insights) {
      await this.pool.query(
        `insert into analytics_insights (insight_id,tenant_id,workspace_id,type,severity,title,description,evidence,metric_references,period,generated_at,status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (insight_id) do update set status = excluded.status`,
        [insight.insightId, insight.tenantId, insight.workspaceId, insight.type, insight.severity, insight.title, insight.description, JSON.stringify(insight.evidence), insight.metricReferences, JSON.stringify(insight.period), insight.generatedAt, insight.status],
      );
    }
    return [...insights];
  }

  async listInsights(filter: { tenantId: string; workspaceId: string; status?: AnalyticsInsight["status"]; limit?: number }): Promise<AnalyticsInsight[]> {
    const result = await this.pool.query<InsightRow>("select * from analytics_insights where tenant_id = $1 and workspace_id = $2 and ($3::text is null or status = $3) order by generated_at desc limit $4", [filter.tenantId, filter.workspaceId, filter.status ?? null, filter.limit ?? 100]);
    return result.rows.map(toInsight);
  }

  async createAlertRule(input: Omit<AnalyticsAlertRule, "createdAt" | "updatedAt">): Promise<AnalyticsAlertRule> {
    const now = new Date().toISOString();
    const result = await this.pool.query<AlertRuleRow>("insert into analytics_alert_rules (id,tenant_id,workspace_id,metric_id,threshold,comparison,severity,enabled,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) returning *", [input.id, input.tenantId, input.workspaceId, input.metricId, input.threshold, input.comparison, input.severity, input.enabled, now]);
    return toAlertRule(result.rows[0]);
  }

  async listAlertRules(filter: { tenantId: string; workspaceId: string; enabledOnly?: boolean }): Promise<AnalyticsAlertRule[]> {
    const result = await this.pool.query<AlertRuleRow>("select * from analytics_alert_rules where tenant_id = $1 and workspace_id = $2 and ($3::boolean = false or enabled = true)", [filter.tenantId, filter.workspaceId, filter.enabledOnly ?? false]);
    return result.rows.map(toAlertRule);
  }

  async upsertAlertOccurrence(input: Omit<AnalyticsAlertOccurrence, "triggeredAt"> & { triggeredAt?: string }): Promise<AnalyticsAlertOccurrence> {
    const now = input.triggeredAt ?? new Date().toISOString();
    const result = await this.pool.query<AlertOccurrenceRow>("insert into analytics_alert_occurrences (id,rule_id,tenant_id,workspace_id,status,severity,title,description,metric_id,value,triggered_at,acknowledged_at,resolved_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *", [input.id, input.ruleId, input.tenantId, input.workspaceId, input.status, input.severity, input.title, input.description, input.metricId, input.value, now, input.acknowledgedAt ?? null, input.resolvedAt ?? null]);
    return toAlertOccurrence(result.rows[0]);
  }

  async listAlertOccurrences(filter: { tenantId: string; workspaceId: string; status?: AnalyticsAlertOccurrence["status"]; limit?: number }): Promise<AnalyticsAlertOccurrence[]> {
    const result = await this.pool.query<AlertOccurrenceRow>("select * from analytics_alert_occurrences where tenant_id = $1 and workspace_id = $2 and ($3::text is null or status = $3) order by triggered_at desc limit $4", [filter.tenantId, filter.workspaceId, filter.status ?? null, filter.limit ?? 100]);
    return result.rows.map(toAlertOccurrence);
  }

  async updateAlertOccurrence(input: { tenantId: string; workspaceId: string; id: string; status: "acknowledged" | "resolved" | "dismissed"; now: string }): Promise<AnalyticsAlertOccurrence | undefined> {
    const result = await this.pool.query<AlertOccurrenceRow>("update analytics_alert_occurrences set status = $4, acknowledged_at = case when $4 = 'acknowledged' then $5 else acknowledged_at end, resolved_at = case when $4 = 'resolved' then $5 else resolved_at end where tenant_id = $1 and workspace_id = $2 and id = $3 returning *", [input.tenantId, input.workspaceId, input.id, input.status, input.now]);
    return result.rows[0] ? toAlertOccurrence(result.rows[0]) : undefined;
  }

  async createExportJob(input: Omit<AnalyticsExportJob, "requestedAt" | "status">): Promise<AnalyticsExportJob> {
    const now = new Date().toISOString();
    const result = await this.pool.query<ExportRow>("insert into analytics_exports (id,tenant_id,workspace_id,format,status,filters,requested_by_user_id,requested_at,completed_at,expires_at,failure_code) values ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10) returning *", [input.id, input.tenantId, input.workspaceId, input.format, JSON.stringify(input.filters), input.requestedByUserId, now, input.completedAt ?? null, input.expiresAt ?? null, input.failureCode ?? null]);
    return toExportJob(result.rows[0]);
  }

  async completeExportJob(input: { tenantId: string; workspaceId: string; id: string; artifact: Omit<AnalyticsExportArtifact, "id" | "exportJobId" | "createdAt">; now: string }): Promise<{ job: AnalyticsExportJob; artifact: AnalyticsExportArtifact }> {
    const updated = await this.pool.query<ExportRow>("update analytics_exports set status = 'completed', completed_at = $4, expires_at = $5 where tenant_id = $1 and workspace_id = $2 and id = $3 returning *", [input.tenantId, input.workspaceId, input.id, input.now, input.artifact.expiresAt]);
    if (!updated.rows[0]) throw new Error("ANALYTICS_EXPORT_NOT_FOUND: export não encontrado.");
    const artifactId = `analytics-export-artifact-${input.id}`;
    const artifact = await this.pool.query<ExportArtifactRow>("insert into analytics_export_artifacts (id,export_job_id,tenant_id,workspace_id,content_type,body,created_at,expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *", [artifactId, input.id, input.tenantId, input.workspaceId, input.artifact.contentType, input.artifact.body, input.now, input.artifact.expiresAt]);
    return { job: toExportJob(updated.rows[0]), artifact: toExportArtifact(artifact.rows[0]) };
  }

  async getExportJob(input: { tenantId: string; workspaceId: string; id: string }): Promise<{ job: AnalyticsExportJob; artifact?: AnalyticsExportArtifact } | undefined> {
    const result = await this.pool.query<ExportRow>("select * from analytics_exports where tenant_id = $1 and workspace_id = $2 and id = $3", [input.tenantId, input.workspaceId, input.id]);
    if (!result.rows[0]) return undefined;
    const artifact = await this.pool.query<ExportArtifactRow>("select * from analytics_export_artifacts where export_job_id = $1", [input.id]);
    return { job: toExportJob(result.rows[0]), artifact: artifact.rows[0] ? toExportArtifact(artifact.rows[0]) : undefined };
  }

  async listExportJobs(filter: { tenantId: string; workspaceId: string; status?: AnalyticsExportJob["status"]; limit?: number }): Promise<AnalyticsExportJob[]> {
    const result = await this.pool.query<ExportRow>("select * from analytics_exports where tenant_id = $1 and workspace_id = $2 and ($3::text is null or status = $3) order by requested_at desc limit $4", [filter.tenantId, filter.workspaceId, filter.status ?? null, filter.limit ?? 100]);
    return result.rows.map(toExportJob);
  }

  async saveDataQualityReport(input: Omit<AnalyticsDataQualityReport, "generatedAt"> & { generatedAt?: string }): Promise<AnalyticsDataQualityReport> {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const result = await this.pool.query<DataQualityRow>("insert into analytics_data_quality_reports (id,tenant_id,workspace_id,status,generated_at,issues) values ($1,$2,$3,$4,$5,$6) returning *", [input.id, input.tenantId, input.workspaceId, input.status, generatedAt, JSON.stringify(input.issues)]);
    return toDataQuality(result.rows[0]);
  }

  async getLatestDataQualityReport(input: { tenantId: string; workspaceId: string }): Promise<AnalyticsDataQualityReport | undefined> {
    const result = await this.pool.query<DataQualityRow>("select * from analytics_data_quality_reports where tenant_id = $1 and workspace_id = $2 order by generated_at desc limit 1", [input.tenantId, input.workspaceId]);
    return result.rows[0] ? toDataQuality(result.rows[0]) : undefined;
  }

  async metrics(filter: { tenantId: string; workspaceId?: string }): Promise<Record<string, number>> {
    const [events, deadLetters, snapshots, exports, insights, alerts, dq] = await Promise.all([
      this.pool.query<{ count: string }>("select count(*)::text as count from analytics_events where tenant_id = $1 and ($2::text is null or workspace_id = $2)", [filter.tenantId, filter.workspaceId ?? null]),
      this.pool.query<{ count: string }>("select count(*)::text as count from analytics_dead_letters where tenant_id = $1 and ($2::text is null or workspace_id = $2)", [filter.tenantId, filter.workspaceId ?? null]),
      this.pool.query<{ count: string }>("select count(*)::text as count from analytics_snapshots where tenant_id = $1 and ($2::text is null or workspace_id = $2)", [filter.tenantId, filter.workspaceId ?? null]),
      this.pool.query<{ count: string }>("select count(*)::text as count from analytics_exports where tenant_id = $1 and ($2::text is null or workspace_id = $2)", [filter.tenantId, filter.workspaceId ?? null]),
      this.pool.query<{ count: string }>("select count(*)::text as count from analytics_insights where tenant_id = $1 and ($2::text is null or workspace_id = $2)", [filter.tenantId, filter.workspaceId ?? null]),
      this.pool.query<{ count: string }>("select count(*)::text as count from analytics_alert_occurrences where tenant_id = $1 and ($2::text is null or workspace_id = $2) and status = 'active'", [filter.tenantId, filter.workspaceId ?? null]),
      this.pool.query<{ issues: unknown[] }>("select issues from analytics_data_quality_reports where tenant_id = $1 and ($2::text is null or workspace_id = $2)", [filter.tenantId, filter.workspaceId ?? null]),
    ]);
    return {
      analytics_events_ingested_total: Number(events.rows[0]?.count ?? 0),
      analytics_events_rejected_total: Number(deadLetters.rows[0]?.count ?? 0),
      analytics_events_duplicated_total: 0,
      analytics_events_dead_lettered_total: Number(deadLetters.rows[0]?.count ?? 0),
      analytics_snapshot_build_total: Number(snapshots.rows[0]?.count ?? 0),
      analytics_export_total: Number(exports.rows[0]?.count ?? 0),
      analytics_export_failure_total: 0,
      analytics_data_quality_issue_total: dq.rows.reduce((sum, row) => sum + (Array.isArray(row.issues) ? row.issues.length : 0), 0),
      analytics_insight_generated_total: Number(insights.rows[0]?.count ?? 0),
      analytics_alert_active_total: Number(alerts.rows[0]?.count ?? 0),
    };
  }
}

type EventRow = Record<string, any>;
type SnapshotRow = Record<string, any>;
type DeadLetterRow = Record<string, any>;
type ProviderMetricRow = Record<string, any>;
type InsightRow = Record<string, any>;
type AlertRuleRow = Record<string, any>;
type AlertOccurrenceRow = Record<string, any>;
type ExportRow = Record<string, any>;
type ExportArtifactRow = Record<string, any>;
type DataQualityRow = Record<string, any>;

function toEvent(row: EventRow): AnalyticsEvent {
  return { eventId: row.event_id, eventType: row.event_type, eventVersion: row.event_version, occurredAt: iso(row.occurred_at), ingestedAt: iso(row.ingested_at), tenantId: row.tenant_id, workspaceId: row.workspace_id, campaignId: row.campaign_id ?? undefined, planningId: row.planning_id ?? undefined, executionRunId: row.execution_run_id ?? undefined, publicationId: row.publication_id ?? undefined, publicationReceiptId: row.publication_receipt_id ?? undefined, scheduleId: row.schedule_id ?? undefined, occurrenceId: row.occurrence_id ?? undefined, providerId: row.provider_id as PublicationProvider | undefined, targetId: row.target_id ?? undefined, correlationId: row.correlation_id, causationId: row.causation_id ?? undefined, dimensions: row.dimensions ?? {}, measurements: row.measurements ?? {}, source: row.source, sourceType: row.source_type, schemaVersion: row.schema_version, compensatesEventId: row.compensates_event_id ?? undefined, metadata: row.metadata ?? {} };
}

function toSnapshot(row: SnapshotRow): AnalyticsSnapshot {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, snapshotPeriod: row.snapshot_period, periodStartUtc: iso(row.period_start_utc), periodEndUtc: iso(row.period_end_utc), timezone: row.timezone, metricId: row.metric_id, dimensions: row.dimensions ?? {}, value: Number(row.value), sourceEventCount: Number(row.source_event_count), rebuiltAt: maybeIso(row.rebuilt_at), createdAt: iso(row.created_at) };
}

function toDeadLetter(row: DeadLetterRow): AnalyticsDeadLetter {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id ?? undefined, eventId: row.event_id ?? undefined, reason: row.reason, safeMessage: row.safe_message, payloadDigest: row.payload_digest ?? undefined, status: row.status, createdAt: iso(row.created_at), reprocessedAt: maybeIso(row.reprocessed_at) };
}

function toProviderMetric(row: ProviderMetricRow): ProviderMetricSnapshot {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, providerId: row.provider_id, externalPublicationId: row.external_publication_id, metricName: row.metric_name, metricValue: Number(row.metric_value), metricUnit: row.metric_unit, capturedAt: iso(row.captured_at), sourceTimestamp: maybeIso(row.source_timestamp), isEstimated: Boolean(row.is_estimated), isFinal: Boolean(row.is_final), metadata: row.metadata ?? {} };
}

function toInsight(row: InsightRow): AnalyticsInsight {
  return { insightId: row.insight_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, type: row.type, severity: row.severity, title: row.title, description: row.description, evidence: row.evidence ?? {}, metricReferences: row.metric_references ?? [], period: row.period, generatedAt: iso(row.generated_at), status: row.status };
}

function toAlertRule(row: AlertRuleRow): AnalyticsAlertRule {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, metricId: row.metric_id, threshold: Number(row.threshold), comparison: row.comparison, severity: row.severity, enabled: Boolean(row.enabled), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function toAlertOccurrence(row: AlertOccurrenceRow): AnalyticsAlertOccurrence {
  return { id: row.id, ruleId: row.rule_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, status: row.status, severity: row.severity, title: row.title, description: row.description, metricId: row.metric_id, value: Number(row.value), triggeredAt: iso(row.triggered_at), acknowledgedAt: maybeIso(row.acknowledged_at), resolvedAt: maybeIso(row.resolved_at) };
}

function toExportJob(row: ExportRow): AnalyticsExportJob {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, format: row.format, status: row.status, filters: row.filters ?? {}, requestedByUserId: row.requested_by_user_id, requestedAt: iso(row.requested_at), completedAt: maybeIso(row.completed_at), expiresAt: maybeIso(row.expires_at), failureCode: row.failure_code ?? undefined };
}

function toExportArtifact(row: ExportArtifactRow): AnalyticsExportArtifact {
  return { id: row.id, exportJobId: row.export_job_id, tenantId: row.tenant_id, workspaceId: row.workspace_id, contentType: row.content_type, body: row.body, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at) };
}

function toDataQuality(row: DataQualityRow): AnalyticsDataQualityReport {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, status: row.status, generatedAt: iso(row.generated_at), issues: row.issues ?? [] };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function maybeIso(value: Date | string | null | undefined): string | undefined {
  return value ? iso(value) : undefined;
}
