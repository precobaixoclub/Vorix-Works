import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import {
  analyzeEditorialBase,
  classifyScreenshot,
  DESKTOP_SCREENSHOT_MIN_DISPLAY_SCALE,
  extractScreenshotPalette,
  findScreenshotDetailRegions,
  measureCompositedAssetFidelity,
  renderEditorialCreative,
  selectDigitalServiceVariant,
  selectInstitutionalVariant,
} from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

// Base OpenAI REAL do cenário B (execution-muzqmi4q-f7qx3f), pixel-idêntica (WebP lossless exact):
// colagem de 4 polaroides recortada sobre transparência (~45% alfa 0, RGB laranja escondido).
const B_BASE = await readFile(new URL("./fixtures/editorial/scenario-b-openai-base.webp", import.meta.url));
const LOGO = await readFile(new URL("./fixtures/editorial/logo-rumo-ao-altar.png", import.meta.url));
// Captura desktop REAL do site (1280x900).
const DESKTOP_SHOT = await readFile(new URL("./fixtures/editorial/screenshot-desktop-presentes.png", import.meta.url));
const PRODUCT = await readFile(new URL("./fixtures/editorial/product-ring-reminder.jpg", import.meta.url));

const COPY_B = {
  headline: "O casamento organizado como vocês sonharam",
  subheadline: "Site, lista de presentes e confirmação de presença em um só lugar.",
  cta: "Conheça o Rumo ao Altar",
};
const COPY_C = {
  headline: "Sua lista de presentes, linda e sem planilha",
  subheadline: "Convidados escolhem, presenteiam e confirmam presença no site do casal.",
  cta: "Criar meu site",
};

function plan(copy, overrides = {}) {
  return {
    objective: "Fixture",
    angle: "Institucional",
    targetAudience: "Casais",
    title: copy.headline,
    description: "Fixture",
    ...copy,
    visualDirection: "Base editorial",
    compositionIntent: "Composição editorial",
    assetUsage: {},
    assetPlacements: [],
    textZones: [],
    allowedRenderedTexts: [copy.headline, copy.subheadline, copy.cta],
    requiredRenderedFacts: [],
    requiredElements: ["headline", "subheadline", "cta", "logo"],
    forbiddenElements: [],
    visualDensity: "balanced",
    styleNotes: "",
    rationale: "",
    artDirection: { primaryMassPct: 50 },
    layoutPlan: [],
    ...overrides,
  };
}

function context() {
  return { brandName: "Rumo ao Altar", objective: "Fixture", channel: "instagram", format: "4:5", ideaText: "", assets: [], confirmedFacts: [] };
}

async function lightBase() {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1280"><rect width="1024" height="1280" fill="#EED8CB"/></svg>`)).jpeg().toBuffer();
}

function renderB(override) {
  return renderEditorialCreative({ baseImageBuffer: B_BASE, context: context(), plan: plan(COPY_B), assets: [{ role: "logo", url: "fixture://logo.png", buffer: LOGO }], qaVariantOverride: override });
}

async function renderC(override, screenshot = DESKTOP_SHOT, option) {
  return renderEditorialCreative({ baseImageBuffer: await lightBase(), context: context(), plan: plan(COPY_C), assets: [{ role: "screenshot", url: "fixture://site.png", buffer: screenshot }, { role: "logo", url: "fixture://logo.png", buffer: LOGO }], qaVariantOverride: override, qaVariantOption: option });
}

// ------------------------------------ institutional -----------------------------------------

test("analyzeEditorialBase (base real de B): colagem com vários focos, transparência registrada, determinística", async () => {
  const first = await analyzeEditorialBase(B_BASE);
  const second = await analyzeEditorialBase(B_BASE);
  assert.deepEqual(first, second);
  assert.ok(first.detailClusters >= 3, JSON.stringify(first));
  assert.ok(first.transparentRatio > 0.35 && first.transparentRatio < 0.55, String(first.transparentRatio));
  assert.ok(first.negativeSpaceRatio < 0.5);
});

test("selectInstitutionalVariant: regras determinísticas pela base e pelo plano", () => {
  const base = { visualDensity: 0.3, negativeSpaceRatio: 0.3, focalConcentration: 0.4, focalPoint: { xPct: 50, yPct: 50 }, detailBox: { xPct: 5, yPct: 5, widthPct: 90, heightPct: 90 }, detailClusters: 1, quietTopPct: 0, quietBottomPct: 0, meanLuma: 0.4, transparentRatio: 0 };
  const signals = { base, headlineChars: 42, subheadlineChars: 66, hasCta: true };
  assert.equal(selectInstitutionalVariant({ ...signals, base: { ...base, detailClusters: 4 } }).variant, "COLLAGE_EDITORIAL");
  assert.equal(selectInstitutionalVariant({ ...signals, base: { ...base, quietBottomPct: 0.35 } }).variant, "FULL_BLEED_EDITORIAL");
  assert.equal(selectInstitutionalVariant({ ...signals, headlineChars: 70 }).variant, "SPLIT_STORY");
  assert.equal(selectInstitutionalVariant({ ...signals, base: { ...base, focalConcentration: 0.6 }, primaryMassPct: 60 }).variant, "FULL_BLEED_EDITORIAL");
  assert.equal(selectInstitutionalVariant(signals).variant, "SPLIT_STORY");
  assert.deepEqual(selectInstitutionalVariant(signals), selectInstitutionalVariant(signals));
});

test("institucional automático (base real de B): escolhe COLLAGE_EDITORIAL e mantém a base inteira", async () => {
  const result = await renderB();
  assert.equal(result.family, "premium_institutional");
  assert.equal(result.composition.variant, "COLLAGE_EDITORIAL");
  assert.equal(result.composition.baseFit.strategy, "CONTAIN_WITH_BACKGROUND");
  assert.equal(result.composition.baseFit.cropLossPct, 0);
});

for (const variant of ["FULL_BLEED_EDITORIAL", "SPLIT_STORY", "COLLAGE_EDITORIAL"]) {
  test(`institucional ${variant}: geometria válida, logo comprovada, sem crop destrutivo, texto exato e ritmo coeso`, async () => {
    const result = await renderB(variant);
    assert.equal(result.composition.variant, variant);
    assert.equal(result.geometry.valid, true, JSON.stringify(result.geometry.issues));
    const logo = result.assetVerification.find((item) => item.role === "logo");
    assert.equal(logo.visible, true);
    assert.equal(logo.fidelityPass, true);
    assert.ok(result.composition.baseFit.cropLossPct <= 0.03, JSON.stringify(result.composition.baseFit));
    assert.ok(result.composition.baseFit.detailRetainedPct >= 0.92);
    assert.ok(result.composition.largestEmptyBandPct <= 0.12, String(result.composition.largestEmptyBandPct));
    assert.ok(["DIRECT", "MULTIPLY_ON_LIGHT", "CHIP"].includes(result.composition.logoTreatment));
    const zones = Object.fromEntries(result.renderedTextZones.map((zone) => [zone.kind, zone.text]));
    assert.deepEqual(zones, { headline: COPY_B.headline, subheadline: COPY_B.subheadline, cta: COPY_B.cta });
    const ctaBox = result.renderedGeometry.textBoxes.find((box) => box.id === "cta");
    assert.equal(ctaBox.text, "CONHEÇA O RUMO AO ALTAR", "CTA editorial em caixa alta (o gate regional reconhece a equivalência)");
  });
}

test("institucional: transparência da base mostra o fundo da peça, nunca o RGB escondido sob alfa 0", async () => {
  const result = await renderB("FULL_BLEED_EDITORIAL");
  const { data } = await sharp(result.buffer).extract({ left: 20, top: 20, width: 8, height: 8 }).raw().toBuffer({ resolveWithObject: true });
  const [r, , b] = data;
  assert.ok(r - b < 80, `canto não pode ser o laranja escondido (r=${r}, b=${b})`);
});

// ------------------------------------ digital_service ---------------------------------------

test("classifyScreenshot: pela proporção real, nunca força mobile", () => {
  assert.equal(classifyScreenshot(1280, 900), "DESKTOP");
  assert.equal(classifyScreenshot(1920, 1080), "DESKTOP");
  assert.equal(classifyScreenshot(390, 844), "MOBILE");
  assert.equal(classifyScreenshot(768, 1024), "TABLET");
  assert.equal(classifyScreenshot(1000, 1000), "OTHER");
  assert.equal(classifyScreenshot(1280, 6000), "OTHER");
});

test("selectDigitalServiceVariant: desktop nunca vira celular; regras determinísticas", () => {
  const base = { classification: "DESKTOP", headlineChars: 44, subheadlineChars: 72, hasPrice: false, detailRegions: 2 };
  assert.equal(selectDigitalServiceVariant(base).variant, "UI_DETAIL_FOCUS");
  assert.equal(selectDigitalServiceVariant({ ...base, detailRegions: 1 }).variant, "UI_HERO");
  assert.equal(selectDigitalServiceVariant({ ...base, headlineChars: 70 }).variant, "UI_HERO");
  assert.equal(selectDigitalServiceVariant({ ...base, visualDensity: "clean" }).variant, "FLOATING_PRODUCT");
  assert.equal(selectDigitalServiceVariant({ ...base, primaryMassPct: 65 }).variant, "UI_HERO");
  assert.equal(selectDigitalServiceVariant({ ...base, classification: "TABLET" }).variant, "FLOATING_PRODUCT");
  assert.equal(selectDigitalServiceVariant({ ...base, classification: "MOBILE" }).variant, "MOBILE_DEVICE");
  assert.deepEqual(selectDigitalServiceVariant(base), selectDigitalServiceVariant(base));
});

test("extractScreenshotPalette: acento vem da interface lisa (botões rosé), não das fotos", async () => {
  const palette = await extractScreenshotPalette(await sharp(DESKTOP_SHOT).ensureAlpha().png().toBuffer());
  const { r, g, b } = palette.accent;
  assert.ok(r > g + 30 && r > b + 20, JSON.stringify(palette.accent));
});

test("findScreenshotDetailRegions: determinístico, dentro da fonte, sem sobreposição e respeitando exclusões", async () => {
  const png = await sharp(DESKTOP_SHOT).ensureAlpha().png().toBuffer();
  const specs = [{ relWidth: 0.28, aspect: 0.82 }, { relWidth: 0.27, aspect: 3.2 }];
  const first = await findScreenshotDetailRegions(png, 1280, 900, specs);
  assert.deepEqual(first, await findScreenshotDetailRegions(png, 1280, 900, specs));
  assert.equal(first.length, 2);
  for (const { rect } of first) assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1280 && rect.y + rect.height <= 900, JSON.stringify(rect));
  const [a, b] = first.map((item) => item.rect);
  assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  const excluded = await findScreenshotDetailRegions(png, 1280, 900, specs, first.map((item) => item.rect));
  for (const { rect } of excluded) assert.ok(!first.some(({ rect: used }) => rect.x < used.x + used.width && rect.x + rect.width > used.x && rect.y < used.y + used.height && rect.y + rect.height > used.y));
});

const DIGITAL_CASES = [
  [undefined, undefined],
  ["UI_HERO", "left"],
  ["UI_HERO", "right"],
  ["UI_DETAIL_FOCUS", "a"],
  ["UI_DETAIL_FOCUS", "b"],
  ["FLOATING_PRODUCT", "light"],
  ["FLOATING_PRODUCT", "dark"],
];

for (const [variant, option] of DIGITAL_CASES) {
  test(`digital desktop ${variant ?? "automático"}${option ? `/${option}` : ""}: screenshot inteiro, sem celular nem chrome, fiel, legível e geometria válida`, async () => {
    const result = await renderC(variant, DESKTOP_SHOT, option);
    assert.equal(result.family, "digital_service");
    assert.equal(result.geometry.valid, true, JSON.stringify(result.geometry.issues));
    const shot = result.composition.screenshot;
    assert.equal(shot.classification, "DESKTOP");
    assert.ok(["EDITORIAL_SURFACE", "FLOATING_SCREEN"].includes(shot.frame));
    assert.notEqual(result.composition.variant, "MOBILE_DEVICE");
    assert.equal(shot.fit, "contain");
    assert.ok(shot.displayScale >= DESKTOP_SCREENSHOT_MIN_DISPLAY_SCALE, String(shot.displayScale));
    const verifications = result.assetVerification.filter((item) => item.role === "screenshot");
    assert.ok(verifications.length >= 1);
    for (const item of verifications) {
      assert.equal(item.visible, true, JSON.stringify(item));
      assert.equal(item.fidelityPass, true, JSON.stringify(item));
    }
    const main = result.renderedAssetPlacements.find((item) => item.role === "screenshot");
    const placedAspect = (main.rect.widthPct * 1080) / (main.rect.heightPct * 1350);
    assert.ok(Math.abs(placedAspect - 1280 / 900) / (1280 / 900) < 0.01, `tela principal sem deformação/crop: ${placedAspect}`);
    assert.ok(result.composition.productVisualProminence >= 0.3, `UI protagonista: ${result.composition.productVisualProminence}`);
    assert.ok(result.composition.largestEmptyBandPct <= 0.12, String(result.composition.largestEmptyBandPct));
    const zones = Object.fromEntries(result.renderedTextZones.map((zone) => [zone.kind, zone.text]));
    assert.deepEqual(zones, { headline: COPY_C.headline, subheadline: COPY_C.subheadline, cta: COPY_C.cta });
    assert.equal(result.renderedGeometry.textBoxes.find((box) => box.id === "cta").text, "CRIAR MEU SITE");
    assert.ok(result.compositedAssetRoles.includes("logo"));
    if (option) assert.equal(shot.option, option);
  });
}

test("digital UI_DETAIL_FOCUS: recortes vêm do screenshot real, rastreáveis (SCREENSHOT_SOURCE + CROP_SOURCE_RECT) e verificados em pixel", async () => {
  for (const option of ["a", "b"]) {
    const result = await renderC("UI_DETAIL_FOCUS", DESKTOP_SHOT, option);
    const crops = result.composition.screenshot.crops;
    assert.equal(crops.length, 2);
    const cropPlacements = result.renderedAssetPlacements.filter((item) => item.role === "screenshot").slice(1);
    assert.equal(cropPlacements.length, 2);
    for (const [index, crop] of crops.entries()) {
      assert.equal(crop.source, "SCREENSHOT_SOURCE");
      assert.equal(crop.url, "fixture://site.png");
      assert.equal(cropPlacements[index].url, "fixture://site.png", "recorte aponta para o MESMO asset (proveniência do gate)");
      assert.ok(crop.zoomVsMain > 1, "detalhe é ampliado em relação à tela");
      const verification = result.assetVerification.find((item) => item.cropSourceRect && item.cropSourceRect.x === crop.cropSourceRect.x && item.cropSourceRect.y === crop.cropSourceRect.y);
      assert.ok(verification?.fidelityPass, JSON.stringify(verification));
      // a região recortada do ORIGINAL bate com os pixels da bbox final
      const fidelity = await measureCompositedAssetFidelity({ finalImage: result.buffer, rect: crop.placedRect, asset: { role: "screenshot", url: "x", buffer: await sharp(DESKTOP_SHOT).extract({ left: crop.cropSourceRect.x, top: crop.cropSourceRect.y, width: crop.cropSourceRect.width, height: crop.cropSourceRect.height }).png().toBuffer() }, fit: "contain", inset: 0.06 });
      assert.equal(fidelity.fidelityPass, true, String(fidelity.fidelityMeanAbsDiff));
    }
    // recortes nunca cobrem a tela principal nem textos
    const main = cropPlacements.length ? result.renderedAssetPlacements[0].rect : undefined;
    for (const placement of cropPlacements) {
      const overlaps = placement.rect.xPct < main.xPct + main.widthPct && placement.rect.xPct + placement.rect.widthPct > main.xPct && placement.rect.yPct < main.yPct + main.heightPct && placement.rect.yPct + placement.rect.heightPct > main.yPct;
      assert.equal(overlaps, false);
    }
  }
});

test("digital: conjuntos de recortes a e b mostram detalhes diferentes", async () => {
  const a = (await renderC("UI_DETAIL_FOCUS", DESKTOP_SHOT, "a")).composition.screenshot.crops.map((crop) => JSON.stringify(crop.cropSourceRect));
  const b = (await renderC("UI_DETAIL_FOCUS", DESKTOP_SHOT, "b")).composition.screenshot.crops.map((crop) => JSON.stringify(crop.cropSourceRect));
  assert.ok(!a.some((rect) => b.includes(rect)));
});

test("digital: recorte com conteúdo trocado reprova a prova em pixel (outro asset na mesma bbox)", async () => {
  const result = await renderC("UI_DETAIL_FOCUS", DESKTOP_SHOT, "a");
  const crop = result.composition.screenshot.crops[0];
  const other = await measureCompositedAssetFidelity({ finalImage: result.buffer, rect: crop.placedRect, asset: { role: "screenshot", url: "x", buffer: PRODUCT }, fit: "contain", inset: 0.06 });
  assert.equal(other.fidelityPass, false, String(other.fidelityMeanAbsDiff));
});

test("digital: fidelidade da tela principal compara contra o screenshot original", async () => {
  const result = await renderC("UI_HERO", DESKTOP_SHOT, "left");
  const placement = result.renderedAssetPlacements.find((item) => item.role === "screenshot");
  const same = await measureCompositedAssetFidelity({ finalImage: result.buffer, rect: placement.rect, asset: { role: "screenshot", url: "x", buffer: DESKTOP_SHOT }, fit: "contain", inset: 0.03 });
  const other = await measureCompositedAssetFidelity({ finalImage: result.buffer, rect: placement.rect, asset: { role: "screenshot", url: "x", buffer: PRODUCT }, fit: "contain", inset: 0.03 });
  assert.equal(same.fidelityPass, true, String(same.fidelityMeanAbsDiff));
  assert.equal(other.fidelityPass, false, String(other.fidelityMeanAbsDiff));
});

test("digital: screenshot desktop largo demais para caber legível vira SCREENSHOT_ILLEGIBLE (nunca encolhe em silêncio)", async () => {
  const wide = await sharp(DESKTOP_SHOT).resize(3000, 1200, { fit: "fill" }).png().toBuffer();
  const result = await renderC("UI_HERO", wide, "left");
  assert.ok(result.geometry.issues.some((issue) => issue.code === "SCREENSHOT_ILLEGIBLE"), JSON.stringify(result.geometry.issues));
});

test("digital: screenshot de celular continua no mockup de aparelho (MOBILE_DEVICE)", async () => {
  const mobile = await sharp(DESKTOP_SHOT).extract({ left: 0, top: 0, width: 400, height: 860 }).png().toBuffer();
  const result = await renderC(undefined, mobile);
  assert.equal(result.composition.variant, "MOBILE_DEVICE");
  assert.equal(result.composition.screenshot.frame, "PHONE_DEVICE");
});
