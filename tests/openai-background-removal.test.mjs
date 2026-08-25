import test from "node:test";
import assert from "node:assert/strict";
import { removeImageBackgroundViaAI } from "../dist/infrastructure/ai-providers/openai-background-removal.js";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("removeImageBackgroundViaAI: sem API key configurada, nunca chama HTTP e falha com mensagem clara", async () => {
  let called = false;
  const httpClient = async () => { called = true; return jsonResponse(200, {}); };
  await assert.rejects(
    () => removeImageBackgroundViaAI({ getApiKey: async () => undefined }, { imageBuffer: Buffer.from("x"), contentType: "image/jpeg" }, httpClient),
    /OPENAI_BACKGROUND_REMOVAL_NOT_CONFIGURED/,
  );
  assert.equal(called, false);
});

test("removeImageBackgroundViaAI: sucesso devolve o buffer decodificado do b64_json", async () => {
  const expected = Buffer.from("conteudo-png-fake");
  const httpClient = async () => jsonResponse(200, { data: [{ b64_json: expected.toString("base64") }] });
  const result = await removeImageBackgroundViaAI({ getApiKey: async () => "sk-test" }, { imageBuffer: Buffer.from("original"), contentType: "image/jpeg" }, httpClient);
  assert.deepEqual(result, expected);
});

test("removeImageBackgroundViaAI: chama POST /v1/images/edits com background=transparent, model gpt-image-1 e a imagem original no multipart", async () => {
  let capturedUrl;
  let capturedInit;
  const httpClient = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse(200, { data: [{ b64_json: Buffer.from("x").toString("base64") }] });
  };
  await removeImageBackgroundViaAI({ apiBaseUrl: "https://api.openai.com", getApiKey: async () => "sk-test" }, { imageBuffer: Buffer.from("original"), contentType: "image/jpeg" }, httpClient);

  assert.equal(capturedUrl, "https://api.openai.com/v1/images/edits");
  assert.equal(capturedInit.method, "POST");
  assert.equal(capturedInit.headers.authorization, "Bearer sk-test");
  assert.ok(capturedInit.body instanceof FormData);
  assert.equal(capturedInit.body.get("model"), "gpt-image-1");
  assert.equal(capturedInit.body.get("background"), "transparent");
  assert.ok(capturedInit.body.get("image"), "envia a imagem original no campo multipart");
});

test("removeImageBackgroundViaAI: resposta de erro da OpenAI vira OPENAI_BACKGROUND_REMOVAL_FAILED com a mensagem real", async () => {
  const httpClient = async () => jsonResponse(400, { error: { message: "imagem inválida" } });
  await assert.rejects(
    () => removeImageBackgroundViaAI({ getApiKey: async () => "sk-test" }, { imageBuffer: Buffer.from("x"), contentType: "image/jpeg" }, httpClient),
    /OPENAI_BACKGROUND_REMOVAL_FAILED.*imagem inválida/,
  );
});

test("removeImageBackgroundViaAI: resposta sem nenhuma imagem devolvida vira OPENAI_BACKGROUND_REMOVAL_FAILED", async () => {
  const httpClient = async () => jsonResponse(200, { data: [] });
  await assert.rejects(
    () => removeImageBackgroundViaAI({ getApiKey: async () => "sk-test" }, { imageBuffer: Buffer.from("x"), contentType: "image/jpeg" }, httpClient),
    /OPENAI_BACKGROUND_REMOVAL_FAILED/,
  );
});
