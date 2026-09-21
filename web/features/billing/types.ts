/** Tipos do módulo de Cobrança self-service — SaaS Commercialization, Fase 4. Espelham
 * `src/application/billing/overview-use-cases.ts` e `entitlement-use-cases.ts` do backend. */

export const PLATFORM_PLAN_CODES = ["FREE", "START", "PRO", "BUSINESS", "ENTERPRISE"] as const;
export type PlatformPlanCode = (typeof PLATFORM_PLAN_CODES)[number];

export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const PLAN_LIMIT_RESOURCES = ["users", "workspaces", "messaging_connections", "contacts", "ai_credits", "storage_mb", "automations"] as const;
export type PlanLimitResource = (typeof PLAN_LIMIT_RESOURCES)[number];

export const RESOURCE_LABELS: Record<PlanLimitResource, string> = {
  users: "Usuários",
  workspaces: "Workspaces",
  messaging_connections: "Conexões de mensageria",
  contacts: "Contatos",
  ai_credits: "Créditos de IA",
  storage_mb: "Armazenamento (MB)",
  automations: "Automações",
};

export type PaymentMethodSnapshot = { providerPaymentMethodId: string; brand?: string; last4?: string; expMonth?: number; expYear?: number };

export type BillingOverviewAddon = { addonCode: string; name: string; quantity: number; subscriptionItemId: string };
export type BillingOverviewConsumption = { resource: PlanLimitResource; used: number; max: number | null };
export type BillingOverviewAvailableAddon = { code: string; name: string; description: string; monthlyPriceUsd: number; yearlyPriceUsd: number; resource: PlanLimitResource; increment: number };

export type BillingOverview = {
  planCode: string;
  planName: string;
  virtual: boolean;
  readOnly: boolean;
  billingInterval: BillingInterval | null;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  trialDaysRemaining: number | null;
  allowedAddonCodes: readonly string[];
  addons: BillingOverviewAddon[];
  availableAddons: BillingOverviewAvailableAddon[];
  consumption: BillingOverviewConsumption[];
  paymentMethod: PaymentMethodSnapshot | undefined;
  recentInvoices: Array<{
    id: string;
    providerInvoiceId: string;
    amountCents: number;
    currency: string;
    status: "draft" | "open" | "paid" | "void" | "uncollectible";
    pdfUrl?: string;
    createdAt: string;
  }>;
};

export type DowngradePreview = { overages: Array<{ resource: PlanLimitResource; used: number; newMax: number }>; safeToChange: boolean };

/** Pricing/Capacity Etapa B — espelham `capacity.model.ts`/`capacity-use-cases.ts` do backend.
 * Backend é a autoridade do cálculo (seção 9/35 do pedido) — este arquivo só formata o que a API
 * já devolve pronto, nunca reimplementa a conta. */
export type CapacitySnapshot = {
  planCode: PlatformPlanCode;
  currency: string;
  includedUsers: number | null;
  additionalUsers: number;
  totalUsers: number | null;
  includedWhatsappConnections: number | null;
  additionalWhatsappConnections: number;
  totalWhatsappConnections: number | null;
  baseMonthlyAmount: number;
  addonsMonthlyAmount: number;
  totalMonthlyAmount: number;
};

export type CapacityPendingChange = { resource: PlanLimitResource; addonCode: string; targetQuantity: number; effectiveAt: string };

export type CapacityState = { current: CapacitySnapshot; pending: readonly CapacityPendingChange[] };

export type CapacityCostBreakdown = {
  planCode: PlatformPlanCode;
  currency: string;
  baseMonthlyAmount: number;
  includedUsers: number | null;
  includedWhatsappConnections: number | null;
  additionalUsers: number;
  additionalWhatsappConnections: number;
  userAddonMonthlyAmount: number;
  whatsappAddonMonthlyAmount: number;
  addonsMonthlyAmount: number;
  totalMonthlyAmount: number;
  feasible: boolean;
};

export type PlanRecommendation = { options: CapacityCostBreakdown[]; recommended: CapacityCostBreakdown | undefined };

export type CapacityPreviewResult = { current: CapacitySnapshot; requestedOnCurrentPlan: CapacityCostBreakdown; recommendation: PlanRecommendation };

export type CapacityChangeOutcome = { resource: PlanLimitResource; kind: "unchanged" | "increased" | "decrease_scheduled"; fromQuantity: number; toQuantity: number; effectiveAt?: string };

export type CapacityChangeResult = { outcomes: CapacityChangeOutcome[] };
