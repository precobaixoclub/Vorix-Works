// Matriz de encaixe de texto (headline/subtítulo/CTA curtos, médios e longos) nas três famílias
// editoriais, com os artefatos reais aprovados — ZERO OpenAI. Uso: node scripts/editorial-text-fit-matrix.mjs [format] [outDir]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderEditorialCreative } from "../dist/infrastructure/rendering/editorial-creative-renderer.js";

export const TEXT_FIT_CASES = {
  headline: {
    short: "Sem Correria",
    medium: "O casamento organizado como vocês sonharam",
    long: "Organize o casamento inteiro, do convite ao último presente, sem planilhas e sem estresse",
  },
  subheadline: {
    short: "Tudo em um só lugar.",
    long: "Site do casamento, lista de presentes com pagamento online, confirmação de presença dos convidados e mural de recados, tudo em um só lugar.",
  },
  cta: { short: "Comprar", long: "Quero criar o site do meu casamento" },
};

const FX = "tests/fixtures/editorial";
export async function loadScenario(key) {
  const files = { a: ["916/a-base.webp", [["product_photo", "916/a-product.webp"]]], b: ["916/b-base.webp", []], c: ["916/c-base.webp", [["screenshot", "screenshot-desktop-presentes.png"]]] }[key];
  const { plan, context } = JSON.parse(await readFile(join(FX, `916/${key}-plan.json`), "utf8"));
  const assets = [
    ...(await Promise.all(files[1].map(async ([role, file]) => ({ role, url: `fixture://${file}`, buffer: await readFile(join(FX, file)) })))),
    { role: "logo", url: "fixture://logo.png", buffer: await readFile(join(FX, "logo-rumo-ao-altar.png")) },
  ];
  return { base: await readFile(join(FX, files[0])), plan, context, assets };
}

export function* textFitCombos() {
  for (const headline of Object.keys(TEXT_FIT_CASES.headline)) for (const sub of Object.keys(TEXT_FIT_CASES.subheadline)) for (const cta of Object.keys(TEXT_FIT_CASES.cta)) yield { headline, sub, cta };
}

export async function renderCombo(scenario, format, combo) {
  const plan = {
    ...scenario.plan,
    headline: TEXT_FIT_CASES.headline[combo.headline],
    subheadline: TEXT_FIT_CASES.subheadline[combo.sub],
    cta: TEXT_FIT_CASES.cta[combo.cta],
    title: TEXT_FIT_CASES.headline[combo.headline],
  };
  plan.allowedRenderedTexts = [plan.headline, plan.subheadline, plan.cta];
  return renderEditorialCreative({ baseImageBuffer: scenario.base, context: { ...scenario.context, format }, plan, assets: scenario.assets });
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("editorial-text-fit-matrix.mjs")) {
  const format = process.argv[2] ?? "9:16";
  const outDir = process.argv[3];
  if (outDir) await mkdir(outDir, { recursive: true });
  for (const key of ["a", "b", "c"]) {
    const scenario = await loadScenario(key);
    for (const combo of textFitCombos()) {
      const name = `${key}-${combo.headline}-${combo.sub}-${combo.cta}`;
      try {
        const result = await renderCombo(scenario, format, combo);
        if (outDir) await writeFile(join(outDir, `${name}.jpg`), result.buffer);
        const texts = result.renderedGeometry.textBoxes.map((box) => `${box.id}:${box.fontSizePx}px/${box.lineCount}l/w${Math.round((box.rect.widthPct / 100) * 1080)}`);
        console.log(name, result.composition?.variant, result.geometry.valid ? "VALID" : "INVALID", texts.join(" "), result.geometry.issues.map((issue) => issue.code + ":" + issue.message.slice(0, 90)).join(" | "));
      } catch (error) {
        console.log(name, "THROW", error.message.slice(0, 200));
      }
    }
  }
}
