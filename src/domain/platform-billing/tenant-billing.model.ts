/**
 * Modelos de dom\u00ednio de billing por Tenant \u2014 Sprint 25 (Fase 1). Nenhum destes tipos depende
 * de Fastify, Postgres ou qualquer biblioteca; a borda HTTP e o adapter Postgres vivem em
 * `interfaces/api/routes/v1/admin.route.ts` e `infrastructure/storage/postgres/`.
 */

import type { PlatformPlanCode, PlatformSubscriptionStatus } from "./platform-plan-catalog.js";

/**
 * Configura\u00e7\u00e3o de billing de um Tenant. Uma linha por Tenant em `tenant_billing`. `tenantId` \u00e9
 * refer\u00eancia solta (a tabela `tenants` n\u00e3o existe \u2014 mesma conven\u00e7\u00e3o de `workspaces.tenant_id`).
 */
export type TenantBilling = {
  tenantId: string;
  planCode: PlatformPlanCode;
  subscriptionStatus: PlatformSubscriptionStatus;
  /** Cota mensal de tokens de IA (input + output somados) inclu\u00edda no plano contratado. */
  monthlyTokenQuota: number;
  /** Cota mensal de publica\u00e7\u00f5es reais (Meta/etc.) inclu\u00edda no plano contratado. */
  monthlyPublicationsQuota: number;
  /** Tokens comprados avulsos ainda n\u00e3o consumidos \u2014 rolam entre meses. */
  creditsExtraTokens: number;
  /** Markup aplicado sobre o custo real do provider para calcular o pre\u00e7o cobrado do cliente.
   * `2.00` = cobramos o dobro do custo. Sempre >= 1.00. */
  priceMultiplier: number;
  activatedAt?: string;
  suspendedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Entrada no ledger de cr\u00e9ditos. Todo delta em `creditsExtraTokens` deixa uma linha aqui \u2014
 * audit\u00e1vel, imut\u00e1vel. `deltaTokens` positivo = adicionado; negativo = consumido/estornado.
 */
export const TENANT_CREDIT_LEDGER_REASONS = [
  "manual_adjustment",
  "plan_purchase",
  "extra_purchase",
  "ai_consumption",
  "refund",
  "plan_reset",
  "trial_grant",
  "signup_grant",
] as const;
export type TenantCreditLedgerReason = (typeof TENANT_CREDIT_LEDGER_REASONS)[number];

export type TenantCreditLedgerEntry = {
  id: string;
  tenantId: string;
  deltaTokens: number;
  reason: TenantCreditLedgerReason;
  actorUserId?: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

/**
 * Consumo mensal agregado. Uma linha por (tenant, per\u00edodo YYYY-MM). \u00c9 a fonte de verdade das
 * m\u00e9tricas de neg\u00f3cio: quanto pagamos ao provedor real (`providerCostUsd`) vs. quanto cobramos
 * do cliente (`customerPriceUsd`) \u2014 a diferen\u00e7a \u00e9 o lucro bruto.
 */
export type TenantAiUsageMonthly = {
  tenantId: string;
  /** YYYY-MM (ex.: "2026-08"). */
  period: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Custo real pago ao provider real (Anthropic). */
  providerCostUsd: number;
  /** Pre\u00e7o cobrado do cliente = providerCost * priceMultiplier. */
  customerPriceUsd: number;
  requestsCount: number;
  updatedAt: string;
};

/** Vista consolidada para o painel admin \u2014 um Tenant + billing + consumo do m\u00eas corrente. */
export type TenantAdminOverview = {
  tenantId: string;
  billing: TenantBilling;
  currentPeriod: string;
  currentUsage: TenantAiUsageMonthly;
  currentProfitUsd: number;
  totalTokensUsedThisMonth: number;
  quotaUsagePercent: number;
};

export function periodOf(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function emptyMonthlyUsage(tenantId: string, period: string, now: string): TenantAiUsageMonthly {
  return {
    tenantId,
    period,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    providerCostUsd: 0,
    customerPriceUsd: 0,
    requestsCount: 0,
    updatedAt: now,
  };
}

/** Lucro bruto = pre\u00e7o cobrado - custo pago ao provider. Sempre >= 0 (o multiplier \u00e9 >= 1). */
export function profitOfMonthly(usage: TenantAiUsageMonthly): number {
  return Math.max(0, usage.customerPriceUsd - usage.providerCostUsd);
}

/** Pre\u00e7o cobrado do cliente = custo real * multiplier. Nunca negativo. */
export function applyMarkup(providerCostUsd: number, multiplier: number): number {
  if (multiplier < 1) throw new Error("PLATFORM_BILLING_INVALID_MULTIPLIER: markup precisa ser >= 1.");
  return roundToMicroCent(Math.max(0, providerCostUsd) * multiplier);
}

function roundToMicroCent(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
