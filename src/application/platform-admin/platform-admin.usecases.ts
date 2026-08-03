/**
 * Use cases do bounded context `platform-admin` \u2014 Sprint 25 (Fase 1).
 *
 * Escopo: opera\u00e7\u00f5es cross-tenant que S\u00d3 platform admins podem invocar. Cada use case aqui \u00e9
 * pass\u00edvel de ser chamado por rotas HTTP (`/v1/admin/*`) OU por scripts operacionais
 * (retry manual, ajuste em massa etc.). A por\u00e7\u00e3o "quem \u00e9 platform admin" \u00e9 responsabilidade da
 * borda HTTP (`requirePlatformAdmin`); aqui a fun\u00e7\u00e3o recebe o principal j\u00e1 validado.
 */

import { getPlatformPlan, type PlatformPlanCode } from "../../domain/platform-billing/platform-plan-catalog.js";
import {
  applyMarkup,
  emptyMonthlyUsage,
  periodOf,
  profitOfMonthly,
  type TenantAdminOverview,
  type TenantAiUsageMonthly,
  type TenantBilling,
  type TenantCreditLedgerEntry,
} from "../../domain/platform-billing/tenant-billing.model.js";
import type { PlatformBillingRepositoryPort } from "../ports/platform-billing-repository.port.js";
import type { TenantMembershipRepositoryPort } from "../ports/tenant-membership-repository.port.js";
import type { UserRepositoryPort } from "../ports/user-repository.port.js";
import type { WorkspaceRepositoryPort } from "../ports/workspace-repository.port.js";

export type PlatformAdminUseCaseDeps = {
  platformBillingRepository: PlatformBillingRepositoryPort;
  membershipRepository: TenantMembershipRepositoryPort;
  userRepository: UserRepositoryPort;
  workspaceRepository: WorkspaceRepositoryPort;
  idGenerator: () => string;
  now: () => Date;
};

export type PlatformAdminActor = { userId: string };

/** Snapshot detalhado de UM tenant: billing, consumo, workspaces, membros, ledger recente. */
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
  totalTokensUsed: number;
  topTenantsByRevenue: Array<{
    tenantId: string;
    planCode: PlatformPlanCode;
    customerPriceUsd: number;
    providerCostUsd: number;
    profitUsd: number;
  }>;
};

/** Lista paginada de tenants com seu overview mensal (para a tabela principal do painel). */
export async function listTenantsOverview(
  deps: PlatformAdminUseCaseDeps,
  input: { limit?: number; offset?: number; planCode?: PlatformPlanCode; subscriptionStatus?: TenantBilling["subscriptionStatus"] } = {},
): Promise<{ items: TenantAdminOverview[]; total: number }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const offset = Math.max(input.offset ?? 0, 0);
  const period = periodOf(deps.now());

  const [billings, total] = await Promise.all([
    deps.platformBillingRepository.listAllTenantBilling({
      planCode: input.planCode,
      subscriptionStatus: input.subscriptionStatus,
      limit,
      offset,
    }),
    deps.platformBillingRepository.countAllTenantBilling({
      planCode: input.planCode,
      subscriptionStatus: input.subscriptionStatus,
    }),
  ]);

  const items: TenantAdminOverview[] = await Promise.all(
    billings.map(async (billing) => {
      const usage = (await deps.platformBillingRepository.getAiUsage({ tenantId: billing.tenantId, period }))
        ?? emptyMonthlyUsage(billing.tenantId, period, deps.now().toISOString());
      const quotaUsagePercent = billing.monthlyTokenQuota > 0
        ? Math.min(100, ((usage.inputTokens + usage.outputTokens) / billing.monthlyTokenQuota) * 100)
        : 0;
      return {
        tenantId: billing.tenantId,
        billing,
        currentPeriod: period,
        currentUsage: usage,
        currentProfitUsd: profitOfMonthly(usage),
        totalTokensUsedThisMonth: usage.inputTokens + usage.outputTokens,
        quotaUsagePercent,
      };
    }),
  );

  return { items, total };
}

/** Detalhe completo de um tenant. */
export async function getTenantDetail(
  deps: PlatformAdminUseCaseDeps,
  input: { tenantId: string },
): Promise<PlatformTenantDetail> {
  const billing = await deps.platformBillingRepository.getTenantBilling(input.tenantId);
  if (!billing) throw new Error("PLATFORM_ADMIN_TENANT_NOT_FOUND: tenant sem billing configurado.");

  const period = periodOf(deps.now());
  const [usage, recentCreditEntries, workspaces, members, usageHistory] = await Promise.all([
    deps.platformBillingRepository.getAiUsage({ tenantId: input.tenantId, period }),
    deps.platformBillingRepository.listCreditLedger({ tenantId: input.tenantId, limit: 25 }),
    deps.workspaceRepository.listByTenant(input.tenantId),
    deps.membershipRepository.listByTenant(input.tenantId),
    listUsageHistoryLastMonths(deps, input.tenantId, 6),
  ]);

  const currentUsage = usage ?? emptyMonthlyUsage(input.tenantId, period, deps.now().toISOString());
  const quotaUsagePercent = billing.monthlyTokenQuota > 0
    ? Math.min(100, ((currentUsage.inputTokens + currentUsage.outputTokens) / billing.monthlyTokenQuota) * 100)
    : 0;

  const memberDetails = await Promise.all(
    members.map(async (m) => {
      const u = await deps.userRepository.getById(m.userId);
      return {
        userId: m.userId,
        email: u?.email ?? "(desconhecido)",
        name: u?.name ?? "(desconhecido)",
        role: m.role,
      };
    }),
  );

  return {
    overview: {
      tenantId: input.tenantId,
      billing,
      currentPeriod: period,
      currentUsage,
      currentProfitUsd: profitOfMonthly(currentUsage),
      totalTokensUsedThisMonth: currentUsage.inputTokens + currentUsage.outputTokens,
      quotaUsagePercent,
    },
    planName: getPlatformPlan(billing.planCode).name,
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, status: w.status })),
    members: memberDetails,
    recentCreditEntries,
    usageHistory,
  };
}

/** Ajuste manual de cr\u00e9ditos (o admin libera/subtrai tokens avulsos). */
export async function adjustTenantCredits(
  deps: PlatformAdminUseCaseDeps,
  input: { tenantId: string; deltaTokens: number; reason: string; actor: PlatformAdminActor },
): Promise<{ billing: TenantBilling; entry: TenantCreditLedgerEntry }> {
  if (input.deltaTokens === 0) throw new Error("PLATFORM_ADMIN_INVALID_DELTA: o delta n\u00e3o pode ser zero.");
  const result = await deps.platformBillingRepository.applyCreditDelta({
    id: deps.idGenerator(),
    tenantId: input.tenantId,
    deltaTokens: input.deltaTokens,
    reason: "manual_adjustment",
    actorUserId: input.actor.userId,
    metadata: { note: input.reason.slice(0, 500) },
    now: deps.now().toISOString(),
  });
  return result;
}

/** Muda o plano contratado do tenant \u2014 aplica as cotas do novo plano imediatamente. */
export async function changeTenantPlan(
  deps: PlatformAdminUseCaseDeps,
  input: { tenantId: string; planCode: PlatformPlanCode; actor: PlatformAdminActor },
): Promise<TenantBilling> {
  const plan = getPlatformPlan(input.planCode);
  return deps.platformBillingRepository.updateTenantBilling({
    tenantId: input.tenantId,
    patch: {
      planCode: input.planCode,
      monthlyTokenQuota: plan.monthlyTokenQuota,
      monthlyPublicationsQuota: plan.monthlyPublicationsQuota,
      subscriptionStatus: input.planCode === "FREE" ? "trial" : "active",
      activatedAt: input.planCode === "FREE" ? undefined : deps.now().toISOString(),
    },
    now: deps.now().toISOString(),
  });
}

export async function suspendTenant(
  deps: PlatformAdminUseCaseDeps,
  input: { tenantId: string; actor: PlatformAdminActor },
): Promise<TenantBilling> {
  return deps.platformBillingRepository.updateTenantBilling({
    tenantId: input.tenantId,
    patch: { subscriptionStatus: "suspended", suspendedAt: deps.now().toISOString() },
    now: deps.now().toISOString(),
  });
}

export async function activateTenant(
  deps: PlatformAdminUseCaseDeps,
  input: { tenantId: string; actor: PlatformAdminActor },
): Promise<TenantBilling> {
  return deps.platformBillingRepository.updateTenantBilling({
    tenantId: input.tenantId,
    patch: { subscriptionStatus: "active", activatedAt: deps.now().toISOString(), suspendedAt: undefined },
    now: deps.now().toISOString(),
  });
}

/** Ajusta o multiplier de pre\u00e7o de um tenant (para casos raros de negocia\u00e7\u00e3o). */
export async function setPriceMultiplier(
  deps: PlatformAdminUseCaseDeps,
  input: { tenantId: string; multiplier: number; actor: PlatformAdminActor },
): Promise<TenantBilling> {
  if (input.multiplier < 1 || input.multiplier > 100) {
    throw new Error("PLATFORM_ADMIN_INVALID_MULTIPLIER: multiplier precisa estar entre 1 e 100.");
  }
  return deps.platformBillingRepository.updateTenantBilling({
    tenantId: input.tenantId,
    patch: { priceMultiplier: input.multiplier },
    now: deps.now().toISOString(),
  });
}

/** Resumo geral do painel (dashboard). */
export async function getPlatformDashboard(deps: PlatformAdminUseCaseDeps): Promise<PlatformDashboardSummary> {
  const period = periodOf(deps.now());
  const [aggregate, billings, totalTenants] = await Promise.all([
    deps.platformBillingRepository.aggregateUsage({ period }),
    deps.platformBillingRepository.listAllTenantBilling({ limit: 200 }),
    deps.platformBillingRepository.countAllTenantBilling({}),
  ]);

  const active = billings.filter((b) => b.subscriptionStatus === "active" || b.subscriptionStatus === "trial").length;
  const suspended = billings.filter((b) => b.subscriptionStatus === "suspended").length;

  const top = await Promise.all(
    billings.slice(0, 10).map(async (b) => {
      const u = await deps.platformBillingRepository.getAiUsage({ tenantId: b.tenantId, period });
      const usage = u ?? emptyMonthlyUsage(b.tenantId, period, deps.now().toISOString());
      return {
        tenantId: b.tenantId,
        planCode: b.planCode,
        customerPriceUsd: usage.customerPriceUsd,
        providerCostUsd: usage.providerCostUsd,
        profitUsd: profitOfMonthly(usage),
      };
    }),
  );
  top.sort((a, b) => b.customerPriceUsd - a.customerPriceUsd);

  return {
    currentPeriod: period,
    totalTenants,
    activeTenants: active,
    suspendedTenants: suspended,
    totalRevenueUsd: aggregate.totalCustomerPriceUsd,
    totalProviderCostUsd: aggregate.totalProviderCostUsd,
    totalProfitUsd: Math.max(0, aggregate.totalCustomerPriceUsd - aggregate.totalProviderCostUsd),
    totalRequestsCount: aggregate.totalRequestsCount,
    totalTokensUsed: aggregate.totalInputTokens + aggregate.totalOutputTokens,
    topTenantsByRevenue: top.slice(0, 10),
  };
}

async function listUsageHistoryLastMonths(
  deps: PlatformAdminUseCaseDeps,
  tenantId: string,
  months: number,
): Promise<TenantAiUsageMonthly[]> {
  const now = deps.now();
  const results: TenantAiUsageMonthly[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const period = periodOf(d);
    const usage = await deps.platformBillingRepository.getAiUsage({ tenantId, period });
    results.push(usage ?? emptyMonthlyUsage(tenantId, period, now.toISOString()));
  }
  return results;
}

/** Utilit\u00e1rio p\u00fablico \u2014 uso combinado por use cases futuros de tracking do AI Gateway. */
export function calculateCustomerCharge(providerCostUsd: number, priceMultiplier: number): number {
  return applyMarkup(providerCostUsd, priceMultiplier);
}
