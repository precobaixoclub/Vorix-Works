import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { computeRegionPixelStats, applyLocalBlur, applyLocalScrim, extractRegionBuffer } from "../dist/infrastructure/image-processing/region-pixel-stats.js";
import { classifyGhostTextIntensity, resolveGhostTextTreatmentParams } from "../dist/application/creative-engine/resolve-actual-safe-area.js";

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

// ---------------------------------------------------------------------------------------------
// ETAPA 3.1 (Rodada 4) — applyLocalScrim/extractRegionBuffer: véu adaptativo + recorte pra
// reverificação isolada (blur sozinho às vezes mantém a forma das letras reconhecível).
// ---------------------------------------------------------------------------------------------

test("applyLocalScrim: escurece uma região clara com véu escuro (reduz luminância real, mensurável)", async () => {
  const buffer = await solidImage(400, 400, 220);
  const rect = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 };
  const before = await computeRegionPixelStats(buffer, rect);
  const scrimmed = await applyLocalScrim(buffer, rect, 0.6, "dark");
  const after = await computeRegionPixelStats(scrimmed, rect);
  assert.ok(after.meanLuminance < before.meanLuminance, `esperava luminância menor depois do véu escuro, antes=${before.meanLuminance} depois=${after.meanLuminance}`);
});

test("applyLocalScrim: clareia uma região escura com véu claro (aumenta luminância real, mensurável)", async () => {
  const buffer = await solidImage(400, 400, 30);
  const rect = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 };
  const before = await computeRegionPixelStats(buffer, rect);
  const scrimmed = await applyLocalScrim(buffer, rect, 0.6, "light");
  const after = await computeRegionPixelStats(scrimmed, rect);
  assert.ok(after.meanLuminance > before.meanLuminance, `esperava luminância maior depois do véu claro, antes=${before.meanLuminance} depois=${after.meanLuminance}`);
});

test("applyLocalScrim: opacidade maior reduz mais o contraste residual que opacidade menor (escalonamento real, não só nominal)", async () => {
  const checkerSvg = Buffer.from(
    '<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="200" fill="white"/>' +
      Array.from({ length: 4 }, (_, row) => Array.from({ length: 4 }, (_, col) => ((row + col) % 2 === 0 ? `<rect x="${col * 50}" y="${row * 50}" width="50" height="50" fill="black"/>` : "")).join("")).join("") +
      "</svg>",
  );
  const buffer = await sharp(checkerSvg).png().toBuffer();
  const rect = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 };

  const lightScrim = await applyLocalScrim(buffer, rect, 0.3, "dark");
  const heavyScrim = await applyLocalScrim(buffer, rect, 0.8, "dark");
  const lightStats = await computeRegionPixelStats(lightScrim, rect);
  const heavyStats = await computeRegionPixelStats(heavyScrim, rect);
  assert.ok(heavyStats.stdDevLuminance < lightStats.stdDevLuminance, `esperava desvio-padrão residual menor com véu mais opaco, leve=${lightStats.stdDevLuminance} pesado=${heavyStats.stdDevLuminance}`);
});

test("applyLocalScrim: nunca lança para um buffer inválido — devolve o buffer original intacto", async () => {
  const invalid = Buffer.from("not an image");
  const result = await applyLocalScrim(invalid, { xPct: 0, yPct: 0, widthPct: 50, heightPct: 50 }, 0.5, "dark");
  assert.equal(result, invalid);
});

test("extractRegionBuffer: recorta só a região pedida, nunca a imagem inteira", async () => {
  const buffer = await solidImage(400, 400, 100);
  const cropped = await extractRegionBuffer(buffer, { xPct: 25, yPct: 25, widthPct: 50, heightPct: 50 });
  assert.ok(cropped);
  const meta = await sharp(cropped).metadata();
  assert.equal(meta.width, 200);
  assert.equal(meta.height, 200);
});

test("extractRegionBuffer: nunca lança para um buffer inválido — devolve undefined", async () => {
  const cropped = await extractRegionBuffer(Buffer.from("not an image"), { xPct: 0, yPct: 0, widthPct: 50, heightPct: 50 });
  assert.equal(cropped, undefined);
});

// ---------------------------------------------------------------------------------------------
// ETAPA 3.1 (Rodada 4) — SMOKE LOCAL (brief, ponto 16): 3 cenários sintéticos com texto REAL
// inserido propositalmente (LOW/MEDIUM/HIGH contraste), usando o pipeline REAL completo
// (estatística -> classificação de intensidade -> blur -> véu), confirmando que o tratamento
// escalado de fato reduz o contraste residual de forma mensurável em todos os níveis — nunca só
// no caso fácil.
// ---------------------------------------------------------------------------------------------

async function makeGhostTextImage(textColor, backgroundColor, fontSize) {
  const svg = Buffer.from(
    `<svg width="400" height="150" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="400" height="150" fill="${backgroundColor}"/>` +
      `<text x="20" y="90" font-family="sans-serif" font-size="${fontSize}" font-weight="bold" fill="${textColor}">R$ 149,00</text>` +
      "</svg>",
  );
  return sharp(svg).png().toBuffer();
}

for (const scenario of [
  { label: "LOW contraste (cinza claro sobre branco)", textColor: "#d8d8d8", backgroundColor: "#ffffff", fontSize: 36 },
  { label: "MEDIUM contraste (cinza escuro sobre cinza claro)", textColor: "#555555", backgroundColor: "#cccccc", fontSize: 44 },
  { label: "HIGH contraste (preto sólido sobre branco, fonte grande)", textColor: "#000000", backgroundColor: "#ffffff", fontSize: 56 },
]) {
  test(`SMOKE LOCAL (ETAPA 3.1) — ${scenario.label}: tratamento escalado reduz o contraste residual de forma mensurável`, async () => {
    const rect = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 };
    const buffer = await makeGhostTextImage(scenario.textColor, scenario.backgroundColor, scenario.fontSize);

    const before = await computeRegionPixelStats(buffer, rect);
    assert.ok(before.stdDevLuminance > 0, "a imagem sintética precisa ter texto real detectável (desvio-padrão > 0)");

    const intensity = classifyGhostTextIntensity(before);
    const params = resolveGhostTextTreatmentParams(intensity);
    const blurred = await applyLocalBlur(buffer, rect, params.blurSigma);
    const treated = await applyLocalScrim(blurred, rect, params.scrimOpacity, before.meanLuminance < 128 ? "light" : "dark");

    const after = await computeRegionPixelStats(treated, rect);
    assert.ok(
      after.stdDevLuminance < before.stdDevLuminance * 0.6,
      `esperava redução de pelo menos 40% no desvio-padrão (contraste residual) — antes=${before.stdDevLuminance.toFixed(1)} depois=${after.stdDevLuminance.toFixed(1)} (intensidade="${intensity}")`,
    );
  });
}
