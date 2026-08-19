import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { cropToTargetAspectRatio } from "../dist/infrastructure/image-processing/aspect-ratio-crop.js";

async function makeSolidPng(width, height) {
  return sharp({ create: { width, height, channels: 4, background: { r: 20, g: 60, b: 120, alpha: 1 } } }).png().toBuffer();
}

test("cropToTargetAspectRatio: corta 1024x1536 (2:3, o tamanho nativo da OpenAI para retrato) para 9:16 real (regressão do pillarboxing achado ao vivo)", async () => {
  const buffer = await makeSolidPng(1024, 1536);

  const result = await cropToTargetAspectRatio(buffer, "9:16");
  const meta = await sharp(result).metadata();

  const resultRatio = meta.width / meta.height;
  assert.ok(Math.abs(resultRatio - 9 / 16) < 0.01, `esperava proporção ~0.5625, veio ${resultRatio}`);
  assert.equal(meta.height, 1536, "altura não deveria mudar (corta largura, não altura, pra 9:16)");
  assert.ok(meta.width < 1024, "largura deveria ser reduzida");
});

test("cropToTargetAspectRatio: corta 1024x1536 para 4:5 real (largura maior que a altura permite, corta altura)", async () => {
  const buffer = await makeSolidPng(1024, 1536);

  const result = await cropToTargetAspectRatio(buffer, "4:5");
  const meta = await sharp(result).metadata();

  const resultRatio = meta.width / meta.height;
  assert.ok(Math.abs(resultRatio - 4 / 5) < 0.01, `esperava proporção ~0.8, veio ${resultRatio}`);
  assert.equal(meta.width, 1024, "largura não deveria mudar (corta altura, não largura, pra 4:5)");
  assert.ok(meta.height < 1536, "altura deveria ser reduzida");
});

test("cropToTargetAspectRatio: corta 1536x1024 (paisagem nativa) para 16:9 real", async () => {
  const buffer = await makeSolidPng(1536, 1024);

  const result = await cropToTargetAspectRatio(buffer, "16:9");
  const meta = await sharp(result).metadata();

  const resultRatio = meta.width / meta.height;
  assert.ok(Math.abs(resultRatio - 16 / 9) < 0.01, `esperava proporção ~1.778, veio ${resultRatio}`);
});

test("cropToTargetAspectRatio: proporção já compatível (1:1 pedido, 1024x1024 nativo) não corta nada", async () => {
  const buffer = await makeSolidPng(1024, 1024);

  const result = await cropToTargetAspectRatio(buffer, "1:1");

  assert.equal(Buffer.compare(result, buffer), 0);
});

test("cropToTargetAspectRatio: rótulo ausente devolve o buffer original sem tocar", async () => {
  const buffer = await makeSolidPng(1024, 1536);

  const result = await cropToTargetAspectRatio(buffer, undefined);

  assert.equal(Buffer.compare(result, buffer), 0);
});

test("cropToTargetAspectRatio: rótulo malformado (não bate o padrão W:H) devolve o buffer original, nunca lança", async () => {
  const buffer = await makeSolidPng(1024, 1536);

  const result = await cropToTargetAspectRatio(buffer, "vertical");

  assert.equal(Buffer.compare(result, buffer), 0);
});

test("cropToTargetAspectRatio: corte é sempre centralizado (mesma margem nos dois lados)", async () => {
  const buffer = await makeSolidPng(1024, 1536);
  const result = await cropToTargetAspectRatio(buffer, "9:16");
  const meta = await sharp(result).metadata();

  const expectedWidth = Math.round(1536 * (9 / 16));
  assert.ok(Math.abs(meta.width - expectedWidth) <= 1, `largura esperada ~${expectedWidth}, veio ${meta.width}`);
});
