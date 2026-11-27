#!/usr/bin/env node
// PROVA AUDIOVISUAL — Professional Video Engine pelo caminho de produção:
// rascunho (Codex ou de referência) → construtor (emoção, marca, batida, reenquadramento, efeitos) →
// executor (cenas Remotion antes, FFmpeg depois) → Quality Gate (técnico + audiovisual objetivo).
// A: CMKV (fotos oficiais) · B: Vorix (capturas reais) · C: gravação de tela com fala.
//
// Uso:
//   npm run build && node scripts/video/remotion-proof.mjs [--only A,B,C] [--concurrency 1] [--quality final|preview]
//     [--root artifacts] [--out remotion/prova-pro] [--before remotion/prova-r1]
//   --emit-prompts <dir>  escreve, por caso, o prompt do diretor, o schema e as imagens (para o Codex REAL)
//   --drafts <dir>        usa a saída do Codex (<dir>/<caso>-codex.json) em vez do rascunho de referência
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { FfmpegEditExecutor } from "../../dist/infrastructure/video-editing/ffmpeg-edit-executor.js";
import { probeMedia, analyzeVideo, renderContactSheet, runFfmpegCapture } from "../../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { evaluateVideoQualityGate } from "../../dist/application/video-editing/video-quality-gate.js";
import { buildPlanFromDraft } from "../../dist/application/video-editing/build-plan-from-draft.js";
import { validateVideoEditDraftStructure } from "../../dist/application/ai-gateway/schemas/video-edit-draft.v1.js";
import { buildSentences } from "../../dist/application/video-editing/transcript-tools.js";
import { analyzeBeats } from "../../dist/infrastructure/video-editing/audio-analysis.js";
import { analyzeRegionOfInterest } from "../../dist/infrastructure/video-editing/reframe-analysis.js";
import { sfxFile } from "../../dist/infrastructure/video-editing/sfx-library.js";
import { closeBrowser, renderScene, templateVersion, TEMPLATES_VERSION } from "../../motion-graphics/render.mjs";
import { directorPrompt, directorSchema, toDraft } from "../editorial/video-director.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const only = new Set((arg("--only", "A,B,C")).split(","));
const concurrency = Number(arg("--concurrency", "1"));
const quality = arg("--quality", "final");
const ROOT = resolve(arg("--root", "artifacts"));
const OUT = join(ROOT, arg("--out", "remotion/prova-pro"));
const BEFORE = join(ROOT, arg("--before", "remotion/prova-r1"));
const emitDir = arg("--emit-prompts");
const draftsDir = arg("--drafts");
const B0 = join(ROOT, "video-b0", "materials");
const CAPS = join(ROOT, "remotion", "materials");

async function material(id, path, kind, role, label) {
  const probe = await probeMedia(path);
  return { id, fileName: `${id.toLowerCase()}-src${path.slice(path.lastIndexOf("."))}`, path, kind, role, label, width: probe.video?.width, height: probe.video?.height, durationSeconds: kind === "image" ? undefined : probe.durationSeconds, hasSpeech: kind === "video" ? Boolean(probe.audio) : undefined };
}
const scene = (materialId, purpose, extra = {}) => ({ materialId, purpose, durationSeconds: 3, motion: "static", motionIntensity: "medium", focus: "center", transitionIn: "cut", texts: [], ...extra });

// Rascunhos de REFERÊNCIA (mesmos materiais e textos da prova anterior), agora com história, emoção e som.
async function caseA() {
  const materials = [await material("M1", join(B0, "cmkv-bege.jpg"), "image", "product_photo", "camiseta bege"), await material("M2", join(B0, "cmkv-preto.jpg"), "image", "product_photo", "camiseta preta"), await material("M3", join(B0, "cmkv-verde.jpg"), "image", "product_photo", "camiseta verde-militar"), await material("LOGO", join(B0, "cmkv-logo.png"), "image", "logo"), await material("MUS", join(B0, "music-original.wav"), "audio", "music")];
  const print = { x: 0.3, y: 0.255, width: 0.42, height: 0.11 };
  const draft = { schemaVersion: 1, strategy: "produto-heroi-motion", rationale: "Pista no macro da estampa, apresentação editorial, variantes lado a lado, fechamento com a marca.", story: "Um detalhe intriga (a limonada), a peça se revela, as três cores ampliam o desejo, a marca convida.", sfx: "auto", captions: false, music: "present", logo: "end", warnings: [], scenes: [
    scene("M1", "hook", { durationSeconds: 4.4, emotion: "curiosity", modality: "motion_graphics", region: print, design: { template: "detail_reveal", label: "Limonada no peito" } }),
    scene("M2", "product", { durationSeconds: 4.6, emotion: "desire", modality: "motion_graphics", transitionIn: "smooth_left", region: print, design: { template: "product_hero", kicker: "Nova estampa", headline: "Leve como o verão", label: "Estampa exclusiva" } }),
    scene("M3", "variety", { durationSeconds: 4, emotion: "sophistication", modality: "motion_graphics", transitionIn: "cross_dissolve", design: { template: "lineup", headline: "Três cores", extraMaterialIds: ["M1", "M2"] } }),
    scene("CARD", "cta", { durationSeconds: 4, emotion: "trust", modality: "motion_graphics", transitionIn: "dip_to_black", design: { template: "title_card", lines: ["Garanta a sua", "CMKV Wears"], cta: "Compre no site" } }),
  ] };
  const brand = { name: "CMKV Wears", primaryHex: "#0A0A0A", accentHex: "#C9A227", lightHex: "#FFFFFF", darkHex: "#111111", displayFont: "DM Serif Display", cardHex: "#FFFFFF", tone: "premium, editorial, streetwear sofisticado" };
  const idea = { title: "Nova estampa Limonada", keyMessage: "Camiseta com estampa exclusiva de limonada, em três cores (bege, preta, verde-militar).", cta: "Compre no site", visualDirection: "Mostrar a estampa original de perto e a peça inteira; nunca alterar a estampa." };
  return { key: "A", name: "A-cmkv", draft, materials, brand, idea, style: { editing: "elegante", transitions: "moderadas", captions: false, music: true }, logo: "LOGO", music: "MUS" };
}

async function caseB() {
  const materials = [await material("M1", join(CAPS, "cap1.png"), "image", "screenshot", "atendimento com nota interna e transferência"), await material("M2", join(CAPS, "cap3.png"), "image", "screenshot", "conversa do WhatsApp no celular"), await material("MUS", join(B0, "music-original.wav"), "audio", "music")];
  const draft = { schemaVersion: 1, strategy: "demo-funcao-motion", rationale: "Dor, prova na tela real (nota e transferência), conversa no celular e resultado.", story: "Trocar de atendente faz o cliente repetir tudo; na Vorix a nota interna leva o contexto; quem assume já sabe; conheça.", sfx: "auto", captions: false, music: "present", logo: "none", warnings: [], scenes: [
    scene("CARD", "hook", { durationSeconds: 2.6, emotion: "identification", modality: "motion_graphics", design: { template: "title_card", lines: ["Trocou de atendente?", "O contexto fica."] } }),
    scene("M1", "demo", { durationSeconds: 5, emotion: "authority", modality: "software_demo", transitionIn: "push_up", region: { x: 0.455, y: 0.23, width: 0.41, height: 0.1 }, design: { template: "software_focus", headline: "O histórico vai junto", label: "Nota interna para quem assume" } }),
    scene("M2", "proof", { durationSeconds: 2.8, emotion: "trust", modality: "software_demo", transitionIn: "smooth_left", layout: "device_phone", motion: "drift", texts: [{ role: "headline", text: "No WhatsApp do cliente", position: "top", animation: "kinetic" }] }),
    scene("M1", "benefit", { durationSeconds: 4.6, emotion: "authority", modality: "software_demo", transitionIn: "wipe", region: { x: 0.52, y: 0.41, width: 0.46, height: 0.14 }, design: { template: "software_focus", headline: "Sem o cliente repetir", label: "Quem assume já sabe tudo" } }),
    scene("CARD", "cta", { durationSeconds: 3, emotion: "urgency", modality: "motion_graphics", transitionIn: "push_up", design: { template: "title_card", lines: ["Vorix"], cta: "Conheça a Vorix" } }),
  ] };
  const brand = { name: "Vorix Works", primaryHex: "#1A0B2E", accentHex: "#B990FC", lightHex: "#F5F5F4", darkHex: "#111111", displayFont: "Barlow Condensed", tone: "tecnologia, precisão, moderno" };
  const idea = { title: "Troca de atendente sem perder o contexto", keyMessage: "Na Vorix, a nota interna e a transferência levam o histórico: o cliente não repete nada.", cta: "Conheça a Vorix", visualDirection: "Mostrar a função real na tela (nota interna e transferência) com leitura clara." };
  return { key: "B", name: "B-vorix", draft, materials, brand, idea, style: { editing: "dinamico", transitions: "moderadas", captions: false, music: true }, music: "MUS" };
}

async function caseC() {
  const transcript = JSON.parse(await readFile(join(B0, "raw-transcript.json"), "utf8"));
  const materials = [await material("M1", join(B0, "raw-recording.mp4"), "video", "screen_recording", "gravação de tela do site com narração"), await material("MUS", join(B0, "music-original.wav"), "audio", "music")];
  const sentences = buildSentences([{ materialId: "M1", transcript }]);
  const pick = (...needles) => sentences.filter((s) => needles.some((needle) => s.text.toLowerCase().includes(needle))).map((s) => s.id);
  const first = pick("lista de presentes", "taxa").slice(0, 2);
  const second = pick("convidado manda", "qr code").slice(0, 2);
  const consecutive = (ids) => ids.filter((id, i) => i === 0 || Number(id.slice(1)) === Number(ids[i - 1].slice(1)) + 1);
  const draft = { schemaVersion: 1, strategy: "fala-com-motion", rationale: "Pergunta, prova falada com legenda dinâmica, recurso de fotos e chamada.", story: "A dúvida (taxa na lista de presentes) encontra a resposta falada na tela real; as fotos por QR mostram o cuidado; crie o seu.", sfx: "auto", captions: true, music: "subtle", logo: "none", warnings: [], scenes: [
    scene("CARD", "hook", { durationSeconds: 2, emotion: "curiosity", modality: "motion_graphics", design: { template: "title_card", lines: ["Lista de presentes", "sem taxa?"] } }),
    scene("M1", "proof", { emotion: "trust", modality: "original_footage", sentenceIds: consecutive(first), layout: "framed", transitionIn: "cut", design: { template: "speech_captions", emphasis: ["taxa", "pix", "100%"] } }),
    scene("M1", "demo", { emotion: "identification", modality: "original_footage", sentenceIds: consecutive(second), layout: "framed", transitionIn: "cut", design: { template: "speech_captions", emphasis: ["fotos", "qr"] } }),
    scene("CARD", "cta", { durationSeconds: 2.8, emotion: "trust", modality: "motion_graphics", transitionIn: "cross_dissolve", design: { template: "title_card", lines: ["Rumo ao Altar"], cta: "Crie o seu site" } }),
  ] };
  const brand = { name: "Rumo ao Altar", primaryHex: "#7E3B45", accentHex: "#C7A06E", lightHex: "#F5F5F4", darkHex: "#111111", displayFont: "DM Serif Display", glossary: [{ from: "rumo ao altar", to: "Rumo ao Altar" }], tone: "acolhedor, casamento, afetivo" };
  const idea = { title: "Lista de presentes sem taxa", keyMessage: "No Rumo ao Altar os noivos recebem os presentes sem taxa e os convidados mandam fotos pelo QR code.", cta: "Crie o seu site", visualDirection: "A fala é o eixo; mostrar a tela do site enquanto ela explica." };
  return { key: "C", name: "C-fala", draft, materials, brand, idea, style: { editing: "dinamico", transitions: "moderadas", captions: true, music: true }, music: "MUS", transcripts: { M1: transcript }, sentences };
}

async function sideBySide(before, after, output) {
  if (!existsSync(before)) return false;
  const tile = (i) => `[${i}:v]scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`;
  const result = await runFfmpegCapture(["-y", "-i", before, "-i", after, "-filter_complex", `${tile(0)};${tile(1)};[v0][v1]hstack=inputs=2:shortest=0[v]`, "-map", "[v]", "-map", "1:a?", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", output], { timeoutMs: 300_000 });
  return result.exitCode === 0;
}

/** Quadros nos MESMOS instantes relativos (antes × depois) numa prancha de duas linhas. */
async function frameComparison(before, after, output) {
  if (!existsSync(before)) return false;
  const parts = [];
  for (const [index, file] of [before, after].entries()) {
    const duration = (await probeMedia(file)).durationSeconds ?? 10;
    parts.push(`[${index}:v]fps=${(6 / duration).toFixed(4)},scale=270:480:force_original_aspect_ratio=decrease,pad=270:480:(ow-iw)/2:(oh-ih)/2,setsar=1,tile=6x1:padding=4:color=white[r${index}]`);
  }
  const result = await runFfmpegCapture(["-y", "-i", before, "-i", after, "-filter_complex", `${parts.join(";")};[r0][r1]vstack=inputs=2[v]`, "-map", "[v]", "-frames:v", "1", "-q:v", "3", output], { timeoutMs: 120_000 });
  return result.exitCode === 0;
}

async function directorInputs(spec) {
  const images = [];
  const materials = [];
  for (const m of spec.materials) {
    let thumb;
    // Miniaturas na ordem dos materiais (o prompt numera "imagem anexada nº N" nessa ordem).
    if ((m.kind === "image" && m.role !== "logo") || m.kind === "video") {
      thumb = join(emitDir, `${spec.name}-${m.id}.jpg`);
      await runFfmpegCapture(["-y", ...(m.kind === "video" ? ["-ss", "3"] : []), "-i", m.path, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", thumb], { timeoutMs: 60_000 });
    }
    if (thumb) images.push(thumb);
    materials.push({ id: m.id, kind: m.kind, role: m.role, label: m.label, width: m.width, height: m.height, ...(thumb ? { thumb: true } : {}) });
  }
  const selection = { brand: spec.brand.name, brandStyle: { name: spec.brand.name, tone: spec.brand.tone }, idea: spec.idea, recentStrategies: [] };
  return { prompt: directorPrompt({ selection, materials, sentences: spec.sentences ?? [], targetSeconds: 18 }), images };
}

async function run(spec) {
  await mkdir(OUT, { recursive: true });
  if (emitDir) {
    await mkdir(emitDir, { recursive: true });
    const { prompt, images } = await directorInputs(spec);
    await writeFile(join(emitDir, `${spec.name}-prompt.txt`), prompt);
    await writeFile(join(emitDir, `${spec.name}-imagens.json`), JSON.stringify(images));
    await writeFile(join(emitDir, "schema.json"), JSON.stringify(directorSchema));
    console.log(`[prova] ${spec.name}: prompt do diretor em ${emitDir}`);
    return;
  }
  let draft = spec.draft;
  let source = "referência";
  if (draftsDir) {
    const raw = JSON.parse(await readFile(join(draftsDir, `${spec.name}-codex.json`), "utf8"));
    draft = toDraft(raw);
    source = "Codex";
  }
  const structure = validateVideoEditDraftStructure(draft);
  if (!structure.valid) throw new Error(`${spec.name}: rascunho inválido: ${structure.errors.join("; ")}`);
  const sources = Object.fromEntries(spec.materials.map((m) => [m.id, m.path]));
  // Direção audiovisual: os mesmos analisadores do worker.
  const t0 = Date.now();
  const beatInfo = spec.music ? await analyzeBeats(sources[spec.music]).catch(() => undefined) : undefined;
  const roi = {};
  for (const m of spec.materials.filter((item) => item.kind === "video" && (item.width ?? 0) > (item.height ?? 0) * 1.05)) roi[m.id] = { samples: await analyzeRegionOfInterest(m.path, { start: 0, duration: Math.min(180, m.durationSeconds ?? 60) }), aspect: m.width / m.height };
  const analysisMs = Date.now() - t0;
  const built = buildPlanFromDraft(structure.data, { planId: spec.name, workspaceId: "ws-remotion-proof", aspect: "9:16", request: "prova audiovisual", style: spec.style, materials: spec.materials, transcripts: spec.transcripts ?? {}, sentences: spec.sentences ?? [], brand: spec.brand, logoMaterialId: spec.logo, musicMaterialId: spec.music,
    ...(beatInfo?.beats.length ? { beats: { bpm: beatInfo.bpm, times: beatInfo.beats } } : {}), ...(Object.keys(roi).length ? { roi } : {}), sfxLibrary: true });
  if (!built.ok) throw new Error(`${spec.name}: plano recusado: ${built.issues.join("; ")}`);
  for (const asset of built.plan.assets) if (asset.role === "sfx") sources[asset.id] = await sfxFile(join(OUT, "sfx"), asset.id.replace(/^SFX_/, ""));
  const timings = [];
  let peakRss = 0;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 500);
  const executor = new FfmpegEditExecutor({ workRoot: join(OUT, "work"), cacheRoot: join(OUT, "cache"), ffmpeg: { threads: 2, preset: "medium" }, minFreeBytes: 1,
    sceneRenderer: { version: TEMPLATES_VERSION, versionOf: templateVersion, quality, render: async (input) => { const r = await renderScene({ ...input, concurrency, quality, cacheDir: join(OUT, "remotion-cache") }); timings.push({ scene: input.props.template, ms: r.ms, frames: r.frames }); return r; } } });
  const output = join(OUT, `${spec.name}.mp4`);
  const started = Date.now();
  let result;
  try {
    result = await executor.execute({ jobId: `prova-${spec.name.toLowerCase()}`, plan: built.plan, mediaSources: sources, outputPath: output });
  } finally {
    clearInterval(sampler);
  }
  const ms = Date.now() - started;
  const probe = await probeMedia(output);
  const analysis = await analyzeVideo(output, { hasAudio: Boolean(probe.audio) });
  const gate = evaluateVideoQualityGate({ plan: built.plan, probe: { exists: true, sizeBytes: (await stat(output)).size, ...probe }, analysis, compilerWarnings: result.warnings, brandHasLogo: Boolean(built.plan.logo) || built.plan.clips.some((c) => c.design?.props.logo) });
  const tiles = Math.min(18, Math.ceil(built.plan.durationSeconds));
  await renderContactSheet(output, join(OUT, `${spec.name}-prancha.jpg`), { everySeconds: built.plan.durationSeconds / tiles, columns: 6, tileWidth: 240, maxTiles: tiles });
  const before = join(BEFORE, `${spec.name}.mp4`);
  const compared = await sideBySide(before, output, join(OUT, `${spec.name}-antes-depois.mp4`));
  const frames = await frameComparison(before, output, join(OUT, `${spec.name}-quadros-antes-depois.jpg`));
  await writeFile(join(OUT, `${spec.name}-plano.json`), JSON.stringify(built.plan, null, 2));
  await writeFile(join(OUT, `${spec.name}-rascunho.json`), JSON.stringify(structure.data, null, 2));
  const steps = result.details?.steps ?? [];
  const design = result.details?.design ?? { total: 0, hits: 0, ms: 0 };
  const decisions = {
    story: built.plan.direction?.story,
    brandMotion: built.plan.direction?.brandMotion?.personality,
    emotions: built.plan.clips.map((c) => c.emotion ?? "-"),
    remotion: built.plan.clips.map((c) => c.design?.template ?? "ffmpeg"),
    transitions: built.plan.clips.map((c) => c.transitionIn.type),
    beat: built.plan.direction?.beat ?? null,
    bpm: beatInfo?.bpm ?? null,
    sfx: (built.plan.sfx ?? []).map((cue) => `${cue.assetId.replace("SFX_", "")}@${cue.atSeconds.toFixed(2)}s ${cue.gainDb}dB`),
    reframe: built.plan.clips.filter((c) => c.design?.props.fit === "reframe").map((c) => ({ clip: c.id, keys: c.design.props.reframe.length, screen: c.design.props.screen, cx: [Math.min(...c.design.props.reframe.map((k) => k.cx)), Math.max(...c.design.props.reframe.map((k) => k.cx))] })),
    checks: (built.plan.direction?.checks ?? []).map((c) => `${c.status} ${c.id}: ${c.detail}`),
  };
  const report = { name: spec.name, draftSource: source, quality, durationSeconds: built.plan.durationSeconds, totalMs: ms, analysisMs, remotion: timings, design, ffmpegSteps: steps.length, ffmpegCacheHits: result.details?.cacheHits ?? 0, peakNodeRssMb: Math.round(peakRss / 1048576), sizeMb: +((await stat(output)).size / 1e6).toFixed(2), gate: { status: gate.status, failures: gate.failures, warnings: gate.warnings }, decisions, builderWarnings: built.warnings, compared, frames };
  await writeFile(join(OUT, `${spec.name}-relatorio.json`), JSON.stringify(report, null, 2));
  console.log(`[prova] ${spec.name} (${source}): ${built.plan.durationSeconds}s em ${(ms / 1000).toFixed(1)}s (Remotion ${timings.map((t) => `${t.scene} ${(t.ms / 1000).toFixed(1)}s`).join(", ") || "cache"}; cache cenas ${design.hits}/${design.total}, passos ${result.details?.cacheHits ?? 0}/${steps.length}); QG ${gate.status}${gate.failures.length ? ` — ${gate.failures.join("; ")}` : ""}`);
  console.log(`         emoções ${decisions.emotions.join(",")} · batida ${decisions.beat ? `${decisions.beat.snapped}/${decisions.beat.cuts}` : "-"} · efeitos ${decisions.sfx.length} · reenquadramento ${decisions.reframe.length}${built.warnings.length ? `\n         avisos: ${built.warnings.join(" | ")}` : ""}`);
  return report;
}

try {
  for (const [key, make] of [["A", caseA], ["B", caseB], ["C", caseC]]) {
    if (!only.has(key)) continue;
    try { await run(await make()); } catch (error) {
      console.error(`[prova] ${key} FALHOU: ${error.message}`);
      for (const line of error.logTail ?? []) console.error(`         ${line}`);
      process.exitCode = 1;
    }
  }
} finally {
  await closeBrowser();
}
