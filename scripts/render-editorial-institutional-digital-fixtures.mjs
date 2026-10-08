// Fixtures visuais de premium_institutional e digital_service (4:5) — ZERO OpenAI.
//  - B: reaproveita a base OpenAI REAL do cenário B (execution-muzqmi4q-f7qx3f) com copy acentuada.
//  - C: screenshot desktop REAL do site (1280x900) sobre fundo local controlado (C nunca rodou, não
//    existe base OpenAI de C).
// As 3 saídas de cada cenário usam `qaVariantOverride` (só fixture) para comparar as variantes da
// mesma família com a mesma base; o summary registra também qual variante a regra escolheria.
//
// Uso: node scripts/render-editorial-institutional-digital-fixtures.mjs [outDirB] [outDirC]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

const outB = process.argv[2] ?? "docs/creative-editorial-prototype/institutional-fixtures";
const outC = process.argv[3] ?? "docs/creative-editorial-prototype/digital-fixtures";
await mkdir(outB, { recursive: true });
await mkdir(outC, { recursive: true });

const BASE_B = await readFile("tests/fixtures/editorial/scenario-b-openai-base.webp");
const LOGO = await readFile("tests/fixtures/editorial/logo-rumo-ao-altar.png");
const SCREENSHOT = await readFile("tests/fixtures/editorial/screenshot-desktop-presentes.png");
const BASE_C = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1280"><defs><radialGradient id="g" cx="0.7" cy="0.3" r="0.95"><stop offset="0" stop-color="#FBF1E8"/><stop offset="0.6" stop-color="#EED8CB"/><stop offset="1" stop-color="#D7B3A6"/></radialGradient></defs><rect width="1024" height="1280" fill="url(#g)"/></svg>`)).jpeg({ quality: 92 }).toBuffer();

function plan({ headline, subheadline, cta, visualDensity = "balanced", primaryMassPct = 50 }) {
  return {
    objective: "Fixture local sem OpenAI",
    angle: "Institucional",
    targetAudience: "Casais organizando casamento",
    title: headline,
    description: "Fixture local determinístico",
    headline,
    subheadline,
    cta,
    visualDirection: "Base editorial preservada",
    compositionIntent: "Composição editorial integrada",
    assetUsage: {},
    assetPlacements: [],
    textZones: [],
    allowedRenderedTexts: [headline, subheadline, cta].filter(Boolean),
    requiredRenderedFacts: [],
    requiredElements: ["headline", "cta", "logo", ...(subheadline ? ["subheadline"] : [])],
    forbiddenElements: ["texto QA", "placeholder"],
    visualDensity,
    styleNotes: "premium, editorial",
    rationale: "Teste local do renderer",
    artDirection: { primaryMassPct },
    layoutPlan: [],
  };
}

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

async function renderCase(outDir, file, { base, assets, copy, override }) {
  const result = await renderEditorialCreative({
    baseImageBuffer: base,
    context: { brandName: "Rumo ao Altar", objective: "Fixture local", channel: "instagram", format: "4:5", ideaText: "Fixture local sem OpenAI", assets: [], confirmedFacts: [] },
    plan: plan(copy),
    assets,
    qaVariantOverride: override,
  });
  const path = join(outDir, file);
  await writeFile(path, result.buffer);
  return {
    file: path,
    family: result.family,
    composition: result.composition,
    geometryValid: result.geometry.valid,
    issues: result.geometry.issues,
    verification: result.assetVerification,
    renderedTextZones: result.renderedTextZones,
    renderedGeometry: result.renderedGeometry,
  };
}

const logoAsset = { role: "logo", url: "fixture://logo-rumo-ao-altar.png", buffer: LOGO };
const shotAsset = { role: "screenshot", url: "fixture://site-demo-presentes.png", buffer: SCREENSHOT };
const B = [
  ["01-institutional-full-bleed.jpg", "FULL_BLEED_EDITORIAL"],
  ["02-institutional-split-story.jpg", "SPLIT_STORY"],
  ["03-institutional-collage.jpg", "COLLAGE_EDITORIAL"],
];
const C = [
  ["01-digital-desktop-hero.jpg", "DESKTOP_HERO"],
  ["02-digital-split-ui.jpg", "SPLIT_PRODUCT_UI"],
  ["03-digital-floating-browser.jpg", "FLOATING_BROWSER"],
];

const resultsB = [];
for (const [file, override] of B) resultsB.push(await renderCase(outB, file, { base: BASE_B, assets: [logoAsset], copy: COPY_B, override }));
resultsB.push(await renderCase(outB, "00-institutional-auto.jpg", { base: BASE_B, assets: [logoAsset], copy: COPY_B }));
const resultsC = [];
for (const [file, override] of C) resultsC.push(await renderCase(outC, file, { base: BASE_C, assets: [shotAsset, logoAsset], copy: COPY_C, override }));
resultsC.push(await renderCase(outC, "00-digital-auto.jpg", { base: BASE_C, assets: [shotAsset, logoAsset], copy: COPY_C }));
await writeFile(join(outB, "summary.json"), JSON.stringify(resultsB, null, 2));
await writeFile(join(outC, "summary.json"), JSON.stringify(resultsC, null, 2));
console.log(JSON.stringify([...resultsB, ...resultsC].map((item) => ({
  file: item.file,
  variant: item.composition?.variant,
  reasons: item.composition?.selectionReasons,
  baseFit: item.composition?.baseFit,
  screenshot: item.composition?.screenshot,
  logo: item.composition?.logoTreatment,
  prominence: item.composition?.productVisualProminence,
  emptyBand: item.composition?.largestEmptyBandPct,
  valid: item.geometryValid,
  issues: item.issues.map((issue) => `${issue.code}: ${issue.message}`),
  verify: item.verification.map((v) => `${v.role}:${v.visible}/${v.fidelityPass}/${v.fidelityMeanAbsDiff}`),
})), null, 1));
