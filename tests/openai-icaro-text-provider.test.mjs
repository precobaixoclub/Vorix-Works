import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiIcaroTextProvider } from "../dist/infrastructure/ai-providers/openai-icaro-text-provider.js";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

test("OpenAiIcaroTextProvider: sem imageUrls, content continua sendo a string simples de sempre (regressão)", async () => {
  let capturedBody;
  const httpClient = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return jsonResponse(200, { choices: [{ message: { content: "resposta" } }], model: "gpt-4o-mini" });
  };
  const provider = new OpenAiIcaroTextProvider({ getApiKey: async () => "sk-test" }, httpClient);

  await provider.execute({ taskType: "analysis", prompt: "Analise isto.", model: "", temperature: 0.5, maxTokens: 500, timeoutMs: 5000 });

  assert.equal(typeof capturedBody.messages[0].content, "string");
  assert.equal(capturedBody.messages[0].content, "Analise isto.");
});

test("OpenAiIcaroTextProvider: com imageUrls, content vira blocos multimodais (texto + image_url por imagem)", async () => {
  let capturedBody;
  const httpClient = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return jsonResponse(200, { choices: [{ message: { content: "resposta" } }], model: "gpt-4o-mini" });
  };
  const provider = new OpenAiIcaroTextProvider({ getApiKey: async () => "sk-test" }, httpClient);

  await provider.execute({
    taskType: "review",
    prompt: "Compare as duas imagens.",
    model: "",
    temperature: 0.2,
    maxTokens: 200,
    timeoutMs: 5000,
    imageUrls: ["https://x/referencia.png", "https://x/gerada.png"],
  });

  const content = capturedBody.messages[0].content;
  assert.ok(Array.isArray(content));
  assert.equal(content[0].type, "text");
  assert.equal(content[0].text, "Compare as duas imagens.");
  assert.equal(content[1].type, "image_url");
  assert.equal(content[1].image_url.url, "https://x/referencia.png");
  assert.equal(content[2].type, "image_url");
  assert.equal(content[2].image_url.url, "https://x/gerada.png");
});

test("OpenAiIcaroTextProvider: response_format json_object continua funcionando junto com imageUrls", async () => {
  let capturedBody;
  const httpClient = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return jsonResponse(200, { choices: [{ message: { content: "{}" } }], model: "gpt-4o-mini" });
  };
  const provider = new OpenAiIcaroTextProvider({ getApiKey: async () => "sk-test" }, httpClient);

  await provider.execute({
    taskType: "review",
    prompt: "Compare.",
    model: "",
    temperature: 0.2,
    maxTokens: 200,
    timeoutMs: 5000,
    imageUrls: ["https://x/a.png"],
    expectedOutput: "json",
  });

  assert.equal(capturedBody.response_format.type, "json_object");
  assert.ok(Array.isArray(capturedBody.messages[0].content));
});

// Achado real em produção (incidente de quota OpenAI): HTTP 429 cobre tanto rate limit
// transitório (se resolve sozinho) quanto crédito/saldo da organização esgotado (nunca se resolve
// sozinho) — confundir os dois fazia o Ícaro tentar de novo (retryable=true) contra um erro que
// ia repetir idêntico. `quota_exhausted` precisa ser um `kind` DIFERENTE de `rate_limit`, e nunca
// retryable.

async function captureExecuteError(httpClient) {
  const provider = new OpenAiIcaroTextProvider({ getApiKey: async () => "sk-test" }, httpClient);
  try {
    await provider.execute({ taskType: "analysis", prompt: "x", model: "", temperature: 0.5, maxTokens: 100, timeoutMs: 5000 });
    throw new Error("esperava que execute() lançasse");
  } catch (error) {
    return error;
  }
}

test("OpenAiIcaroTextProvider: 429 com credit_balance_exhausted vira kind='quota_exhausted', NUNCA retryable", async () => {
  const error = await captureExecuteError(async () => jsonResponse(429, { error: { code: "credit_balance_exhausted", type: "insufficient_quota", message: "sem crédito" } }));
  assert.equal(error.kind, "quota_exhausted");
  assert.equal(error.retryable, false);
  assert.doesNotMatch(error.message, /429/, "mensagem de quota esgotada nunca deveria parecer um erro HTTP genérico");
});

test("OpenAiIcaroTextProvider: 429 com insufficient_quota (sem credit_balance_exhausted) também vira 'quota_exhausted'", async () => {
  const error = await captureExecuteError(async () => jsonResponse(429, { error: { type: "insufficient_quota", message: "sem crédito" } }));
  assert.equal(error.kind, "quota_exhausted");
  assert.equal(error.retryable, false);
});

test("OpenAiIcaroTextProvider: 429 SEM corpo de quota (rate limit de verdade) continua 'rate_limit', retryable", async () => {
  const error = await captureExecuteError(async () => jsonResponse(429, { error: { code: "rate_limit_exceeded", message: "muitas requisições" } }));
  assert.equal(error.kind, "rate_limit");
  assert.equal(error.retryable, true);
});

test("OpenAiIcaroTextProvider: 401 continua classificado sem relação nenhuma com quota (regressão)", async () => {
  const error = await captureExecuteError(async () => jsonResponse(401, { error: { message: "chave inválida" } }));
  assert.notEqual(error.kind, "quota_exhausted");
  assert.equal(error.kind, "provider_error");
  assert.equal(error.retryable, false);
});

test("OpenAiIcaroTextProvider: 500 continua 'temporary', retryable (regressão)", async () => {
  const error = await captureExecuteError(async () => jsonResponse(500, { error: { message: "erro interno" } }));
  assert.equal(error.kind, "temporary");
  assert.equal(error.retryable, true);
});
