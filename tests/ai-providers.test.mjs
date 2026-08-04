import { test } from "node:test";
import assert from "node:assert/strict";

import { createDefaultAiMediaProviderRegistry } from "../dist/application/ai-providers/ai-media-provider-registry.js";
import { CreditAccountingService } from "../dist/application/ai-providers/credit-accounting.service.js";
import { MediaGenerationService } from "../dist/application/ai-providers/media-generation.service.js";
import { OpenAiImageProviderAdapter } from "../dist/infrastructure/ai-providers/openai-image-provider-adapter.js";
import { GoogleVeoProviderAdapter } from "../dist/infrastructure/ai-providers/google-veo-provider-adapter.js";
import { emptyMonthlyUsage } from "../dist/domain/platform-billing/tenant-billing.model.js";

const IMAGE_OPERATION_TYPE = {
  code: "image_generation",
  label: "Geração de imagem",
  capability: "image_generation",
  creditsCost: 2,
  defaultProviderCode: "openai",
  defaultModelId: "gpt-image-1",
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function fakeAdapter(providerCode, capability, generateImpl) {
  return {
    descriptor: { providerCode, displayName: providerCode, enabled: true, capabilities: [capability] },
    generate: generateImpl,
    async health() { return { ok: true }; },
  };
}

// ---------------------------------------------------------------------------------------------
// AiMediaProviderRegistry
// ---------------------------------------------------------------------------------------------

test("AiMediaProviderRegistry: resolve retorna o adapter certo; provider desconhecido/desabilitado lança", () => {
  const openai = fakeAdapter("openai", "image_generation", async () => ({ ok: true, mediaUrl: "https://x", billableUnits: 1, latencyMs: 1 }));
  const disabled = { descriptor: { providerCode: "google", displayName: "google", enabled: false, capabilities: ["video_generation"] }, generate: async () => { throw new Error("não deveria chamar"); }, async health() { return { ok: false }; } };
  const registry = createDefaultAiMediaProviderRegistry([openai, disabled]);

  assert.equal(registry.resolve("openai"), openai);
  assert.throws(() => registry.resolve("google"), /AI_PROVIDER_DISABLED/);
  assert.throws(() => registry.resolve("anthropic"), /AI_PROVIDER_UNKNOWN/);
  assert.equal(registry.list().length, 2);
});

// ---------------------------------------------------------------------------------------------
// MediaGenerationService — crédito, geração, ledger
// ---------------------------------------------------------------------------------------------

function makeBillingRepo(billing, usage = {}) {
  const billings = new Map([[billing.tenantId, billing]]);
  const usageMap = new Map(Object.entries(usage));
  const creditLedger = [];
  return {
    billings,
    creditLedger,
    usageMap,
    repo: {
      async getTenantBilling(tenantId) { return billings.get(tenantId); },
      async getAiUsage({ tenantId, period }) { return usageMap.get(`${tenantId}:${period}`); },
      async addAiUsage(entry) {
        const key = `${entry.tenantId}:${entry.period}`;
        const existing = usageMap.get(key) ?? emptyMonthlyUsage(entry.tenantId, entry.period, entry.now);
        const merged = {
          ...existing,
          creditsConsumed: existing.creditsConsumed + entry.creditsConsumed,
          providerCostUsd: existing.providerCostUsd + entry.providerCostUsd,
          customerPriceUsd: existing.customerPriceUsd + entry.customerPriceUsd,
          requestsCount: existing.requestsCount + (entry.requestsDelta ?? 0),
          updatedAt: entry.now,
        };
        usageMap.set(key, merged);
        return merged;
      },
      async applyCreditDelta({ id, tenantId, deltaCredits, reason, metadata, now }) {
        const current = billings.get(tenantId);
        const updated = { ...current, creditsExtra: current.creditsExtra + deltaCredits, updatedAt: now };
        billings.set(tenantId, updated);
        const entry = { id, tenantId, deltaCredits, reason, metadata: metadata ?? {}, occurredAt: now };
        creditLedger.push(entry);
        return { billing: updated, entry };
      },
    },
  };
}

function makeAiProvidersRepo(operationType, models = [], providerStatus = "active") {
  const generationLedger = [];
  return {
    generationLedger,
    repo: {
      async getOperationType(code) { return code === operationType.code ? operationType : undefined; },
      async getProvider(code) { return code === operationType.defaultProviderCode ? { code, status: providerStatus } : undefined; },
      async recordGeneration(entry) { generationLedger.push(entry); return entry; },
      async listModels(providerCode) { return models.filter((m) => !providerCode || m.providerCode === providerCode); },
    },
  };
}

test("MediaGenerationService: bloqueia quando saldo de créditos é insuficiente, sem chamar o provider", async () => {
  const billing = { tenantId: "t1", subscriptionStatus: "trial", monthlyCreditsQuota: 1, creditsExtra: 0, priceMultiplier: 2 };
  const { repo: billingRepo } = makeBillingRepo(billing);
  const { repo: aiProvidersRepo } = makeAiProvidersRepo(IMAGE_OPERATION_TYPE, []);
  let calls = 0;
  const openai = fakeAdapter("openai", "image_generation", async () => { calls++; return { ok: true, mediaUrl: "https://x", billableUnits: 1, latencyMs: 1 }; });
  const registry = createDefaultAiMediaProviderRegistry([openai]);

  const creditAccounting = new CreditAccountingService({ platformBillingRepository: billingRepo, aiProvidersRepository: aiProvidersRepo, idGenerator: (p) => `${p}-1` });
  const service = new MediaGenerationService({ registry, creditAccounting, aiProvidersRepository: aiProvidersRepo, now: () => new Date("2026-08-01T10:00:00Z") });

  const result = await service.generate({ tenantId: "t1", operationTypeCode: "image_generation", prompt: "um gato", params: {} });
  assert.equal(result.ok, false);
  assert.equal(result.category, "quota_exceeded");
  assert.equal(calls, 0);
});

test("MediaGenerationService: bloqueia quando o provider está desabilitado em ai_providers.status, mesmo com o adapter registrado e créditos disponíveis", async () => {
  const billing = { tenantId: "t1", subscriptionStatus: "trial", monthlyCreditsQuota: 100, creditsExtra: 0, priceMultiplier: 2 };
  const { repo: billingRepo } = makeBillingRepo(billing);
  // status "disabled" no banco — o toggle "Habilitado" do painel admin.
  const { repo: aiProvidersRepo } = makeAiProvidersRepo(IMAGE_OPERATION_TYPE, [], "disabled");
  let calls = 0;
  const openai = fakeAdapter("openai", "image_generation", async () => { calls++; return { ok: true, mediaUrl: "https://x", billableUnits: 1, latencyMs: 1 }; });
  const registry = createDefaultAiMediaProviderRegistry([openai]);

  const creditAccounting = new CreditAccountingService({ platformBillingRepository: billingRepo, aiProvidersRepository: aiProvidersRepo, idGenerator: (p) => `${p}-1` });
  const service = new MediaGenerationService({ registry, creditAccounting, aiProvidersRepository: aiProvidersRepo, now: () => new Date("2026-08-01T10:00:00Z") });

  const result = await service.generate({ tenantId: "t1", operationTypeCode: "image_generation", prompt: "um gato", params: {} });
  assert.equal(result.ok, false);
  assert.equal(result.category, "not_configured");
  assert.equal(calls, 0, "nunca chama o adapter quando o provider está desabilitado no banco, independente do registry");
});

test("MediaGenerationService: gera com sucesso, calcula custo real pela pricing do modelo e a receita pelo % de lucro do tenant", async () => {
  const billing = { tenantId: "t1", subscriptionStatus: "trial", monthlyCreditsQuota: 100, creditsExtra: 0, priceMultiplier: 2 };
  const { repo: billingRepo, usageMap } = makeBillingRepo(billing);
  const models = [{ id: "m1", providerCode: "openai", modelId: "gpt-image-1", capability: "image_generation", active: true, pricing: { kind: "per_image", usdPerImage: 0.04 } }];
  const { repo: aiProvidersRepo, generationLedger } = makeAiProvidersRepo(IMAGE_OPERATION_TYPE, models);
  const openai = fakeAdapter("openai", "image_generation", async () => ({ ok: true, mediaUrl: "https://cdn/x.png", billableUnits: 1, latencyMs: 20 }));
  const registry = createDefaultAiMediaProviderRegistry([openai]);

  const creditAccounting = new CreditAccountingService({ platformBillingRepository: billingRepo, aiProvidersRepository: aiProvidersRepo, idGenerator: (p) => `${p}-1` });
  const service = new MediaGenerationService({ registry, creditAccounting, aiProvidersRepository: aiProvidersRepo, now: () => new Date("2026-08-01T10:00:00Z") });

  const result = await service.generate({ tenantId: "t1", operationTypeCode: "image_generation", prompt: "um gato", params: {} });
  assert.equal(result.ok, true);
  assert.equal(result.mediaUrl, "https://cdn/x.png");

  assert.equal(generationLedger.length, 1);
  assert.equal(generationLedger[0].creditsConsumed, 2);
  assert.equal(generationLedger[0].providerCostUsd, 0.04);
  assert.equal(generationLedger[0].estimatedRevenueUsd, 0.08, "custo real (0.04) * priceMultiplier do tenant (2x = 100% de lucro)");

  const usage = usageMap.get("t1:2026-08");
  assert.equal(usage.creditsConsumed, 2);
});

test("MediaGenerationService: tenant com priceMultiplier 1 (0% de lucro) tem receita estimada igual ao custo", async () => {
  const billing = { tenantId: "t1", subscriptionStatus: "trial", monthlyCreditsQuota: 100, creditsExtra: 0, priceMultiplier: 1 };
  const { repo: billingRepo } = makeBillingRepo(billing);
  const models = [{ id: "m1", providerCode: "openai", modelId: "gpt-image-1", capability: "image_generation", active: true, pricing: { kind: "per_image", usdPerImage: 0.04 } }];
  const { repo: aiProvidersRepo, generationLedger } = makeAiProvidersRepo(IMAGE_OPERATION_TYPE, models);
  const openai = fakeAdapter("openai", "image_generation", async () => ({ ok: true, mediaUrl: "https://cdn/x.png", billableUnits: 1, latencyMs: 20 }));
  const registry = createDefaultAiMediaProviderRegistry([openai]);

  const creditAccounting = new CreditAccountingService({ platformBillingRepository: billingRepo, aiProvidersRepository: aiProvidersRepo, idGenerator: (p) => `${p}-1` });
  const service = new MediaGenerationService({ registry, creditAccounting, aiProvidersRepository: aiProvidersRepo, now: () => new Date("2026-08-01T10:00:00Z") });

  const result = await service.generate({ tenantId: "t1", operationTypeCode: "image_generation", prompt: "um gato", params: {} });
  assert.equal(result.ok, true);
  assert.equal(generationLedger[0].providerCostUsd, 0.04);
  assert.equal(generationLedger[0].estimatedRevenueUsd, 0.04, "0% de lucro (conta interna própria) — receita fica igual ao custo real");
});

test("MediaGenerationService: falha do provider não consome crédito, mas registra a falha", async () => {
  const billing = { tenantId: "t1", subscriptionStatus: "trial", monthlyCreditsQuota: 100, creditsExtra: 0, priceMultiplier: 2 };
  const { repo: billingRepo, usageMap } = makeBillingRepo(billing);
  const { repo: aiProvidersRepo, generationLedger } = makeAiProvidersRepo(IMAGE_OPERATION_TYPE, []);
  const openai = fakeAdapter("openai", "image_generation", async () => ({ ok: false, category: "content_blocked", message: "bloqueado", latencyMs: 5 }));
  const registry = createDefaultAiMediaProviderRegistry([openai]);

  const creditAccounting = new CreditAccountingService({ platformBillingRepository: billingRepo, aiProvidersRepository: aiProvidersRepo, idGenerator: (p) => `${p}-1` });
  const service = new MediaGenerationService({ registry, creditAccounting, aiProvidersRepository: aiProvidersRepo, now: () => new Date("2026-08-01T10:00:00Z") });

  const result = await service.generate({ tenantId: "t1", operationTypeCode: "image_generation", prompt: "algo", params: {} });
  assert.equal(result.ok, false);
  assert.equal(result.category, "content_blocked");
  assert.equal(generationLedger.length, 1);
  assert.equal(generationLedger[0].status, "failed");
  assert.equal(generationLedger[0].creditsConsumed, 0);
  assert.equal(usageMap.get("t1:2026-08"), undefined, "nenhum crédito consumido numa falha");
});

// ---------------------------------------------------------------------------------------------
// OpenAiImageProviderAdapter — HTTP mockado
// ---------------------------------------------------------------------------------------------

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("OpenAiImageProviderAdapter: sucesso com url direta", async () => {
  const httpClient = async () => jsonResponse(200, { data: [{ url: "https://openai/img.png" }] });
  const adapter = new OpenAiImageProviderAdapter({ enabled: true, getApiKey: async () => "sk-test", persistGeneratedImage: async () => { throw new Error("não deveria chamar"); } }, httpClient);

  const result = await adapter.generate({ operationTypeCode: "image_generation", modelId: "gpt-image-1", prompt: "um gato", tenantId: "t1", params: {}, timeoutMs: 5000 });
  assert.equal(result.ok, true);
  assert.equal(result.mediaUrl, "https://openai/img.png");
  assert.equal(result.billableUnits, 1);
});

test("OpenAiImageProviderAdapter: sucesso com b64_json faz upload via persistGeneratedImage", async () => {
  const httpClient = async () => jsonResponse(200, { data: [{ b64_json: "AAAA" }] });
  let persisted;
  const adapter = new OpenAiImageProviderAdapter({ enabled: true, getApiKey: async () => "sk-test", persistGeneratedImage: async (input) => { persisted = input; return "https://s3/generated.png"; } }, httpClient);

  const result = await adapter.generate({ operationTypeCode: "image_generation", modelId: "gpt-image-1", prompt: "um gato", tenantId: "t1", params: {}, timeoutMs: 5000 });
  assert.equal(result.ok, true);
  assert.equal(result.mediaUrl, "https://s3/generated.png");
  assert.equal(persisted.base64, "AAAA");
});

test("OpenAiImageProviderAdapter: falha ao hospedar b64_json (Object Storage não configurado) vira erro claro, não 'falha de conexão'", async () => {
  const httpClient = async () => jsonResponse(200, { data: [{ b64_json: "AAAA" }] });
  const adapter = new OpenAiImageProviderAdapter({
    enabled: true,
    getApiKey: async () => "sk-test",
    persistGeneratedImage: async () => { throw new Error("OBJECT_STORAGE_NOT_CONFIGURED: upload de mídia não está habilitado neste servidor."); },
  }, httpClient);

  const result = await adapter.generate({ operationTypeCode: "image_generation", modelId: "gpt-image-1", prompt: "um gato", tenantId: "t1", params: {}, timeoutMs: 5000 });
  assert.equal(result.ok, false);
  assert.equal(result.category, "internal_error");
  assert.match(result.message, /OBJECT_STORAGE_NOT_CONFIGURED/, "preserva o motivo real, não generaliza para 'falha de conexão com a OpenAI'");
});

test("OpenAiImageProviderAdapter: sem API key retorna not_configured sem chamar HTTP", async () => {
  let called = false;
  const httpClient = async () => { called = true; return jsonResponse(200, {}); };
  const adapter = new OpenAiImageProviderAdapter({ enabled: true, getApiKey: async () => undefined, persistGeneratedImage: async () => "x" }, httpClient);

  const result = await adapter.generate({ operationTypeCode: "image_generation", modelId: "gpt-image-1", prompt: "x", tenantId: "t1", params: {}, timeoutMs: 5000 });
  assert.equal(result.ok, false);
  assert.equal(result.category, "not_configured");
  assert.equal(called, false);
});

test("OpenAiImageProviderAdapter: 401 vira authentication_failed", async () => {
  const httpClient = async () => jsonResponse(401, {});
  const adapter = new OpenAiImageProviderAdapter({ enabled: true, getApiKey: async () => "sk-test", persistGeneratedImage: async () => "x" }, httpClient);
  const result = await adapter.generate({ operationTypeCode: "image_generation", modelId: "gpt-image-1", prompt: "x", tenantId: "t1", params: {}, timeoutMs: 5000 });
  assert.equal(result.ok, false);
  assert.equal(result.category, "authentication_failed");
});

// ---------------------------------------------------------------------------------------------
// GoogleVeoProviderAdapter — HTTP mockado (polling)
// ---------------------------------------------------------------------------------------------

test("GoogleVeoProviderAdapter: inicia operação e faz polling até done=true", async () => {
  let pollCount = 0;
  const httpClient = async (url) => {
    if (String(url).includes("predictLongRunning")) return jsonResponse(200, { name: "operations/abc" });
    pollCount++;
    if (pollCount < 2) return jsonResponse(200, { done: false });
    return jsonResponse(200, { done: true, response: { generatedVideos: [{ video: { uri: "https://veo/video.mp4" } }] } });
  };
  const adapter = new GoogleVeoProviderAdapter({ enabled: true, getApiKey: async () => "gkey", pollIntervalMs: 1 }, httpClient);

  const result = await adapter.generate({ operationTypeCode: "video_generation", modelId: "veo-3", prompt: "um carro", tenantId: "t1", params: { durationSeconds: 8 }, timeoutMs: 5000 });
  assert.equal(result.ok, true);
  assert.equal(result.mediaUrl, "https://veo/video.mp4");
  assert.equal(result.billableUnits, 8);
});

test("GoogleVeoProviderAdapter: sem API key retorna not_configured", async () => {
  const adapter = new GoogleVeoProviderAdapter({ enabled: true, getApiKey: async () => undefined }, async () => jsonResponse(200, {}));
  const result = await adapter.generate({ operationTypeCode: "video_generation", modelId: "veo-3", prompt: "x", tenantId: "t1", params: {}, timeoutMs: 5000 });
  assert.equal(result.ok, false);
  assert.equal(result.category, "not_configured");
});
