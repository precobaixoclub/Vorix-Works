export type GrowthFunnelStage = { stage: string; count: number };

export type PlatformSubscriptionStatus = "trial" | "active" | "past_due" | "cancelled" | "expired" | "suspended" | "trial_expired";

export type GrowthDashboard = {
  funnel: GrowthFunnelStage[];
  trial: { active: number; expired: number; converted: number; conversionRate: number | null };
  subscriptionsByStatus: Partial<Record<PlatformSubscriptionStatus, number>>;
  lifecycle: { upgrades: number; downgrades: number; cancellations: number; reactivations: number; paymentFailures: number };
  revenue: { mrrUsd: number; arrUsd: number; arpuUsd: number | null; payingCustomers: number };
  unavailableMetrics: string[];
};
