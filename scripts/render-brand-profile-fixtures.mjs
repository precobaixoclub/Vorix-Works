// Fixtures de Brand Profile — artefatos REAIS aprovados (A produto, B institucional, C digital)
// renderizados SEM perfil e com 3 perfis sintéticos — ZERO OpenAI. A estrutura (variante, geometria,
// fidelidade, provenance) deve se manter; a linguagem visual (cores, logo, CTA, forma, tipografia)
// deve mudar. Uso: node scripts/render-brand-profile-fixtures.mjs [outDir] [--formats=4:5,9:16] [--only=a,b,c]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";
import { BRAND_DENSITY_TO_PLAN, commitBrandIdentity, validateBrandIdentityInput } from "../dist/shared/utils/brand-identity.js";
import { SYNTHETIC_PROFILES } from "../tests/fixtures/editorial/brand/profiles.mjs";

const args = process.argv.slice(2);
const outDir = args.find((arg) => !arg.startsWith("--")) ?? "docs/creative-editorial-prototype/brand-profile-fixtures";
const formats = (args.find((arg) => arg.startsWith("--formats="))?.slice(10) ?? "4:5").split(",");
const only = (args.find((arg) => arg.startsWith("--only="))?.slice(7) ?? "a,b,c").split(",");
const FX = "tests/fixtures/editorial";
await mkdir(outDir, { recursive: true });

export function brandFor(profileKey, workspaceId = "workspace-fixture") {
  const validated = validateBrandIdentityInput(SYNTHETIC_PROFILES[profileKey]);
  if (!validated.ok) throw new Error(`${profileKey}: ${validated.errors.join("; ")}`);
  const identity = commitBrandIdentity(validated.identity, undefined, "2026-10-10T00:00:00.000Z");
  return { profileId: `fixture-${profileKey}`, workspaceId, version: identity.version, updatedAt: identity.updatedAt, identity, logos: [] };
}

const SCEN = {
  a: { base: "916/a-base.webp", assets: [["product_photo", "916/a-product.webp"]] },
  b: { base: "916/b-base.webp", assets: [] },
  c: { base: "916/c-base.webp", assets: [["screenshot", "screenshot-desktop-presentes.png"]] },
};
const logo = await readFile(join(FX, "logo-rumo-ao-altar.png"));
const summary = [];
for (const key of only) {
  const { plan, context } = JSON.parse(await readFile(join(FX, `916/${key}-plan.json`), "utf8"));
  const base = await readFile(join(FX, SCEN[key].base));
  const assets = [
    ...(await Promise.all(SCEN[key].assets.map(async ([role, file]) => ({ role, url: `fixture://${file}`, buffer: await readFile(join(FX, file)) })))),
    { role: "logo", url: "fixture://logo.png", buffer: logo },
  ];
  for (const format of formats) {
    for (const profileKey of ["NONE", "P1", "P2", "P3"]) {
      const brand = profileKey === "NONE" ? undefined : brandFor(profileKey);
      // Mesma regra do motor: densidade da marca vira a visualDensity do plano.
      const planForRender = brand?.identity.density ? { ...plan, visualDensity: BRAND_DENSITY_TO_PLAN[brand.identity.density] } : plan;
      const result = await renderEditorialCreative({ baseImageBuffer: base, context: { ...context, format, ...(brand ? { brandIdentity: brand } : {}) }, plan: planForRender, assets });
      const file = `${key}-${format.replace(":", "x")}-${profileKey}.jpg`;
      await writeFile(join(outDir, file), result.buffer);
      summary.push({
        file,
        variant: result.composition?.variant,
        logoTreatment: result.composition?.logoTreatment,
        geometryValid: result.geometry.valid,
        issues: result.geometry.issues.map((issue) => issue.code),
        texts: result.renderedTextZones.map((zone) => zone.text),
        verification: result.assetVerification.map((item) => `${item.role}:${item.visible}/${item.fidelityPass}`),
        brandRules: (result.composition?.brandRules ?? []).map((rule) => `${rule.code}: ${rule.detail}`),
      });
    }
  }
}
await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
for (const item of summary) console.log(item.file, item.variant, item.logoTreatment, item.geometryValid ? "VALID" : `INVALID ${item.issues.join(",")}`, item.verification.join(" "), `rules=${item.brandRules.length}`);
