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
} from "../../domain/analytics/analytics.model.js";
import type { AnalyticsEventFilter, AnalyticsRepositoryPort, AnalyticsSnapshotFilter } from "../../application/ports/analytics-repository.port.js";

export class InMemoryAnalyticsRepository implements AnalyticsRepositoryPort {
  private readonly events = new Map<string, AnalyticsEvent>();
  private readonly deadLetters = new Map<string, AnalyticsDeadLetter>();
  private readonly snapshots = new Map<string, AnalyticsSnapshot>();
  private readonly providerSnapshots = new Map<string, ProviderMetricSnapshot>();
  private readonly insights = new Map<string, AnalyticsInsight>();
  private readonly alertRules = new Map<string, AnalyticsAlertRule>();
  private readonly alertOccurrences = new Map<string, AnalyticsAlertOccurrence>();
  private readonly exportJobs = new Map<string, AnalyticsExportJob>();
  private readonly exportArtifacts = new Map<string, AnalyticsExportArtifact>();
  private readonly dataQualityReports = new Map<string, AnalyticsDataQualityReport>();

  async appendEvent(event: AnalyticsEvent): Promise<{ event: AnalyticsEvent; duplicate: boolean }> {
    const key = eventKey(event.tenantId, event.eventId);
    const existing = this.events.get(key);
    if (existing) return { event: existing, duplicate: true };
    this.events.set(key, event);
    return { event, duplicate: false };
  }

  async getEvent(input: { tenantId: string; eventId: string }): Promise<AnalyticsEvent | undefined> {
    return this.events.get(eventKey(input.tenantId, input.eventId));
  }

  async listEvents(filter: AnalyticsEventFilter): Promise<AnalyticsEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.tenantId === filter.tenantId)
      .filter((event) => !filter.workspaceId || event.workspaceId === filter.workspaceId)
      .filter((event) => !filter.eventType || event.eventType === filter.eventType)
      .filter((event) => !filter.from || event.occurredAt >= filter.from)
      .filter((event) => !filter.to || event.occurredAt < filter.to)
      .filter((event) => !filter.providerId || event.providerId === filter.providerId)
      .filter((event) => !filter.campaignId || event.campaignId === filter.campaignId)
      .filter((event) => !filter.publicationId || event.publicationId === filter.publicationId)
      .filter((event) => !filter.scheduleId || event.scheduleId === filter.scheduleId)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .slice(0, filter.limit ?? 1000);
  }

  async countEvents(filter: AnalyticsEventFilter): Promise<number> {
    return (await this.listEvents({ ...filter, limit: Number.MAX_SAFE_INTEGER })).length;
  }

  async createDeadLetter(input: Omit<AnalyticsDeadLetter, "createdAt">): Promise<AnalyticsDeadLetter> {
    const letter = { ...input, createdAt: new Date().toISOString() };
    this.deadLetters.set(letter.id, letter);
    return letter;
  }

  async listDeadLetters(filter: { tenantId: string; workspaceId?: string; status?: AnalyticsDeadLetter["status"]; limit?: number }): Promise<AnalyticsDeadLetter[]> {
    return [...this.deadLetters.values()]
      .filter((letter) => letter.tenantId === filter.tenantId)
      .filter((letter) => !filter.workspaceId || letter.workspaceId === filter.workspaceId)
      .filter((letter) => !filter.status || letter.status === filter.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, filter.limit ?? 500);
  }

  async reprocessDeadLetter(input: { tenantId: string; id: string; now: string }): Promise<AnalyticsDeadLetter | undefined> {
    const letter = this.deadLetters.get(input.id);
    if (!letter || letter.tenantId !== input.tenantId) return undefined;
    const updated = { ...letter, status: "reprocessed" as const, reprocessedAt: input.now };
    this.deadLetters.set(input.id, updated);
    return updated;
  }

  async upsertSnapshots(inputs: readonly Omit<AnalyticsSnapshot, "createdAt">[]): Promise<AnalyticsSnapshot[]> {
    const created: AnalyticsSnapshot[] = [];
    for (const input of inputs) {
      const key = snapshotKey(input);
      const snapshot = { ...input, id: this.snapshots.get(key)?.id ?? input.id, createdAt: this.snapshots.get(key)?.createdAt ?? new Date().toISOString() };
      this.snapshots.set(key, snapshot);
      created.push(snapshot);
    }
    return created;
  }

  async listSnapshots(filter: AnalyticsSnapshotFilter): Promise<AnalyticsSnapshot[]> {
    return [...this.snapshots.values()]
      .filter((snapshot) => snapshot.tenantId === filter.tenantId && snapshot.workspaceId === filter.workspaceId)
      .filter((snapshot) => !filter.snapshotPeriod || snapshot.snapshotPeriod === filter.snapshotPeriod)
      .filter((snapshot) => !filter.metricId || snapshot.metricId === filter.metricId)
      .filter((snapshot) => !filter.from || snapshot.periodStartUtc >= filter.from)
      .filter((snapshot) => !filter.to || snapshot.periodStartUtc < filter.to);
  }

  async deleteSnapshots(filter: AnalyticsSnapshotFilter): Promise<number> {
    const matches = await this.listSnapshots(filter);
    for (const snapshot of matches) this.snapshots.delete(snapshotKey(snapshot));
    return matches.length;
  }

  async createProviderMetricSnapshot(input: Omit<ProviderMetricSnapshot, "id"> & { id?: string }): Promise<ProviderMetricSnapshot> {
    const snapshot = { ...input, id: input.id ?? `provider-metric-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` };
    this.providerSnapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  async listProviderMetricSnapshots(filter: { tenantId: string; workspaceId: string; providerId?: string; from?: string; to?: string; limit?: number }): Promise<ProviderMetricSnapshot[]> {
    return [...this.providerSnapshots.values()]
      .filter((snapshot) => snapshot.tenantId === filter.tenantId && snapshot.workspaceId === filter.workspaceId)
      .filter((snapshot) => !filter.providerId || snapshot.providerId === filter.providerId)
      .filter((snapshot) => !filter.from || snapshot.capturedAt >= filter.from)
      .filter((snapshot) => !filter.to || snapshot.capturedAt < filter.to)
      .slice(0, filter.limit ?? 500);
  }

  async saveInsights(insights: readonly AnalyticsInsight[]): Promise<AnalyticsInsight[]> {
    for (const insight of insights) this.insights.set(insight.insightId, insight);
    return [...insights];
  }

  async listInsights(filter: { tenantId: string; workspaceId: string; status?: AnalyticsInsight["status"]; limit?: number }): Promise<AnalyticsInsight[]> {
    return [...this.insights.values()]
      .filter((insight) => insight.tenantId === filter.tenantId && insight.workspaceId === filter.workspaceId)
      .filter((insight) => !filter.status || insight.status === filter.status)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
      .slice(0, filter.limit ?? 100);
  }

  async createAlertRule(input: Omit<AnalyticsAlertRule, "createdAt" | "updatedAt">): Promise<AnalyticsAlertRule> {
    const now = new Date().toISOString();
    const rule = { ...input, createdAt: now, updatedAt: now };
    this.alertRules.set(rule.id, rule);
    return rule;
  }

  async listAlertRules(filter: { tenantId: string; workspaceId: string; enabledOnly?: boolean }): Promise<AnalyticsAlertRule[]> {
    return [...this.alertRules.values()].filter((rule) => rule.tenantId === filter.tenantId && rule.workspaceId === filter.workspaceId && (!filter.enabledOnly || rule.enabled));
  }

  async upsertAlertOccurrence(input: Omit<AnalyticsAlertOccurrence, "triggeredAt"> & { triggeredAt?: string }): Promise<AnalyticsAlertOccurrence> {
    const existing = [...this.alertOccurrences.values()].find((occurrence) => occurrence.ruleId === input.ruleId && occurrence.status === "active");
    const occurrence = { ...input, id: existing?.id ?? input.id, triggeredAt: existing?.triggeredAt ?? input.triggeredAt ?? new Date().toISOString() };
    this.alertOccurrences.set(occurrence.id, occurrence);
    return occurrence;
  }

  async listAlertOccurrences(filter: { tenantId: string; workspaceId: string; status?: AnalyticsAlertOccurrence["status"]; limit?: number }): Promise<AnalyticsAlertOccurrence[]> {
    return [...this.alertOccurrences.values()]
      .filter((occurrence) => occurrence.tenantId === filter.tenantId && occurrence.workspaceId === filter.workspaceId)
      .filter((occurrence) => !filter.status || occurrence.status === filter.status)
      .sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt))
      .slice(0, filter.limit ?? 100);
  }

  async updateAlertOccurrence(input: { tenantId: string; workspaceId: string; id: string; status: "acknowledged" | "resolved" | "dismissed"; now: string }): Promise<AnalyticsAlertOccurrence | undefined> {
    const existing = this.alertOccurrences.get(input.id);
    if (!existing || existing.tenantId !== input.tenantId || existing.workspaceId !== input.workspaceId) return undefined;
    const updated = { ...existing, status: input.status, acknowledgedAt: input.status === "acknowledged" ? input.now : existing.acknowledgedAt, resolvedAt: input.status === "resolved" ? input.now : existing.resolvedAt };
    this.alertOccurrences.set(input.id, updated);
    return updated;
  }

  async createExportJob(input: Omit<AnalyticsExportJob, "requestedAt" | "status">): Promise<AnalyticsExportJob> {
    const job = { ...input, status: "pending" as const, requestedAt: new Date().toISOString() };
    this.exportJobs.set(job.id, job);
    return job;
  }

  async completeExportJob(input: { tenantId: string; workspaceId: string; id: string; artifact: Omit<AnalyticsExportArtifact, "id" | "exportJobId" | "createdAt">; now: string }): Promise<{ job: AnalyticsExportJob; artifact: AnalyticsExportArtifact }> {
    const job = this.exportJobs.get(input.id);
    if (!job || job.tenantId !== input.tenantId || job.workspaceId !== input.workspaceId) throw new Error("ANALYTICS_EXPORT_NOT_FOUND: export não encontrado.");
    const updated = { ...job, status: "completed" as const, completedAt: input.now, expiresAt: input.artifact.expiresAt };
    const artifact = { ...input.artifact, id: `analytics-export-artifact-${input.id}`, exportJobId: input.id, createdAt: input.now };
    this.exportJobs.set(input.id, updated);
    this.exportArtifacts.set(input.id, artifact);
    return { job: updated, artifact };
  }

  async getExportJob(input: { tenantId: string; workspaceId: string; id: string }): Promise<{ job: AnalyticsExportJob; artifact?: AnalyticsExportArtifact } | undefined> {
    const job = this.exportJobs.get(input.id);
    if (!job || job.tenantId !== input.tenantId || job.workspaceId !== input.workspaceId) return undefined;
    return { job, artifact: this.exportArtifacts.get(input.id) };
  }

  async listExportJobs(filter: { tenantId: string; workspaceId: string; status?: AnalyticsExportJob["status"]; limit?: number }): Promise<AnalyticsExportJob[]> {
    return [...this.exportJobs.values()]
      .filter((job) => job.tenantId === filter.tenantId && job.workspaceId === filter.workspaceId)
      .filter((job) => !filter.status || job.status === filter.status)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .slice(0, filter.limit ?? 100);
  }

  async saveDataQualityReport(input: Omit<AnalyticsDataQualityReport, "generatedAt"> & { generatedAt?: string }): Promise<AnalyticsDataQualityReport> {
    const report = { ...input, generatedAt: input.generatedAt ?? new Date().toISOString() };
    this.dataQualityReports.set(report.id, report);
    return report;
  }

  async getLatestDataQualityReport(input: { tenantId: string; workspaceId: string }): Promise<AnalyticsDataQualityReport | undefined> {
    return [...this.dataQualityReports.values()]
      .filter((report) => report.tenantId === input.tenantId && report.workspaceId === input.workspaceId)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
  }

  async metrics(filter: { tenantId: string; workspaceId?: string }): Promise<Record<string, number>> {
    const events = await this.listEvents({ tenantId: filter.tenantId, workspaceId: filter.workspaceId, limit: Number.MAX_SAFE_INTEGER });
    return {
      analytics_events_ingested_total: events.length,
      analytics_events_rejected_total: [...this.deadLetters.values()].filter((letter) => letter.tenantId === filter.tenantId && (!filter.workspaceId || letter.workspaceId === filter.workspaceId)).length,
      analytics_events_duplicated_total: 0,
      analytics_events_dead_lettered_total: [...this.deadLetters.values()].filter((letter) => letter.tenantId === filter.tenantId && (!filter.workspaceId || letter.workspaceId === filter.workspaceId)).length,
      analytics_snapshot_build_total: [...this.snapshots.values()].filter((snapshot) => snapshot.tenantId === filter.tenantId && (!filter.workspaceId || snapshot.workspaceId === filter.workspaceId)).length,
      analytics_export_total: [...this.exportJobs.values()].filter((job) => job.tenantId === filter.tenantId && (!filter.workspaceId || job.workspaceId === filter.workspaceId)).length,
      analytics_export_failure_total: [...this.exportJobs.values()].filter((job) => job.tenantId === filter.tenantId && (!filter.workspaceId || job.workspaceId === filter.workspaceId) && job.status === "failed").length,
      analytics_data_quality_issue_total: [...this.dataQualityReports.values()].filter((report) => report.tenantId === filter.tenantId && (!filter.workspaceId || report.workspaceId === filter.workspaceId)).reduce((sum, report) => sum + report.issues.length, 0),
      analytics_insight_generated_total: [...this.insights.values()].filter((insight) => insight.tenantId === filter.tenantId && (!filter.workspaceId || insight.workspaceId === filter.workspaceId)).length,
      analytics_alert_active_total: [...this.alertOccurrences.values()].filter((alert) => alert.tenantId === filter.tenantId && (!filter.workspaceId || alert.workspaceId === filter.workspaceId) && alert.status === "active").length,
    };
  }
}

function eventKey(tenantId: string, eventId: string): string {
  return `${tenantId}:${eventId}`;
}

function snapshotKey(input: Omit<AnalyticsSnapshot, "createdAt">): string {
  return `${input.tenantId}:${input.workspaceId}:${input.snapshotPeriod}:${input.periodStartUtc}:${input.metricId}:${JSON.stringify(Object.entries(input.dimensions).sort())}`;
}
