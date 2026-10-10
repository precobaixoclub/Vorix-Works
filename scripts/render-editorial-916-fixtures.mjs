// Fixtures 9:16 (e regressão 4:5) com os artefatos REAIS aprovados dos cenários A/B/C — ZERO OpenAI.
// Base OpenAI real + assets reais + plano/contexto persistidos de cada run aprovado.
//
// Uso: node scripts/render-editorial-916-fixtures.mjs [outDir] [--only=a,b,c] [--formats=4:5,9:16]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

const args = process.argv.slice(2);
const outDir = args.find((arg) => !arg.startsWith("--")) ?? "docs/creative-editorial-prototype/916-fixtures";
const only = (args.find((arg) => arg.startsWith("--only="))?.slice(7) ?? "a,b,c").split(",");
const variants = (args.find((arg) => arg.startsWith("--variants="))?.slice(11) ?? "").split(",").filter(Boolean);
const baseOverride = args.find((arg) => arg.startsWith("--base="))?.slice(7);
const formats = (args.find((arg) => arg.startsWith("--formats="))?.slice(10) ?? "4:5,9:16").split(",");
const FX = "tests/fixtures/editorial";
await mkdir(outDir, { recursive: true });

const logo = await readFile(join(FX, "logo-rumo-ao-altar.png"));
const SCENARIOS = {
  a: { base: "916/a-base.webp", assets: [{ role: "product_photo", file: "916/a-product.webp" }] },
  b: { base: "916/b-base.webp", assets: [] },
  c: { base: "916/c-base.webp", assets: [{ role: "screenshot", file: "screenshot-desktop-presentes.png" }] },
};

const summary = [];
for (const key of only) {
  const scenario = SCENARIOS[key];
  const { plan, context } = JSON.parse(await readFile(join(FX, `916/${key}-plan.json`), "utf8"));
  const base = await readFile(baseOverride ?? join(FX, scenario.base));
  const assets = [
    ...(await Promise.all(scenario.assets.map(async (asset) => ({ role: asset.role, url: `fixture://${asset.file}`, buffer: await readFile(join(FX, asset.file)) })))),
    { role: "logo", url: "fixture://logo-rumo-ao-altar.png", buffer: logo },
  ];
  for (const format of formats) for (const variant of variants.length > 0 ? variants : [undefined]) {
    const result = await renderEditorialCreative({ baseImageBuffer: base, context: { ...context, format }, plan, assets, ...(variant ? { qaVariantOverride: variant } : {}) });
    const file = `${key}-${format.replace(":", "x")}${variant ? `-${variant}` : ""}${baseOverride ? "-alt" : ""}.jpg`;
    await writeFile(join(outDir, file), result.buffer);
    const composition = result.composition ?? {};
    summary.push({
      file,
      family: result.family,
      variant: composition.variant,
      baseVisualClass: composition.baseVisualClass,
      logoTreatment: composition.logoTreatment,
      ctaTreatment: composition.ctaTreatment,
      baseFit: composition.baseFit?.strategy,
      cropLossPct: composition.baseFit?.cropLossPct,
      occupiedAreaRatio: composition.occupiedAreaRatio,
      largestEmptyBandPct: composition.largestEmptyBandPct,
      prominence: composition.productVisualProminence,
      geometryValid: result.geometry.valid,
      issues: result.geometry.issues.map((issue) => `${issue.code}: ${issue.message}`),
      texts: result.renderedGeometry.textBoxes.map((box) => `${box.id}:${box.fontSizePx ?? "?"}px/${box.lineCount ?? "?"}l`),
      assets: result.renderedGeometry.assetBoxes.map((box) => `${box.id}@${box.rect.xPct.toFixed(1)},${box.rect.yPct.toFixed(1)} ${box.rect.widthPct.toFixed(1)}x${box.rect.heightPct.toFixed(1)}`),
      verification: result.assetVerification.map((item) => `${item.role}:${item.visible}/${item.fidelityPass}/${item.fidelityMeanAbsDiff}`),
    });
  }
}
await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
for (const item of summary) console.log(JSON.stringify(item));
