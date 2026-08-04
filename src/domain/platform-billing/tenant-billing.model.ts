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
  /** Cota mensal de cr\u00e9ditos Vorix inclu\u00edda no plano contratado. Cr\u00e9dito \u00e9 uma unidade
   * abstrata, fixa por funcionalidade (ver `AiOperationType.creditsCost` em `ai-providers.model.ts`)
   * \u2014 nunca proporcional a tokens/segundos reais gastos no provider. */
  monthlyCreditsQuota: number;
  /** Cota mensal de publica\u00e7\u00f5es reais (Meta/etc.) inclu\u00edda no plano contratado. */
  monthlyPublicationsQuota: number;
  /** Cr\u00e9ditos comprados avulsos ainda n\u00e3o consumidos \u2014 rolam entre meses. */
  creditsExtra: number;
  /** Markup hist\u00f3rico (era usado para `customerPrice = providerCost * multiplier`). Desde a
   * migra\u00e7\u00e3o para cr\u00e9ditos fixos por opera\u00e7\u00e3o, a receita estimada usa
   * `creditUnitValueUsd` (`platform_ai_settings`) \u2014 este campo fica mantido s\u00f3 para eventual
   * desconto/markup negociado por tenant, n\u00e3o \u00e9 mais lido pelo fluxo de consumo de IA. */
  priceMultiplier: number;
  activatedAt?: string;
  suspendedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Entrada no ledger de cr\u00e9ditos. Todo delta em `creditsExtra` deixa uma linha aqui \u2014
 * audit\u00e1vel, imut\u00e1vel. `deltaCredits` positivo = adicionado; negativo = consumido/estornado.
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
  deltaCredits: number;
  reason: TenantCreditLedgerReason;
  actorUserId?: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

/**
 * Consumo mensal agregado. Uma linha por (tenant, per\u00edodo YYYY-MM). \u00c9 a fonte de verdade das
 * m\u00e9tricas de neg\u00f3cio: quanto pagamos ao(s) provedor(es) real(is) (`providerCostUsd`, somado de
 * Anthropic/OpenAI/Google conforme a opera\u00e7\u00e3o) vs. a receita estimada (`customerPriceUsd` =
 * `creditsConsumed * creditUnitValueUsd`, ver `platform_ai_settings`) \u2014 a diferen\u00e7a \u00e9 o lucro
 * bruto. `inputTokens`/`outputTokens` seguem espec\u00edficos do consumo de texto (Anthropic); gera\u00e7\u00e3o
 * de imagem/v\u00eddeo n\u00e3o usa token, s\u00f3 incrementa `creditsConsumed` e `providerCostUsd`.
 */
export type TenantAiUsageMonthly = {
  tenantId: string;
  /** YYYY-MM (ex.: "2026-08"). */
  period: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** Cr\u00e9ditos Vorix consumidos no per\u00edodo \u2014 soma de todas as opera\u00e7\u00f5es (texto, imagem, v\u00eddeo). */
  creditsConsumed: number;
  /** Custo real pago ao(s) provider(s) real(is), somado independente de qual foi usado. */
  providerCostUsd: number;
  /** Receita estimada = creditsConsumed * creditUnitValueUsd (n\u00e3o \u00e9 pagamento real \u2014 ainda n\u00e3o existe gateway de pagamento). */
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
  totalCreditsUsedThisMonth: number;
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
    creditsConsumed: 0,
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
