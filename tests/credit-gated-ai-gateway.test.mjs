import { test } from "node:test";
import assert from "node:assert/strict";

import { CreditGatedAiGateway } from "../dist/application/ai-gateway/credit-gated-ai-gateway.js";
import { emptyMonthlyUsage } from "../dist/domain/platform-billing/tenant-billing.model.js";

function makeFakeBillingRepo(initialBillings = new Map()) {
  const billings = new Map(initialBillings);
  const usage = new Map();
  const ledger = [];

  return {
    billings,
    usage,
    ledger,
    repo: {
      async ensureTenantBilling({ tenantId }) {
        return billings.get(tenantId);
      },
      async getTenantBilling(tenantId) {
        return billings.get(tenantId);
      },
      async addAiUsage(entry) {
        const key = `${entry.tenantId}:${entry.period}`;
        const existing = usage.get(key) ?? emptyMonthlyUsage(entry.tenantId, entry.period, entry.now);
        const merged = {
          ...existing,
          inputTokens: existing.inputTokens + entry.inputTokens,
          outputTokens: existing.outputTokens + entry.outputTokens,
          cachedInputTokens: existing.cachedInputTokens + entry.cachedInputTokens,
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
      async applyCreditDelta({ id, tenantId, deltaTokens, reason, metadata, now }) {
        const current = billings.get(tenantId);
        const updated = { ...current, creditsExtraTokens: current.creditsExtraTokens + deltaTokens, updatedAt: now };
        billings.set(tenantId, updated);
        const entry = { id, tenantId, deltaTokens, reason, metadata: metadata ?? {}, occurredAt: now };
        ledger.push(entry);
        return { billing: updated, entry };
      },
      async updateTenantBilling() { throw new Error("não usado"); },
      async listAllTenantBilling() { throw new Error("não usado"); },
      async countAllTenantBilling() { throw new Error("não usado"); },
      async listCreditLedger() { throw new Error("não usado"); },
      async aggregateUsage() { throw new Error("não usado"); },
    },
  };
}

function fakeSuccessGateway(usageOverride = {}) {
  return {
    calls: 0,
    async execute(_request) {
      this.calls++;
      return {
        ok: true,
        data: {
          operation: _request.operation,
          provider: "anthropic",
          model: "claude-fake",
          output: { field: "value" },
          validated: true,
          usage: {
            inputTokens: 100,
            outputTokens: 200,
            totalTokens: 300,
            cachedInputTokens: 0,
            estimatedCost: 0.001,
            currency: "USD",
            providerReported: true,
            ...usageOverride,
          },
          latencyMs: 12,
          finishReason: "stop",
          warnings: [],
          traceId: "trace-1",
        },
      };
    },
  };
}

const REQUEST = {
  operation: "briefing_field_extraction",
  tenantId: "tenant-1",
  workspaceId: "ws-1",
  correlationId: "corr-1",
  input: {},
  outputSchema: { id: "any", version: 1 },
  policy: {
    preferredCapability: "structured_text",
    maxInputTokens: 1000,
    maxOutputTokens: 500,
    timeoutMs: 15000,
    retryPolicy: { maxAttempts: 1, retryableFailures: [] },
    temperature: 0,
    structuredOutputRequired: true,
    sensitiveDataPolicy: "strict",
    providerFallbackAllowed: false,
  },
};

test("CreditGatedAiGateway: bloqueia quando tenant sem billing", async () => {
  const { repo } = makeFakeBillingRepo();
  const inner = fakeSuccessGateway();
  const gated = new CreditGatedAiGateway({
    inner,
    platformBillingRepository: repo,
    idGenerator: () => "id-1",
    now: () => new Date("2026-08-01T10:00:00Z"),
  });

  const result = await gated.execute(REQUEST);
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "quota_exceeded");
  assert.equal(inner.calls, 0);
});

test("CreditGatedAiGateway: bloqueia quando subscription_status é 'suspended'", async () => {
  const billings = new Map([["tenant-1", {
    tenantId: "tenant-1", planCode: "FREE", subscriptionStatus: "suspended",
    monthlyTokenQuota: 100_000, monthlyPublicationsQuota: 5,
    creditsExtraTokens: 50_000, priceMultiplier: 2,
    createdAt: "2026-08-01", updatedAt: "2026-08-01",
  }]]);
  const { repo } = makeFakeBillingRepo(billings);
  const inner = fakeSuccessGateway();
  const gated = new CreditGatedAiGateway({
    inner, platformBillingRepository: repo, idGenerator: () => "id", now: () => new Date("2026-08-01T10:00:00Z"),
  });

  const result = await gated.execute(REQUEST);
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "quota_exceeded");
  assert.match(result.error.message, /suspensa/i);
  assert.equal(inner.calls, 0);
});

test("CreditGatedAiGateway: bloqueia quando saldo total = 0", async () => {
  const billings = new Map([["tenant-1", {
    tenantId: "tenant-1", planCode: "FREE", subscriptionStatus: "trial",
    monthlyTokenQuota: 100_000, monthlyPublicationsQuota: 5,
    creditsExtraTokens: 0, priceMultiplier: 2,
    createdAt: "2026-08-01", updatedAt: "2026-08-01",
  }]]);
  const { repo, usage } = makeFakeBillingRepo(billings);
  // Simula 100k tokens já consumidos no mês corrente:
  usage.set("tenant-1:2026-08", {
    tenantId: "tenant-1", period: "2026-08",
    inputTokens: 60_000, outputTokens: 40_000, cachedInputTokens: 0,
    providerCostUsd: 0.3, customerPriceUsd: 0.6, requestsCount: 5,
    updatedAt: "2026-08-01T09:00:00Z",
  });
  const inner = fakeSuccessGateway();
  const gated = new CreditGatedAiGateway({
    inner, platformBillingRepository: repo, idGenerator: () => "id", now: () => new Date("2026-08-01T10:00:00Z"),
  });

  const result = await gated.execute(REQUEST);
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "quota_exceeded");
  assert.match(result.error.message, /esgotado/i);
  assert.equal(inner.calls, 0);
});

test("CreditGatedAiGateway: chama inner e registra consumo dentro da cota mensal (sem tocar creditsExtraTokens)", async () => {
  const billings = new Map([["tenant-1", {
    tenantId: "tenant-1", planCode: "FREE", subscriptionStatus: "trial",
    monthlyTokenQuota: 100_000, monthlyPublicationsQuota: 5,
    creditsExtraTokens: 10_000, priceMultiplier: 2,
    createdAt: "2026-08-01", updatedAt: "2026-08-01",
  }]]);
  const { repo, usage, ledger } = makeFakeBillingRepo(billings);
  const inner = fakeSuccessGateway();
  const gated = new CreditGatedAiGateway({
    inner, platformBillingRepository: repo, idGenerator: (p) => `${p}-1`, now: () => new Date("2026-08-01T10:00:00Z"),
  });

  const result = await gated.execute(REQUEST);
  assert.equal(result.ok, true);
  assert.equal(inner.calls, 1);

  const row = usage.get("tenant-1:2026-08");
  assert.equal(row.inputTokens, 100);
  assert.equal(row.outputTokens, 200);
  assert.equal(row.providerCostUsd, 0.001);
  assert.equal(row.customerPriceUsd, 0.002); // 2x markup
  assert.equal(row.requestsCount, 1);

  assert.equal(ledger.length, 0, "não toca creditsExtraTokens porque a cota mensal cobriu tudo");
  assert.equal(billings.get("tenant-1").creditsExtraTokens, 10_000);
});

test("CreditGatedAiGateway: consumo estoura a cota mensal e sangra em creditsExtraTokens via applyCreditDelta", async () => {
  const initial = new Map([["tenant-1", {
    tenantId: "tenant-1", planCode: "FREE", subscriptionStatus: "trial",
    monthlyTokenQuota: 100_000, monthlyPublicationsQuota: 5,
    creditsExtraTokens: 500, priceMultiplier: 2,
    createdAt: "2026-08-01", updatedAt: "2026-08-01",
  }]]);
  const { repo, ledger, billings } = makeFakeBillingRepo(initial);
  // 99_800 já usados => sobram 200 na cota mensal antes da chamada
  await repo.addAiUsage({
    tenantId: "tenant-1", period: "2026-08",
    inputTokens: 60_000, outputTokens: 39_800, cachedInputTokens: 0,
    providerCostUsd: 0.5, customerPriceUsd: 1.0, requestsDelta: 3,
    now: "2026-08-01T09:00:00Z",
  });
  const inner = fakeSuccessGateway(); // consome 300 tokens
  const gated = new CreditGatedAiGateway({
    inner, platformBillingRepository: repo, idGenerator: (p) => `${p}-99`, now: () => new Date("2026-08-01T10:00:00Z"),
  });

  const result = await gated.execute(REQUEST);
  assert.equal(result.ok, true);
  assert.equal(ledger.length, 1);
  const entry = ledger[0];
  assert.equal(entry.reason, "ai_consumption");
  assert.equal(entry.deltaTokens, -100, "sangram 100 tokens em creditsExtras (300 usados - 200 restante na cota)");
  const updated = billings.get("tenant-1");
  assert.equal(updated.creditsExtraTokens, 400);
});
