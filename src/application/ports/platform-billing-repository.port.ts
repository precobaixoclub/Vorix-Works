import type {
  TenantAiUsageMonthly,
  TenantBilling,
  TenantCreditLedgerEntry,
  TenantCreditLedgerReason,
} from "../../domain/platform-billing/index.js";
import type { PlatformPlanCode, PlatformSubscriptionStatus } from "../../domain/platform-billing/index.js";

/**
 * Porta de persist\u00eancia do bounded context `platform-billing` \u2014 Sprint 25 (Fase 1). Adapters
 * (`PostgresPlatformBillingRepository`, `InMemoryPlatformBillingRepository`) implementam essa
 * interface. Nenhuma regra de neg\u00f3cio aqui, s\u00f3 CRUD com sem\u00e2ntica clara.
 */
export type PlatformBillingRepositoryPort = {
  /** Cria ou retorna o billing existente do tenant. Idempotente. */
  ensureTenantBilling(input: { tenantId: string; now: string }): Promise<TenantBilling>;

  getTenantBilling(tenantId: string): Promise<TenantBilling | undefined>;

  listAllTenantBilling(filters?: {
    planCode?: PlatformPlanCode;
    subscriptionStatus?: PlatformSubscriptionStatus;
    limit?: number;
    offset?: number;
  }): Promise<TenantBilling[]>;

  countAllTenantBilling(filters?: {
    planCode?: PlatformPlanCode;
    subscriptionStatus?: PlatformSubscriptionStatus;
  }): Promise<number>;

  updateTenantBilling(input: {
    tenantId: string;
    patch: Partial<Pick<TenantBilling,
      "planCode" | "subscriptionStatus" | "monthlyCreditsQuota" | "monthlyPublicationsQuota"
      | "priceMultiplier" | "activatedAt" | "suspendedAt" | "expiresAt">>;
    now: string;
  }): Promise<TenantBilling>;

  /** Ajusta `creditsExtra` E grava uma linha em `tenant_credit_ledger` na mesma transa\u00e7\u00e3o. */
  applyCreditDelta(input: {
    id: string;
    tenantId: string;
    deltaCredits: number;
    reason: TenantCreditLedgerReason;
    actorUserId?: string;
    metadata?: Record<string, unknown>;
    now: string;
  }): Promise<{ billing: TenantBilling; entry: TenantCreditLedgerEntry }>;

  listCreditLedger(input: { tenantId: string; limit?: number }): Promise<TenantCreditLedgerEntry[]>;

  /** Upserta a linha de consumo do m\u00eas corrente somando os deltas. Chamado toda vez que uma
   * opera\u00e7\u00e3o de IA (texto/imagem/v\u00eddeo) completa. Nunca DIMINUI valores \u2014 s\u00f3 incrementa. */
  addAiUsage(input: {
    tenantId: string;
    period: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    creditsConsumed: number;
    providerCostUsd: number;
    customerPriceUsd: number;
    requestsDelta: number;
    now: string;
  }): Promise<TenantAiUsageMonthly>;

  getAiUsage(input: { tenantId: string; period: string }): Promise<TenantAiUsageMonthly | undefined>;

  /** Somat\u00f3rio de consumo em um per\u00edodo \u2014 usado para receita/lucro agregado do painel admin. */
  aggregateUsage(input: { period?: string; tenantIds?: readonly string[] }): Promise<{
    totalTenants: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCreditsConsumed: number;
    totalRequestsCount: number;
    totalProviderCostUsd: number;
    totalCustomerPriceUsd: number;
  }>;
};
