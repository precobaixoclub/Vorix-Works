// Fixtures do premium_institutional editorial v2 (4:5) — ZERO OpenAI. Base REAL aprovada do cenário B
// (execution-mv0m68op-4z3oek, pixel-idêntica em WebP lossless) + logo real + copy aprovada.
// 00 = escolha automática (sem override); 01–04 = cada variante nova; 05 = final atual de produção.
//
// Uso: node scripts/render-editorial-institutional-v2-fixtures.mjs [outDir]
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

const outDir = process.argv[2] ?? "docs/creative-editorial-prototype/institutional-v2-fixtures";
await mkdir(outDir, { recursive: true });
const BASE = await readFile("tests/fixtures/editorial/scenario-b-db3a574-base.webp");
const LOGO = await readFile("tests/fixtures/editorial/logo-rumo-ao-altar.png");
const COPY = {
  headline: "O casamento organizado como vocês sonharam",
  subheadline: "Site, lista de presentes e confirmação de presença em um só lugar.",
  cta: "Conheça o Rumo ao Altar",
};

function plan() {
  return {
    objective: "Institucional premium", angle: "Marca", targetAudience: "Casais", title: COPY.headline, description: "Fixture local",
    ...COPY,
    visualDirection: "Cena editorial", compositionIntent: "Imagem protagonista", assetUsage: {}, assetPlacements: [], textZones: [],
    allowedRenderedTexts: [COPY.headline, COPY.subheadline, COPY.cta], requiredRenderedFacts: [], requiredElements: ["headline", "subheadline", "cta", "logo"],
    forbiddenElements: [], visualDensity: "balanced", styleNotes: "", rationale: "", artDirection: { primaryMassPct: 60 }, layoutPlan: [],
  };
}

async function renderCase(file, override) {
  const result = await renderEditorialCreative({
    baseImageBuffer: BASE,
    context: { brandName: "Rumo ao Altar", objective: "Fixture", channel: "instagram", format: "4:5", ideaText: "", assets: [], confirmedFacts: [] },
    plan: plan(),
    assets: [{ role: "logo", url: "fixture://logo-rumo-ao-altar.png", buffer: LOGO }],
    qaVariantOverride: override,
  });
  await writeFile(join(outDir, file), result.buffer);
  return { file, composition: result.composition, geometryValid: result.geometry.valid, issues: result.geometry.issues, verification: result.assetVerification, renderedGeometry: result.renderedGeometry };
}

const results = [
  await renderCase("00-institutional-auto-v2.jpg"),
  await renderCase("01-photo-dominant-editorial.jpg", "PHOTO_DOMINANT_EDITORIAL"),
  await renderCase("02-asymmetric-luxury.jpg", "ASYMMETRIC_LUXURY"),
  await renderCase("03-full-bleed-story.jpg", "FULL_BLEED_STORY"),
  await renderCase("04-minimal-premium.jpg", "MINIMAL_PREMIUM"),
];
await copyFile("docs/creative-editorial-prototype/scenario-b-db3a574/2-final-rendered.jpg", join(outDir, "05-current-production-reference.jpg")).catch(() => undefined);
await writeFile(join(outDir, "summary.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map((item) => ({
  file: item.file,
  variant: item.composition?.variant,
  baseClass: item.composition?.baseVisualClass,
  reasons: item.composition?.selectionReasons,
  fit: item.composition?.baseFit?.strategy,
  crop: item.composition?.baseFit?.cropLossPct,
  logo: item.composition?.logoTreatment,
  cta: item.composition?.ctaTreatment,
  prominence: item.composition?.productVisualProminence,
  emptyBand: item.composition?.largestEmptyBandPct,
  valid: item.geometryValid,
  issues: item.issues.map((issue) => issue.code + ": " + issue.message),
  verify: item.verification.map((v) => `${v.role}:${v.visible}/${v.fidelityPass}/${v.fidelityMeanAbsDiff}`),
})), null, 1));
