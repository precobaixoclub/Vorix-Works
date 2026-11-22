import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GPT_IMAGE_FAST_MODEL,
  DEFAULT_GPT_IMAGE_MODEL,
  GPT_IMAGE_MODELS,
  computeGptImageCostUsd,
  getGptImageModel,
  isValidCustomGptImageSize,
  parseGptImageUsage,
  resolveGptImageCanvas,
} from "../dist/shared/utils/gpt-image-models.js";

test("catálogo: só modelos validados; padrão = 2.6 sunburst, rápido = 2.6 flare; gpt-image-1 fora", () => {
  assert.equal(DEFAULT_GPT_IMAGE_MODEL, "gpt-image-2.6-sunburst");
  assert.equal(DEFAULT_GPT_IMAGE_FAST_MODEL, "gpt-image-2.6-flare");
  assert.equal(getGptImageModel("gpt-image-1"), undefined);
  assert.deepEqual(Object.keys(GPT_IMAGE_MODELS).sort(), ["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]);
});

test("canvas: cada formato nasce na proporção exata, dentro das regras de tamanho livre da família 2.6", () => {
  const model = getGptImageModel(DEFAULT_GPT_IMAGE_MODEL);
  const expected = { "1:1": "1088x1088", "4:5": "1088x1360", "9:16": "1152x2048", "16:9": "2048x1152" };
  for (const [ratio, size] of Object.entries(expected)) {
    const canvas = resolveGptImageCanvas(model, ratio);
    assert.equal(canvas.size, size, ratio);
    assert.equal(canvas.exact, true, ratio);
    assert.ok(isValidCustomGptImageSize(canvas.width, canvas.height), ratio);
    const [w, h] = ratio.split(":").map(Number);
    assert.ok(Math.abs(canvas.width / canvas.height - w / h) < 0.001, `${ratio} proporção exata`);
  }
  const odd = resolveGptImageCanvas(model, "5:7");
  assert.ok(isValidCustomGptImageSize(odd.width, odd.height));
  assert.equal(odd.exact, true);
  assert.equal(resolveGptImageCanvas(model, undefined).size, "1088x1088");
});

test("tamanho livre: bordas ×16, proporção 1:3–3:1, área 655.360–8.294.400", () => {
  assert.equal(isValidCustomGptImageSize(1088, 1360), true);
  assert.equal(isValidCustomGptImageSize(1080, 1350), false, "1080 não é múltiplo de 16");
  assert.equal(isValidCustomGptImageSize(512, 512), false, "abaixo da área mínima");
  assert.equal(isValidCustomGptImageSize(3840, 1088), false, "proporção acima de 3:1");
});

test("custo: lido do usage real × preço oficial (texto $5, imagem entrada $8, imagem saída $30 por 1M)", () => {
  const usage = parseGptImageUsage({ input_tokens: 2000, input_tokens_details: { text_tokens: 1500, image_tokens: 500 }, output_tokens: 8000, output_tokens_details: { image_tokens: 8000 }, total_tokens: 10000 });
  assert.deepEqual(usage, { inputTextTokens: 1500, inputImageTokens: 500, outputImageTokens: 8000, outputTextTokens: 0, totalTokens: 10000 });
  assert.equal(computeGptImageCostUsd(getGptImageModel(DEFAULT_GPT_IMAGE_MODEL), usage), 0.2515);
  assert.equal(parseGptImageUsage(undefined), undefined);
});
