import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { renderAdCreativeOverlay } from "../dist/infrastructure/rendering/ad-creative-renderer.js";
import { computeContrastRatio } from "../dist/shared/utils/color-contrast.js";

async function makeSolidPng(width, height, color) {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer();
}

function tenisPlan(overrides = {}) {
  return {
    objective: "promocao_oferta",
    creativeType: "oferta",
    primaryHook: "50% OFF - R$39,99",
    heroProduct: "Tênis RV",
    offer: "R$39,99",
    price: "R$ 39,99",
    oldPrice: "R$ 79,99",
    discount: "50%",
    benefits: [],
    trustSignals: [],
    specifications: [],
    urgency: "Oferta Relâmpago",
    cta: "Aproveite agora",
    brandElements: [],
    visualDensity: "performance",
    layoutFamily: "flash_sale",
    informationPriority: ["price", "discount", "cta"],
    ...overrides,
  };
}

function flashSaleLayoutSpec(overrides = {}) {
  return {
    format: "4:5",
    aspectRatio: "4:5",
    layoutFamily: "flash_sale",
    density: "performance",
    zones: [
      { type: "headline", priority: 1, position: { xPct: 6, yPct: 6, widthPct: 88, heightPct: 16 } },
      { type: "price", priority: 1, position: { xPct: 6, yPct: 60, widthPct: 44, heightPct: 16 } },
      { type: "discount", priority: 1, position: { xPct: 6, yPct: 40, widthPct: 30, heightPct: 14 } },
      { type: "cta", priority: 2, position: { xPct: 6, yPct: 84, widthPct: 88, heightPct: 10 } },
    ],
    ...overrides,
  };
}

test("renderAdCreativeOverlay: mantém as dimensões da imagem base e devolve PNG válido", async () => {
  const baseImageBuffer = await makeSolidPng(1024, 1280, { r: 30, g: 90, b: 60, alpha: 1 });

  const result = await renderAdCreativeOverlay({ baseImageBuffer, adLayoutSpec: flashSaleLayoutSpec(), plan: tenisPlan() });
  const meta = await sharp(result.buffer).metadata();

  assert.equal(meta.format, "png");
  assert.equal(meta.width, 1024);
  assert.equal(meta.height, 1280);
});

test("renderAdCreativeOverlay: o resultado difere da base (as zonas foram de fato compostas)", async () => {
  const baseImageBuffer = await makeSolidPng(1024, 1280, { r: 30, g: 90, b: 60, alpha: 1 });

  const result = await renderAdCreativeOverlay({ baseImageBuffer, adLayoutSpec: flashSaleLayoutSpec(), plan: tenisPlan() });

  assert.notEqual(Buffer.compare(result.buffer, baseImageBuffer), 0);
});

test("renderAdCreativeOverlay: devolve a geometria de tipografia exata usada por zona, uma entrada por zona resolvida", async () => {
  const baseImageBuffer = await makeSolidPng(1024, 1280, { r: 30, g: 90, b: 60, alpha: 1 });

  const result = await renderAdCreativeOverlay({ baseImageBuffer, adLayoutSpec: flashSaleLayoutSpec(), plan: tenisPlan() });

  assert.equal(result.typographyGeometry.length, 4);
  const types = result.typographyGeometry.map((entry) => entry.type);
  assert.deepEqual(types.sort(), ["cta", "discount", "headline", "price"]);
  for (const entry of result.typographyGeometry) {
    assert.ok(entry.fontSizePx > 0, `${entry.type}: fontSizePx deveria ser positivo`);
    assert.ok(entry.widthPx > 0 && entry.heightPx > 0);
  }
});

test("renderAdCreativeOverlay: preço/desconto/CTA nunca vazam da caixa — fontSize nunca excede o que cabe na largura disponível (regressão do bug de overflow achado ao vivo)", async () => {
  const baseImageBuffer = await makeSolidPng(1024, 1280, { r: 30, g: 90, b: 60, alpha: 1 });
  // Preço propositalmente longo — caso que originalmente vazava da caixa antes do fix de
  // `fitFontSizeToBox`.
  const plan = tenisPlan({ price: "R$ 1.239,99", oldPrice: "R$ 2.499,90" });

  const result = await renderAdCreativeOverlay({ baseImageBuffer, adLayoutSpec: flashSaleLayoutSpec(), plan });

  const priceEntry = result.typographyGeometry.find((entry) => entry.type === "price");
  assert.ok(priceEntry);
  // Estimativa conservadora: largura em px dividida pela largura média de caractere (~0.58 do
  // fontSize) deveria comportar o texto mais longo ("R$ 1.239,99", 12 caracteres) sem estourar.
  const estimatedTextWidth = priceEntry.fontSizePx * 0.58 * "R$ 1.239,99".length;
  assert.ok(estimatedTextWidth <= priceEntry.widthPx * 1.05, `texto do preço (${estimatedTextWidth}px estimados) não deveria exceder a largura da caixa (${priceEntry.widthPx}px)`);
});

test("renderAdCreativeOverlay: zonas sem fato correspondente no plano são ignoradas (nunca renderiza caixa vazia)", async () => {
  const baseImageBuffer = await makeSolidPng(1024, 1280, { r: 30, g: 90, b: 60, alpha: 1 });
  const plan = tenisPlan({ price: undefined, discount: undefined });

  const result = await renderAdCreativeOverlay({ baseImageBuffer, adLayoutSpec: flashSaleLayoutSpec(), plan });

  const types = result.typographyGeometry.map((entry) => entry.type);
  assert.equal(types.includes("price"), false);
  assert.equal(types.includes("discount"), false);
});

test("renderAdCreativeOverlay: nenhuma zona renderer-owned resolvida devolve a imagem base intocada", async () => {
  const baseImageBuffer = await makeSolidPng(1024, 1280, { r: 30, g: 90, b: 60, alpha: 1 });
  const emptyPlan = tenisPlan({ price: undefined, oldPrice: undefined, discount: undefined, primaryHook: undefined, cta: undefined, urgency: undefined });
  const emptySpec = { format: "4:5", aspectRatio: "4:5", layoutFamily: "flash_sale", density: "clean", zones: [] };

  const result = await renderAdCreativeOverlay({ baseImageBuffer, adLayoutSpec: emptySpec, plan: emptyPlan });

  assert.equal(Buffer.compare(result.buffer, baseImageBuffer), 0);
  assert.deepEqual(result.typographyGeometry, []);
});

test("renderAdCreativeOverlay: CTA se adapta a um accentColor escuro (regressão achada em geração real — texto escuro sobre indigo reprovava o quality gate de contraste)", async () => {
  const baseImageBuffer = await makeSolidPng(1024, 1280, { r: 30, g: 90, b: 60, alpha: 1 });
  const plan = tenisPlan({ price: undefined, oldPrice: undefined, discount: undefined, primaryHook: undefined, urgency: undefined });
  const spec = { format: "4:5", aspectRatio: "4:5", layoutFamily: "flash_sale", density: "performance", zones: [
    { type: "cta", priority: 1, position: { xPct: 6, yPct: 84, widthPct: 88, heightPct: 10 } },
  ] };

  const result = await renderAdCreativeOverlay({ baseImageBuffer, adLayoutSpec: spec, plan, brandColors: { accentColor: "#4338CA" } });

  const ctaEntry = result.typographyGeometry.find((entry) => entry.type === "cta");
  assert.ok(ctaEntry);
  assert.equal(ctaEntry.backgroundColor, "#4338CA");
  const ratio = computeContrastRatio(ctaEntry.textColor, ctaEntry.backgroundColor);
  assert.ok(ratio >= 4.5, `contraste do CTA (${ratio}:1) deveria atingir WCAG AA (4.5:1) mesmo com accent escuro`);
});

test("renderAdCreativeOverlay: preço cai para preto/branco quando accentColor não contrasta com backgroundColor", async () => {
  const baseImageBuffer = await makeSolidPng(1024, 1280, { r: 30, g: 90, b: 60, alpha: 1 });
  const plan = tenisPlan({ discount: undefined, primaryHook: undefined, cta: undefined, urgency: undefined });
  const spec = { format: "4:5", aspectRatio: "4:5", layoutFamily: "flash_sale", density: "performance", zones: [
    { type: "price", priority: 1, position: { xPct: 6, yPct: 60, widthPct: 44, heightPct: 16 } },
  ] };

  // Accent quase branco sobre fundo branco — par que a marca poderia escolher e que não contrasta.
  const result = await renderAdCreativeOverlay({ baseImageBuffer, adLayoutSpec: spec, plan, brandColors: { accentColor: "#FDFDFD", backgroundColor: "#FFFFFF" } });

  const priceEntry = result.typographyGeometry.find((entry) => entry.type === "price");
  assert.ok(priceEntry);
  const ratio = computeContrastRatio(priceEntry.textColor, priceEntry.backgroundColor);
  assert.ok(ratio >= 4.5, `contraste do preço (${ratio}:1) deveria atingir WCAG AA (4.5:1) mesmo com accent quase idêntico ao fundo`);
});

test("renderAdCreativeOverlay: headline sempre usa scrim escuro + texto branco (regressão achada em geração real — texto escuro direto sobre foto ficava quase invisível)", async () => {
  const baseImageBuffer = await makeSolidPng(1024, 1280, { r: 10, g: 20, b: 80, alpha: 1 });
  const plan = tenisPlan({ price: undefined, oldPrice: undefined, discount: undefined, cta: undefined, urgency: undefined });
  const spec = { format: "4:5", aspectRatio: "4:5", layoutFamily: "flash_sale", density: "performance", zones: [
    { type: "headline", priority: 1, position: { xPct: 6, yPct: 6, widthPct: 88, heightPct: 16 } },
  ] };

  const result = await renderAdCreativeOverlay({ baseImageBuffer, adLayoutSpec: spec, plan });

  const headlineEntry = result.typographyGeometry.find((entry) => entry.type === "headline");
  assert.ok(headlineEntry);
  assert.equal(headlineEntry.textColor, "#FFFFFF");
  assert.ok(headlineEntry.backgroundColor.includes("rgba(0, 0, 0"), `headline deveria ter um scrim escuro, veio "${headlineEntry.backgroundColor}"`);
});

test("renderAdCreativeOverlay: rejeita quando a imagem base não tem metadados de dimensão válidos", async () => {
  await assert.rejects(() =>
    renderAdCreativeOverlay({ baseImageBuffer: Buffer.from("not an image"), adLayoutSpec: flashSaleLayoutSpec(), plan: tenisPlan() }),
  );
});
