import useSWR from "swr";
import { getAnalyticsCampaigns, getAnalyticsDataQuality, getAnalyticsExecution, getAnalyticsFunnel, getAnalyticsHealth, getAnalyticsOverview, getAnalyticsProviders, getAnalyticsPublication, getAnalyticsScheduling, listAnalyticsAlerts, listAnalyticsInsights, listAnalyticsMetrics } from "./api";

export function useAnalyticsOverview(workspaceId: string, period: string, timezone: string) {
  return useSWR(["analytics-overview", workspaceId, period, timezone], () => getAnalyticsOverview(workspaceId, period, timezone));
}

export function useAnalyticsMetrics() {
  return useSWR("analytics-metrics", listAnalyticsMetrics);
}

export function useAnalyticsProviders(workspaceId: string, period: string, timezone: string) {
  return useSWR(["analytics-providers", workspaceId, period, timezone], () => getAnalyticsProviders(workspaceId, period, timezone));
}

export function useAnalyticsCampaigns(workspaceId: string, period: string, timezone: string) {
  return useSWR(["analytics-campaigns", workspaceId, period, timezone], () => getAnalyticsCampaigns(workspaceId, period, timezone));
}

export function useAnalyticsScheduling(workspaceId: string, period: string, timezone: string) {
  return useSWR(["analytics-scheduling", workspaceId, period, timezone], () => getAnalyticsScheduling(workspaceId, period, timezone));
}

export function useAnalyticsPublication(workspaceId: string, period: string, timezone: string) {
  return useSWR(["analytics-publication", workspaceId, period, timezone], () => getAnalyticsPublication(workspaceId, period, timezone));
}

export function useAnalyticsExecution(workspaceId: string, period: string, timezone: string) {
  return useSWR(["analytics-execution", workspaceId, period, timezone], () => getAnalyticsExecution(workspaceId, period, timezone));
}

export function useAnalyticsFunnel(workspaceId: string, period: string, timezone: string) {
  return useSWR(["analytics-funnel", workspaceId, period, timezone], () => getAnalyticsFunnel(workspaceId, period, timezone));
}

export function useAnalyticsInsights(workspaceId: string, period: string, timezone: string) {
  return useSWR(["analytics-insights", workspaceId, period, timezone], () => listAnalyticsInsights(workspaceId, period, timezone));
}

export function useAnalyticsAlerts(workspaceId: string, period: string, timezone: string) {
  return useSWR(["analytics-alerts", workspaceId, period, timezone], () => listAnalyticsAlerts(workspaceId, period, timezone));
}

export function useAnalyticsDataQuality(workspaceId: string) {
  return useSWR(["analytics-data-quality", workspaceId], () => getAnalyticsDataQuality(workspaceId));
}

export function useAnalyticsHealth(workspaceId: string) {
  return useSWR(["analytics-health", workspaceId], () => getAnalyticsHealth(workspaceId));
}
