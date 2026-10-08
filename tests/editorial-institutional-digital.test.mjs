import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import {
  analyzeEditorialBase,
  classifyScreenshot,
  DESKTOP_SCREENSHOT_MIN_DISPLAY_SCALE,
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

async function renderC(override, screenshot = DESKTOP_SHOT) {
  return renderEditorialCreative({ baseImageBuffer: await lightBase(), context: context(), plan: plan(COPY_C), assets: [{ role: "screenshot", url: "fixture://site.png", buffer: screenshot }, { role: "logo", url: "fixture://logo.png", buffer: LOGO }], qaVariantOverride: override });
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
  const base = { classification: "DESKTOP", headlineChars: 44, subheadlineChars: 72, hasPrice: false };
  assert.equal(selectDigitalServiceVariant(base).variant, "DESKTOP_HERO");
  assert.equal(selectDigitalServiceVariant({ ...base, headlineChars: 30 }).variant, "SPLIT_PRODUCT_UI");
  assert.equal(selectDigitalServiceVariant({ ...base, visualDensity: "clean", headlineChars: 38 }).variant, "FLOATING_BROWSER");
  assert.equal(selectDigitalServiceVariant({ ...base, primaryMassPct: 65, headlineChars: 20 }).variant, "DESKTOP_HERO");
  assert.equal(selectDigitalServiceVariant({ ...base, classification: "TABLET" }).variant, "FLOATING_BROWSER");
  assert.equal(selectDigitalServiceVariant({ ...base, classification: "MOBILE" }).variant, "MOBILE_DEVICE");
});

for (const variant of [undefined, "DESKTOP_HERO", "SPLIT_PRODUCT_UI", "FLOATING_BROWSER"]) {
  test(`digital desktop ${variant ?? "automático"}: screenshot real inteiro, sem celular, fiel e legível`, async () => {
    const result = await renderC(variant);
    assert.equal(result.family, "digital_service");
    assert.equal(result.geometry.valid, true, JSON.stringify(result.geometry.issues));
    const shot = result.composition.screenshot;
    assert.equal(shot.classification, "DESKTOP");
    assert.notEqual(shot.frame, "PHONE_DEVICE");
    assert.notEqual(result.composition.variant, "MOBILE_DEVICE");
    assert.equal(shot.fit, "contain");
    assert.ok(shot.displayScale >= DESKTOP_SCREENSHOT_MIN_DISPLAY_SCALE, String(shot.displayScale));
    const verification = result.assetVerification.find((item) => item.role === "screenshot");
    assert.equal(verification.visible, true);
    assert.equal(verification.fidelityPass, true);
    const placement = result.renderedAssetPlacements.find((item) => item.role === "screenshot");
    const placedAspect = (placement.rect.widthPct * 1080) / (placement.rect.heightPct * 1350);
    assert.ok(Math.abs(placedAspect - 1280 / 900) / (1280 / 900) < 0.01, `sem deformação/crop: ${placedAspect}`);
  });
}

test("digital: fidelidade compara contra o screenshot original (outro asset na mesma bbox reprova)", async () => {
  const result = await renderC("DESKTOP_HERO");
  const placement = result.renderedAssetPlacements.find((item) => item.role === "screenshot");
  const same = await measureCompositedAssetFidelity({ finalImage: result.buffer, rect: placement.rect, asset: { role: "screenshot", url: "x", buffer: DESKTOP_SHOT }, fit: "contain", inset: 0.03 });
  const other = await measureCompositedAssetFidelity({ finalImage: result.buffer, rect: placement.rect, asset: { role: "screenshot", url: "x", buffer: PRODUCT }, fit: "contain", inset: 0.03 });
  assert.equal(same.fidelityPass, true, String(same.fidelityMeanAbsDiff));
  assert.equal(other.fidelityPass, false, String(other.fidelityMeanAbsDiff));
});

test("digital: screenshot desktop largo demais para caber legível vira SCREENSHOT_ILLEGIBLE (nunca encolhe em silêncio)", async () => {
  const wide = await sharp(DESKTOP_SHOT).resize(3000, 1200, { fit: "fill" }).png().toBuffer();
  const result = await renderC("DESKTOP_HERO", wide);
  assert.ok(result.geometry.issues.some((issue) => issue.code === "SCREENSHOT_ILLEGIBLE"), JSON.stringify(result.geometry.issues));
});

test("digital: screenshot de celular continua no mockup de aparelho (MOBILE_DEVICE)", async () => {
  const mobile = await sharp(DESKTOP_SHOT).extract({ left: 0, top: 0, width: 400, height: 860 }).png().toBuffer();
  const result = await renderC(undefined, mobile);
  assert.equal(result.composition.variant, "MOBILE_DEVICE");
  assert.equal(result.composition.screenshot.frame, "PHONE_DEVICE");
});
