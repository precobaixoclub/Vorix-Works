// Motor de vídeo B (FFmpeg): contrato, texto (ASS), compilador, transcrição e executor com render real.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateVideoEditPlan } from "../dist/domain/video-editing/video-edit-plan.js";
import { buildAss, layoutText, escapeAssText, assColor, fontRegistry, resolveFont, collectTextWindows, textSimilarity } from "../dist/infrastructure/video-editing/ass-subtitles.js";
import { compileFfmpegEdit, FfmpegPlanError } from "../dist/infrastructure/video-editing/ffmpeg-edit-compiler.js";
import { FfmpegEditExecutor, VideoEditLimitError, VideoRenderCancelledError } from "../dist/infrastructure/video-editing/ffmpeg-edit-executor.js";
import { probeMedia, analyzeVideo } from "../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { evaluateVideoQualityGate } from "../dist/application/video-editing/video-quality-gate.js";
import { mergeAttachedWords, applyGlossaryToTokens, captionsFromTranscript, captionsFromNarration, snapRangeToWords, findPhraseRange, chooseFraming } from "../dist/application/video-editing/transcript-tools.js";
import { makeVideo, makeTone, cleanup } from "./helpers/fake-davinci-bridge.mjs";
import { imagesAdPlan, footagePlan, TEXT_STYLE } from "./helpers/video-edit-fixtures.mjs";

const issues = (plan) => validateVideoEditPlan(plan).issues.map((issue) => `${issue.path}: ${issue.message}`);

// ---------- contrato ----------

test("cartão de cor: sem arquivo, cor obrigatória; arquivo em cartão é recusado", () => {
  const plan = imagesAdPlan();
  plan.assets.push({ id: "card", kind: "card", role: "card", card: { colorHex: "#FBF8F2", gradientToHex: "#EADFCB" } });
  plan.clips[3].assetId = "card";
  assert.deepEqual(issues(plan), []);
  plan.assets.at(-1).fileName = "x.png";
  plan.assets.at(-1).card = { colorHex: "vermelho" };
  const found = issues(plan);
  assert.ok(found.some((i) => i.includes("cartão não tem arquivo")));
  assert.ok(found.some((i) => i.includes("cor válida")));
});

test("zoom de enquadramento limitado e mais restrito para produto protegido", () => {
  const plan = imagesAdPlan();
  plan.clips[0].framing.zoom = 3;
  plan.clips[1].framing.zoom = 1.9;
  const found = issues(plan);
  assert.ok(found.some((i) => i.startsWith("clips[0].framing.zoom") && i.includes("1–2,5")));
  assert.ok(found.some((i) => i.startsWith("clips[1].framing.zoom") && i.includes("protegidos")));
});

test("palavras da legenda precisam estar em ordem e dentro do bloco; narração precisa ser áudio", () => {
  const plan = footagePlan();
  plan.captions.segments[0].words = [{ text: "Você", startSeconds: 0.2, endSeconds: 0.5 }, { text: "perde", startSeconds: 5, endSeconds: 5.5 }];
  plan.narration = { assetId: "v1", startSeconds: 0, gainDb: 0 };
  const found = issues(plan);
  assert.ok(found.some((i) => i.includes("palavra fora")));
  assert.ok(found.some((i) => i.includes("narração deve ser um asset de áudio")));
});

// ---------- texto ----------

test("fontes empacotadas são lidas com nome de família real e medem largura", () => {
  const families = fontRegistry().map((font) => font.family);
  assert.ok(families.includes("Barlow Condensed") && families.includes("DM Serif Display"));
  const warnings = [];
  const font = resolveFont("Fonte Inexistente", warnings);
  assert.equal(font.family, "Barlow Condensed");
  assert.equal(warnings.length, 1);
  assert.ok(font.metrics.measure("WWWW", 100) > font.metrics.measure("iiii", 100));
});

test("layout quebra em até 3 linhas pela largura real e reduz a fonte quando precisa", () => {
  const { metrics } = resolveFont("Barlow Condensed", []);
  const long = layoutText("Uma frase realmente comprida para um vídeo vertical com muitas palavras e pouco espaço disponível", 0.09, metrics, 1080, 1920, 0.84);
  assert.ok(long.lines.length <= 3);
  assert.ok(long.shrunk);
  for (const line of long.lines) assert.ok(metrics.measure(line, long.sizePx) <= 1080 * 0.84 + 0.5);
  assert.throws(() => layoutText("Supercalifragilisticexpialidociousmentelongo".repeat(3), 0.05, metrics, 1080, 1920), /não cabe/);
});

test("texto do usuário não injeta comandos ASS", () => {
  assert.equal(escapeAssText("{\\pos(0,0)}oi\\N"), "(∖pos(0,0))oi∖N");
  assert.equal(assColor("#FF8800"), "&H000088FF");
});

test("ASS: área segura do 9:16, legenda repetindo CTA some, colisão muda posição, destaque por palavra", () => {
  const plan = footagePlan();
  plan.captions.segments[2] = { startSeconds: 9, endSeconds: 11.5, text: "Teste grátis já", words: [{ text: "Teste", startSeconds: 9, endSeconds: 9.4 }, { text: "grátis", startSeconds: 9.4, endSeconds: 10 }, { text: "já", startSeconds: 10, endSeconds: 10.5 }] };
  plan.captions.segments[0].words = [{ text: "Você", startSeconds: 0.2, endSeconds: 0.6 }, { text: "perde", startSeconds: 0.6, endSeconds: 1.1 }, { text: "clientes", startSeconds: 1.1, endSeconds: 1.9 }];
  const ass = buildAss(plan);
  assert.ok(ass.warnings.some((w) => w.includes("omitida")), "legenda que repete o CTA é omitida");
  const events = ass.content.split("\n").filter((line) => line.startsWith("Dialogue:"));
  assert.equal(events.filter((line) => line.includes("perde") || line.includes("clientes") || line.includes("Você")).length, 3, "um evento por palavra destacada");
  assert.ok(events.some((line) => line.includes("\\1c&H003BD4FF}perde")), "palavra falada em destaque");
  assert.ok(ass.layouts.every((layout) => layout.withinFrame));
  assert.ok(textSimilarity("Crie o seu no Rumo ao Altar", "Cria o seu no rumo ao") >= 0.6);
  // colisão: legenda na mesma posição de um título (não CTA, texto diferente) sobe
  const other = imagesAdPlan({ captions: { enabled: true, style: TEXT_STYLE, position: "top", segments: [{ startSeconds: 0.5, endSeconds: 2, text: "Legenda qualquer aqui" }] } });
  const windows = collectTextWindows(other, []);
  assert.equal(windows.find((w) => w.isCaption).position, "lower_third");
});

// ---------- compilador ----------

const facts = { p1: { hasAudio: false, width: 1200, height: 1500 }, p2: { hasAudio: false, width: 1500, height: 1000 }, p3: { hasAudio: false, width: 1000, height: 1000 }, logo: { hasAudio: false, width: 800, height: 400 }, song: { hasAudio: true, durationSeconds: 30 }, v1: { hasAudio: true, durationSeconds: 60, width: 1920, height: 1080 } };

test("compilador: passos, transições, threads por entrada e só nomes simples", () => {
  const compiled = compileFfmpegEdit({ plan: imagesAdPlan(), facts, options: { threads: 2, assFile: "texts.ass", fontsDir: "fonts" } });
  const kinds = compiled.steps.map((step) => step.kind);
  assert.equal(kinds.filter((k) => k === "base").length, 4);
  assert.equal(kinds.filter((k) => k === "clip").length, 4);
  assert.equal(kinds.at(-1), "final");
  const final = compiled.steps.at(-1).args.join(" ");
  assert.ok(final.includes("xfade=transition=fade:duration=0.5:offset=3.5"));
  assert.ok(final.includes("xfade=transition=slideleft"));
  assert.ok(final.includes("xfade=transition=zoomin"));
  assert.ok(final.includes("ass=filename=texts.ass:fontsdir=fonts"));
  assert.ok(final.includes("loudnorm=I=-14"));
  for (const step of compiled.steps) {
    const inputs = step.args.filter((_, i) => step.args[i - 1] === "-i");
    for (const input of inputs) assert.ok(!/^[A-Za-z]:|^\/|\.\./.test(input), `entrada não é nome simples: ${input}`);
    const threadFlags = step.args.filter((_, i) => step.args[i - 1] === "-threads").length;
    assert.ok(threadFlags >= inputs.length, `${step.kind} ${step.id}: limite de threads em cada entrada`);
  }
  assert.equal(compiled.totalFrames, 450);
});

test("compilador: fala com trilha usa ducking por sidechain e áudio por trecho", () => {
  const compiled = compileFfmpegEdit({ plan: footagePlan(), facts });
  const audio = compiled.steps.filter((step) => step.kind === "audio");
  assert.equal(audio.length, 3);
  assert.ok(audio[0].args.includes("12"));
  assert.ok(compiled.steps.at(-1).args.join(" ").includes("sidechaincompress"));
  assert.ok(compiled.hasAudio);
  // mídia sem áudio: aviso honesto, sem trecho de fala
  const silent = compileFfmpegEdit({ plan: footagePlan(), facts: { ...facts, v1: { ...facts.v1, hasAudio: false } } });
  assert.equal(silent.steps.filter((step) => step.kind === "audio").length, 0);
  assert.ok(silent.warnings.some((w) => w.includes("não tem áudio")));
});

test("compilador recusa plano inválido e logo sem dimensões", () => {
  const plan = imagesAdPlan();
  plan.clips = [];
  assert.throws(() => compileFfmpegEdit({ plan, facts }), FfmpegPlanError);
  const noDims = imagesAdPlan();
  delete noDims.assets[3].width;
  assert.throws(() => compileFfmpegEdit({ plan: noDims, facts: { ...facts, logo: { hasAudio: false } } }), /Logo sem dimensões/);
});

// ---------- transcrição ----------

const transcript = {
  segments: [
    { start: 10, end: 16, text: " acessa rumo ao altar.com.gr agora", words: [{ start: 10, end: 10.4, word: " acessa" }, { start: 10.4, end: 10.7, word: " rumo" }, { start: 10.7, end: 10.8, word: " ao" }, { start: 10.8, end: 11.2, word: " altar" }, { start: 11.2, end: 11.4, word: ".com" }, { start: 11.4, end: 11.6, word: ".gr" }, { start: 11.7, end: 12.2, word: " agora." }] },
    { start: 20, end: 22, text: " 100% no Pix", words: [{ start: 20, end: 20.4, word: " 100" }, { start: 20.4, end: 20.5, word: "%" }, { start: 20.6, end: 21, word: " no" }, { start: 21, end: 21.5, word: " PIX" }] },
  ],
};

test("transcrição: tokens grudados se juntam e o glossário corrige grafia sem perder o tempo", () => {
  const words = mergeAttachedWords(transcript.segments.flatMap((s) => s.words));
  assert.deepEqual(words.map((w) => w.word.trim()), ["acessa", "rumo", "ao", "altar.com.gr", "agora.", "100%", "no", "PIX"]);
  assert.deepEqual(applyGlossaryToTokens(["acessa", "rumo", "ao", "altar.", "no", "PIX"], [{ from: "rumo ao altar", to: "Rumo ao Altar" }, { from: "PIX", to: "Pix" }]), ["acessa", "Rumo", "ao", "Altar.", "no", "Pix"]);
});

test("legendas da transcrição são reposicionadas para a linha do tempo do clipe", () => {
  const clips = [{ id: "c1", assetId: "raw", purpose: "x", sourceInSeconds: 10, durationSeconds: 2.4, recordStartSeconds: 5, motion: { type: "static", intensity: 0 }, framing: { fit: "fit", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "cut", durationSeconds: 0 }, overlays: [], keepSourceAudio: true }];
  const segments = captionsFromTranscript(clips, "raw", transcript, { glossary: [{ from: "altar.com.gr", to: "altar.com.br" }] });
  assert.equal(segments[0].startSeconds, 5);
  assert.ok(segments.map((s) => s.text).join(" ").includes("altar.com.br"));
  assert.ok(segments.every((s) => s.endSeconds <= 7.4));
  const narration = captionsFromNarration(transcript, 1, 30);
  assert.equal(narration[0].startSeconds, 11);
});

test("corte não parte palavra; frase encontrada sem acento; enquadramento automático por formato", () => {
  const words = mergeAttachedWords(transcript.segments.flatMap((s) => s.words));
  const range = snapRangeToWords(words, 10.5, 11.5);
  assert.equal(range.start, 10.4, "começa no início da palavra, sem invadir a anterior");
  assert.ok(range.end >= 11.6 && range.end <= 11.7);
  assert.deepEqual(findPhraseRange(words, "Acessa rumo", "agora"), { start: 10, end: 12.2 });
  const photo = { kind: "image", width: 1440, height: 1920, protectedFidelity: true };
  assert.equal(chooseFraming(photo, "9:16"), "fill");
  assert.equal(chooseFraming(photo, "16:9"), "fit");
  assert.equal(chooseFraming({ kind: "video", width: 1920, height: 1080 }, "9:16"), "fit");
});

// ---------- executor com render real ----------

async function smallPlan(dir, overrides = {}) {
  await makeVideo(join(dir, "src-clip.mp4"), { width: 640, height: 360, fps: 30, seconds: 4 });
  await makeTone(join(dir, "src-song.wav"), 6);
  return {
    sources: { v1: join(dir, "src-clip.mp4"), song: join(dir, "src-song.wav") },
    plan: {
      version: 1, planId: "small-1", workspaceId: "ws-a", mode: "edit_footage", aspect: "1:1", width: 1080, height: 1080, fps: 30, durationSeconds: 3.5, sourceAudioGainDb: 0, strategy: "teste", prompt: "teste",
      assets: [{ id: "v1", kind: "video", role: "footage", fileName: "clip-ax.mp4", sourceDurationSeconds: 4, width: 640, height: 360 }, { id: "card", kind: "card", role: "card", card: { colorHex: "#222244", gradientToHex: "#111122" } }, { id: "song", kind: "audio", role: "music", fileName: "song-ax.wav", sourceDurationSeconds: 6 }],
      clips: [
        { id: "c1", assetId: "v1", purpose: "x", sourceInSeconds: 0.5, durationSeconds: 2, recordStartSeconds: 0, motion: { type: "push_in", intensity: 0.3 }, framing: { fit: "fit", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "cut", durationSeconds: 0 }, keepSourceAudio: true, overlays: [{ id: "t1", role: "hook", text: "Teste {\\b1} real", startOffsetSeconds: 0.2, durationSeconds: 1.5, position: "top", animation: "pop", style: TEXT_STYLE }] },
        { id: "c2", assetId: "card", purpose: "cta", sourceInSeconds: 0, durationSeconds: 1.8, recordStartSeconds: 1.7, motion: { type: "static", intensity: 0 }, framing: { fit: "fill", focusX: 0.5, focusY: 0.5 }, transitionIn: { type: "cross_dissolve", durationSeconds: 0.3 }, keepSourceAudio: false, overlays: [] },
      ],
      music: { assetId: "song", gainDb: -12, fadeInSeconds: 0.2, fadeOutSeconds: 0.5, duckUnderSpeech: true },
      ...overrides,
    },
  };
}

test("executor: MP4 real aprovado no Quality Gate, pasta do job limpa e cache por workspace com conteúdo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vorix-ff-"));
  const { plan, sources } = await smallPlan(dir);
  const executor = new FfmpegEditExecutor({ workRoot: join(dir, "work"), cacheRoot: join(dir, "cache"), ffmpeg: { threads: 2, preset: "veryfast" }, minFreeBytes: 1 });
  const stages = new Set();
  const out = join(dir, "out.mp4");
  const result = await executor.execute({ jobId: "job-ff-1", plan, mediaSources: sources, outputPath: out, onProgress: (p) => stages.add(p.stage) });
  assert.ok(existsSync(out) && result.sizeBytes > 10_000);
  for (const stage of ["staging", "rendering_clips", "rendering", "done"]) assert.ok(stages.has(stage), stage);
  assert.equal(existsSync(join(dir, "work", "jobs", "job-ff-1")), false, "pasta do job removida");
  const probe = await probeMedia(out);
  const analysis = await analyzeVideo(out, { hasAudio: true });
  const gate = evaluateVideoQualityGate({ plan, probe: { exists: true, sizeBytes: result.sizeBytes, ...probe }, analysis, compilerWarnings: result.warnings, brandHasLogo: false });
  assert.equal(gate.status, "ready_for_review", gate.failures.join("; "));

  // 2ª vez, mesmo workspace: reaproveita intermediários
  const again = await executor.execute({ jobId: "job-ff-2", plan, mediaSources: sources, outputPath: join(dir, "out2.mp4") });
  assert.ok(again.details.cacheHits >= 3);
  // outro workspace: nunca lê o cache do primeiro
  const other = await executor.execute({ jobId: "job-ff-3", plan: { ...plan, workspaceId: "ws-b" }, mediaSources: sources, outputPath: join(dir, "out3.mp4") });
  assert.equal(other.details.cacheHits, 0);
  assert.deepEqual(readdirSync(join(dir, "cache")).sort(), ["ws-a", "ws-b"]);
  // mesmo nome de arquivo, conteúdo diferente: não reaproveita o clipe antigo
  await makeVideo(sources.v1, { width: 640, height: 360, fps: 30, seconds: 4, blackFirst: 4 });
  const changed = await executor.execute({ jobId: "job-ff-4", plan, mediaSources: sources, outputPath: join(dir, "out4.mp4") });
  const clipSteps = changed.details.steps.filter((s) => s.kind === "clip" && s.id === "c1");
  assert.equal(clipSteps[0].cached, false, "conteúdo novo invalida o cache");
  await cleanup(dir);
});

test("executor: limites, mídia ausente e cancelamento (processo morto, pasta limpa)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vorix-ff-"));
  const { plan, sources } = await smallPlan(dir);
  const executor = new FfmpegEditExecutor({ workRoot: join(dir, "work"), ffmpeg: { threads: 1, preset: "veryfast" }, minFreeBytes: 1, limits: { maxDurationSeconds: 3 } });
  await assert.rejects(executor.execute({ jobId: "job-lim", plan, mediaSources: sources, outputPath: join(dir, "x.mp4") }), VideoEditLimitError);
  const ok = new FfmpegEditExecutor({ workRoot: join(dir, "work"), ffmpeg: { threads: 1, preset: "veryfast" }, minFreeBytes: 1 });
  await assert.rejects(ok.execute({ jobId: "job-miss", plan, mediaSources: { song: sources.song }, outputPath: join(dir, "x.mp4") }), /Mídia obrigatória ausente/);
  await assert.rejects(ok.execute({ jobId: "../escape", plan, mediaSources: sources, outputPath: join(dir, "x.mp4") }), /jobId inválido/);
  const controller = new AbortController();
  const run = ok.execute({ jobId: "job-cancel", plan, mediaSources: sources, outputPath: join(dir, "x.mp4"), signal: controller.signal, onProgress: (p) => { if (p.stage === "rendering_clips") controller.abort(); } });
  await assert.rejects(run, VideoRenderCancelledError);
  assert.equal(existsSync(join(dir, "work", "jobs", "job-cancel")), false);
  assert.equal(existsSync(join(dir, "x.mp4")), false);
  await cleanup(dir);
});
