// Validação das capturas reais de software antes de cadastrá-las na Biblioteca da marca: para cada captura,
// passa por cada composição compatível do piloto e mede o que o Quality Gate mede — texto da interface na
// arte (px), tela com conteúdo (desvio/bordas) e veredito. Sem IA, sem rede, sem escrita fora da pasta de saída.
//
// Uso (na raiz, depois de `npm run build`): node scripts/editorial/validate-software-captures.mjs <pasta> [saída]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { renderArt } from "./codex-social-render.mjs";

const [dir = "scripts/editorial/library/vorix-works", out] = process.argv.slice(2);
const dist = (path) => import(pathToFileURL(join(process.cwd(), "dist", path)).href);
const { FIDELITY_LIMITS } = await dist("application/creative-engine/creative-fidelity-gate.js");
const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
if (out) await mkdir(out, { recursive: true });
const logo = (await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="140"><rect x="10" y="30" width="380" height="80" rx="16" fill="#F5F3FF"/></svg>`)).png().toBuffer()).toString("base64");
const profile = { identity: { colors: [{ name: "Preto tecnológico", hex: "#0B0F19", role: "SECONDARY" }, { name: "Lavanda", hex: "#B990FC", role: "ACCENT" }, { name: "Roxo", hex: "#9333EA", role: "PRIMARY" }], typography: { family: "SANS" }, notes: "Fundo sempre escuro." } };
const rows = [];
for (const capture of manifest.captures) {
  const data = await readFile(join(dir, capture.file));
  const meta = await sharp(data).metadata();
  const archetypes = capture.form === "mobile" ? ["phone_conversation"] : ["device_laptop", "browser_window", ...(capture.focus ? ["ui_focus"] : [])];
  for (const archetype of archetypes) {
    const spec = { mode: "software", subject: { kind: "feature", key: capture.feature }, requiredReferences: [{ id: capture.file, role: "software_capture" }], blockers: [] };
    const result = await renderArt({ profile, logos: [{ data: logo, variant: "LIGHT", backgrounds: ["DARK"] }], headline: capture.label, body: "", cta: "",
      composition: { mode: "software", archetype, capture: { id: capture.file, data: data.toString("base64"), devicePixelRatio: capture.devicePixelRatio, focus: capture.focus, feature: capture.feature, form: capture.form } },
      fidelity: { spec, operation: "deterministic_composite", archetype, transmittedReferenceIds: [capture.file] }, history: [] });
    const screen = result.evidence.screen;
    rows.push({ capture: capture.file, feature: capture.feature, resolution: `${meta.width}x${meta.height}@${capture.devicePixelRatio}x`, archetype,
      textPx: Math.round(screen.renderedTextPx * 10) / 10, legible: screen.renderedTextPx >= FIDELITY_LIMITS.minRenderedTextPx, luminanceStd: screen.luminanceStd, edgeDensity: screen.edgeDensity,
      approved: result.gate.approved, failures: result.gate.failures.map((failure) => failure.code) });
    if (out) await writeFile(join(out, `${capture.file.replace(/\.png$/, "")}--${archetype}.jpg`), Buffer.from(result.image, "base64"));
  }
}
console.table(rows.map(({ capture, archetype, textPx, legible, approved, failures }) => ({ capture, archetype, textPx, legible, approved, failures: failures.join(",") })));
if (out) await writeFile(join(out, "captures-validation.json"), `${JSON.stringify(rows, null, 2)}\n`);
