import type {
  AnalyticsAlertOccurrence,
  AnalyticsAlertRule,
  AnalyticsDataQualityReport,
  AnalyticsDeadLetter,
  AnalyticsEvent,
  AnalyticsEventType,
  AnalyticsExportArtifact,
  AnalyticsExportJob,
  AnalyticsInsight,
  AnalyticsPeriodGranularity,
  AnalyticsSnapshot,
  ProviderMetricSnapshot,
} from "../../domain/analytics/analytics.model.js";

export type AnalyticsEventFilter = {
  tenantId: string;
  workspaceId?: string;
  eventType?: AnalyticsEventType;
  from?: string;
  to?: string;
  providerId?: string;
  campaignId?: string;
  publicationId?: string;
  scheduleId?: string;
  limit?: number;
};

export type AnalyticsSnapshotFilter = {
  tenantId: string;
  workspaceId: string;
  snapshotPeriod?: AnalyticsPeriodGranularity;
  metricId?: string;
  from?: string;
  to?: string;
};

export type AnalyticsRepositoryPort = {
  appendEvent(event: AnalyticsEvent): Promise<{ event: AnalyticsEvent; duplicate: boolean }>;
  getEvent(input: { tenantId: string; eventId: string }): Promise<AnalyticsEvent | undefined>;
  listEvents(filter: AnalyticsEventFilter): Promise<AnalyticsEvent[]>;
  countEvents(filter: AnalyticsEventFilter): Promise<number>;

  createDeadLetter(input: Omit<AnalyticsDeadLetter, "createdAt">): Promise<AnalyticsDeadLetter>;
  listDeadLetters(filter: { tenantId: string; workspaceId?: string; status?: AnalyticsDeadLetter["status"]; limit?: number }): Promise<AnalyticsDeadLetter[]>;
  reprocessDeadLetter(input: { tenantId: string; id: string; now: string }): Promise<AnalyticsDeadLetter | undefined>;

  upsertSnapshots(snapshots: readonly Omit<AnalyticsSnapshot, "createdAt">[]): Promise<AnalyticsSnapshot[]>;
  listSnapshots(filter: AnalyticsSnapshotFilter): Promise<AnalyticsSnapshot[]>;
  deleteSnapshots(filter: AnalyticsSnapshotFilter): Promise<number>;

  createProviderMetricSnapshot(input: Omit<ProviderMetricSnapshot, "id"> & { id?: string }): Promise<ProviderMetricSnapshot>;
  listProviderMetricSnapshots(filter: { tenantId: string; workspaceId: string; providerId?: string; from?: string; to?: string; limit?: number }): Promise<ProviderMetricSnapshot[]>;

  saveInsights(insights: readonly AnalyticsInsight[]): Promise<AnalyticsInsight[]>;
  listInsights(filter: { tenantId: string; workspaceId: string; status?: AnalyticsInsight["status"]; limit?: number }): Promise<AnalyticsInsight[]>;

  createAlertRule(input: Omit<AnalyticsAlertRule, "createdAt" | "updatedAt">): Promise<AnalyticsAlertRule>;
  listAlertRules(filter: { tenantId: string; workspaceId: string; enabledOnly?: boolean }): Promise<AnalyticsAlertRule[]>;
  upsertAlertOccurrence(input: Omit<AnalyticsAlertOccurrence, "triggeredAt"> & { triggeredAt?: string }): Promise<AnalyticsAlertOccurrence>;
  listAlertOccurrences(filter: { tenantId: string; workspaceId: string; status?: AnalyticsAlertOccurrence["status"]; limit?: number }): Promise<AnalyticsAlertOccurrence[]>;
  updateAlertOccurrence(input: { tenantId: string; workspaceId: string; id: string; status: "acknowledged" | "resolved" | "dismissed"; now: string }): Promise<AnalyticsAlertOccurrence | undefined>;

  createExportJob(input: Omit<AnalyticsExportJob, "requestedAt" | "status">): Promise<AnalyticsExportJob>;
  completeExportJob(input: { tenantId: string; workspaceId: string; id: string; artifact: Omit<AnalyticsExportArtifact, "id" | "exportJobId" | "createdAt">; now: string }): Promise<{ job: AnalyticsExportJob; artifact: AnalyticsExportArtifact }>;
  getExportJob(input: { tenantId: string; workspaceId: string; id: string }): Promise<{ job: AnalyticsExportJob; artifact?: AnalyticsExportArtifact } | undefined>;
  listExportJobs(filter: { tenantId: string; workspaceId: string; status?: AnalyticsExportJob["status"]; limit?: number }): Promise<AnalyticsExportJob[]>;

  saveDataQualityReport(report: Omit<AnalyticsDataQualityReport, "generatedAt"> & { generatedAt?: string }): Promise<AnalyticsDataQualityReport>;
  getLatestDataQualityReport(input: { tenantId: string; workspaceId: string }): Promise<AnalyticsDataQualityReport | undefined>;

  metrics(filter: { tenantId: string; workspaceId?: string }): Promise<Record<string, number>>;
};
