export type AnalyticsMetricDefinition = {
  metricId: string;
  displayName: string;
  description: string;
  category: string;
  unit: string;
  aggregationType: string;
  supportedDimensions: readonly string[];
  sourceType: string;
  dataType: string;
  version: number;
  status: string;
};

export type AnalyticsPeriod = { preset: string; timezone: string } | { preset: "custom"; from: string; to: string; timezone: string };

export type AnalyticsSeriesPoint = {
  key: string;
  from: string;
  to: string;
  values: Record<string, number | null>;
  dimensions: Record<string, string>;
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
  series: { granularity: string; points: readonly AnalyticsSeriesPoint[] };
  comparisons: readonly AnalyticsComparison[];
  dataFreshness: { generatedAt: string; partialData: boolean; staleData: boolean; unavailableMetrics: readonly string[] };
  funnel?: readonly { stage: string; input: number; output: number; abandonment: number; conversionRate: number; averageStageTimeMs: number | null }[];
};

export type AnalyticsInsight = {
  insightId: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  metricReferences: readonly string[];
  generatedAt: string;
  status: string;
};

export type AnalyticsAlertOccurrence = {
  id: string;
  status: "active" | "acknowledged" | "resolved" | "dismissed";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  metricId: string;
  value: number;
  triggeredAt: string;
};

export type AnalyticsDataQualityReport = {
  id: string;
  status: "healthy" | "warning" | "critical";
  generatedAt: string;
  issues: readonly { code: string; severity: "warning" | "critical"; safeMessage: string; evidence?: Record<string, unknown> }[];
};

export type AnalyticsExportJob = {
  id: string;
  format: "csv" | "json";
  status: "pending" | "completed" | "failed" | "expired";
  requestedAt: string;
  completedAt?: string;
  expiresAt?: string;
};

export type AnalyticsExportDetail = {
  job: AnalyticsExportJob;
  artifact?: { id: string; contentType: string; body: string; createdAt: string; expiresAt: string };
};

export type AnalyticsHealth = {
  status: "healthy" | "degraded" | "unhealthy";
  checks: readonly { id: string; status: "pass" | "warn" | "fail"; safeMessage: string; evidence?: Record<string, unknown> }[];
  metrics: Record<string, number>;
};
