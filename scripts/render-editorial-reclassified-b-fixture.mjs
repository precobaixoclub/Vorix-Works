// Reprocessa a base REAL do último cenário B (execution-mv0uvicq-9ca5dd) — ZERO OpenAI, sem geração.
// 00 = seleção automática nova (sem override); 01 = layout antigo de colagem reproduzido para comparação.
//
// Uso: node scripts/render-editorial-reclassified-b-fixture.mjs [outDir]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

const outDir = process.argv[2] ?? "docs/creative-editorial-prototype/scenario-b-4f4d604-reclassified";
await mkdir(outDir, { recursive: true });
const BASE = await readFile("tests/fixtures/editorial/scenario-b-4f4d604-base.webp");
const LOGO = await readFile("tests/fixtures/editorial/logo-rumo-ao-altar.png");
// Mesma copy e densidade do plano real persistido no run (visualDensity "clean").
const COPY = { headline: "O casamento organizado como vocês sonharam", subheadline: "Site, lista de presentes e confirmação de presença em um só lugar.", cta: "Conheça o Rumo ao Altar" };
const plan = {
  objective: "Institucional premium", angle: "Marca", targetAudience: "Casais", title: COPY.headline, description: "Reprocessamento local", ...COPY,
  visualDirection: "Cena editorial", compositionIntent: "Imagem protagonista", assetUsage: {}, assetPlacements: [], textZones: [],
  allowedRenderedTexts: [COPY.headline, COPY.subheadline, COPY.cta], requiredRenderedFacts: [], requiredElements: ["headline", "subheadline", "cta", "logo"],
  forbiddenElements: [], visualDensity: "clean", styleNotes: "", rationale: "", artDirection: { primaryMassPct: 60 }, layoutPlan: [],
};

async function renderCase(file, override) {
  const result = await renderEditorialCreative({
    baseImageBuffer: BASE,
    context: { brandName: "Rumo ao Altar", objective: "Reprocessamento", channel: "instagram", format: "4:5", ideaText: "", assets: [], confirmedFacts: [] },
    plan,
    assets: [{ role: "logo", url: "fixture://logo-rumo-ao-altar.png", buffer: LOGO }],
    qaVariantOverride: override,
  });
  await writeFile(join(outDir, file), result.buffer);
  return { file, variant: result.composition?.variant, baseVisualClass: result.composition?.baseVisualClass, selectionReasons: result.composition?.selectionReasons, classificationReasons: result.composition?.baseAnalysis?.classificationReasons, baseAnalysis: result.composition?.baseAnalysis, baseFit: result.composition?.baseFit, logoTreatment: result.composition?.logoTreatment, ctaTreatment: result.composition?.ctaTreatment, prominence: result.composition?.productVisualProminence, geometryValid: result.geometry.valid, issues: result.geometry.issues, verification: result.assetVerification };
}

const results = [await renderCase("00-latest-b-auto-reclassified.jpg"), await renderCase("01-latest-b-old-collage-reference.jpg", "COLLAGE_EDITORIAL")];
await writeFile(join(outDir, "summary.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({ baseAnalysis, verification, ...rest }) => ({ ...rest, logo: verification.map((v) => `${v.visible}/${v.fidelityPass}/${v.fidelityMeanAbsDiff}`) })), null, 1));
