import { apiClient } from "@/lib/api-client";
import type { AnalyticsAlertOccurrence, AnalyticsDataQualityReport, AnalyticsExportDetail, AnalyticsExportJob, AnalyticsHealth, AnalyticsInsight, AnalyticsMetricDefinition, AnalyticsPeriod, AnalyticsQueryResult } from "./types";

export function getAnalyticsOverview(workspaceId: string, period: string, timezone: string): Promise<AnalyticsQueryResult> {
  return apiClient.get<AnalyticsQueryResult>(`/v1/analytics/overview?${params({ workspaceId, period, timezone })}`);
}

export function queryAnalytics(input: { workspaceId: string; metrics: string[]; groupBy?: string[]; period?: AnalyticsPeriod; timezone: string; comparisonPeriod?: AnalyticsPeriod }): Promise<AnalyticsQueryResult> {
  return apiClient.post<AnalyticsQueryResult>("/v1/analytics/query", input);
}

export function listAnalyticsMetrics(): Promise<AnalyticsMetricDefinition[]> {
  return apiClient.get<AnalyticsMetricDefinition[]>("/v1/analytics/metrics");
}

export function getAnalyticsProviders(workspaceId: string, period: string, timezone: string): Promise<AnalyticsQueryResult> {
  return apiClient.get<AnalyticsQueryResult>(`/v1/analytics/providers?${params({ workspaceId, period, timezone })}`);
}

export function getAnalyticsCampaigns(workspaceId: string, period: string, timezone: string): Promise<AnalyticsQueryResult> {
  return apiClient.get<AnalyticsQueryResult>(`/v1/analytics/campaigns?${params({ workspaceId, period, timezone })}`);
}

export function getAnalyticsScheduling(workspaceId: string, period: string, timezone: string): Promise<AnalyticsQueryResult> {
  return apiClient.get<AnalyticsQueryResult>(`/v1/analytics/scheduling?${params({ workspaceId, period, timezone })}`);
}

export function getAnalyticsPublication(workspaceId: string, period: string, timezone: string): Promise<AnalyticsQueryResult> {
  return apiClient.get<AnalyticsQueryResult>(`/v1/analytics/publication?${params({ workspaceId, period, timezone })}`);
}

export function getAnalyticsExecution(workspaceId: string, period: string, timezone: string): Promise<AnalyticsQueryResult> {
  return apiClient.get<AnalyticsQueryResult>(`/v1/analytics/execution?${params({ workspaceId, period, timezone })}`);
}

export function getAnalyticsFunnel(workspaceId: string, period: string, timezone: string): Promise<AnalyticsQueryResult> {
  return apiClient.get<AnalyticsQueryResult>(`/v1/analytics/funnel?${params({ workspaceId, period, timezone })}`);
}

export function listAnalyticsInsights(workspaceId: string, period: string, timezone: string): Promise<AnalyticsInsight[]> {
  return apiClient.get<AnalyticsInsight[]>(`/v1/analytics/insights?${params({ workspaceId, period, timezone })}`);
}

export function listAnalyticsAlerts(workspaceId: string, period: string, timezone: string): Promise<AnalyticsAlertOccurrence[]> {
  return apiClient.get<AnalyticsAlertOccurrence[]>(`/v1/analytics/alerts?${params({ workspaceId, period, timezone })}`);
}

export function acknowledgeAnalyticsAlert(workspaceId: string, id: string): Promise<AnalyticsAlertOccurrence | undefined> {
  return apiClient.post<AnalyticsAlertOccurrence | undefined>(`/v1/analytics/alerts/${encodeURIComponent(id)}/acknowledge`, { workspaceId });
}

export function resolveAnalyticsAlert(workspaceId: string, id: string): Promise<AnalyticsAlertOccurrence | undefined> {
  return apiClient.post<AnalyticsAlertOccurrence | undefined>(`/v1/analytics/alerts/${encodeURIComponent(id)}/resolve`, { workspaceId });
}

export function getAnalyticsDataQuality(workspaceId: string): Promise<AnalyticsDataQualityReport> {
  return apiClient.get<AnalyticsDataQualityReport>(`/v1/analytics/data-quality?${params({ workspaceId })}`);
}

export function requestAnalyticsExport(workspaceId: string, format: "csv" | "json", query: { metrics: string[]; timezone: string; period: AnalyticsPeriod }): Promise<AnalyticsExportJob> {
  return apiClient.post<AnalyticsExportJob>("/v1/analytics/exports", { workspaceId, format, query });
}

export function getAnalyticsExport(workspaceId: string, id: string): Promise<AnalyticsExportDetail | undefined> {
  return apiClient.get<AnalyticsExportDetail | undefined>(`/v1/analytics/exports/${encodeURIComponent(id)}?${params({ workspaceId })}`);
}

export function getAnalyticsHealth(workspaceId: string): Promise<AnalyticsHealth> {
  return apiClient.get<AnalyticsHealth>(`/v1/analytics/health?${params({ workspaceId })}`);
}

function params(input: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value) search.set(key, value);
  return search.toString();
}
