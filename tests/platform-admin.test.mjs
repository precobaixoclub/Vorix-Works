import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PLATFORM_PLAN_CATALOG,
  getPlatformPlan,
  listPublicPlans,
} from "../dist/domain/platform-billing/platform-plan-catalog.js";
import {
  applyMarkup,
  emptyMonthlyUsage,
  periodOf,
  profitOfMonthly,
} from "../dist/domain/platform-billing/tenant-billing.model.js";
import {
  adjustTenantCredits,
  calculateCustomerCharge,
  changeTenantPlan,
  getPlatformDashboard,
  getTenantDetail,
  listTenantsOverview,
  setPriceMultiplier,
  suspendTenant,
  activateTenant,
} from "../dist/application/platform-admin/platform-admin.usecases.js";

// -------------------------------------------------------------------------------------------------
// Domínio puro — cotas, plano, markup, lucro, período.
// -------------------------------------------------------------------------------------------------

test("plan catalog: FREE tem 50 créditos; PRO tem cota maior; PRO destacado; ENTERPRISE fora do público", () => {
  assert.equal(PLATFORM_PLAN_CATALOG.FREE.monthlyCreditsQuota, 50);
  assert.ok(PLATFORM_PLAN_CATALOG.PRO.monthlyCreditsQuota > PLATFORM_PLAN_CATALOG.START.monthlyCreditsQuota);
  assert.equal(PLATFORM_PLAN_CATALOG.PRO.highlighted, true);
  const publics = listPublicPlans().map((plan) => plan.code);
  assert.equal(publics.includes("ENTERPRISE"), false);
  assert.equal(publics.includes("FREE"), true);
});

test("getPlatformPlan retorna a definição; código desconhecido lança", () => {
  assert.equal(getPlatformPlan("PRO").code, "PRO");
  assert.throws(() => getPlatformPlan("QUANTUM"), /PLATFORM_PLAN_UNKNOWN/);
});

test("periodOf retorna YYYY-MM em UTC (não local)", () => {
  assert.equal(periodOf("2026-04-15T10:00:00Z"), "2026-04");
  assert.equal(periodOf("2026-12-31T23:00:00Z"), "2026-12");
});

test("applyMarkup: markup 2x dobra o custo; markup < 1 lança", () => {
  assert.equal(applyMarkup(0.15, 2), 0.3);
  assert.equal(applyMarkup(0, 2), 0);
  assert.throws(() => applyMarkup(1, 0.5), /INVALID_MULTIPLIER/);
});

test("profitOfMonthly: receita − custo, nunca negativo", () => {
  const usage = { ...emptyMonthlyUsage("t1", "2026-04", "now"), providerCostUsd: 2, customerPriceUsd: 5 };
  assert.equal(profitOfMonthly(usage), 3);
  const negative = { ...emptyMonthlyUsage("t1", "2026-04", "now"), providerCostUsd: 10, customerPriceUsd: 5 };
  assert.equal(profitOfMonthly(negative), 0);
});

test("calculateCustomerCharge é o mesmo que applyMarkup — API pública", () => {
  assert.equal(calculateCustomerCharge(3, 2), 6);
});

// -------------------------------------------------------------------------------------------------
// Use cases — repositórios em memória alinhados aos ports.
// -------------------------------------------------------------------------------------------------

function makeInMemoryDeps() {
  const billings = new Map();
  const ledger = [];
  const usage = new Map();

  const platformBillingRepository = {
    async ensureTenantBilling({ tenantId, now }) {
      const existing = billings.get(tenantId);
      if (existing) return existing;
      const plan = getPlatformPlan("FREE");
      const created = {
        tenantId,
        planCode: "FREE",
        subscriptionStatus: "trial",
        monthlyCreditsQuota: plan.monthlyCreditsQuota,
        monthlyPublicationsQuota: plan.monthlyPublicationsQuota,
        creditsExtra: 0,
        priceMultiplier: 2,
        createdAt: now,
        updatedAt: now,
      };
      billings.set(tenantId, created);
      return created;
    },
    async getTenantBilling(tenantId) {
      return billings.get(tenantId);
    },
    async listAllTenantBilling(filters = {}) {
      let rows = Array.from(billings.values());
      if (filters.planCode) rows = rows.filter((b) => b.planCode === filters.planCode);
      if (filters.subscriptionStatus) rows = rows.filter((b) => b.subscriptionStatus === filters.subscriptionStatus);
      const offset = filters.offset ?? 0;
      const limit = filters.limit ?? rows.length;
      return rows.slice(offset, offset + limit);
    },
    async countAllTenantBilling(filters = {}) {
      let rows = Array.from(billings.values());
      if (filters.planCode) rows = rows.filter((b) => b.planCode === filters.planCode);
      if (filters.subscriptionStatus) rows = rows.filter((b) => b.subscriptionStatus === filters.subscriptionStatus);
      return rows.length;
    },
    async updateTenantBilling({ tenantId, patch, now }) {
      const current = billings.get(tenantId);
      if (!current) throw new Error("PLATFORM_BILLING_TENANT_NOT_FOUND");
      const updated = { ...current, ...patch, updatedAt: now };
      billings.set(tenantId, updated);
      return updated;
    },
    async applyCreditDelta({ id, tenantId, deltaCredits, reason, actorUserId, metadata, now }) {
      const current = billings.get(tenantId);
      if (!current) throw new Error("PLATFORM_BILLING_TENANT_NOT_FOUND");
      const nextBalance = current.creditsExtra + deltaCredits;
      if (nextBalance < 0) throw new Error("PLATFORM_BILLING_INSUFFICIENT_CREDITS");
      const updated = { ...current, creditsExtra: nextBalance, updatedAt: now };
      billings.set(tenantId, updated);
      const entry = { id, tenantId, deltaCredits, reason, actorUserId, metadata: metadata ?? {}, occurredAt: now };
      ledger.push(entry);
      return { billing: updated, entry };
    },
    async listCreditLedger({ tenantId, limit }) {
      const rows = ledger.filter((e) => e.tenantId === tenantId).slice().reverse();
      return typeof limit === "number" ? rows.slice(0, limit) : rows;
    },
    async addAiUsage(entry) {
      const key = `${entry.tenantId}:${entry.period}`;
      const existing = usage.get(key) ?? emptyMonthlyUsage(entry.tenantId, entry.period, entry.now);
      const merged = {
        ...existing,
        inputTokens: existing.inputTokens + entry.inputTokens,
        outputTokens: existing.outputTokens + entry.outputTokens,
        cachedInputTokens: existing.cachedInputTokens + entry.cachedInputTokens,
        creditsConsumed: existing.creditsConsumed + (entry.creditsConsumed ?? 0),
        providerCostUsd: existing.providerCostUsd + entry.providerCostUsd,
        customerPriceUsd: existing.customerPriceUsd + entry.customerPriceUsd,
        requestsCount: existing.requestsCount + (entry.requestsDelta ?? 0),
        updatedAt: entry.now,
      };
      usage.set(key, merged);
      return merged;
    },
    async getAiUsage({ tenantId, period }) {
      return usage.get(`${tenantId}:${period}`);
    },
    async aggregateUsage(filter = {}) {
      const relevant = [];
      for (const row of usage.values()) {
        if (filter.period && row.period !== filter.period) continue;
        if (filter.tenantIds && !filter.tenantIds.includes(row.tenantId)) continue;
        relevant.push(row);
      }
      return {
        totalTenants: new Set(relevant.map((r) => r.tenantId)).size,
        totalInputTokens: relevant.reduce((s, r) => s + r.inputTokens, 0),
        totalOutputTokens: relevant.reduce((s, r) => s + r.outputTokens, 0),
        totalCreditsConsumed: relevant.reduce((s, r) => s + r.creditsConsumed, 0),
        totalRequestsCount: relevant.reduce((s, r) => s + r.requestsCount, 0),
        totalProviderCostUsd: relevant.reduce((s, r) => s + r.providerCostUsd, 0),
        totalCustomerPriceUsd: relevant.reduce((s, r) => s + r.customerPriceUsd, 0),
      };
    },
  };

  const workspaceRepository = {
    async listByTenant(tenantId) {
      return [{ id: `ws-${tenantId}`, tenantId, name: `Workspace ${tenantId}`, status: "active" }];
    },
  };
  const membershipRepository = {
    async listByTenant(tenantId) {
      return [{ id: `m-${tenantId}`, tenantId, userId: `u-${tenantId}`, role: "owner", createdAt: "", updatedAt: "" }];
    },
  };
  const userRepository = {
    async getById(id) {
      return {
        id,
        email: `${id}@t.com`,
        name: `User ${id}`,
        status: "active",
        isPlatformAdmin: false,
        passwordHash: "",
        createdAt: "",
        updatedAt: "",
      };
    },
  };

  return {
    platformBillingRepository,
    workspaceRepository,
    membershipRepository,
    userRepository,
    idGenerator: () => `credit-fixed-${ledger.length + 1}`,
    now: () => new Date("2026-04-15T10:00:00Z"),
  };
}

test("changeTenantPlan aplica cotas do plano do catálogo", async () => {
  const deps = makeInMemoryDeps();
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId: "t-a", now: "2026-04-01" });
  const updated = await changeTenantPlan(deps, { tenantId: "t-a", planCode: "PRO", actor: { userId: "admin" } });
  assert.equal(updated.planCode, "PRO");
  assert.equal(updated.monthlyCreditsQuota, PLATFORM_PLAN_CATALOG.PRO.monthlyCreditsQuota);
  assert.equal(updated.subscriptionStatus, "active");
});

test("adjustTenantCredits soma delta positivo e escreve ledger", async () => {
  const deps = makeInMemoryDeps();
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId: "t-b", now: "2026-04-01" });
  const result = await adjustTenantCredits(deps, {
    tenantId: "t-b",
    deltaCredits: 500,
    reason: "Pix R$ 90 — créditos extras",
    actor: { userId: "admin" },
  });
  assert.equal(result.billing.creditsExtra, 500);
  assert.equal(result.entry.deltaCredits, 500);
  assert.equal(result.entry.reason, "manual_adjustment");
});

test("adjustTenantCredits recusa delta = 0", async () => {
  const deps = makeInMemoryDeps();
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId: "t-c", now: "2026-04-01" });
  await assert.rejects(
    () => adjustTenantCredits(deps, { tenantId: "t-c", deltaCredits: 0, reason: "x", actor: { userId: "admin" } }),
    /PLATFORM_ADMIN_INVALID_DELTA/,
  );
});

test("suspendTenant e activateTenant alternam status", async () => {
  const deps = makeInMemoryDeps();
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId: "t-d", now: "2026-04-01" });
  const suspended = await suspendTenant(deps, { tenantId: "t-d", actor: { userId: "admin" } });
  assert.equal(suspended.subscriptionStatus, "suspended");
  const active = await activateTenant(deps, { tenantId: "t-d", actor: { userId: "admin" } });
  assert.equal(active.subscriptionStatus, "active");
});

test("setPriceMultiplier valida faixa 1..100", async () => {
  const deps = makeInMemoryDeps();
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId: "t-e", now: "2026-04-01" });
  const updated = await setPriceMultiplier(deps, { tenantId: "t-e", multiplier: 3, actor: { userId: "admin" } });
  assert.equal(updated.priceMultiplier, 3);
  await assert.rejects(
    () => setPriceMultiplier(deps, { tenantId: "t-e", multiplier: 0.5, actor: { userId: "admin" } }),
    /PLATFORM_ADMIN_INVALID_MULTIPLIER/,
  );
  await assert.rejects(
    () => setPriceMultiplier(deps, { tenantId: "t-e", multiplier: 500, actor: { userId: "admin" } }),
    /PLATFORM_ADMIN_INVALID_MULTIPLIER/,
  );
});

test("listTenantsOverview retorna items com quotaUsagePercent computado", async () => {
  const deps = makeInMemoryDeps();
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId: "t-f", now: "2026-04-01" });
  await deps.platformBillingRepository.addAiUsage({
    tenantId: "t-f",
    period: "2026-04",
    inputTokens: 30_000,
    outputTokens: 20_000,
    cachedInputTokens: 0,
    creditsConsumed: 25,
    providerCostUsd: 0.5,
    customerPriceUsd: 1.0,
    requestsDelta: 1,
    now: "2026-04-15",
  });
  const list = await listTenantsOverview(deps, {});
  assert.equal(list.total, 1);
  const item = list.items[0];
  assert.equal(item.tenantId, "t-f");
  assert.equal(Math.round(item.quotaUsagePercent), 50);
});

test("getPlatformDashboard soma receita/custo/lucro do mês corrente", async () => {
  const deps = makeInMemoryDeps();
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId: "t-g", now: "2026-04-01" });
  await changeTenantPlan(deps, { tenantId: "t-g", planCode: "PRO", actor: { userId: "admin" } });
  await deps.platformBillingRepository.addAiUsage({
    tenantId: "t-g",
    period: "2026-04",
    inputTokens: 100_000,
    outputTokens: 50_000,
    cachedInputTokens: 0,
    creditsConsumed: 80,
    providerCostUsd: 4,
    customerPriceUsd: 8,
    requestsDelta: 2,
    now: "2026-04-15",
  });
  const dashboard = await getPlatformDashboard(deps);
  assert.equal(dashboard.currentPeriod, "2026-04");
  assert.equal(dashboard.totalRevenueUsd, 8);
  assert.equal(dashboard.totalProviderCostUsd, 4);
  assert.equal(dashboard.totalProfitUsd, 4);
  assert.equal(dashboard.topTenantsByRevenue.length, 1);
});

test("getTenantDetail junta billing + workspaces + members + usage history de 6 meses", async () => {
  const deps = makeInMemoryDeps();
  await deps.platformBillingRepository.ensureTenantBilling({ tenantId: "t-h", now: "2026-04-01" });
  const detail = await getTenantDetail(deps, { tenantId: "t-h" });
  assert.equal(detail.overview.tenantId, "t-h");
  assert.equal(detail.planName, PLATFORM_PLAN_CATALOG.FREE.name);
  assert.equal(detail.workspaces.length, 1);
  assert.equal(detail.members.length, 1);
  assert.equal(detail.members[0].email, "u-t-h@t.com");
  assert.equal(detail.usageHistory.length, 6);
});
