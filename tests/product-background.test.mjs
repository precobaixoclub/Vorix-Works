import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { computeAssetSuitabilityScore, extractProductAsset } from "../dist/infrastructure/image-processing/product-background.js";

async function solidPng(width, height, color) {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}

async function circleOnBackground(size, backgroundColor, circleColor, boxSize = 800) {
  const background = await solidPng(boxSize, boxSize, backgroundColor);
  const circleSvg = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="rgb(${circleColor.r},${circleColor.g},${circleColor.b})"/></svg>`);
  const circle = await sharp(circleSvg).png().toBuffer();
  const offset = Math.round((boxSize - size) / 2);
  return sharp(background).composite([{ input: circle, left: offset, top: offset }]).png().toBuffer();
}

async function countOpaquePixels(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opaque = 0;
  for (let i = 3; i < data.length; i += info.channels) {
    if (data[i] > 0) opaque += 1;
  }
  return { opaque, total: info.width * info.height };
}

// ---------------------------------------------------------------------------------------------
// computeAssetSuitabilityScore (Fatia 2, Bloco 0.1)
// ---------------------------------------------------------------------------------------------

test("computeAssetSuitabilityScore: produto de alto contraste em fundo branco sólido e boa resolução recebe score alto (confiança 'high')", async () => {
  const buffer = await circleOnBackground(300, { r: 255, g: 255, b: 255, alpha: 1 }, { r: 200, g: 40, b: 40 });

  const result = await computeAssetSuitabilityScore(buffer);

  assert.ok(result);
  assert.equal(result.confidence, "high");
  assert.ok(result.score >= 75, `esperava score >= 75, veio ${result.score}`);
  assert.equal(result.dominantBackgroundColor, "#FFFFFF");
  assert.equal(result.widthPx, 800);
  assert.equal(result.heightPx, 800);
  assert.ok(result.factors.edgeUniformity >= 90);
  assert.ok(result.factors.extractionCleanliness > 0);
  assert.ok(result.reasoning.length > 0);
});

test("computeAssetSuitabilityScore: fundo ruidoso/fotográfico (blocos de cor variados) derruba edgeUniformity e o score geral", async () => {
  const noisyBackground = await sharp({
    create: { width: 800, height: 800, channels: 4, background: { r: 30, g: 30, b: 30, alpha: 1 } },
  })
    .composite([
      { input: await solidPng(800, 200, { r: 200, g: 180, b: 40, alpha: 1 }), left: 0, top: 0 },
      { input: await solidPng(800, 200, { r: 10, g: 120, b: 200, alpha: 1 }), left: 0, top: 600 },
      { input: await solidPng(200, 800, { r: 220, g: 20, b: 90, alpha: 1 }), left: 0, top: 0 },
      { input: await solidPng(200, 800, { r: 5, g: 200, b: 90, alpha: 1 }), left: 600, top: 0 },
    ])
    .png()
    .toBuffer();

  const result = await computeAssetSuitabilityScore(noisyBackground);

  assert.ok(result);
  assert.notEqual(result.confidence, "high");
  assert.ok(result.factors.edgeUniformity < 50, `esperava edgeUniformity baixo, veio ${result.factors.edgeUniformity}`);
});

test("computeAssetSuitabilityScore: produto com cor muito parecida com o fundo (baixo contraste) reduz productBackgroundContrast", async () => {
  // Fundo cinza claro, "produto" cinza quase idêntico — risco real do chroma-key remover parte do produto.
  const buffer = await circleOnBackground(300, { r: 235, g: 235, b: 235, alpha: 1 }, { r: 225, g: 225, b: 225 });

  const result = await computeAssetSuitabilityScore(buffer);

  assert.ok(result);
  assert.ok(result.factors.productBackgroundContrast < 40, `esperava contraste baixo, veio ${result.factors.productBackgroundContrast}`);
});

test("computeAssetSuitabilityScore: resolução abaixo do mínimo reduz resolutionAdequacy a 0", async () => {
  const buffer = await circleOnBackground(150, { r: 255, g: 255, b: 255, alpha: 1 }, { r: 200, g: 40, b: 40 }, 400);

  const result = await computeAssetSuitabilityScore(buffer);

  assert.ok(result);
  assert.equal(result.factors.resolutionAdequacy, 0);
});

test("computeAssetSuitabilityScore: resolução no ideal (>=1200px) satura resolutionAdequacy em 100", async () => {
  const buffer = await circleOnBackground(500, { r: 255, g: 255, b: 255, alpha: 1 }, { r: 200, g: 40, b: 40 }, 1200);

  const result = await computeAssetSuitabilityScore(buffer);

  assert.ok(result);
  assert.equal(result.factors.resolutionAdequacy, 100);
});

test("computeAssetSuitabilityScore: bytes inválidos nunca lança, devolve undefined", async () => {
  const result = await computeAssetSuitabilityScore(Buffer.from("not an image"));
  assert.equal(result, undefined);
});

test("computeAssetSuitabilityScore: reasoning sempre identifica o fator mais fraco, nunca genérico", async () => {
  const noisyBackground = await sharp({
    create: { width: 800, height: 800, channels: 4, background: { r: 30, g: 30, b: 30, alpha: 1 } },
  })
    .composite([
      { input: await solidPng(800, 200, { r: 200, g: 180, b: 40, alpha: 1 }), left: 0, top: 0 },
      { input: await solidPng(800, 200, { r: 10, g: 120, b: 200, alpha: 1 }), left: 0, top: 600 },
    ])
    .png()
    .toBuffer();

  const result = await computeAssetSuitabilityScore(noisyBackground);

  assert.ok(result);
  assert.match(result.reasoning, /fator mais fraco/);
});

// ---------------------------------------------------------------------------------------------
// extractProductAsset
// ---------------------------------------------------------------------------------------------

test("extractProductAsset: recorta um produto circular de fundo branco — canto do bounding box vira transparente, centro permanece opaco", async () => {
  const buffer = await circleOnBackground(300, { r: 255, g: 255, b: 255, alpha: 1 }, { r: 200, g: 40, b: 40 });

  const asset = await extractProductAsset(buffer, "#FFFFFF");

  assert.ok(asset);
  const meta = await sharp(asset).metadata();
  assert.equal(meta.width, 300);
  assert.equal(meta.height, 300);
  assert.equal(meta.hasAlpha, true);

  const { data, info } = await sharp(asset).raw().toBuffer({ resolveWithObject: true });
  const pixelAt = (x, y) => {
    const idx = (y * info.width + x) * info.channels;
    return { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] };
  };
  // Canto (fora do círculo, dentro do bounding box quadrado) deveria ter virado transparente.
  assert.equal(pixelAt(2, 2).a, 0, "canto do bounding box deveria estar transparente");
  // Centro (dentro do círculo) deveria continuar opaco e vermelho.
  const center = pixelAt(150, 150);
  assert.ok(center.a > 200, "centro deveria continuar opaco");
  assert.ok(center.r > 150 && center.g < 100, "centro deveria preservar a cor original do produto");
});

test("extractProductAsset: preserva a proporção exata do produto (nunca distorce/redimensiona)", async () => {
  const buffer = await circleOnBackground(240, { r: 255, g: 255, b: 255, alpha: 1 }, { r: 40, g: 40, b: 200 });

  const asset = await extractProductAsset(buffer, "#FFFFFF");

  const meta = await sharp(asset).metadata();
  assert.equal(meta.width, 240);
  assert.equal(meta.height, 240);
});

test("extractProductAsset: cor de fundo fornecida não-hex devolve undefined em vez de lançar", async () => {
  const buffer = await circleOnBackground(300, { r: 255, g: 255, b: 255, alpha: 1 }, { r: 200, g: 40, b: 40 });

  const asset = await extractProductAsset(buffer, "branco");

  assert.equal(asset, undefined);
});

test("extractProductAsset: bytes inválidos nunca lança, devolve undefined", async () => {
  const asset = await extractProductAsset(Buffer.from("not an image"), "#FFFFFF");
  assert.equal(asset, undefined);
});

test("extractProductAsset: quando o 'produto' preenche quase todo o quadro sem cantos de fundo sobrando, ainda é um recorte válido (sem teto de opacidade)", async () => {
  // Retângulo perfeito preenche 100% do bounding box do trim — resultado 100% opaco é legítimo.
  const background = await solidPng(800, 800, { r: 255, g: 255, b: 255, alpha: 1 });
  const product = await solidPng(300, 300, { r: 10, g: 150, b: 10, alpha: 1 });
  const buffer = await sharp(background).composite([{ input: product, left: 250, top: 250 }]).png().toBuffer();

  const asset = await extractProductAsset(buffer, "#FFFFFF");

  assert.ok(asset, "retângulo perfeito não deveria ser rejeitado por 'excesso de opacidade'");
  const { opaque, total } = await countOpaquePixels(asset);
  assert.equal(opaque, total);
});
