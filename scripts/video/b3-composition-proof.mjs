#!/usr/bin/env node
// PROVA B3 — composições reais (cartão, divisão com painel da marca, paralaxe, lupa, aparelho) pelo
// caminho de produção: rascunho do diretor criativo → construtor determinístico → FFmpeg → Quality Gate.
// Os rascunhos aqui fazem o papel do Codex (mesmo formato que ele devolve), para isolar a qualidade
// visual do motor. Compare com artifacts/video-b0/out (B0: foto em tela cheia + zoom).
// Uso: npm run build && node scripts/video/b3-composition-proof.mjs [--only cmkv|raa] [--threads 2]
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FfmpegEditExecutor } from "../../dist/infrastructure/video-editing/ffmpeg-edit-executor.js";
import { probeMedia, analyzeVideo, renderContactSheet } from "../../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { evaluateVideoQualityGate } from "../../dist/application/video-editing/video-quality-gate.js";
import { buildPlanFromDraft } from "../../dist/application/video-editing/build-plan-from-draft.js";
import { validateVideoEditDraftStructure } from "../../dist/application/ai-gateway/schemas/video-edit-draft.v1.js";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const ROOT = resolve("artifacts/video-b0");
const MAT = join(ROOT, "materials");
const OUT = join(ROOT, "b3");
const threads = Number(arg("--threads", "2"));
const only = arg("--only", "");

async function material(id, fileName, kind, role, label) {
  const probe = await probeMedia(join(MAT, fileName));
  return { id, fileName, kind, role, label, width: probe.video?.width, height: probe.video?.height, durationSeconds: kind === "image" ? undefined : probe.durationSeconds };
}
const t = (role, text, position, animation) => ({ role, text, position, animation });
const scene = (materialId, purpose, durationSeconds, motion, layout, transitionIn, texts = [], focus = "center", motionIntensity = "medium") => ({ materialId, purpose, durationSeconds, motion, ...(layout ? { layout } : {}), motionIntensity, focus, transitionIn, texts });

const CMKV = { name: "CMKV", primaryHex: "#EDE6DA", accentHex: "#C9A23F", lightHex: "#FBF8F2", darkHex: "#111111", displayFont: "DM Serif Display", bodyFont: "Barlow Condensed" };
const RAA = { name: "Rumo ao Altar", primaryHex: "#B5546B", accentHex: "#E8C07A", lightHex: "#FFF6F2", darkHex: "#3A1520", displayFont: "Barlow Condensed", bodyFont: "Barlow Condensed", glossary: [{ from: "rumo ao altar", to: "Rumo ao Altar" }] };

async function cmkv() {
  const materials = [
    await material("M1", "cmkv-bege.jpg", "image", "product_photo", "camiseta bege, estampa frontal"),
    await material("M2", "cmkv-preto.jpg", "image", "product_photo", "camiseta preta"),
    await material("M3", "cmkv-verde.jpg", "image", "product_photo", "camiseta verde-militar"),
    await material("LOGO", "cmkv-logo.png", "image", "logo"),
    await material("MUS", "music-original.wav", "audio", "music"),
  ];
  const draft = {
    schemaVersion: 1,
    strategy: "produto-heroi-premium",
    rationale: "Gancho com aproximação rápida em profundidade, produto em cartão, detalhe na lupa, cores lado a lado com painel e fechamento com marca.",
    scenes: [
      scene("M1", "hook", 2.6, "punch_in", "parallax", "cut", [t("hook", "Estampa exclusiva", "top", "kinetic")]),
      scene("M2", "product", 3.4, "drift", "framed", "smooth_left", [t("headline", "Algodão encorpado", "bottom", "slide_up")]),
      scene("M2", "detail", 3.0, "push_in", "inset", "circle_open", [], "top"),
      scene("M3", "variety", 3.6, "push_in", "split", "wipe", [t("headline", "Bege, preto e verde-militar", "center", "kinetic")]),
      scene("M1", "benefit", 3.0, "pull_out", "full", "blur", [t("subtitle", "Feita para durar", "bottom", "fade")], "center", "subtle"),
      scene("CARD", "cta", 4.0, "static", undefined, "flash", [t("cta", "Garanta a sua", "bottom", "pop")]),
    ],
    captions: false,
    music: "present",
    logo: "end",
    warnings: [],
  };
  return { name: "cmkv-b3-9x16", aspect: "9:16", draft, materials, brand: CMKV, style: { editing: "elegante", transitions: "moderadas", captions: false, music: true }, logo: "LOGO", music: "MUS", target: 20, request: "Anúncio de 20 segundos da camiseta CMKV com as fotos reais, visual premium." };
}

async function raa() {
  const materials = [
    await material("M1", "raa-home.png", "image", "screenshot", "página inicial do Rumo ao Altar"),
    await material("M2", "raa-site-demo-presentes.png", "image", "screenshot", "lista de presentes no Pix"),
    await material("M3", "raa-site-demo-fotos.png", "image", "screenshot", "álbum colaborativo"),
    await material("M4", "raa-precos.png", "image", "screenshot", "planos e preços"),
    await material("MUS", "music-original.wav", "audio", "music"),
  ];
  const draft = {
    schemaVersion: 1,
    strategy: "demo-guiada",
    rationale: "Telas reais dentro do celular, cada recurso com um título curto; fechamento com convite.",
    scenes: [
      scene("CARD", "hook", 2.4, "punch_in", undefined, "cut", [t("hook", "Seu site de casamento", "center", "kinetic")]),
      scene("M1", "demo", 3.6, "drift", "device_phone", "push_up", [t("headline", "Pronto em minutos", "top", "slide_up")], "top"),
      scene("M2", "benefit", 3.8, "pan_down", "split", "smooth_left", [t("headline", "Presentes no Pix, sem taxa", "center", "kinetic")], "top"),
      scene("M3", "demo", 3.6, "push_in", "device_phone", "circle_open", [t("headline", "Álbum com os convidados", "top", "slide_up")], "top"),
      scene("M4", "proof", 3.0, "drift", "framed", "wipe", [], "top", "subtle"),
      scene("CARD", "cta", 3.6, "static", undefined, "flash", [t("cta", "Crie o seu agora", "center", "pop")]),
    ],
    captions: false,
    music: "present",
    logo: "none",
    warnings: [],
  };
  return { name: "raa-b3-9x16", aspect: "9:16", draft, materials, brand: RAA, style: { editing: "dinamico", transitions: "moderadas", captions: false, music: true }, music: "MUS", target: 20, request: "Vídeo de 20 segundos mostrando o Rumo ao Altar com capturas reais." };
}

async function run(spec) {
  const structure = validateVideoEditDraftStructure(spec.draft);
  if (!structure.valid) throw new Error(`${spec.name}: rascunho inválido: ${structure.errors.join("; ")}`);
  const built = buildPlanFromDraft(structure.data, { planId: spec.name, workspaceId: "ws-b3-proof", aspect: spec.aspect, request: spec.request, targetDurationSeconds: spec.target, style: spec.style, materials: spec.materials, transcripts: {}, sentences: [], brand: spec.brand, logoMaterialId: spec.logo, musicMaterialId: spec.music });
  if (!built.ok) throw new Error(`${spec.name}: plano não montado: ${built.issues.join("; ")}`);
  const plan = built.plan;
  await mkdir(OUT, { recursive: true });
  const executor = new FfmpegEditExecutor({ workRoot: join(ROOT, "work"), cacheRoot: join(ROOT, "cache"), ffmpeg: { threads, preset: "medium" }, limits: { maxDurationSeconds: 90 } });
  const mediaSources = Object.fromEntries(spec.materials.map((m) => [m.id, join(MAT, m.fileName)]));
  const output = join(OUT, `${spec.name}.mp4`);
  const started = Date.now();
  const result = await executor.execute({ jobId: `b3-${spec.name}`, plan, mediaSources, outputPath: output });
  const ms = Date.now() - started;
  const info = await stat(output);
  const probe = await probeMedia(output);
  const analysis = await analyzeVideo(output, { hasAudio: Boolean(probe.audio) });
  const gate = evaluateVideoQualityGate({ plan, probe: { exists: true, sizeBytes: info.size, ...probe }, analysis, compilerWarnings: result.warnings, brandHasLogo: Boolean(plan.logo) });
  const tiles = Math.min(20, Math.ceil(plan.durationSeconds));
  await renderContactSheet(output, join(OUT, `${spec.name}-sheet.jpg`), { everySeconds: plan.durationSeconds / tiles, columns: 5, tileWidth: 270, maxTiles: tiles });
  await writeFile(join(OUT, `${spec.name}-draft.json`), JSON.stringify(spec.draft, null, 2));
  await writeFile(join(OUT, `${spec.name}-plan.json`), JSON.stringify(plan, null, 2));
  const report = { name: spec.name, durationSeconds: plan.durationSeconds, renderMs: ms, sizeMb: +(info.size / 1e6).toFixed(2), builderWarnings: built.warnings, compilerWarnings: result.warnings, gate: { status: gate.status, failures: gate.failures, checks: gate.checks } };
  await writeFile(join(OUT, `${spec.name}-report.json`), JSON.stringify(report, null, 2));
  console.log(`[B3] ${spec.name}: ${plan.durationSeconds}s em ${(ms / 1000).toFixed(1)}s, ${report.sizeMb} MB, QG ${gate.status}${gate.failures.length ? ` — ${gate.failures.join("; ")}` : ""}`);
  for (const warning of [...built.warnings, ...result.warnings]) console.log(`       aviso: ${warning}`);
  return report;
}

async function main() {
  const reports = [];
  if (!only || only === "cmkv") reports.push(await run(await cmkv()));
  if (!only || only === "raa") reports.push(await run(await raa()));
  if (reports.some((report) => report.gate.status !== "ready_for_review")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[B3] FALHOU: ${error.message}`);
  if (error.logTail) console.error(error.logTail.join("\n"));
  process.exitCode = 1;
});
