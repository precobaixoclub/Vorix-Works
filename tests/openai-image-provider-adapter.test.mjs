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
    modelId: "gpt-image-1",
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
