import { test } from "node:test";
import assert from "node:assert/strict";

import { CreditGatedAiGateway } from "../dist/application/ai-gateway/credit-gated-ai-gateway.js";
import { CreditAccountingService } from "../dist/application/ai-providers/credit-accounting.service.js";
import { emptyMonthlyUsage } from "../dist/domain/platform-billing/tenant-billing.model.js";

const OPERATION_TYPE = {
  code: "briefing_field_extraction",
  label: "Extração de campos do briefing",
  capability: "text_generation",
  creditsCost: 1,
  defaultProviderCode: "anthropic",
  defaultModelId: "claude-fake",
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function makeFakeBillingRepo(initialBillings = new Map()) {
  const billings = new Map(initialBillings);
  const usage = new Map();
  const creditLedger = [];

  return {
    billings,
    usage,
    creditLedger,
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
          creditsConsumed: existing.creditsConsumed + entry.creditsConsumed,
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
      async applyCreditDelta({ id, tenantId, deltaCredits, reason, metadata, now }) {
        const current = billings.get(tenantId);
        const updated = { ...current, creditsExtra: current.creditsExtra + deltaCredits, updatedAt: now };
        billings.set(tenantId, updated);
        const entry = { id, tenantId, deltaCredits, reason, metadata: metadata ?? {}, occurredAt: now };
        creditLedger.push(entry);
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

function makeFakeAiProvidersRepo(operationType = OPERATION_TYPE) {
  const generationLedger = [];
  return {
    generationLedger,
    repo: {
      async getOperationType(code) {
        return code === operationType.code ? operationType : undefined;
      },
      async recordGeneration(entry) {
        generationLedger.push(entry);
        return entry;
      },
      async listProviders() { throw new Error("não usado"); },
      async getProvider() { throw new Error("não usado"); },
      async updateProvider() { throw new Error("não usado"); },
      async listModels() { throw new Error("não usado"); },
      async updateModel() { throw new Error("não usado"); },
      async listOperationTypes() { throw new Error("não usado"); },
      async updateOperationType() { throw new Error("não usado"); },
      async listGenerations() { throw new Error("não usado"); },
      async aggregateGenerationsByProvider() { throw new Error("não usado"); },
    },
  };
}

function buildGated({ billingRepo, aiProvidersRepo, now, idGenerator }) {
  const creditAccounting = new CreditAccountingService({
    platformBillingRepository: billingRepo,
    aiProvidersRepository: aiProvidersRepo,
    idGenerator: idGenerator ?? ((p) => `${p}-1`),
  });
  return new CreditGatedAiGateway({ inner: fakeSuccessGateway(), creditAccounting, now });
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
  const { repo: billingRepo } = makeFakeBillingRepo();
  const { repo: aiProvidersRepo } = makeFakeAiProvidersRepo();
  const gated = buildGated({ billingRepo, aiProvidersRepo, now: () => new Date("2026-08-01T10:00:00Z") });

  const result = await gated.execute(REQUEST);
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "quota_exceeded");
});

test("CreditGatedAiGateway: bloqueia quando subscription_status é 'suspended'", async () => {
  const billings = new Map([["tenant-1", {
    tenantId: "tenant-1", planCode: "FREE", subscriptionStatus: "suspended",
    monthlyCreditsQuota: 100, monthlyPublicationsQuota: 5,
    creditsExtra: 50, priceMultiplier: 2,
    createdAt: "2026-08-01", updatedAt: "2026-08-01",
  }]]);
  const { repo: billingRepo } = makeFakeBillingRepo(billings);
  const { repo: aiProvidersRepo } = makeFakeAiProvidersRepo();
  const gated = buildGated({ billingRepo, aiProvidersRepo, now: () => new Date("2026-08-01T10:00:00Z") });

  const result = await gated.execute(REQUEST);
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "quota_exceeded");
  assert.match(result.error.message, /suspensa/i);
});

test("CreditGatedAiGateway: bloqueia quando saldo total de créditos é insuficiente", async () => {
  const billings = new Map([["tenant-1", {
    tenantId: "tenant-1", planCode: "FREE", subscriptionStatus: "trial",
    monthlyCreditsQuota: 1, monthlyPublicationsQuota: 5,
    creditsExtra: 0, priceMultiplier: 2,
    createdAt: "2026-08-01", updatedAt: "2026-08-01",
  }]]);
  const { repo: billingRepo, usage } = makeFakeBillingRepo(billings);
  // 1 crédito já consumido no mês corrente — não sobra nada, nem na cota nem em extra.
  usage.set("tenant-1:2026-08", {
    tenantId: "tenant-1", period: "2026-08",
    inputTokens: 100, outputTokens: 200, cachedInputTokens: 0, creditsConsumed: 1,
    providerCostUsd: 0.001, customerPriceUsd: 0.05, requestsCount: 1,
    updatedAt: "2026-08-01T09:00:00Z",
  });
  const { repo: aiProvidersRepo } = makeFakeAiProvidersRepo();
  const gated = buildGated({ billingRepo, aiProvidersRepo, now: () => new Date("2026-08-01T10:00:00Z") });

  const result = await gated.execute(REQUEST);
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "quota_exceeded");
  assert.match(result.error.message, /insuficiente/i);
});

test("CreditGatedAiGateway: chama inner e registra consumo dentro da cota mensal (sem tocar creditsExtra)", async () => {
  const billings = new Map([["tenant-1", {
    tenantId: "tenant-1", planCode: "FREE", subscriptionStatus: "trial",
    monthlyCreditsQuota: 100, monthlyPublicationsQuota: 5,
    creditsExtra: 10, priceMultiplier: 2,
    createdAt: "2026-08-01", updatedAt: "2026-08-01",
  }]]);
  const { repo: billingRepo, usage, billings: billingsMap } = makeFakeBillingRepo(billings);
  const { repo: aiProvidersRepo, generationLedger } = makeFakeAiProvidersRepo();
  const gated = buildGated({ billingRepo, aiProvidersRepo, now: () => new Date("2026-08-01T10:00:00Z") });

  const result = await gated.execute(REQUEST);
  assert.equal(result.ok, true);

  const row = usage.get("tenant-1:2026-08");
  assert.equal(row.inputTokens, 100);
  assert.equal(row.outputTokens, 200);
  assert.equal(row.creditsConsumed, 1, "1 crédito fixo, independente de quantos tokens o provider gastou");
  assert.equal(row.providerCostUsd, 0.001);
  assert.equal(row.customerPriceUsd, 0.002, "receita = custo real (0.001) * priceMultiplier do tenant (2x = 100% de lucro)");
  assert.equal(row.requestsCount, 1);

  assert.equal(generationLedger.length, 1, "grava uma linha no ledger de geração (auditoria financeira) mesmo sem estourar a cota");
  assert.equal(generationLedger[0].creditsConsumed, 1);
  assert.equal(generationLedger[0].providerCode, "anthropic");

  assert.equal(billingsMap.get("tenant-1").creditsExtra, 10, "não toca creditsExtra porque a cota mensal cobriu tudo");
});

test("CreditGatedAiGateway: tenant com priceMultiplier 1 (0% de lucro, ex.: conta interna própria) tem receita igual ao custo", async () => {
  const billings = new Map([["tenant-1", {
    tenantId: "tenant-1", planCode: "FREE", subscriptionStatus: "trial",
    monthlyCreditsQuota: 100, monthlyPublicationsQuota: 5,
    creditsExtra: 10, priceMultiplier: 1,
    createdAt: "2026-08-01", updatedAt: "2026-08-01",
  }]]);
  const { repo: billingRepo, usage } = makeFakeBillingRepo(billings);
  const { repo: aiProvidersRepo } = makeFakeAiProvidersRepo();
  const gated = buildGated({ billingRepo, aiProvidersRepo, now: () => new Date("2026-08-01T10:00:00Z") });

  const result = await gated.execute(REQUEST);
  assert.equal(result.ok, true);

  const row = usage.get("tenant-1:2026-08");
  assert.equal(row.providerCostUsd, 0.001);
  assert.equal(row.customerPriceUsd, 0.001, "0% de lucro — receita estimada fica exatamente no custo real, sem margem");
});

test("CreditGatedAiGateway: consumo estoura a cota mensal e sangra em creditsExtra via applyCreditDelta", async () => {
  const initial = new Map([["tenant-1", {
    tenantId: "tenant-1", planCode: "FREE", subscriptionStatus: "trial",
    monthlyCreditsQuota: 100, monthlyPublicationsQuota: 5,
    creditsExtra: 500, priceMultiplier: 2,
    createdAt: "2026-08-01", updatedAt: "2026-08-01",
  }]]);
  const { repo: billingRepo, creditLedger, billings } = makeFakeBillingRepo(initial);
  // 100 créditos já usados => cota mensal esgotada antes da chamada.
  await billingRepo.addAiUsage({
    tenantId: "tenant-1", period: "2026-08",
    inputTokens: 60_000, outputTokens: 39_800, cachedInputTokens: 0, creditsConsumed: 100,
    providerCostUsd: 0.5, customerPriceUsd: 5, requestsDelta: 3,
    now: "2026-08-01T09:00:00Z",
  });
  const { repo: aiProvidersRepo } = makeFakeAiProvidersRepo();
  const gated = buildGated({ billingRepo, aiProvidersRepo, now: () => new Date("2026-08-01T10:00:00Z"), idGenerator: (p) => `${p}-99` });

  const result = await gated.execute(REQUEST);
  assert.equal(result.ok, true);
  assert.equal(creditLedger.length, 1);
  const entry = creditLedger[0];
  assert.equal(entry.reason, "ai_consumption");
  assert.equal(entry.deltaCredits, -1, "o único crédito da operação sangra inteiro de creditsExtra, já que a cota mensal está zerada");
  const updated = billings.get("tenant-1");
  assert.equal(updated.creditsExtra, 499);
});
