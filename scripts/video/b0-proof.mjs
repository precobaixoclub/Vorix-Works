#!/usr/bin/env node
// PROVA B0 — executor FFmpeg do motor de vídeo com materiais reais/sintéticos (sem dados de clientes).
// Vídeos: anúncio CMKV (fotos reais) em 9:16, 1:1 e 16:9; Reels a partir de uma gravação bruta com
// fala (legendas da transcrição, palavra destacada); demo 16:9 com narração e legendas.
// Uso: npm run build && node scripts/video/b0-proof.mjs [--only cmkv|reels|demo] [--threads 2] [--preset medium]
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { cpus, totalmem, platform } from "node:os";
import { FfmpegEditExecutor } from "../../dist/infrastructure/video-editing/ffmpeg-edit-executor.js";
import { probeMedia, analyzeVideo, renderContactSheet } from "../../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { evaluateVideoQualityGate } from "../../dist/application/video-editing/video-quality-gate.js";
import { captionsFromNarration, captionsFromTranscript, chooseFraming, findPhraseRange, snapRangeToWords, transcriptWords } from "../../dist/application/video-editing/transcript-tools.js";
import { validateVideoEditPlan, VIDEO_FORMATS } from "../../dist/domain/video-editing/video-edit-plan.js";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const ROOT = resolve("artifacts/video-b0");
const MAT = join(ROOT, "materials");
const threads = Number(arg("--threads", "2"));
const preset = arg("--preset", "medium");
const only = arg("--only", "");

const probe = async (file) => probeMedia(join(MAT, file));

function plan(base) {
  return { version: 1, workspaceId: "ws-b0-proof", sourceAudioGainDb: 0, ...base, ...VIDEO_FORMATS[base.aspect], fps: 30 };
}

/** Encadeia clipes: cada um começa onde o anterior termina menos a sobreposição da transição. */
function chain(specs) {
  let t = 0;
  return specs.map((spec, index) => {
    const overlap = index > 0 && ["cross_dissolve", "push_left", "push_up", "zoom_in"].includes(spec.transitionIn.type) ? spec.transitionIn.durationSeconds : 0;
    const start = index === 0 ? 0 : t - overlap;
    t = start + spec.durationSeconds;
    return { sourceInSeconds: 0, keepSourceAudio: false, overlays: [], ...spec, recordStartSeconds: Math.round(start * 1000) / 1000 };
  });
}
const end = (clips) => Math.round((clips.at(-1).recordStartSeconds + clips.at(-1).durationSeconds) * 1000) / 1000;

// ---------------- CMKV: anúncio de 15 s com fotos reais ----------------
async function cmkvPlan(aspect) {
  const photos = {};
  for (const [id, file] of [["bege", "cmkv-bege.jpg"], ["preto", "cmkv-preto.jpg"], ["verde", "cmkv-verde.jpg"]]) {
    const p = await probe(file);
    photos[id] = { id, kind: "image", role: "product_photo", fileName: file, width: p.video.width, height: p.video.height, protectedFidelity: true };
  }
  const logo = await probe("cmkv-logo.png");
  const frame = (id, focusY) => ({ fit: chooseFraming(photos[id], aspect), focusX: 0.5, focusY });
  const serif = (size, colorHex, backgroundHex) => ({ size, colorHex, backgroundHex, bold: false, fontFamily: "DM Serif Display" });
  const vertical = aspect === "9:16";
  const clips = chain([
    { id: "abertura", assetId: "bege", purpose: "abertura: produto inteiro", durationSeconds: 3.0, motion: { type: "push_in", intensity: 0.35 }, framing: frame("bege", 0.42), transitionIn: { type: "dip_to_black", durationSeconds: 0.5 }, overlays: [{ id: "hook", role: "hook", text: "Estampa exclusiva CMKV", startOffsetSeconds: 0.35, durationSeconds: 2.45, position: "top", animation: "slide_up", style: serif(vertical ? 0.05 : 0.07, "#111111", "#F4EFE6") }] },
    { id: "detalhe", assetId: "preto", purpose: "detalhe da estampa", durationSeconds: 3.4, motion: { type: "push_in", intensity: 0.55 }, framing: frame("preto", 0.36), transitionIn: { type: "cross_dissolve", durationSeconds: 0.4 } },
    { id: "cores", assetId: "verde", purpose: "variação de cor", durationSeconds: 3.4, motion: { type: "pan_left", intensity: 0.35 }, framing: frame("verde", 0.42), transitionIn: { type: "push_left", durationSeconds: 0.4 }, overlays: [{ id: "cores", role: "headline", text: "Bege, preto e verde-militar", startOffsetSeconds: 0.5, durationSeconds: 2.6, position: "top", animation: "fade", style: serif(vertical ? 0.042 : 0.058, "#FFFFFF", "#111111") }] },
    { id: "close", assetId: "bege", purpose: "close final do produto", durationSeconds: 2.8, motion: { type: "pull_out", intensity: 0.4 }, framing: frame("bege", 0.34), transitionIn: { type: "zoom_in", durationSeconds: 0.4 } },
    { id: "cta", assetId: "card", purpose: "encerramento com marca e CTA", durationSeconds: 4.0, motion: { type: "static", intensity: 0 }, framing: { fit: "fill", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "cross_dissolve", durationSeconds: 0.4 }, overlays: [{ id: "cta", role: "cta", text: "Garanta a sua", startOffsetSeconds: 0.9, durationSeconds: 3.1, position: "bottom", animation: "pop", style: serif(vertical ? 0.048 : 0.065, "#111111", "#C9A23F") }] },
  ]);
  const duration = end(clips);
  return plan({
    planId: `cmkv-${aspect.replace(":", "x")}`,
    mode: "images_ad",
    aspect,
    durationSeconds: duration,
    assets: [...Object.values(photos), { id: "logo", kind: "image", role: "logo", fileName: "cmkv-logo.png", width: logo.video.width, height: logo.video.height }, { id: "card", kind: "card", role: "card", card: { colorHex: "#FBF8F2", gradientToHex: "#EADFCB" } }, { id: "song", kind: "audio", role: "music", fileName: "music-original.wav", sourceDurationSeconds: 40 }],
    clips,
    logo: { assetId: "logo", placement: "center", scale: vertical ? 0.5 : aspect === "1:1" ? 0.42 : 0.3, startSeconds: clips.at(-1).recordStartSeconds + 0.3, durationSeconds: duration - clips.at(-1).recordStartSeconds - 0.3 },
    music: { assetId: "song", gainDb: -6, fadeInSeconds: 0.6, fadeOutSeconds: 1.4, duckUnderSpeech: false },
    strategy: "produto-heroi-premium",
    prompt: "Propaganda premium de 15 segundos destacando a estampa, com movimentos de câmera, transições modernas e chamada final para comprar.",
  });
}

// ---------------- Reels: gravação bruta → ~30 s com legendas ----------------
async function reelsPlan() {
  const transcript = JSON.parse(await readFile(join(MAT, "raw-transcript.json"), "utf8"));
  const words = transcriptWords(transcript);
  const raw = await probe("raw-recording.mp4");
  const asset = { id: "raw", kind: "video", role: "footage", fileName: "raw-recording.mp4", sourceDurationSeconds: raw.durationSeconds, width: raw.video.width, height: raw.video.height };
  const pick = (from, to) => {
    const range = findPhraseRange(words, from, to);
    if (!range) throw new Error(`trecho não encontrado: "${from}" … "${to}"`);
    return snapRangeToWords(words, range.start, range.end);
  };
  // Seleção de momentos: gancho (dor), prova (Pix sem taxa), recurso (fotos), benefício (1 minuto), CTA.
  const moments = [
    { id: "gancho", r: pick("Sabe aquela lista", "Pois é"), motion: "push_in" },
    { id: "pix", r: pick("os noivos recebem", "nenhuma taxa"), motion: "static" },
    { id: "fotos", r: pick("Cada convidado manda", "QR code"), motion: "push_in" },
    { id: "minuto", r: pick("você cria o site", "um minuto"), motion: "static" },
    { id: "acesso", r: pick("acessa rumo", "seu agora"), motion: "push_in" },
  ];
  // Gravação de tela horizontal no 9:16: mostrar inteiro e aproximar 1,5× a área central (leitura no celular).
  const framing = { fit: chooseFraming(asset, "9:16"), focusX: 0.5, focusY: 0.42, zoom: 1.5 };
  const bold = (size, colorHex, backgroundHex) => ({ size, colorHex, backgroundHex, bold: true, fontFamily: "Barlow Condensed" });
  const specs = moments.map((moment, index) => ({
    id: moment.id,
    assetId: "raw",
    purpose: moment.id,
    sourceInSeconds: Math.round(moment.r.start * 1000) / 1000,
    durationSeconds: Math.round((moment.r.end - moment.r.start) * 1000) / 1000,
    motion: { type: moment.motion, intensity: 0.12 },
    framing,
    transitionIn: index === 0 ? { type: "dip_to_black", durationSeconds: 0.3 } : { type: "cut", durationSeconds: 0 },
    keepSourceAudio: true,
    overlays: index === 0 ? [{ id: "hook", role: "hook", text: "Lista de presentes SEM taxa?", startOffsetSeconds: 0.15, durationSeconds: Math.min(3.2, moment.r.end - moment.r.start - 0.2), position: "top", animation: "pop", style: bold(0.058, "#FFFFFF", "#B5546B") }] : [],
  }));
  specs.push({ id: "cta", assetId: "card", purpose: "encerramento", durationSeconds: 2.6, motion: { type: "push_in", intensity: 0.15 }, framing: { fit: "fill", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "cross_dissolve", durationSeconds: 0.35 }, overlays: [{ id: "cta", role: "cta", text: "Crie o seu site em 1 minuto", startOffsetSeconds: 0.3, durationSeconds: 2.3, position: "center", animation: "pop", style: bold(0.06, "#FFFFFF") }, { id: "url", role: "cta", text: "rumoaoaltar.com.br", startOffsetSeconds: 0.6, durationSeconds: 2.0, position: "bottom", animation: "fade", style: bold(0.038, "#FFFFFF") }] });
  const clips = chain(specs);
  const glossary = [{ from: "rumo ao altar", to: "Rumo ao Altar" }, { from: "PIX", to: "Pix" }, { from: "altar.com.gr", to: "altar.com.br" }];
  const segments = captionsFromTranscript(clips, "raw", transcript, { glossary });
  return plan({
    planId: "reels-raa",
    mode: "edit_footage",
    aspect: "9:16",
    durationSeconds: end(clips),
    assets: [asset, { id: "card", kind: "card", role: "card", card: { colorHex: "#C2607A", gradientToHex: "#6E2A3C" } }, { id: "song", kind: "audio", role: "music", fileName: "music-original.wav", sourceDurationSeconds: 40 }],
    clips,
    captions: { enabled: true, style: bold(0.046, "#FFFFFF"), position: "bottom", segments },
    music: { assetId: "song", gainDb: -14, fadeInSeconds: 0.4, fadeOutSeconds: 1.2, duckUnderSpeech: true },
    strategy: "fala-direta-com-gancho",
    prompt: "Transforme esta gravação em um Reels profissional de cerca de 30 segundos: melhores momentos, sem pausas, legendas animadas, música discreta e abertura chamativa.",
  });
}

// ---------------- Demo 16:9: capturas reais + narração + legendas ----------------
async function demoPlan() {
  const transcript = JSON.parse(await readFile(join(MAT, "demo-transcript.json"), "utf8"));
  const shots = {};
  for (const [id, file] of [["home", "raa-home.png"], ["presentes", "raa-site-demo-presentes.png"], ["fotos", "raa-site-demo-fotos.png"], ["demo", "raa-demo.png"]]) {
    const p = await probe(file);
    shots[id] = { id, kind: "image", role: "screenshot", fileName: file, width: p.video.width, height: p.video.height, protectedFidelity: true };
  }
  const narration = await probe("demo-narration.wav");
  const label = (text) => [{ id: `t-${text.length}`, role: "headline", text, startOffsetSeconds: 0.4, durationSeconds: 3.0, position: "top", animation: "slide_up", style: { size: 0.06, colorHex: "#FFFFFF", backgroundHex: "#7A2E45", bold: true, fontFamily: "Barlow Condensed" } }];
  const fr = (id, focusY) => ({ fit: chooseFraming(shots[id], "16:9"), focusX: 0.5, focusY });
  const clips = chain([
    { id: "home", assetId: "home", purpose: "abertura com a página real", durationSeconds: 4.4, motion: { type: "push_in", intensity: 0.3 }, framing: fr("home", 0.15), transitionIn: { type: "dip_to_black", durationSeconds: 0.4 } },
    { id: "presentes", assetId: "presentes", purpose: "recurso: presentes no Pix", durationSeconds: 4.2, motion: { type: "pan_down", intensity: 0.35 }, framing: fr("presentes", 0.3), transitionIn: { type: "push_left", durationSeconds: 0.45 }, overlays: label("Presentes no Pix, sem taxas") },
    { id: "fotos", assetId: "fotos", purpose: "recurso: álbum", durationSeconds: 4.2, motion: { type: "pan_up", intensity: 0.35 }, framing: fr("fotos", 0.5), transitionIn: { type: "push_left", durationSeconds: 0.45 }, overlays: label("Álbum colaborativo") },
    { id: "demo", assetId: "demo", purpose: "visão geral", durationSeconds: 3.4, motion: { type: "pull_out", intensity: 0.25 }, framing: fr("demo", 0.3), transitionIn: { type: "cross_dissolve", durationSeconds: 0.4 } },
    { id: "cta", assetId: "card", purpose: "encerramento", durationSeconds: 3.0, motion: { type: "static", intensity: 0 }, framing: { fit: "fill", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "cross_dissolve", durationSeconds: 0.4 }, overlays: [{ id: "cta", role: "cta", text: "Crie o seu no Rumo ao Altar", startOffsetSeconds: 0.2, durationSeconds: 2.8, position: "center", animation: "pop", style: { size: 0.085, colorHex: "#FFFFFF", bold: true, fontFamily: "Barlow Condensed" } }] },
  ]);
  const duration = end(clips);
  const narrationStart = 0.3;
  const segments = captionsFromNarration(transcript, narrationStart, duration, { glossary: [{ from: "rumo ao altar", to: "Rumo ao Altar" }, { from: "PIX", to: "Pix" }] });
  return plan({
    planId: "demo-raa",
    mode: "images_ad",
    aspect: "16:9",
    durationSeconds: duration,
    assets: [...Object.values(shots), { id: "card", kind: "card", role: "card", card: { colorHex: "#B5546B", gradientToHex: "#5E2234" } }, { id: "nar", kind: "audio", role: "narration", fileName: "demo-narration.wav", sourceDurationSeconds: narration.durationSeconds }, { id: "song", kind: "audio", role: "music", fileName: "music-original.wav", sourceDurationSeconds: 40 }],
    clips,
    narration: { assetId: "nar", startSeconds: narrationStart, gainDb: 0 },
    captions: { enabled: true, style: { size: 0.052, colorHex: "#FFFFFF", backgroundHex: "#141414", bold: true, fontFamily: "Barlow Condensed" }, position: "bottom", segments },
    music: { assetId: "song", gainDb: -12, fadeInSeconds: 0.5, fadeOutSeconds: 1.2, duckUnderSpeech: true },
    strategy: "demo-de-produto-narrado",
    prompt: "Vídeo demonstrativo com capturas reais das funcionalidades, narração e legendas.",
  });
}

function sampleFfmpegMemory() {
  return new Promise((ok) => {
    if (platform() === "win32") {
      execFile("tasklist", ["/FI", "IMAGENAME eq ffmpeg.exe", "/FO", "CSV", "/NH"], (error, stdout) => {
        if (error) return ok(0);
        const kb = stdout.split(/\r?\n/).filter((line) => line.includes("ffmpeg")).map((line) => Number(line.split('","')[4]?.replace(/[^\d]/g, "") ?? 0));
        ok(kb.reduce((a, b) => a + b, 0) * 1024);
      });
    } else {
      execFile("ps", ["-C", "ffmpeg", "-o", "rss="], (error, stdout) => ok(error ? 0 : stdout.split(/\s+/).filter(Boolean).reduce((a, b) => a + Number(b), 0) * 1024));
    }
  });
}

async function render(name, planObject) {
  const validation = validateVideoEditPlan(planObject);
  if (!validation.valid) throw new Error(`${name}: plano inválido\n${validation.issues.map((i) => ` - ${i.path}: ${i.message}`).join("\n")}`);
  const outDir = join(ROOT, "out");
  await mkdir(outDir, { recursive: true });
  const executor = new FfmpegEditExecutor({ workRoot: join(ROOT, "work"), cacheRoot: arg("--no-cache", null) === null && !process.argv.includes("--no-cache") ? join(ROOT, "cache") : undefined, ffmpeg: { threads, preset }, limits: { maxDurationSeconds: 90 } });
  const mediaSources = Object.fromEntries(planObject.assets.filter((asset) => asset.fileName).map((asset) => [asset.id, join(MAT, asset.fileName)]));
  const output = join(outDir, `${name}.mp4`);
  let peak = 0;
  const sampler = setInterval(async () => (peak = Math.max(peak, await sampleFfmpegMemory())), 400);
  const started = Date.now();
  let lastStage = "";
  const result = await executor.execute({ jobId: `b0-${name}`.toLowerCase(), plan: planObject, mediaSources, outputPath: output, onProgress: (p) => { if (p.stage !== lastStage) { lastStage = p.stage; process.stdout.write(`   ${p.stage}…\n`); } } }).finally(() => clearInterval(sampler));
  const ms = Date.now() - started;
  const info = await stat(output);
  const probeResult = await probeMedia(output);
  const analysis = await analyzeVideo(output, { hasAudio: Boolean(probeResult.audio) });
  const gate = evaluateVideoQualityGate({ plan: planObject, probe: { exists: true, sizeBytes: info.size, ...probeResult }, analysis, compilerWarnings: result.warnings, brandHasLogo: Boolean(planObject.logo) });
  const tiles = Math.min(20, Math.ceil(planObject.durationSeconds));
  await renderContactSheet(output, join(outDir, `${name}-sheet.jpg`), { everySeconds: planObject.durationSeconds / tiles, columns: planObject.aspect === "16:9" ? 4 : 5, tileWidth: planObject.aspect === "16:9" ? 480 : planObject.aspect === "1:1" ? 360 : 270, maxTiles: tiles });
  await writeFile(join(outDir, `${name}-plan.json`), JSON.stringify(planObject, null, 2));
  const report = { name, renderMs: ms, realtimeFactor: +(planObject.durationSeconds / (ms / 1000)).toFixed(2), sizeMb: +(info.size / 1e6).toFixed(2), peakFfmpegMemMb: Math.round(peak / 1e6), threads, preset, engine: result.engine, timings: result.timings, details: result.details, warnings: result.warnings, gate: { status: gate.status, failures: gate.failures, checks: gate.checks }, probe: probeResult, analysis: { black: analysis.blackSegments, meanVolumeDb: analysis.meanVolumeDb, maxVolumeDb: analysis.maxVolumeDb, decodeErrors: analysis.decodeErrors } };
  await writeFile(join(outDir, `${name}-report.json`), JSON.stringify(report, null, 2));
  console.log(`[B0] ${name}: ${planObject.durationSeconds}s em ${(ms / 1000).toFixed(1)}s (${report.realtimeFactor}x tempo real), ${report.sizeMb} MB, pico FFmpeg ${report.peakFfmpegMemMb} MB, QG ${gate.status}${gate.failures.length ? ` — ${gate.failures.join("; ")}` : ""}`);
  if (result.warnings.length) console.log(`       avisos: ${result.warnings.join(" | ")}`);
  return report;
}

async function main() {
  console.log(`[B0] máquina: ${cpus()[0]?.model} (${cpus().length} núcleos), ${(totalmem() / 1e9).toFixed(1)} GB; threads=${threads} preset=${preset}`);
  const reports = [];
  if (!only || only === "cmkv") for (const aspect of ["9:16", "1:1", "16:9"]) reports.push(await render(`cmkv-${aspect.replace(":", "x")}`, await cmkvPlan(aspect)));
  if (!only || only === "reels") reports.push(await render("reels-raa-9x16", await reelsPlan()));
  if (!only || only === "demo") reports.push(await render("demo-raa-16x9", await demoPlan()));
  await writeFile(join(ROOT, "out", `summary-${Date.now()}.json`), JSON.stringify(reports.map(({ name, renderMs, realtimeFactor, sizeMb, peakFfmpegMemMb, gate }) => ({ name, renderMs, realtimeFactor, sizeMb, peakFfmpegMemMb, gate: gate.status })), null, 2));
  if (reports.some((report) => report.gate.status !== "ready_for_review")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[B0] FALHOU: ${error.message}`);
  if (error.logTail) console.error(error.logTail.join("\n"));
  process.exitCode = 1;
});
