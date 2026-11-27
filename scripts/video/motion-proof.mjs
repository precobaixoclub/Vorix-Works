#!/usr/bin/env node
// PROVA COMPARATIVA DE MOVIMENTO POR IA — 2 camisetas reais da CMKV × 2 provedores × 1 movimento simples.
//
// PADRÃO: simulação. Só imprime o plano e o custo estimado (nenhuma chamada paga).
// Execução real SÓ com autorização explícita do responsável:
//   MOTION_PROOF_AUTHORIZED=sim VIDEO_MOTION_GOOGLE_API_KEY=... VIDEO_MOTION_RUNWAY_API_KEY=... \
//   node scripts/video/motion-proof.mjs --execute --photos foto1.jpg,foto2.jpg [--budget 20]
// Saída: clipes, relatório de fidelidade (8 quadros), pranchas e comparativo lado a lado (original | A | B).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { estimateMotionCost } from "../../dist/application/video-motion/motion-provider.js";
import { GoogleVeoMotionProvider, RunwayMotionProvider, VEO_MODELS, RUNWAY_MODELS } from "../../dist/infrastructure/video-motion/motion-providers.js";
import { checkProductFidelity } from "../../dist/infrastructure/video-motion/product-fidelity.js";
import { runFfmpegCapture } from "../../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const execute = process.argv.includes("--execute");
const budget = Number(arg("--budget", "20"));
const photos = (arg("--photos", "") || "").split(",").filter(Boolean);
const OUT = resolve(arg("--out", "artifacts/video-motion-proof"));
const PROMPT = "Slow, smooth camera orbit around the person wearing the t-shirt, natural studio light, subtle fabric movement. Keep the t-shirt print EXACTLY as in the photo: same drawing, colors, position and size; do not add, remove or redraw any element; no text or logos.";

const runs = [
  { provider: "google-veo", spec: VEO_MODELS.find((m) => m.model === "veo-3.1-fast-generate-preview"), seconds: 4 },
  { provider: "runway", spec: RUNWAY_MODELS.find((m) => m.model === "gen4_turbo"), seconds: 5 },
];

const shirts = photos.length ? photos : ["<foto oficial camiseta 1>", "<foto oficial camiseta 2>"];
const plan = shirts.flatMap((photo) => runs.map((run) => ({ photo, provider: run.provider, model: run.spec.model, ...estimateMotionCost(run.spec, run.seconds), pricingSource: run.spec.pricingSource })));
const total = plan.reduce((sum, item) => sum + item.usd, 0);
console.log(JSON.stringify({ mode: execute ? "execução" : "simulação (nenhuma chamada paga)", prompt: PROMPT, plan, totalUsd: Math.round(total * 100) / 100, withOneRetryEachUsd: Math.round(total * 2 * 100) / 100, budgetUsd: budget }, null, 2));

if (!execute) process.exit(0);
if (process.env.MOTION_PROOF_AUTHORIZED !== "sim") throw new Error("Execução paga exige MOTION_PROOF_AUTHORIZED=sim (autorização do responsável).");
if (photos.length !== 2) throw new Error("Informe as 2 fotos oficiais: --photos a.jpg,b.jpg");
if (total * 2 > budget) throw new Error(`Custo com uma repetição (US$ ${(total * 2).toFixed(2)}) passa do orçamento (US$ ${budget})`);
const providers = { "google-veo": new GoogleVeoMotionProvider({ apiKey: process.env.VIDEO_MOTION_GOOGLE_API_KEY }), runway: new RunwayMotionProvider({ apiKey: process.env.VIDEO_MOTION_RUNWAY_API_KEY }) };
await mkdir(OUT, { recursive: true });
const results = [];
for (const [index, item] of plan.entries()) {
  const image = await readFile(item.photo);
  const started = Date.now();
  try {
    const clip = await providers[item.provider].generate({ model: item.model, image: { bytes: image, mimeType: "image/jpeg" }, prompt: PROMPT, seconds: item.seconds, aspect: "9:16" });
    const file = join(OUT, `camiseta${Math.floor(index / runs.length) + 1}-${item.provider}.mp4`);
    await writeFile(file, clip.video);
    const { report, sheet } = await checkProductFidelity({ originalImage: image, clipPath: file, workDir: join(OUT, `fid-${index}`) });
    await writeFile(file.replace(/\.mp4$/, "-fidelidade.jpg"), sheet);
    results.push({ ...item, file, ms: Date.now() - started, fidelity: report.verdict, worst: report.worst, reasons: report.reasons });
  } catch (error) {
    results.push({ ...item, error: error.message.slice(0, 300), ms: Date.now() - started });
  }
}
// Comparativo lado a lado por camiseta: foto original | provedor A | provedor B.
for (let shirt = 0; shirt < 2; shirt += 1) {
  const clips = results.slice(shirt * runs.length, shirt * runs.length + runs.length).filter((item) => item.file);
  if (clips.length !== runs.length) continue;
  const inputs = ["-loop", "1", "-t", "5", "-i", photos[shirt], ...clips.flatMap((item) => ["-i", item.file])];
  const scale = (i) => `[${i}:v]scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1[v${i}]`;
  const filter = `${[0, 1, 2].map(scale).join(";")};[v0][v1][v2]hstack=inputs=3[out]`;
  await runFfmpegCapture(["-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(OUT, `comparativo-camiseta${shirt + 1}.mp4`)], { timeoutMs: 120_000 });
}
await writeFile(join(OUT, "relatorio.json"), JSON.stringify({ prompt: PROMPT, results, totalEstimatedUsd: total }, null, 2));
console.log(JSON.stringify(results.map(({ provider, photo, fidelity, worst, error, ms }) => ({ provider, photo, fidelity, worst, error, ms })), null, 2));
