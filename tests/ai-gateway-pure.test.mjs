import { test } from "node:test";
import assert from "node:assert/strict";

import { routeAiRequest } from "../dist/application/ai-gateway/model-router.js";
import { getModelRegistryEntry, isModelRegisteredAndActive, listActiveEntriesForCapability } from "../dist/application/ai-gateway/model-registry.js";
import {
  validateBriefingFieldExtractionStructure,
  applySemanticValidation,
  BRIEFING_FIELD_EXTRACTION_RESULT_SCHEMA_VERSION,
} from "../dist/application/ai-gateway/schemas/briefing-field-extraction-result.v1.js";
import { sanitizeAiInput } from "../dist/application/ai-gateway/input-sanitizer.js";
import { checkRenderedPrompt } from "../dist/application/ai-gateway/post-render-check.js";
import { calculateEstimatedCostUsd, buildAiUsage } from "../dist/application/ai-gateway/cost-calculator.js";
import { DEFAULT_AI_RETRY_POLICY, isRetryableFailure, computeBackoffMs } from "../dist/application/ai-gateway/retry-policy.js";
import { InMemoryAiCircuitBreaker } from "../dist/infrastructure/ai-gateway/in-memory-ai-circuit-breaker.js";
import { InMemoryAiRateLimiter } from "../dist/infrastructure/ai-gateway/in-memory-ai-rate-limiter.js";
import { decideShouldCallAi } from "../dist/application/ai-gateway/extraction-decision.js";
import { CAMPAIGN_CREATION_SCHEMA_V1 } from "../dist/domain/briefing/schemas/campaign-creation.schema.js";
import { FakeAiModelProvider } from "../dist/infrastructure/ai/fake-ai-model-provider.js";

// ---------------------------------------------------------------------------------------------
// Model Registry
// ---------------------------------------------------------------------------------------------

test("Model Registry: nenhum alias implícito — modelId sempre explícito e versionado", () => {
  const entry = getModelRegistryEntry("anthropic", "claude-haiku-4-5-20251001");
  assert.ok(entry);
  assert.equal(entry.status, "active");
  assert.ok(entry.pricing.effectiveFrom);
  assert.ok(entry.pricing.sourceVersion);
  assert.equal(isModelRegisteredAndActive("anthropic", "claude-latest"), false, "nunca um alias tipo 'latest'");
});

test("Model Registry: listActiveEntriesForCapability só devolve entradas ativas com a capability", () => {
  const entries = listActiveEntriesForCapability("structured_text");
  assert.ok(entries.length > 0);
  assert.ok(entries.every((entry) => entry.status === "active" && entry.capabilities.includes("structured_text")));
});

// ---------------------------------------------------------------------------------------------
// AiModelRouter
// ---------------------------------------------------------------------------------------------

function baseRequest(overrides = {}) {
  return {
    operation: "briefing_field_extraction",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    correlationId: "corr-1",
    input: {},
    outputSchema: { id: "briefing-field-extraction-result", version: 1 },
    policy: {
      preferredCapability: "structured_text",
      maxInputTokens: 2000,
      maxOutputTokens: 1024,
      timeoutMs: 8000,
      retryPolicy: DEFAULT_AI_RETRY_POLICY,
      temperature: 0,
      structuredOutputRequired: true,
      sensitiveDataPolicy: "strict",
      providerFallbackAllowed: false,
    },
    ...overrides,
  };
}

test("AiModelRouter: operação não suportada devolve not_configured", () => {
  const result = routeAiRequest({
    request: baseRequest({ operation: "content_generation", policy: { ...baseRequest().policy, preferredCapability: "free_text" } }),
    providers: [],
    bindings: {},
    isProviderAvailable: () => true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "not_configured");
});

test("AiModelRouter: capability da política incompatível com a operação é invalid_request", () => {
  const result = routeAiRequest({
    request: baseRequest({ policy: { ...baseRequest().policy, preferredCapability: "vision" } }),
    providers: [],
    bindings: { briefing_field_extraction: { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" } },
    isProviderAvailable: () => true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "invalid_request");
});

test("AiModelRouter: provider ausente (sem binding configurado) devolve not_configured", () => {
  const result = routeAiRequest({ request: baseRequest(), providers: [], bindings: {}, isProviderAvailable: () => true });
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "not_configured");
});

test("AiModelRouter: provider configurado mas não presente na lista de providers devolve not_configured", () => {
  const result = routeAiRequest({
    request: baseRequest(),
    providers: [],
    bindings: { briefing_field_extraction: { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" } },
    isProviderAvailable: () => true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "not_configured");
});

test("AiModelRouter: circuit breaker aberto devolve provider_unavailable (retryable)", () => {
  const fake = new FakeAiModelProvider({ id: "anthropic", script: [] });
  const result = routeAiRequest({
    request: baseRequest(),
    providers: [fake],
    bindings: { briefing_field_extraction: { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" } },
    isProviderAvailable: () => false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "provider_unavailable");
  assert.equal(result.error.retryable, true);
});

test("AiModelRouter: binding para modelo fora do allowedModels é policy_violation", () => {
  const fake = new FakeAiModelProvider({ id: "anthropic", script: [] });
  const result = routeAiRequest({
    request: baseRequest({ policy: { ...baseRequest().policy, allowedModels: ["claude-sonnet-5-20260201"] } }),
    providers: [fake],
    bindings: { briefing_field_extraction: { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" } },
    isProviderAvailable: () => true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.category, "policy_violation");
});

test("AiModelRouter: caminho feliz devolve exatamente um candidato", () => {
  const fake = new FakeAiModelProvider({ id: "anthropic", script: [] });
  const result = routeAiRequest({
    request: baseRequest(),
    providers: [fake],
    bindings: { briefing_field_extraction: { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" } },
    isProviderAvailable: () => true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].modelId, "claude-haiku-4-5-20251001");
});

// ---------------------------------------------------------------------------------------------
// Structured output — validação estrutural (Zod strict) + semântica
// ---------------------------------------------------------------------------------------------

function validCandidate(overrides = {}) {
  return {
    fieldKey: "channel",
    originalText: "vamos postar no instagram",
    proposedValue: "instagram",
    normalizedValue: "instagram",
    confidence: 0.8,
    evidence: "instagram",
    requiresConfirmation: true,
    sensitivityDetected: false,
    rationaleCode: "explicit_statement",
    ...overrides,
  };
}

function validResult(overrides = {}) {
  return { schemaVersion: BRIEFING_FIELD_EXTRACTION_RESULT_SCHEMA_VERSION, candidates: [validCandidate()], ambiguities: [], unsupportedClaims: [], warnings: [], ...overrides };
}

test("Structured output: resposta válida passa na validação estrutural", () => {
  const result = validateBriefingFieldExtractionStructure(validResult());
  assert.equal(result.valid, true);
});

test("Structured output: JSON com formato errado (não é objeto) falha estruturalmente", () => {
  const result = validateBriefingFieldExtractionStructure("isto não é json válido para o schema");
  assert.equal(result.valid, false);
});

test("Structured output: schemaVersion inválida falha estruturalmente", () => {
  const result = validateBriefingFieldExtractionStructure(validResult({ schemaVersion: 999 }));
  assert.equal(result.valid, false);
});

test("Structured output: campo desconhecido no objeto (Zod strict) falha estruturalmente", () => {
  const result = validateBriefingFieldExtractionStructure({ ...validResult(), somethingUnexpected: true });
  assert.equal(result.valid, false);
});

test("Structured output: candidate com propriedade extra (Zod strict no nível do candidato) falha estruturalmente", () => {
  const result = validateBriefingFieldExtractionStructure(validResult({ candidates: [{ ...validCandidate(), extra: "nope" }] }));
  assert.equal(result.valid, false);
});

test("Structured output: confidence fora de [0,1] falha estruturalmente", () => {
  const result = validateBriefingFieldExtractionStructure(validResult({ candidates: [validCandidate({ confidence: 1.5 })] }));
  assert.equal(result.valid, false);
});

test("Structured output: rationaleCode fora do enum fechado falha estruturalmente", () => {
  const result = validateBriefingFieldExtractionStructure(validResult({ candidates: [validCandidate({ rationaleCode: "trust_me_bro" })] }));
  assert.equal(result.valid, false);
});

test("Semântica: campo desconhecido no schema ativo é descartado (não invalida o lote inteiro)", () => {
  const structural = validateBriefingFieldExtractionStructure(
    validResult({ candidates: [validCandidate(), validCandidate({ fieldKey: "campoQueNaoExiste", evidence: "vamos postar no instagram" })] }),
  );
  assert.equal(structural.valid, true);
  const semantic = applySemanticValidation({ structural: structural.data, schema: CAMPAIGN_CREATION_SCHEMA_V1, sourceText: "vamos postar no instagram" });
  assert.equal(semantic.valid, true);
  assert.equal(semantic.data.candidates.length, 1);
  assert.ok(semantic.warnings.some((w) => w.includes("unknown_field_key")));
});

test("Semântica: acceptedValue inválido para campo enum é descartado", () => {
  const structural = validateBriefingFieldExtractionStructure(validResult({ candidates: [validCandidate({ normalizedValue: "canal-que-nao-existe" })] }));
  const semantic = applySemanticValidation({ structural: structural.data, schema: CAMPAIGN_CREATION_SCHEMA_V1, sourceText: "vamos postar no instagram" });
  assert.equal(semantic.valid, true);
  assert.equal(semantic.data.candidates.length, 0);
  assert.ok(semantic.warnings.some((w) => w.includes("value_not_in_accepted_values")));
});

test("Semântica: evidence que não aparece no texto original (alucinação) é descartada", () => {
  const structural = validateBriefingFieldExtractionStructure(validResult({ candidates: [validCandidate({ evidence: "isto nunca foi dito" })] }));
  const semantic = applySemanticValidation({ structural: structural.data, schema: CAMPAIGN_CREATION_SCHEMA_V1, sourceText: "vamos postar no instagram" });
  assert.equal(semantic.valid, true);
  assert.equal(semantic.data.candidates.length, 0);
  assert.ok(semantic.warnings.some((w) => w.includes("evidence_not_traceable")));
});

test("Semântica: quando NADA sobra depois de filtrar, ainda é 'valid' (só um turno sem novidade) — nunca bloqueia o fluxo", () => {
  const structural = validateBriefingFieldExtractionStructure(validResult({ candidates: [validCandidate({ evidence: "texto inventado" })] }));
  const semantic = applySemanticValidation({ structural: structural.data, schema: CAMPAIGN_CREATION_SCHEMA_V1, sourceText: "nada a ver com o candidato" });
  assert.equal(semantic.valid, true);
  assert.deepEqual(semantic.data.candidates, []);
  assert.ok(semantic.warnings.some((w) => w.includes("all_candidates_dropped_by_semantic_validation")));
});

test("Semântica: ambiguidade explícita nunca é tratada como erro — sobrevive à validação", () => {
  const structural = validateBriefingFieldExtractionStructure(validResult({ candidates: [], ambiguities: ["canal: instagram ou facebook?"] }));
  const semantic = applySemanticValidation({ structural: structural.data, schema: CAMPAIGN_CREATION_SCHEMA_V1, sourceText: "instagram ou facebook" });
  assert.equal(semantic.valid, true);
  assert.deepEqual(semantic.data.ambiguities, ["canal: instagram ou facebook?"]);
});

// ---------------------------------------------------------------------------------------------
// AiInputSanitizer — nunca trunca; sempre rejeita quando excede limite
// ---------------------------------------------------------------------------------------------

test("Sanitizer: remove campos sensíveis por nome (senha, token, storageRef...)", () => {
  const result = sanitizeAiInput({
    input: { message: "oi", passwordHash: "abc", refreshToken: "xyz", storageRef: "s3://bucket/key", apiKey: "sk-123" },
    expectedTenantId: "t1",
    expectedWorkspaceId: "w1",
    maxInputChars: 10_000,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.sanitized).sort(), ["message"]);
  assert.ok(result.removedFields.includes("passwordHash"));
  assert.ok(result.removedFields.includes("refreshToken"));
  assert.ok(result.removedFields.includes("storageRef"));
  assert.ok(result.removedFields.includes("apiKey"));
});

test("Sanitizer: isola workspace — um workspaceId diferente do esperado é removido com alerta", () => {
  const result = sanitizeAiInput({
    input: { message: "oi", workspaceId: "workspace-de-outro-tenant" },
    expectedTenantId: "t1",
    expectedWorkspaceId: "w1",
    maxInputChars: 10_000,
  });
  assert.equal(result.ok, true);
  assert.ok(!("workspaceId" in result.sanitized));
  assert.ok(result.alerts.some((alert) => alert.includes("cross_workspace")));
});

test("Sanitizer: NUNCA trunca — input acima do limite é rejeitado inteiro", () => {
  const result = sanitizeAiInput({
    input: { message: "x".repeat(500) },
    expectedTenantId: "t1",
    expectedWorkspaceId: "w1",
    maxInputChars: 50,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "oversized");
});

test("Sanitizer: nada sobra depois de remover tudo sensível é rejeitado", () => {
  const result = sanitizeAiInput({ input: { apiKey: "sk-123" }, expectedTenantId: "t1", expectedWorkspaceId: "w1", maxInputChars: 10_000 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "empty_after_sanitization");
});

test("Post-render check: detecta padrão de vazamento (bearer token) mesmo depois da sanitização de entrada", () => {
  const result = checkRenderedPrompt({ systemPrompt: "instruções normais", userInput: "aqui: Bearer sk-abcdefghij1234567890", maxTotalChars: 10_000 });
  assert.equal(result.ok, false);
});

test("Post-render check: prompt renderizado gigante é rejeitado mesmo com input sanitizado pequeno", () => {
  const result = checkRenderedPrompt({ systemPrompt: "x".repeat(20_000), userInput: "oi", maxTotalChars: 5_000 });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------------------------
// Custo — versionado, sem câmbio, sem billing
// ---------------------------------------------------------------------------------------------

test("AiCostCalculator: usa pricing versionado do Model Registry, considera tokens em cache", () => {
  const entry = getModelRegistryEntry("anthropic", "claude-haiku-4-5-20251001");
  const cost = calculateEstimatedCostUsd(entry, { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0 });
  assert.equal(cost, entry.pricing.inputPerMillionTokensUsd + entry.pricing.outputPerMillionTokensUsd);

  const cachedCost = calculateEstimatedCostUsd(entry, { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 1_000_000 });
  assert.equal(cachedCost, entry.pricing.cachedInputPerMillionTokensUsd);
});

test("AiUsage: providerReported=false quando o provider não informa tokens", () => {
  const entry = getModelRegistryEntry("anthropic", "claude-haiku-4-5-20251001");
  const usage = buildAiUsage({ entry, inputTokens: 0, outputTokens: 0, providerReported: false });
  assert.equal(usage.providerReported, false);
  assert.equal(usage.currency, "USD");
});

// ---------------------------------------------------------------------------------------------
// Retry policy / circuit breaker / rate limiter
// ---------------------------------------------------------------------------------------------

test("Retry policy: só timeout/rate_limited/provider_unavailable são retentáveis por padrão", () => {
  assert.equal(isRetryableFailure("timeout", DEFAULT_AI_RETRY_POLICY), true);
  assert.equal(isRetryableFailure("rate_limited", DEFAULT_AI_RETRY_POLICY), true);
  assert.equal(isRetryableFailure("provider_unavailable", DEFAULT_AI_RETRY_POLICY), true);
  assert.equal(isRetryableFailure("invalid_output", DEFAULT_AI_RETRY_POLICY), false);
  assert.equal(isRetryableFailure("policy_violation", DEFAULT_AI_RETRY_POLICY), false);
  assert.equal(isRetryableFailure("authentication_failed", DEFAULT_AI_RETRY_POLICY), false);
  assert.equal(isRetryableFailure("content_blocked", DEFAULT_AI_RETRY_POLICY), false);
  assert.equal(isRetryableFailure("invalid_request", DEFAULT_AI_RETRY_POLICY), false);
});

test("Retry policy: backoff cresce com o número de tentativas", () => {
  const first = computeBackoffMs(1, 100, 5000);
  const second = computeBackoffMs(2, 100, 5000);
  assert.ok(second >= first);
});

test("Circuit breaker: abre depois do limiar de falhas consecutivas e bloqueia; sucesso fecha de novo", () => {
  const breaker = new InMemoryAiCircuitBreaker({ failureThreshold: 2, cooldownMs: 10_000 });
  assert.equal(breaker.isAvailable("anthropic"), true);
  breaker.recordFailure("anthropic");
  assert.equal(breaker.isAvailable("anthropic"), true, "ainda não atingiu o limiar");
  breaker.recordFailure("anthropic");
  assert.equal(breaker.getState("anthropic"), "open");
  assert.equal(breaker.isAvailable("anthropic"), false);

  breaker.recordSuccess("anthropic");
  assert.equal(breaker.getState("anthropic"), "closed");
  assert.equal(breaker.isAvailable("anthropic"), true);
});

test("Circuit breaker: half_open depois do cooldown, mas falha nele reabre imediatamente", () => {
  let now = 0;
  const breaker = new InMemoryAiCircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => now });
  breaker.recordFailure("anthropic");
  assert.equal(breaker.getState("anthropic"), "open");
  assert.equal(breaker.isAvailable("anthropic"), false);

  now = 1001;
  assert.equal(breaker.isAvailable("anthropic"), true);
  assert.equal(breaker.getState("anthropic"), "half_open");

  breaker.recordFailure("anthropic");
  assert.equal(breaker.getState("anthropic"), "open");
});

test("Rate limiter: bloqueia depois do limite na janela, libera fora dela", async () => {
  let now = 0;
  const limiter = new InMemoryAiRateLimiter({ maxCallsPerWindow: 2, windowMs: 1000, now: () => now });
  const key = { tenantId: "t1", operation: "briefing_field_extraction" };
  assert.equal((await limiter.consume(key)).allowed, true);
  assert.equal((await limiter.consume(key)).allowed, true);
  const third = await limiter.consume(key);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterMs > 0);

  now = 1001;
  assert.equal((await limiter.consume(key)).allowed, true);
});

// ---------------------------------------------------------------------------------------------
// AiExtractionDecision
// ---------------------------------------------------------------------------------------------

test("AiExtractionDecision: feature desligada nunca chama IA, mesmo com lacunas", () => {
  const decision = decideShouldCallAi({
    featureEnabled: false,
    readiness: { missingRequiredFields: ["channel"], ambiguousFields: [], optionalHighImpactFields: [] },
  });
  assert.equal(decision.shouldCall, false);
  assert.equal(decision.reason, "feature_disabled");
});

test("AiExtractionDecision: extração determinística suficiente (nada faltando) não chama IA", () => {
  const decision = decideShouldCallAi({
    featureEnabled: true,
    readiness: { missingRequiredFields: [], ambiguousFields: [], optionalHighImpactFields: [] },
  });
  assert.equal(decision.shouldCall, false);
  assert.equal(decision.reason, "deterministic_sufficient");
});

test("AiExtractionDecision: NÃO é restrita a campo obrigatório faltante — ambiguidade e opcional de alto impacto também acionam", () => {
  const onlyAmbiguous = decideShouldCallAi({ featureEnabled: true, readiness: { missingRequiredFields: [], ambiguousFields: ["channel"], optionalHighImpactFields: [] } });
  assert.equal(onlyAmbiguous.shouldCall, true);

  const onlyHighImpact = decideShouldCallAi({ featureEnabled: true, readiness: { missingRequiredFields: [], ambiguousFields: [], optionalHighImpactFields: ["tone"] } });
  assert.equal(onlyHighImpact.shouldCall, true);
});
