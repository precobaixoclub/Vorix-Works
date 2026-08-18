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
