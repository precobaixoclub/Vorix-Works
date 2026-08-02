import type { PublicationProvider } from "../publication/publication.model.js";

export const ANALYTICS_EVENT_TYPES = [
  "planning_created",
  "planning_completed",
  "execution_started",
  "execution_completed",
  "execution_failed",
  "publication_requested",
  "publication_queued",
  "publication_dispatched",
  "publication_completed",
  "publication_failed",
  "publication_unknown_outcome",
  "publication_reconciled",
  "publication_cancelled",
  "receipt_created",
  "receipt_verified",
  "schedule_created",
  "schedule_occurrence_generated",
  "schedule_occurrence_due",
  "schedule_occurrence_dispatched",
  "schedule_occurrence_completed",
  "schedule_occurrence_missed",
  "schedule_occurrence_failed",
  "schedule_occurrence_cancelled",
  "webhook_received",
  "provider_status_updated",
  "credential_failure",
  "governance_denied",
  "analytics_compensation",
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export const ANALYTICS_DIMENSIONS = [
  "tenant",
  "workspace",
  "campaign",
  "provider",
  "target",
  "channel",
  "publicationStatus",
  "scheduleStatus",
  "executionStatus",
  "credentialStatus",
  "environment",
  "day",
  "week",
  "month",
  "hour",
  "timezone",
  "contentType",
  "capability",
] as const;
export type AnalyticsDimensionId = (typeof ANALYTICS_DIMENSIONS)[number];

export const ANALYTICS_PERIOD_GRANULARITIES = ["hourly", "daily", "weekly", "monthly"] as const;
export type AnalyticsPeriodGranularity = (typeof ANALYTICS_PERIOD_GRANULARITIES)[number];

export const ANALYTICS_PERIOD_PRESETS = ["today", "yesterday", "last_7_days", "last_30_days", "current_week", "previous_week", "current_month", "previous_month", "custom"] as const;
export type AnalyticsPeriodPreset = (typeof ANALYTICS_PERIOD_PRESETS)[number];

export const ANALYTICS_AGGREGATION_TYPES = ["count", "sum", "average", "minimum", "maximum", "rate", "percentage", "percentile", "distinct_count"] as const;
export type AnalyticsAggregationType = (typeof ANALYTICS_AGGREGATION_TYPES)[number];

export const ANALYTICS_METRIC_CATEGORIES = ["operational", "publication", "scheduling", "execution", "editorial", "provider", "governance", "credential"] as const;
export type AnalyticsMetricCategory = (typeof ANALYTICS_METRIC_CATEGORIES)[number];

export const ANALYTICS_SOURCE_TYPES = ["internal", "provider_reported", "estimated", "simulated"] as const;
export type AnalyticsSourceType = (typeof ANALYTICS_SOURCE_TYPES)[number];

export type AnalyticsMeasurement = {
  name: string;
  value: number;
  unit?: string;
};

export type AnalyticsDimension = {
  id: AnalyticsDimensionId;
  value: string;
};

export type AnalyticsEvent = {
  eventId: string;
  eventType: AnalyticsEventType;
  eventVersion: number;
  occurredAt: string;
  ingestedAt: string;
  tenantId: string;
  workspaceId: string;
  campaignId?: string;
  planningId?: string;
  executionRunId?: string;
  publicationId?: string;
  publicationReceiptId?: string;
  scheduleId?: string;
  occurrenceId?: string;
  providerId?: PublicationProvider;
  targetId?: string;
  correlationId: string;
  causationId?: string;
  dimensions: Partial<Record<AnalyticsDimensionId, string>>;
  measurements: Record<string, number>;
  source: string;
  sourceType: AnalyticsSourceType;
  schemaVersion: number;
  compensatesEventId?: string;
  metadata?: Record<string, unknown>;
};

export type AnalyticsMetricDefinition = {
  metricId: string;
  displayName: string;
  description: string;
  category: AnalyticsMetricCategory;
  unit: "count" | "percent" | "ms" | "currency" | "ratio";
  aggregationType: AnalyticsAggregationType;
  supportedDimensions: readonly AnalyticsDimensionId[];
  sourceType: AnalyticsSourceType | "mixed";
  dataType: "integer" | "float";
  version: number;
  status: "active" | "deprecated";
};

export type AnalyticsMetric = AnalyticsMetricDefinition;

export type AnalyticsPeriod =
  | { preset: Exclude<AnalyticsPeriodPreset, "custom">; timezone: string }
  | { preset: "custom"; from: string; to: string; timezone: string };

export type AnalyticsFilter = {
  dimension: AnalyticsDimensionId | "metricId" | "eventType";
  operator: "eq" | "in";
  value: string | readonly string[];
};

export type AnalyticsQuery = {
  tenantId: string;
  workspaceId: string;
  metrics: readonly string[];
  dimensions?: readonly AnalyticsDimensionId[];
  filters?: readonly AnalyticsFilter[];
  groupBy?: readonly AnalyticsDimensionId[];
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
  period: AnalyticsPeriod;
  timezone: string;
  comparisonPeriod?: AnalyticsPeriod;
};

export type AnalyticsSeriesPoint = {
  key: string;
  from: string;
  to: string;
  values: Record<string, number | null>;
  dimensions: Record<string, string>;
};

export type AnalyticsSeries = {
  granularity: AnalyticsPeriodGranularity;
  points: readonly AnalyticsSeriesPoint[];
};

export type AnalyticsComparison = {
  metricId: string;
  dimensions: Record<string, string>;
  currentValue: number;
  previousValue: number;
  absoluteDifference: number;
  percentageDifference: number | null;
  trend: "up" | "down" | "flat" | "new";
};

export type AnalyticsQueryResult = {
  metrics: readonly AnalyticsMetricDefinition[];
  period: { from: string; to: string; timezone: string };
  rows: readonly AnalyticsSeriesPoint[];
  series: AnalyticsSeries;
  comparisons: readonly AnalyticsComparison[];
  dataFreshness: { generatedAt: string; partialData: boolean; staleData: boolean; unavailableMetrics: readonly string[] };
};

export type AnalyticsSnapshot = {
  id: string;
  tenantId: string;
  workspaceId: string;
  snapshotPeriod: AnalyticsPeriodGranularity;
  periodStartUtc: string;
  periodEndUtc: string;
  timezone: string;
  metricId: string;
  dimensions: Record<string, string>;
  value: number;
  sourceEventCount: number;
  rebuiltAt?: string;
  createdAt: string;
};

export type AnalyticsAggregation = {
  metricId: string;
  dimensions: Record<string, string>;
  value: number;
  sourceEventCount: number;
};

export type ProviderMetricSnapshot = {
  id: string;
  tenantId: string;
  workspaceId: string;
  providerId: PublicationProvider;
  externalPublicationId: string;
  metricName: string;
  metricValue: number;
  metricUnit: string;
  capturedAt: string;
  sourceTimestamp?: string;
  isEstimated: boolean;
  isFinal: boolean;
  metadata: Record<string, unknown>;
};

export type AnalyticsInsight = {
  insightId: string;
  tenantId: string;
  workspaceId: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  metricReferences: readonly string[];
  period: { from: string; to: string; timezone: string };
  generatedAt: string;
  status: "active" | "dismissed" | "resolved";
};

export type AnalyticsAlertRule = {
  id: string;
  tenantId: string;
  workspaceId: string;
  metricId: string;
  threshold: number;
  comparison: "gt" | "gte" | "lt" | "lte";
  severity: "info" | "warning" | "critical";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AnalyticsAlertOccurrence = {
  id: string;
  ruleId: string;
  tenantId: string;
  workspaceId: string;
  status: "active" | "acknowledged" | "resolved" | "dismissed";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  metricId: string;
  value: number;
  triggeredAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
};

export type AnalyticsExportJob = {
  id: string;
  tenantId: string;
  workspaceId: string;
  format: "csv" | "json";
  status: "pending" | "completed" | "failed" | "expired";
  filters: Record<string, unknown>;
  requestedByUserId: string;
  requestedAt: string;
  completedAt?: string;
  expiresAt?: string;
  failureCode?: string;
};

export type AnalyticsExportArtifact = {
  id: string;
  exportJobId: string;
  tenantId: string;
  workspaceId: string;
  contentType: string;
  body: string;
  createdAt: string;
  expiresAt: string;
};

export type AnalyticsDeadLetter = {
  id: string;
  tenantId: string;
  workspaceId?: string;
  eventId?: string;
  reason: string;
  safeMessage: string;
  payloadDigest?: string;
  status: "pending" | "reprocessed" | "ignored";
  createdAt: string;
  reprocessedAt?: string;
};

export type AnalyticsDataQualityIssue = {
  code: string;
  severity: "warning" | "critical";
  safeMessage: string;
  evidence?: Record<string, unknown>;
};

export type AnalyticsDataQualityReport = {
  id: string;
  tenantId: string;
  workspaceId: string;
  status: "healthy" | "warning" | "critical";
  generatedAt: string;
  issues: readonly AnalyticsDataQualityIssue[];
};

export type AnalyticsRetentionPolicy = {
  tenantId: string;
  rawEventsDays: number;
  aggregationsDays: number;
  snapshotsDays: number;
  exportsDays: number;
  deadLettersDays: number;
  providerMetricSnapshotsDays: number;
};

export type AnalyticsHealth = {
  status: "healthy" | "degraded" | "unhealthy";
  checks: readonly { id: string; status: "pass" | "warn" | "fail"; safeMessage: string; evidence?: Record<string, unknown> }[];
  metrics: Record<string, number>;
  lastSuccessfulAggregationAt?: string;
  lastSuccessfulSnapshotAt?: string;
};
