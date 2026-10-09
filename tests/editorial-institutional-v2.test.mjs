import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import {
  analyzeEditorialBase,
  classifyEditorialBase,
  renderEditorialCreative,
  selectInstitutionalEditorialVariant,
} from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

// Base REAL aprovada do cenário B (execution-mv0m68op-4z3oek), pixel-idêntica: fotografia única.
const APPROVED_BASE = await readFile(new URL("./fixtures/editorial/scenario-b-db3a574-base.webp", import.meta.url));
// Base REAL do 1º cenário B: colagem de polaroides recortada sobre transparência.
const POLAROID_COLLAGE = await readFile(new URL("./fixtures/editorial/scenario-b-openai-base.webp", import.meta.url));
const PRODUCT_PHOTO = await readFile(new URL("./fixtures/editorial/product-ring-reminder.jpg", import.meta.url));
const LOGO = await readFile(new URL("./fixtures/editorial/logo-rumo-ao-altar.png", import.meta.url));

const COPY = {
  headline: "O casamento organizado como vocês sonharam",
  subheadline: "Site, lista de presentes e confirmação de presença em um só lugar.",
  cta: "Conheça o Rumo ao Altar",
};

function plan(overrides = {}) {
  return {
    objective: "x", angle: "x", targetAudience: "x", title: COPY.headline, description: "x", ...COPY,
    visualDirection: "x", compositionIntent: "x", assetUsage: {}, assetPlacements: [], textZones: [],
    allowedRenderedTexts: [COPY.headline, COPY.subheadline, COPY.cta], requiredRenderedFacts: [], requiredElements: ["headline", "subheadline", "cta", "logo"],
    forbiddenElements: [], visualDensity: "balanced", styleNotes: "", rationale: "", artDirection: { primaryMassPct: 60 }, layoutPlan: [], ...overrides,
  };
}

function render(baseImageBuffer, override, planOverrides) {
  return renderEditorialCreative({
    baseImageBuffer,
    context: { brandName: "Marca", objective: "x", channel: "instagram", format: "4:5", ideaText: "", assets: [], confirmedFacts: [] },
    plan: plan(planOverrides),
    assets: [{ role: "logo", url: "fixture://logo.png", buffer: LOGO }],
    qaVariantOverride: override,
  });
}

async function classOf(buffer) {
  return (await analyzeEditorialBase(await sharp(buffer).png().toBuffer())).visualClass;
}

// ------------------------------------ classificação --------------------------------------------

test("classificação: fotografia única rica em focos é SINGLE_SCENE_PHOTO (não colagem)", async () => {
  const analysis = await analyzeEditorialBase(await sharp(APPROVED_BASE).png().toBuffer());
  assert.ok(analysis.detailClusters >= 3, "tem vários focos de detalhe");
  assert.equal(analysis.visualClass, "SINGLE_SCENE_PHOTO");
  assert.equal(await classOf(PRODUCT_PHOTO), "SINGLE_SCENE_PHOTO");
});

test("classificação: peças separadas por fundo transparente ou liso são COLLAGE", async () => {
  assert.equal(await classOf(POLAROID_COLLAGE), "COLLAGE");
  // Colagem opaca: 4 fotos reais sobre fundo liso.
  const tile = await sharp(PRODUCT_PHOTO).resize(360, 360).jpeg().toBuffer();
  const collage = await sharp({ create: { width: 1024, height: 1280, channels: 3, background: "#E8D9C8" } })
    .composite([{ input: tile, left: 80, top: 120 }, { input: tile, left: 584, top: 160 }, { input: tile, left: 90, top: 720 }, { input: tile, left: 570, top: 760 }])
    .jpeg().toBuffer();
  assert.equal(await classOf(collage), "COLLAGE");
});

test("classificação: painéis com divisória reta de ponta a ponta são MULTI_PANEL; arte chapada é ILLUSTRATION", async () => {
  const top = await sharp(PRODUCT_PHOTO).resize(1024, 630, { fit: "cover" }).jpeg().toBuffer();
  const bottom = await sharp(APPROVED_BASE).resize(1024, 630, { fit: "cover" }).jpeg().toBuffer();
  const panels = await sharp({ create: { width: 1024, height: 1280, channels: 3, background: "#FFFFFF" } })
    .composite([{ input: top, left: 0, top: 0 }, { input: bottom, left: 0, top: 650 }])
    .png().toBuffer();
  assert.equal(await classOf(panels), "MULTI_PANEL");
  const flat = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1280"><rect width="1024" height="1280" fill="#F4E3C9"/><circle cx="512" cy="520" r="300" fill="#C9744A"/><rect x="200" y="900" width="624" height="120" fill="#2E4057"/></svg>`)).png().toBuffer();
  assert.equal(await classOf(flat), "ILLUSTRATION");
});

test("classifyEditorialBase: contagem de focos sozinha nunca vira colagem", () => {
  const base = { visualDensity: 0.8, negativeSpaceRatio: 0.05, focalConcentration: 0.4, focalPoint: { xPct: 50, yPct: 50 }, detailBox: { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }, detailClusters: 12, quietTopPct: 0, quietBottomPct: 0, meanLuma: 0.4, transparentRatio: 0, backgroundSeparatorRatio: 0.02, largestClusterShare: 0.3, straightDividers: 0, colorBuckets90: 80 };
  assert.equal(classifyEditorialBase(base), "SINGLE_SCENE_PHOTO");
  assert.equal(classifyEditorialBase({ ...base, backgroundSeparatorRatio: 0.4 }), "COLLAGE");
});

// ------------------------------------ seleção ---------------------------------------------------

test("seleção institucional: determinística, por classe e forma da cena — nunca pelo tema", () => {
  const base = { visualDensity: 0.8, negativeSpaceRatio: 0.05, focalConcentration: 0.4, focalPoint: { xPct: 50, yPct: 50 }, detailBox: { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }, detailClusters: 5, quietTopPct: 0, quietBottomPct: 0, meanLuma: 0.4, transparentRatio: 0 };
  const signals = { base, visualClass: "SINGLE_SCENE_PHOTO", headlineChars: 42, subheadlineChars: 66, hasSubheadline: true, visualDensity: "balanced" };
  assert.equal(selectInstitutionalEditorialVariant(signals).variant, "PHOTO_DOMINANT_EDITORIAL");
  assert.equal(selectInstitutionalEditorialVariant({ ...signals, visualClass: "COLLAGE" }).variant, "COLLAGE_EDITORIAL");
  assert.equal(selectInstitutionalEditorialVariant({ ...signals, visualClass: "MULTI_PANEL" }).variant, "COLLAGE_EDITORIAL");
  assert.equal(selectInstitutionalEditorialVariant({ ...signals, base: { ...base, quietBottomPct: 0.3 } }).variant, "FULL_BLEED_STORY");
  assert.equal(selectInstitutionalEditorialVariant({ ...signals, visualDensity: "clean" }).variant, "MINIMAL_PREMIUM");
  assert.equal(selectInstitutionalEditorialVariant({ ...signals, base: { ...base, focalPoint: { xPct: 64, yPct: 50 } } }).variant, "ASYMMETRIC_LUXURY");
  assert.deepEqual(selectInstitutionalEditorialVariant(signals), selectInstitutionalEditorialVariant(signals));
});

test("automático na base real aprovada: SINGLE_SCENE_PHOTO, nunca COLLAGE_EDITORIAL", async () => {
  const result = await render(APPROVED_BASE);
  assert.equal(result.composition.baseVisualClass, "SINGLE_SCENE_PHOTO");
  assert.notEqual(result.composition.variant, "COLLAGE_EDITORIAL");
  assert.ok(result.composition.selectionReasons[0].startsWith("SINGLE_SCENE_PHOTO"));
});

test("automático na colagem real: continua COLLAGE_EDITORIAL (base inteira)", async () => {
  const result = await render(POLAROID_COLLAGE);
  assert.equal(result.composition.baseVisualClass, "COLLAGE");
  assert.equal(result.composition.variant, "COLLAGE_EDITORIAL");
  assert.equal(result.geometry.valid, true, JSON.stringify(result.geometry.issues));
});

// ------------------------------------ variantes -------------------------------------------------

for (const variant of ["PHOTO_DOMINANT_EDITORIAL", "ASYMMETRIC_LUXURY", "FULL_BLEED_STORY", "MINIMAL_PREMIUM"]) {
  test(`${variant}: geometria válida, logo fiel, texto exato, headline fora do eixo central, foto sem deformação`, async () => {
    const result = await render(APPROVED_BASE, variant);
    const composition = result.composition;
    assert.equal(composition.variant, variant);
    assert.equal(result.geometry.valid, true, JSON.stringify(result.geometry.issues));
    const logo = result.assetVerification.find((item) => item.role === "logo");
    assert.equal(logo.visible, true);
    assert.equal(logo.fidelityPass, true);
    assert.ok(["LOGO_DIRECT_LIGHT", "LOGO_DIRECT_DARK", "LOGO_SOFT_PLATE", "LOGO_HAIRLINE_PLATE"].includes(composition.logoTreatment), composition.logoTreatment);
    assert.ok(["SOLID_PREMIUM", "OUTLINE_EDITORIAL", "TEXT_HAIRLINE", "COMPACT_PILL"].includes(composition.ctaTreatment), composition.ctaTreatment);
    const zones = Object.fromEntries(result.renderedTextZones.map((zone) => [zone.kind, zone.text]));
    assert.deepEqual(zones, { headline: COPY.headline, subheadline: COPY.subheadline, cta: COPY.cta });
    const head = result.renderedGeometry.textBoxes.find((box) => box.id === "headline");
    const headCentre = head.rect.xPct + head.rect.widthPct / 2;
    assert.ok(Math.abs(headCentre - 50) > 4, `headline não centralizada por padrão (${headCentre.toFixed(1)}%)`);
    assert.ok(["FULL_BLEED", "COVER_FOCAL_SAFE_CROP", "CONTAIN_WITH_BACKGROUND"].includes(composition.baseFit.strategy));
    assert.ok(composition.baseFit.cropLossPct <= 0.32, JSON.stringify(composition.baseFit));
    assert.ok(composition.largestEmptyBandPct <= 0.12, String(composition.largestEmptyBandPct));
  });
}

test("imagem protagonista: 55–70% do canvas nas variantes com superfície; tela cheia no FULL_BLEED_STORY", async () => {
  for (const variant of ["PHOTO_DOMINANT_EDITORIAL", "ASYMMETRIC_LUXURY", "MINIMAL_PREMIUM"]) {
    const prominence = (await render(APPROVED_BASE, variant)).composition.productVisualProminence;
    assert.ok(prominence >= 0.55 && prominence <= 0.7, `${variant}: ${prominence}`);
  }
  assert.equal((await render(APPROVED_BASE, "FULL_BLEED_STORY")).composition.productVisualProminence, 1);
});

test("logo: direto na superfície clara (sem plaquinha); placa suave só no escuro; placa com fio sobre a foto", async () => {
  assert.equal((await render(APPROVED_BASE, "PHOTO_DOMINANT_EDITORIAL")).composition.logoTreatment, "LOGO_DIRECT_LIGHT");
  assert.equal((await render(APPROVED_BASE, "MINIMAL_PREMIUM")).composition.logoTreatment, "LOGO_DIRECT_LIGHT");
  assert.equal((await render(APPROVED_BASE, "ASYMMETRIC_LUXURY")).composition.logoTreatment, "LOGO_SOFT_PLATE");
  assert.equal((await render(APPROVED_BASE, "FULL_BLEED_STORY")).composition.logoTreatment, "LOGO_HAIRLINE_PLATE");
});

test("CTA: tratamentos editoriais distintos por variante e sempre dentro da safe area", async () => {
  const treatments = {};
  for (const variant of ["PHOTO_DOMINANT_EDITORIAL", "ASYMMETRIC_LUXURY", "FULL_BLEED_STORY", "MINIMAL_PREMIUM"]) {
    const result = await render(APPROVED_BASE, variant);
    treatments[variant] = result.composition.ctaTreatment;
    const cta = result.renderedGeometry.textBoxes.find((box) => box.id === "cta");
    assert.equal(cta.text, "CONHEÇA O RUMO AO ALTAR");
    assert.ok(cta.rect.xPct >= 2 && cta.rect.xPct + cta.rect.widthPct <= 98, JSON.stringify(cta.rect));
  }
  assert.deepEqual(treatments, { PHOTO_DOMINANT_EDITORIAL: "SOLID_PREMIUM", ASYMMETRIC_LUXURY: "TEXT_HAIRLINE", FULL_BLEED_STORY: "OUTLINE_EDITORIAL", MINIMAL_PREMIUM: "TEXT_HAIRLINE" });
});

test("headline longa não estoura: linhas adaptam ao tamanho da copy", async () => {
  const headline = "Uma presença de marca mais elegante para casamentos memoráveis";
  for (const variant of ["PHOTO_DOMINANT_EDITORIAL", "MINIMAL_PREMIUM", "ASYMMETRIC_LUXURY", "FULL_BLEED_STORY"]) {
    const result = await render(APPROVED_BASE, variant, { headline, title: headline, allowedRenderedTexts: [headline, COPY.subheadline, COPY.cta] });
    assert.equal(result.geometry.valid, true, `${variant}: ${JSON.stringify(result.geometry.issues)}`);
  }
});

// ------------------------------------ separador semântico (bokeh × fundo de colagem) ------------
// Achado do cenário B real execution-mv0uvicq-9ca5dd: fotografia única com fundo desfocado foi
// classificada COLLAGE porque pouca borda era tratada como fundo separador.

const FLOWERS_BASE = await readFile(new URL("./fixtures/editorial/scenario-b-4f4d604-base.webp", import.meta.url));

async function analysisOf(buffer) {
  return analyzeEditorialBase(await sharp(buffer).png().toBuffer());
}

async function withGrain(svg, sigma = 6) {
  const base = sharp(Buffer.from(svg));
  const meta = await base.metadata();
  const noise = await sharp({ create: { width: meta.width, height: meta.height, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma } } }).png().toBuffer();
  return sharp(Buffer.from(svg)).composite([{ input: noise, blend: "soft-light" }]).png().toBuffer();
}

const SUBJECT = await sharp(PRODUCT_PHOTO).resize(420, 420).png().toBuffer();

const MATRIX = {
  // A) foto única + bokeh: gradiente quente + círculos desfocados + objetos nítidos pequenos.
  bokeh: async () => {
    const bg = await withGrain(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1280"><defs><radialGradient id="g" cx="0.6" cy="0.35" r="0.9"><stop offset="0" stop-color="#E9C46A"/><stop offset="0.6" stop-color="#9C6B22"/><stop offset="1" stop-color="#3B2410"/></radialGradient><filter id="b"><feGaussianBlur stdDeviation="28"/></filter></defs><rect width="1024" height="1280" fill="url(#g)"/><g filter="url(#b)" opacity="0.8">${[[200, 240, 70], [760, 180, 90], [640, 760, 110], [180, 1000, 80], [880, 1100, 70]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#FFE4A0"/>`).join("")}</g></svg>`);
    return sharp(bg).composite([{ input: await sharp(SUBJECT).resize(220, 220).png().toBuffer(), left: 160, top: 300 }, { input: await sharp(SUBJECT).resize(200, 200).png().toBuffer(), left: 640, top: 520 }, { input: await sharp(SUBJECT).resize(180, 180).png().toBuffer(), left: 300, top: 900 }]).png().toBuffer();
  },
  // B) foto única + céu suave: gradiente vertical azul + nuvens desfocadas + silhueta nítida embaixo.
  sky: async () => withGrain(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1280"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1E4E8C"/><stop offset="0.7" stop-color="#8FB8E0"/><stop offset="1" stop-color="#F2D7B0"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="30"/></filter></defs><rect width="1024" height="1280" fill="url(#s)"/><g filter="url(#b)" opacity="0.6"><ellipse cx="300" cy="300" rx="220" ry="60" fill="#FFFFFF"/><ellipse cx="760" cy="520" rx="260" ry="70" fill="#FFFFFF"/></g><path d="M0 1280 L0 1060 L120 1060 L120 980 L260 980 L260 1100 L420 1100 L420 940 L560 940 L560 1040 L760 1040 L760 900 L900 900 L900 1080 L1024 1080 L1024 1280 Z" fill="#14213D"/>${Array.from({ length: 24 }, (_, i) => `<rect x="${140 + (i % 8) * 100}" y="${1000 + Math.floor(i / 8) * 60}" width="14" height="22" fill="#F4D58D"/>`).join("")}</svg>`),
  // C) foto única + parede lisa iluminada (queda de luz) + um sujeito.
  wall: async () => {
    const wall = await withGrain(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1280"><defs><radialGradient id="w" cx="0.2" cy="0.15" r="1.2"><stop offset="0" stop-color="#EFE6D8"/><stop offset="1" stop-color="#9E8A72"/></radialGradient></defs><rect width="1024" height="1280" fill="url(#w)"/></svg>`);
    return sharp(wall).composite([{ input: SUBJECT, left: 300, top: 560 }]).png().toBuffer();
  },
  // D) polaroides (foto + borda branca) sobre fundo liso.
  polaroids: async () => {
    const card = await sharp({ create: { width: 400, height: 470, channels: 3, background: "#FBF8F2" } }).composite([{ input: await sharp(SUBJECT).resize(360, 360).png().toBuffer(), left: 20, top: 20 }]).png().toBuffer();
    return sharp({ create: { width: 1024, height: 1280, channels: 3, background: "#C9A27E" } }).composite([{ input: card, left: 60, top: 80 }, { input: card, left: 560, top: 140 }, { input: card, left: 80, top: 700 }, { input: card, left: 570, top: 740 }]).png().toBuffer();
  },
  // E) 4 cards isolados em canvas branco.
  cards: async () => {
    const card = await sharp(SUBJECT).resize(380, 300, { fit: "cover" }).png().toBuffer();
    return sharp({ create: { width: 1024, height: 1280, channels: 3, background: "#FFFFFF" } }).composite([{ input: card, left: 70, top: 120 }, { input: card, left: 574, top: 120 }, { input: card, left: 70, top: 760 }, { input: card, left: 574, top: 760 }]).png().toBuffer();
  },
  // F) split screen vertical (duas fotos com calha estreita).
  split: async () => {
    const left = await sharp(PRODUCT_PHOTO).resize(506, 1280, { fit: "cover" }).png().toBuffer();
    const right = await sharp(APPROVED_BASE).resize(506, 1280, { fit: "cover" }).png().toBuffer();
    return sharp({ create: { width: 1024, height: 1280, channels: 3, background: "#FFFFFF" } }).composite([{ input: left, left: 0, top: 0 }, { input: right, left: 518, top: 0 }]).png().toBuffer();
  },
  // H) peças isoladas sobre transparência (stickers).
  stickers: async () => {
    const piece = await sharp(SUBJECT).resize(150, 150).png().toBuffer();
    const composites = Array.from({ length: 12 }, (_, i) => ({ input: piece, left: 60 + (i % 4) * 240, top: 80 + Math.floor(i / 4) * 400 }));
    return sharp({ create: { width: 1024, height: 1280, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composites).png().toBuffer();
  },
};

test("matriz A–H: separador semântico distingue fundo fotográfico suave de fundo de colagem", async () => {
  const expected = {
    bokeh: ["SINGLE_SCENE_PHOTO"],
    sky: ["SINGLE_SCENE_PHOTO"],
    wall: ["SINGLE_SCENE_PHOTO"],
    polaroids: ["COLLAGE", "ASSET_SHEET"],
    cards: ["COLLAGE", "ASSET_SHEET"],
    split: ["MULTI_PANEL"],
    stickers: ["COLLAGE", "ASSET_SHEET"],
  };
  for (const [name, build] of Object.entries(MATRIX)) {
    const analysis = await analysisOf(await build());
    assert.ok(expected[name].includes(analysis.visualClass), `${name}: ${analysis.visualClass} ${JSON.stringify({ cand: analysis.backgroundSeparatorRatio, flat: analysis.flatSeparatorRatio, conf: analysis.separatorConfidence, variation: analysis.separatorColorVariation, panels: analysis.contentPanelCount, comps: analysis.contentComponentCount, div: analysis.straightDividers, reasons: analysis.classificationReasons })}`);
    assert.ok(analysis.classificationReasons.length > 0);
  }
});

test("bases reais: flores com bokeh e espelho = SINGLE_SCENE_PHOTO; polaroides e recorte = COLLAGE; produto rico = SINGLE_SCENE_PHOTO", async () => {
  const flowers = await analysisOf(FLOWERS_BASE);
  assert.equal(flowers.visualClass, "SINGLE_SCENE_PHOTO", JSON.stringify(flowers));
  assert.ok(flowers.backgroundSeparatorRatio >= 0.2, "a região de pouca borda continua existindo (candidato)");
  assert.ok(flowers.separatorConfidence < 0.6 && flowers.separatorColorVariation > 32, "mas tem gradiente fotográfico de cor/luz");
  assert.equal(flowers.flatSeparatorRatio, 0);
  assert.match(flowers.classificationReasons.join(" "), /gradiente fotográfico/);
  assert.equal((await analysisOf(APPROVED_BASE)).visualClass, "SINGLE_SCENE_PHOTO");
  assert.equal((await analysisOf(PRODUCT_PHOTO)).visualClass, "SINGLE_SCENE_PHOTO");
  const polaroid = await analysisOf(POLAROID_COLLAGE);
  assert.equal(polaroid.visualClass, "COLLAGE");
  assert.match(polaroid.classificationReasons[0], /transparente/);
});

test("fundo separador liso de verdade continua com confiança alta", async () => {
  const analysis = await analysisOf(await MATRIX.cards());
  assert.ok(analysis.separatorConfidence >= 0.6, JSON.stringify(analysis));
  assert.ok(analysis.flatSeparatorRatio >= 0.2);
});

test("automático na base real das flores: variante de cena única (nunca COLLAGE_EDITORIAL), geometria válida", async () => {
  const result = await render(FLOWERS_BASE);
  assert.equal(result.composition.baseVisualClass, "SINGLE_SCENE_PHOTO");
  assert.ok(["PHOTO_DOMINANT_EDITORIAL", "ASYMMETRIC_LUXURY", "FULL_BLEED_STORY", "MINIMAL_PREMIUM"].includes(result.composition.variant), result.composition.variant);
  assert.equal(result.geometry.valid, true, JSON.stringify(result.geometry.issues));
  assert.equal(result.assetVerification.find((item) => item.role === "logo").fidelityPass, true);
});
