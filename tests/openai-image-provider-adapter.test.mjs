import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiImageProviderAdapter } from "../dist/infrastructure/ai-providers/openai-image-provider-adapter.js";

/**
 * Achado real em produção (incidente de quota OpenAI): HTTP 429 cobre tanto rate limit
 * transitório (`rate_limited`, se resolve sozinho) quanto crédito/saldo da organização esgotado
 * (`quota_exhausted`, nunca se resolve sozinho) — o Vorix classificava os dois igual, escondendo
 * que um exige intervenção financeira e o outro não. Nenhum teste cobria `OpenAiImageProviderAdapter`
 * até esta auditoria.
 */

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function makeAdapter(httpClient, overrides = {}) {
  return new OpenAiImageProviderAdapter(
    {
      enabled: true,
      getApiKey: async () => "sk-test",
      persistGeneratedImage: async () => "https://cdn.exemplo/img.png",
      ...overrides,
    },
    httpClient,
  );
}

function baseRequest(overrides = {}) {
  return {
    operationTypeCode: "image_generation",
    modelId: "gpt-image-2.6-sunburst",
    prompt: "um gato",
    tenantId: "tenant-1",
    params: { size: "1024x1024", quality: "medium" },
    timeoutMs: 30_000,
    ...overrides,
  };
}

test("generate(): 429 com credit_balance_exhausted vira category='quota_exhausted', nunca 'rate_limited'", async () => {
  const adapter = makeAdapter(async () => jsonResponse(429, { error: { code: "credit_balance_exhausted", type: "insufficient_quota", message: "sem crédito" } }));
  const result = await adapter.generate(baseRequest());
  assert.equal(result.ok, false);
  assert.equal(result.category, "quota_exhausted");
  assert.doesNotMatch(result.message.toLowerCase(), /rate limit/, "nunca deveria soar como rate limit transitório");
});

test("generate(): 429 com insufficient_quota (sem credit_balance_exhausted) também vira 'quota_exhausted'", async () => {
  const adapter = makeAdapter(async () => jsonResponse(429, { error: { type: "insufficient_quota", message: "sem crédito" } }));
  const result = await adapter.generate(baseRequest());
  assert.equal(result.category, "quota_exhausted");
});

test("generate(): 429 SEM corpo de quota (rate limit de verdade) continua 'rate_limited' (regressão)", async () => {
  const adapter = makeAdapter(async () => jsonResponse(429, { error: { code: "rate_limit_exceeded", message: "muitas requisições" } }));
  const result = await adapter.generate(baseRequest());
  assert.equal(result.category, "rate_limited");
});

test("generate(): 401 continua 'authentication_failed', sem relação com quota (regressão)", async () => {
  const adapter = makeAdapter(async () => jsonResponse(401, {}));
  const result = await adapter.generate(baseRequest());
  assert.equal(result.category, "authentication_failed");
});

test("generate(): 500 continua 'provider_unavailable' (regressão)", async () => {
  const adapter = makeAdapter(async () => jsonResponse(500, {}));
  const result = await adapter.generate(baseRequest());
  assert.equal(result.category, "provider_unavailable");
});

test("generate(): 400 com content_policy_violation continua 'content_blocked' (regressão)", async () => {
  const adapter = makeAdapter(async () => jsonResponse(400, { error: { code: "content_policy_violation", message: "bloqueado" } }));
  const result = await adapter.generate(baseRequest());
  assert.equal(result.category, "content_blocked");
});

test("generate(): sucesso continua funcionando normalmente (regressão)", async () => {
  const adapter = makeAdapter(async () => jsonResponse(200, { data: [{ b64_json: Buffer.from("fake-png").toString("base64") }] }));
  const result = await adapter.generate(baseRequest());
  assert.equal(result.ok, true);
  assert.equal(result.mediaUrl, "https://cdn.exemplo/img.png");
});

// ---- health() — sinal leve de quota, nunca uma chamada paga nova (pedido explícito do usuário) ----

test("health(): depois de uma falha por quota esgotada, reporta ok=false com mensagem sanitizada (sem precisar de nova chamada paga)", async () => {
  const adapter = makeAdapter(async () => jsonResponse(429, { error: { code: "credit_balance_exhausted", message: "sem crédito" } }));
  await adapter.generate(baseRequest());
  const health = await adapter.health();
  assert.equal(health.ok, false);
  assert.match(health.safeMessage, /quota|crédito/i);
});

test("health(): depois de uma geração bem-sucedida seguinte, o sinal de quota esgotada se limpa sozinho", async () => {
  let callCount = 0;
  const adapter = makeAdapter(async () => {
    callCount += 1;
    if (callCount === 1) return jsonResponse(429, { error: { code: "credit_balance_exhausted", message: "sem crédito" } });
    return jsonResponse(200, { data: [{ b64_json: Buffer.from("fake-png").toString("base64") }] });
  });

  await adapter.generate(baseRequest());
  assert.equal((await adapter.health()).ok, false, "pré-condição: quota esgotada detectada");

  await adapter.generate(baseRequest());
  assert.equal((await adapter.health()).ok, true, "uma geração real com sucesso limpa o sinal sozinha");
});

test("health(): uma falha por rate limit transitório (não quota) NUNCA derruba o health — é passageiro, não um sinal de indisponibilidade", async () => {
  const adapter = makeAdapter(async () => jsonResponse(429, { error: { code: "rate_limit_exceeded", message: "muitas requisições" } }));
  await adapter.generate(baseRequest());
  const health = await adapter.health();
  assert.equal(health.ok, true);
});

test("health(): sem API key configurada, continua reportando indisponível (regressão)", async () => {
  const adapter = makeAdapter(async () => jsonResponse(200, {}), { getApiKey: async () => undefined });
  const health = await adapter.health();
  assert.equal(health.ok, false);
  assert.match(health.safeMessage, /API key/);
});

test("generate(): background explícito vai no corpo de /images/generations; sem ele o corpo continua igual (regressão)", async () => {
  const bodies = [];
  const http = async (url, init) => { bodies.push(JSON.parse(init.body)); return jsonResponse(200, { data: [{ b64_json: Buffer.from("x").toString("base64") }] }); };
  const adapter = makeAdapter(http);
  await adapter.generate(baseRequest({ params: { size: "1024x1536", quality: "high", background: "opaque" } }));
  await adapter.generate(baseRequest());
  assert.equal(bodies[0].background, "opaque");
  assert.equal("background" in bodies[1], false);
});

// Fase 1 da evolução do motor criativo (22/11/2026): o gpt-image-1 deixou de existir na conta; o
// adaptador passa a respeitar o flag de habilitação, só chamar modelos do catálogo validado (sem
// troca silenciosa) e devolver modelo/parâmetros/consumo/custo reais para auditoria.
test("generate(): com OPENAI_IMAGE_ENABLED desligado nenhuma chamada paga sai", async () => {
  let called = false;
  const adapter = makeAdapter(async () => { called = true; return jsonResponse(200, {}); }, { enabled: false });
  const result = await adapter.generate(baseRequest());
  assert.equal(result.ok, false);
  assert.equal(result.category, "not_configured");
  assert.match(result.message, /OPENAI_IMAGE_ENABLED/);
  assert.equal(called, false);
});

test("generate(): modelo fora do catálogo (ex.: gpt-image-1 descontinuado) falha com mensagem clara, sem trocar de modelo", async () => {
  let called = false;
  const adapter = makeAdapter(async () => { called = true; return jsonResponse(200, {}); });
  const result = await adapter.generate(baseRequest({ modelId: "gpt-image-1" }));
  assert.equal(result.ok, false);
  assert.equal(result.category, "invalid_request");
  assert.match(result.message, /não está no catálogo/);
  assert.equal(called, false);
});

test("generate(): qualidade não aceita pelo modelo é recusada antes da chamada", async () => {
  const adapter = makeAdapter(async () => { throw new Error("não deveria chamar"); });
  const result = await adapter.generate(baseRequest({ params: { size: "1088x1360", quality: "ultra" } }));
  assert.equal(result.category, "invalid_request");
});

test("generate(): envia complexity só quando pedido e devolve auditoria com custo real do usage", async () => {
  const bodies = [];
  const adapter = makeAdapter(async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return jsonResponse(200, {
      data: [{ b64_json: Buffer.from("fake-png").toString("base64") }],
      usage: { input_tokens: 1200, input_tokens_details: { text_tokens: 1200, image_tokens: 0 }, output_tokens: 6000, output_tokens_details: { image_tokens: 6000, text_tokens: 0 }, total_tokens: 7200 },
    });
  });
  const withComplexity = await adapter.generate(baseRequest({ params: { size: "1088x1360", quality: "high", complexity: "medium" } }));
  const without = await adapter.generate(baseRequest({ params: { size: "1088x1360", quality: "high" } }));
  assert.equal(bodies[0].model, "gpt-image-2.6-sunburst");
  assert.equal(bodies[0].size, "1088x1360");
  assert.equal(bodies[0].complexity, "medium");
  assert.equal("complexity" in bodies[1], false);
  assert.equal("input_fidelity" in bodies[0], false);
  assert.equal(withComplexity.ok, true);
  assert.equal(withComplexity.audit.model, "gpt-image-2.6-sunburst");
  assert.equal(withComplexity.audit.endpoint, "generations");
  assert.deepEqual(withComplexity.audit.usage, { inputTextTokens: 1200, inputImageTokens: 0, outputImageTokens: 6000, outputTextTokens: 0, totalTokens: 7200 });
  // 1200 × $5/1M + 6000 × $30/1M = 0,006 + 0,18
  assert.equal(withComplexity.audit.costUsd, 0.186);
  assert.equal(without.audit.params.complexity, undefined);
});
