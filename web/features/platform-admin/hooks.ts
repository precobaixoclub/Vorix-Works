import useSWR from "swr";
import type { PlatformPlanCode, PlatformSubscriptionStatus } from "./types";
import {
  fetchPlatformDashboard,
  fetchTenantDetail,
  fetchTenantsList,
} from "./api";

export function usePlatformDashboard() {
  return useSWR(["platform-admin", "dashboard"], () => fetchPlatformDashboard());
}

export function useTenantsList(params: {
  limit?: number;
  offset?: number;
  planCode?: PlatformPlanCode;
  subscriptionStatus?: PlatformSubscriptionStatus;
}) {
  return useSWR(
    ["platform-admin", "tenants", params.limit, params.offset, params.planCode, params.subscriptionStatus],
    () => fetchTenantsList(params),
  );
}

export function useTenantDetail(tenantId: string | undefined) {
  return useSWR(tenantId ? ["platform-admin", "tenant", tenantId] : null, () => fetchTenantDetail(tenantId!));
}
