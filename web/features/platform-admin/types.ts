/** Tipos do painel administrativo de plataforma — Sprint 25. Espelham
 * `src/domain/platform-billing/` e `src/application/platform-admin/` do backend. */

export const PLATFORM_PLAN_CODES = ["FREE", "START", "PRO", "BUSINESS", "ENTERPRISE"] as const;
export type PlatformPlanCode = (typeof PLATFORM_PLAN_CODES)[number];

export const PLATFORM_SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "past_due",
  "cancelled",
  "expired",
  "suspended",
] as const;
export type PlatformSubscriptionStatus = (typeof PLATFORM_SUBSCRIPTION_STATUSES)[number];

export type TenantBilling = {
  tenantId: string;
  planCode: PlatformPlanCode;
  subscriptionStatus: PlatformSubscriptionStatus;
  monthlyCreditsQuota: number;
  monthlyPublicationsQuota: number;
  creditsExtra: number;
  priceMultiplier: number;
  activatedAt?: string;
  suspendedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type TenantAiUsageMonthly = {
  tenantId: string;
  period: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  creditsConsumed: number;
  providerCostUsd: number;
  customerPriceUsd: number;
  requestsCount: number;
  updatedAt: string;
};

export type TenantAdminOverview = {
  tenantId: string;
  billing: TenantBilling;
  currentPeriod: string;
  currentUsage: TenantAiUsageMonthly;
  currentProfitUsd: number;
  totalCreditsUsedThisMonth: number;
  quotaUsagePercent: number;
};

export type TenantCreditLedgerEntry = {
  id: string;
  tenantId: string;
  deltaCredits: number;
  reason: string;
  actorUserId?: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

export type PlatformTenantDetail = {
  overview: TenantAdminOverview;
  planName: string;
  workspaces: { id: string; name: string; status: string }[];
  members: { userId: string; email: string; name: string; role: string }[];
  recentCreditEntries: TenantCreditLedgerEntry[];
  usageHistory: TenantAiUsageMonthly[];
};

export type PlatformDashboardSummary = {
  currentPeriod: string;
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  totalRevenueUsd: number;
  totalProviderCostUsd: number;
  totalProfitUsd: number;
  totalRequestsCount: number;
  totalCreditsConsumed: number;
  topTenantsByRevenue: Array<{
    tenantId: string;
    planCode: PlatformPlanCode;
    customerPriceUsd: number;
    providerCostUsd: number;
    profitUsd: number;
  }>;
};
