import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { computeRegionPixelStats, applyLocalBlur } from "../dist/infrastructure/image-processing/region-pixel-stats.js";

/**
 * ETAPA 3 (Rodada 4, benchmark de qualidade criativa) — medida determinística e gratuita de
 * contraste/complexidade real de uma região (nunca "achismo visual", nunca uma chamada de IA).
 */

async function solidImage(width, height, gray) {
  return sharp({ create: { width, height, channels: 3, background: { r: gray, g: gray, b: gray } } }).png().toBuffer();
}

test("computeRegionPixelStats: região uniforme tem desvio-padrão ~0 e luminância igual ao cinza usado", async () => {
  const buffer = await solidImage(400, 400, 200);
  const stats = await computeRegionPixelStats(buffer, { xPct: 10, yPct: 10, widthPct: 50, heightPct: 50 });
  assert.ok(stats);
  assert.ok(Math.abs(stats.meanLuminance - 200) < 2);
  assert.ok(stats.stdDevLuminance < 2);
});

test("computeRegionPixelStats: região com ruído gaussiano tem desvio-padrão real alto (região 'ocupada')", async () => {
  const buffer = await sharp({ create: { width: 400, height: 400, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).png().toBuffer();
  const stats = await computeRegionPixelStats(buffer, { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 });
  assert.ok(stats);
  assert.ok(stats.stdDevLuminance > 30, `esperava desvio-padrão alto, veio ${stats.stdDevLuminance}`);
});

test("computeRegionPixelStats: região bem escura tem luminância baixa", async () => {
  const buffer = await solidImage(300, 300, 10);
  const stats = await computeRegionPixelStats(buffer, { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 });
  assert.ok(stats.meanLuminance < 20);
});

test("computeRegionPixelStats: devolve undefined (nunca lança) para buffer que não é uma imagem válida", async () => {
  const stats = await computeRegionPixelStats(Buffer.from("not an image"), { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 });
  assert.equal(stats, undefined);
});

test("computeRegionPixelStats: retângulo fora dos limites do canvas é recortado (clamp), nunca lança", async () => {
  const buffer = await solidImage(200, 200, 100);
  const stats = await computeRegionPixelStats(buffer, { xPct: 90, yPct: 90, widthPct: 50, heightPct: 50 });
  assert.ok(stats);
});

test("applyLocalBlur: a região borrada difere da original, mas o restante da imagem permanece igual", async () => {
  // Um padrão de alto contraste (xadrez) na região-alvo garante que o blur produza uma diferença
  // mensurável — uma região sólida poderia "borrar para si mesma" sem mudar nenhum pixel.
  const checkerSvg = Buffer.from(
    '<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="400" height="400" fill="white"/>' +
      Array.from({ length: 10 }, (_, row) => Array.from({ length: 10 }, (_, col) =>
        (row + col) % 2 === 0 ? `<rect x="${col * 40}" y="${row * 40}" width="40" height="40" fill="black"/>` : "").join("")).join("") +
      "</svg>",
  );
  const buffer = await sharp(checkerSvg).png().toBuffer();

  const blurredBuffer = await applyLocalBlur(buffer, { xPct: 0, yPct: 0, widthPct: 50, heightPct: 50 }, 12);

  const originalTargetPixel = await sharp(buffer).extract({ left: 0, top: 0, width: 40, height: 40 }).raw().toBuffer();
  const blurredTargetPixel = await sharp(blurredBuffer).extract({ left: 0, top: 0, width: 40, height: 40 }).raw().toBuffer();
  assert.notDeepEqual(blurredTargetPixel, originalTargetPixel, "a região alvo deveria mudar depois do blur");

  // Fora da região borrada (canto inferior direito), a imagem deve continuar idêntica.
  const originalOutsidePixel = await sharp(buffer).extract({ left: 360, top: 360, width: 1, height: 1 }).raw().toBuffer();
  const blurredOutsidePixel = await sharp(blurredBuffer).extract({ left: 360, top: 360, width: 1, height: 1 }).raw().toBuffer();
  assert.deepEqual(blurredOutsidePixel, originalOutsidePixel, "fora da região alvo não deveria mudar nada");
});

test("applyLocalBlur: nunca lança para um buffer inválido — devolve o buffer original intacto", async () => {
  const invalid = Buffer.from("not an image");
  const result = await applyLocalBlur(invalid, { xPct: 0, yPct: 0, widthPct: 50, heightPct: 50 });
  assert.equal(result, invalid);
});
