import { apiClient } from "@/lib/api-client";
import type {
  PlatformDashboardSummary,
  PlatformPlanCode,
  PlatformSubscriptionStatus,
  PlatformTenantDetail,
  TenantAdminOverview,
  TenantBilling,
  TenantCreditLedgerEntry,
} from "./types";

/** Rotas `/v1/admin/*`. Só respondem 200 quando o JWT tem `isPlatformAdmin`; caso contrário 403. */

export async function fetchPlatformDashboard(): Promise<PlatformDashboardSummary> {
  return apiClient.get<PlatformDashboardSummary>("/v1/admin/dashboard");
}

export async function fetchTenantsList(params: {
  limit?: number;
  offset?: number;
  planCode?: PlatformPlanCode;
  subscriptionStatus?: PlatformSubscriptionStatus;
} = {}): Promise<{ items: TenantAdminOverview[]; total: number }> {
  const search = new URLSearchParams();
  if (params.limit) search.set("limit", String(params.limit));
  if (params.offset) search.set("offset", String(params.offset));
  if (params.planCode) search.set("planCode", params.planCode);
  if (params.subscriptionStatus) search.set("subscriptionStatus", params.subscriptionStatus);
  const qs = search.toString();
  return apiClient.get(`/v1/admin/tenants${qs ? `?${qs}` : ""}`);
}

export async function fetchTenantDetail(tenantId: string): Promise<PlatformTenantDetail> {
  return apiClient.get<PlatformTenantDetail>(`/v1/admin/tenants/${encodeURIComponent(tenantId)}`);
}

export async function adjustTenantCredits(tenantId: string, deltaTokens: number, reason: string): Promise<{
  billing: TenantBilling;
  entry: TenantCreditLedgerEntry;
}> {
  return apiClient.post(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/credits`, { deltaTokens, reason });
}

export async function changeTenantPlan(tenantId: string, planCode: PlatformPlanCode): Promise<TenantBilling> {
  return apiClient.post(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/plan`, { planCode });
}

export async function suspendTenant(tenantId: string): Promise<TenantBilling> {
  return apiClient.post(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/suspend`);
}

export async function activateTenant(tenantId: string): Promise<TenantBilling> {
  return apiClient.post(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/activate`);
}

export async function setTenantMultiplier(tenantId: string, multiplier: number): Promise<TenantBilling> {
  return apiClient.post(`/v1/admin/tenants/${encodeURIComponent(tenantId)}/multiplier`, { multiplier });
}
