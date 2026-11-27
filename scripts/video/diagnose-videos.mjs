#!/usr/bin/env node
// DIAGNÓSTICO MEDIDO de peças de vídeo (as nossas ou referências): mesmo medidor do Bolsão.
// Uso: npm run build && node scripts/video/diagnose-videos.mjs --out <dir> <video1.mp4> [video2.mp4 ...]
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { analyzeReferenceVideo } from "../../dist/infrastructure/video-editing/reference-video-analysis.js";
import { referenceGuidance } from "../../dist/application/video-editing/reference-profile.js";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = resolve(outIndex >= 0 ? args[outIndex + 1] : "artifacts/diagnostico");
const files = args.filter((_, i) => i !== outIndex && i !== outIndex + 1);
await mkdir(out, { recursive: true });
const all = {};
for (const file of files) {
  const name = basename(file).replace(/\.[^.]+$/, "");
  const result = await analyzeReferenceVideo(resolve(file), { sheetPath: join(out, `${name}-miniaturas.jpg`) });
  all[name] = { ...result, guidance: referenceGuidance(result.profile, result.audio) };
  console.log(`\n== ${name} (${result.analysisMs} ms)`);
  for (const line of all[name].guidance) console.log(" ", line);
}
await writeFile(join(out, "diagnostico-medido.json"), JSON.stringify(all, null, 2));
console.log(`\nJSON: ${join(out, "diagnostico-medido.json")}`);
