#!/usr/bin/env node
// PROVA VISUAL — motion design (Remotion) + montagem FFmpeg pelo caminho de produção:
// rascunho no formato do diretor → construtor → executor (cenas Remotion antes, FFmpeg depois) → Quality Gate.
// A: CMKV (fotos oficiais) · B: Vorix (capturas reais) · C: gravação bruta com fala.
// Gera MP4, prancha, plano e um comparativo lado a lado com a versão anterior de cada peça.
// Uso: npm run build && node scripts/video/remotion-proof.mjs [--only A,B,C] [--concurrency 2]
import { mkdir, readFile, stat, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { FfmpegEditExecutor } from "../../dist/infrastructure/video-editing/ffmpeg-edit-executor.js";
import { probeMedia, analyzeVideo, renderContactSheet, runFfmpegCapture } from "../../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { evaluateVideoQualityGate } from "../../dist/application/video-editing/video-quality-gate.js";
import { buildPlanFromDraft } from "../../dist/application/video-editing/build-plan-from-draft.js";
import { validateVideoEditDraftStructure } from "../../dist/application/ai-gateway/schemas/video-edit-draft.v1.js";
import { buildSentences } from "../../dist/application/video-editing/transcript-tools.js";
import { renderScene, TEMPLATES_VERSION } from "../../motion-graphics/render.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const only = new Set((arg("--only", "A,B,C")).split(","));
const concurrency = Number(arg("--concurrency", "2"));
const ROOT = resolve(arg("--root", "artifacts"));
const OUT = join(ROOT, "remotion", "prova");
const B0 = join(ROOT, "video-b0", "materials");
const CAPS = join(ROOT, "remotion", "materials");

async function material(id, path, kind, role, label) {
  const probe = await probeMedia(path);
  return { id, fileName: `${id.toLowerCase()}-src${path.slice(path.lastIndexOf("."))}`, path, kind, role, label, width: probe.video?.width, height: probe.video?.height, durationSeconds: kind === "image" ? undefined : probe.durationSeconds, hasSpeech: kind === "video" ? Boolean(probe.audio) : undefined };
}
const scene = (materialId, purpose, extra = {}) => ({ materialId, purpose, durationSeconds: 3, motion: "static", motionIntensity: "medium", focus: "center", transitionIn: "cut", texts: [], ...extra });

async function caseA() {
  const materials = [await material("M1", join(B0, "cmkv-bege.jpg"), "image", "product_photo", "camiseta bege"), await material("M2", join(B0, "cmkv-preto.jpg"), "image", "product_photo", "camiseta preta"), await material("M3", join(B0, "cmkv-verde.jpg"), "image", "product_photo", "camiseta verde-militar"), await material("LOGO", join(B0, "cmkv-logo.png"), "image", "logo"), await material("MUS", join(B0, "music-original.wav"), "audio", "music")];
  const print = { x: 0.3, y: 0.255, width: 0.42, height: 0.11 };
  const draft = { schemaVersion: 1, strategy: "produto-heroi-motion", rationale: "Pista no macro da estampa, apresentação editorial, variantes em profundidade, detalhe real e fechamento com a marca.", captions: false, music: "present", logo: "end", warnings: [], scenes: [
    scene("M1", "hook", { durationSeconds: 4.4, modality: "motion_graphics", region: print, design: { template: "detail_reveal", label: "Limonada no peito" } }),
    scene("M2", "product", { durationSeconds: 4.6, modality: "motion_graphics", transitionIn: "smooth_left", region: print, design: { template: "product_hero", kicker: "Nova estampa", headline: "Leve como o verão", label: "Estampa exclusiva" } }),
    scene("M3", "variety", { durationSeconds: 4, modality: "motion_graphics", transitionIn: "wipe", design: { template: "lineup", headline: "Três cores", extraMaterialIds: ["M1", "M2"] } }),
    scene("CARD", "cta", { durationSeconds: 4, modality: "motion_graphics", transitionIn: "cross_dissolve", design: { template: "title_card", lines: ["Garanta a sua", "CMKV Wears"], cta: "Compre no site" } }),
  ] };
  const brand = { name: "CMKV Wears", primaryHex: "#0A0A0A", accentHex: "#C9A227", lightHex: "#FFFFFF", darkHex: "#111111", displayFont: "DM Serif Display", cardHex: "#FFFFFF" };
  return { name: "A-cmkv", draft, materials, brand, style: { editing: "elegante", transitions: "moderadas", captions: false, music: true }, logo: "LOGO", music: "MUS", before: join(ROOT, "video-b0", "b3", "cmkv-b3-9x16.mp4") };
}

async function caseB() {
  const materials = [await material("M1", join(CAPS, "cap1.png"), "image", "screenshot", "atendimento com nota interna e transferência"), await material("M2", join(CAPS, "cap3.png"), "image", "screenshot", "conversa do WhatsApp no celular"), await material("MUS", join(B0, "music-original.wav"), "audio", "music")];
  const draft = { schemaVersion: 1, strategy: "demo-funcao-motion", rationale: "Dor, prova na tela real (nota e transferência), conversa no celular e resultado.", captions: false, music: "present", logo: "none", warnings: [], scenes: [
    scene("CARD", "hook", { durationSeconds: 2.6, modality: "motion_graphics", design: { template: "title_card", lines: ["Trocou de atendente?", "O contexto fica."] } }),
    scene("M1", "demo", { durationSeconds: 5, modality: "software_demo", transitionIn: "push_up", region: { x: 0.455, y: 0.23, width: 0.41, height: 0.1 }, design: { template: "software_focus", headline: "O histórico vai junto", label: "Nota interna para quem assume" } }),
    scene("M2", "proof", { durationSeconds: 2.8, modality: "software_demo", transitionIn: "smooth_left", layout: "device_phone", motion: "drift", texts: [{ role: "headline", text: "No WhatsApp do cliente", position: "top", animation: "kinetic" }] }),
    scene("M1", "benefit", { durationSeconds: 4.6, modality: "software_demo", transitionIn: "wipe", region: { x: 0.52, y: 0.41, width: 0.46, height: 0.14 }, design: { template: "software_focus", headline: "Sem o cliente repetir", label: "Quem assume já sabe tudo" } }),
    scene("CARD", "cta", { durationSeconds: 3, modality: "motion_graphics", transitionIn: "cross_dissolve", design: { template: "title_card", lines: ["Vorix"], cta: "Conheça a Vorix" } }),
  ] };
  const brand = { name: "Vorix Works", primaryHex: "#1A0B2E", accentHex: "#B990FC", lightHex: "#F5F5F4", darkHex: "#111111", displayFont: "Barlow Condensed" };
  return { name: "B-vorix", draft, materials, brand, style: { editing: "dinamico", transitions: "moderadas", captions: false, music: true }, music: "MUS", before: join(ROOT, "video-pilot", "final", "out", "video-b-v1.mp4") };
}

async function caseC() {
  const transcript = JSON.parse(await readFile(join(B0, "raw-transcript.json"), "utf8"));
  const materials = [await material("M1", join(B0, "raw-recording.mp4"), "video", "screen_recording", "gravação de tela do site com narração"), await material("MUS", join(B0, "music-original.wav"), "audio", "music")];
  const sentences = buildSentences([{ materialId: "M1", transcript }]);
  const pick = (...needles) => sentences.filter((s) => needles.some((needle) => s.text.toLowerCase().includes(needle))).map((s) => s.id);
  const first = pick("lista de presentes", "taxa").slice(0, 2);
  const second = pick("convidado manda", "qr code").slice(0, 2);
  const consecutive = (ids) => ids.filter((id, i) => i === 0 || Number(id.slice(1)) === Number(ids[i - 1].slice(1)) + 1);
  const draft = { schemaVersion: 1, strategy: "fala-com-motion", rationale: "Pergunta, prova falada com legenda dinâmica, recurso de fotos e chamada.", captions: true, music: "subtle", logo: "none", warnings: [], scenes: [
    scene("CARD", "hook", { durationSeconds: 2, modality: "motion_graphics", design: { template: "title_card", lines: ["Lista de presentes", "sem taxa?"] } }),
    scene("M1", "proof", { modality: "original_footage", sentenceIds: consecutive(first), layout: "framed", transitionIn: "cut", design: { template: "speech_captions", emphasis: ["taxa", "pix", "100%"] } }),
    scene("M1", "demo", { modality: "original_footage", sentenceIds: consecutive(second), layout: "framed", transitionIn: "cut", design: { template: "speech_captions", emphasis: ["fotos", "qr"] } }),
    scene("CARD", "cta", { durationSeconds: 2.8, modality: "motion_graphics", transitionIn: "cross_dissolve", design: { template: "title_card", lines: ["Rumo ao Altar"], cta: "Crie o seu site" } }),
  ] };
  const brand = { name: "Rumo ao Altar", primaryHex: "#7E3B45", accentHex: "#C7A06E", lightHex: "#F5F5F4", darkHex: "#111111", displayFont: "DM Serif Display", glossary: [{ from: "rumo ao altar", to: "Rumo ao Altar" }] };
  return { name: "C-fala", draft, materials, brand, style: { editing: "dinamico", transitions: "moderadas", captions: true, music: true }, music: "MUS", transcripts: { M1: transcript }, sentences, before: join(ROOT, "video-pilot", "final", "out", "video-c-v2.mp4") };
}

async function sideBySide(before, after, output) {
  if (!existsSync(before)) return false;
  const tile = (i) => `[${i}:v]scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`;
  const result = await runFfmpegCapture(["-y", "-i", before, "-i", after, "-filter_complex", `${tile(0)};${tile(1)};[v0][v1]hstack=inputs=2:shortest=0[v]`, "-map", "[v]", "-map", "1:a?", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", output], { timeoutMs: 300_000 });
  return result.exitCode === 0;
}

async function run(spec) {
  const structure = validateVideoEditDraftStructure(spec.draft);
  if (!structure.valid) throw new Error(`${spec.name}: rascunho inválido: ${structure.errors.join("; ")}`);
  const built = buildPlanFromDraft(structure.data, { planId: spec.name, workspaceId: "ws-remotion-proof", aspect: "9:16", request: "prova motion design", style: spec.style, materials: spec.materials, transcripts: spec.transcripts ?? {}, sentences: spec.sentences ?? [], brand: spec.brand, logoMaterialId: spec.logo, musicMaterialId: spec.music });
  if (!built.ok) throw new Error(`${spec.name}: plano recusado: ${built.issues.join("; ")}`);
  await mkdir(OUT, { recursive: true });
  const timings = [];
  const executor = new FfmpegEditExecutor({ workRoot: join(OUT, "work"), cacheRoot: join(OUT, "cache"), ffmpeg: { threads: 2, preset: "medium" }, minFreeBytes: 1,
    sceneRenderer: { version: TEMPLATES_VERSION, render: async (input) => { const r = await renderScene({ ...input, concurrency, cacheDir: join(OUT, "remotion-cache") }); timings.push({ scene: input.props.template, ms: r.ms, frames: r.frames }); return r; } } });
  const output = join(OUT, `${spec.name}.mp4`);
  const started = Date.now();
  const result = await executor.execute({ jobId: `prova-${spec.name.toLowerCase()}`, plan: built.plan, mediaSources: Object.fromEntries(spec.materials.map((m) => [m.id, m.path])), outputPath: output });
  const ms = Date.now() - started;
  const probe = await probeMedia(output);
  const analysis = await analyzeVideo(output, { hasAudio: Boolean(probe.audio) });
  const gate = evaluateVideoQualityGate({ plan: built.plan, probe: { exists: true, sizeBytes: (await stat(output)).size, ...probe }, analysis, compilerWarnings: result.warnings, brandHasLogo: Boolean(built.plan.logo) || built.plan.clips.some((c) => c.design?.props.logo) });
  const tiles = Math.min(18, Math.ceil(built.plan.durationSeconds));
  await renderContactSheet(output, join(OUT, `${spec.name}-prancha.jpg`), { everySeconds: built.plan.durationSeconds / tiles, columns: 6, tileWidth: 240, maxTiles: tiles });
  const compared = await sideBySide(spec.before, output, join(OUT, `${spec.name}-antes-depois.mp4`));
  await writeFile(join(OUT, `${spec.name}-plano.json`), JSON.stringify(built.plan, null, 2));
  const report = { name: spec.name, durationSeconds: built.plan.durationSeconds, totalMs: ms, remotion: timings, steps: result.details?.steps, sizeMb: +((await stat(output)).size / 1e6).toFixed(2), gate: { status: gate.status, failures: gate.failures }, builderWarnings: built.warnings, compared };
  await writeFile(join(OUT, `${spec.name}-relatorio.json`), JSON.stringify(report, null, 2));
  console.log(`[prova] ${spec.name}: ${built.plan.durationSeconds}s em ${(ms / 1000).toFixed(1)}s (Remotion ${timings.map((t) => `${t.scene} ${(t.ms / 1000).toFixed(1)}s`).join(", ")}); QG ${gate.status}${gate.failures.length ? ` — ${gate.failures.join("; ")}` : ""}${built.warnings.length ? `\n         avisos: ${built.warnings.join(" | ")}` : ""}`);
  return report;
}

for (const [key, make] of [["A", caseA], ["B", caseB], ["C", caseC]]) {
  if (!only.has(key)) continue;
  try { await run(await make()); } catch (error) { console.error(`[prova] ${key} FALHOU: ${error.message}`); process.exitCode = 1; }
}
