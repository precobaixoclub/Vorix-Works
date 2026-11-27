// Composições do motor de vídeo (cartão, divisão com painel, paralaxe, lupa, aparelho), transições e
// movimentos novos, texto cinético e o render real de todas elas pelo FFmpeg empacotado.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { validateVideoEditPlan } from "../dist/domain/video-editing/video-edit-plan.js";
import { compileFfmpegEdit } from "../dist/infrastructure/video-editing/ffmpeg-edit-compiler.js";
import { buildAss, collectTextWindows } from "../dist/infrastructure/video-editing/ass-subtitles.js";
import { splitAreas } from "../dist/infrastructure/video-editing/scene-compositions.js";
import { FfmpegEditExecutor } from "../dist/infrastructure/video-editing/ffmpeg-edit-executor.js";
import { probeMedia, analyzeVideo, renderSceneContactSheet } from "../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { evaluateVideoQualityGate } from "../dist/application/video-editing/video-quality-gate.js";
import { buildPlanFromDraft } from "../dist/application/video-editing/build-plan-from-draft.js";
import { validateVideoEditDraftStructure } from "../dist/application/ai-gateway/schemas/video-edit-draft.v1.js";
import { compileEditPlan, PlanCompilationError } from "../dist/infrastructure/davinci-resolve/compile-edit-plan.js";
import { imagesAdPlan, TEXT_STYLE } from "./helpers/video-edit-fixtures.mjs";
import { makeTone, cleanup } from "./helpers/fake-davinci-bridge.mjs";

const require = createRequire(import.meta.url);
const ffmpeg = join(require.resolve("ffmpeg-static/package.json"), "..", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const LOOK = { backgroundHex: "#EDE6DA", accentHex: "#C9A23F", panelTextHex: "#111111" };
const issues = (plan) => validateVideoEditPlan(plan).issues.map((issue) => `${issue.path}: ${issue.message}`);
const facts = { p1: { hasAudio: false, width: 1200, height: 1500 }, p2: { hasAudio: false, width: 1500, height: 1000 }, p3: { hasAudio: false, width: 1000, height: 1000 }, logo: { hasAudio: false, width: 800, height: 400 }, song: { hasAudio: true, durationSeconds: 30 } };

function composedPlan() {
  const plan = imagesAdPlan();
  plan.look = LOOK;
  plan.clips[0].layout = "parallax";
  plan.clips[0].motion = { type: "punch_in", intensity: 0.5 };
  plan.clips[1].layout = "split";
  plan.clips[1].transitionIn = { type: "smooth_left", durationSeconds: 0.5 };
  plan.clips[1].overlays = [{ id: "o3", role: "headline", text: "Três cores", startOffsetSeconds: 0.6, durationSeconds: 3, position: "center", animation: "kinetic", style: TEXT_STYLE }];
  plan.clips[2].layout = "framed";
  plan.clips[2].motion = { type: "drift", intensity: 0.3 };
  plan.clips[2].transitionIn = { type: "circle_open", durationSeconds: 0.5 };
  plan.clips[3].layout = "inset";
  plan.clips[3].transitionIn = { type: "flash", durationSeconds: 0.5 };
  return plan;
}

test("contrato: composição exige paleta, aparelho só com captura, lupa nunca em captura, imagem de IA nunca é produto", () => {
  assert.deepEqual(issues(composedPlan()), []);
  const noLook = composedPlan();
  delete noLook.look;
  assert.ok(issues(noLook).some((i) => i.includes("clips[0]")), "layout sem look");
  const device = composedPlan();
  device.clips[2].layout = "device_phone";
  assert.ok(issues(device).some((i) => i.startsWith("clips[2]")), "aparelho com foto de produto");
  const shot = composedPlan();
  shot.assets[0].role = "screenshot";
  shot.clips[3].layout = "inset";
  assert.ok(issues(shot).some((i) => i.startsWith("clips[3]")), "lupa em captura");
  const generated = composedPlan();
  generated.assets.push({ id: "g1", kind: "image", role: "generated", fileName: "gen-x.png", width: 1024, height: 1536, protectedFidelity: true });
  assert.ok(issues(generated).some((i) => i.includes("gerada por IA")));
  const center = composedPlan();
  center.clips[2].overlays = [{ id: "o9", role: "headline", text: "No meio", startOffsetSeconds: 0.6, durationSeconds: 2, position: "center", animation: "fade", style: TEXT_STYLE }];
  center.assets[2].protectedFidelity = true;
  assert.ok(issues(center).some((i) => i.includes("centro cobre")), "fora do split o centro continua proibido");
});

test("compilador: bases compostas (cantos, sombra, painel, lupa, paralaxe em 2 camadas) e transições novas", () => {
  const compiled = compileFfmpegEdit({ plan: composedPlan(), facts, options: { threads: 2, assFile: "texts.ass", fontsDir: "fonts" } });
  const bases = compiled.steps.filter((step) => step.kind === "base");
  assert.equal(bases.length, 5, "paralaxe gera fundo e primeiro plano");
  const chains = bases.map((step) => step.args[step.args.indexOf("-filter_complex") + 1]).join("\n");
  assert.ok(chains.includes("hypot("), "cantos arredondados");
  assert.ok(chains.includes("gblur"), "sombra/fundo desfocado");
  assert.ok(chains.includes("[f]nullsink") && chains.includes("[b]nullsink"), "paralaxe exporta as duas camadas");
  const parallaxClip = compiled.steps.find((step) => step.kind === "clip" && step.id === "c1").args.join(" ");
  assert.ok(parallaxClip.includes("overlay="), "primeiro plano anda sobre o fundo");
  const final = compiled.steps.at(-1).args.join(" ");
  for (const name of ["smoothleft", "circleopen", "fadewhite"]) assert.ok(final.includes(`xfade=transition=${name}`), name);
  assert.ok(compiled.steps.every((step) => step.args.filter((_, i) => step.args[i - 1] === "-threads").length >= step.args.filter((_, i) => step.args[i - 1] === "-i").length));
});

test("texto: no split vai para o painel, sem caixa, na cor de texto da marca; cinético entra palavra a palavra", () => {
  const plan = composedPlan();
  const { content } = buildAss(plan);
  const panel = splitAreas("9:16", 1080, 1920).panel;
  const line = content.split("\n").find((l) => l.includes("Três") || l.includes("cores"));
  assert.ok(line, "evento do painel");
  const [, , y] = line.match(/\\pos\((\d+),(\d+)\)/);
  assert.ok(Number(y) > panel.y && Number(y) < panel.y + panel.h, `texto dentro do painel (y=${y})`);
  assert.ok(line.includes("\\bord0"), "sem caixa no painel");
  assert.ok(line.includes("\\1c&H00111111"), "cor de texto da marca");
  assert.equal((line.match(/\\alpha&HFF&/g) ?? []).length, 2, "cada palavra com sua entrada");
  assert.ok(line.includes("\\t(110,310"), "segunda palavra entra depois");
});

const material = (id, role, width, height, kind = "image") => ({ id, fileName: `${id.toLowerCase()}-x.${kind === "audio" ? "wav" : "png"}`, kind, role, width, height });
const scene = (materialId, layout, extra = {}) => ({ materialId, purpose: "demo", durationSeconds: 3, motion: "push_in", motionIntensity: "strong", focus: "top", transitionIn: "wipe", texts: [], ...(layout ? { layout } : {}), ...extra });
const brand = { name: "Vorix", primaryHex: "#B5546B", accentHex: "#E8C07A", lightHex: "#FFF6F2", darkHex: "#3A1520" };
const ctx = (materials) => ({ planId: "p-comp", workspaceId: "ws-a", aspect: "9:16", request: "Demo do produto", style: { editing: "dinamico", transitions: "moderadas", captions: false, music: false }, materials, transcripts: {}, sentences: [], brand });

test("construtor: paleta da marca, aparelho pela orientação da captura, lupa vira aparelho em captura, câmera contida", () => {
  const materials = [material("M1", "screenshot", 1920, 1080), material("M2", "screenshot", 900, 1950), material("M3", "product_photo", 1200, 1500)];
  const draft = { schemaVersion: 1, strategy: "demo", rationale: "", captions: false, music: "none", logo: "none", warnings: [], scenes: [
    scene("M1", "device_phone"),
    scene("M2", "device_phone"),
    scene("M1", "inset"),
    scene("M3", "split", { texts: [{ role: "headline", text: "Feita para durar", position: "center", animation: "kinetic" }] }),
    scene("M3", "device_laptop"),
  ] };
  assert.equal(validateVideoEditDraftStructure(draft).valid, true);
  const result = buildPlanFromDraft(draft, ctx(materials));
  assert.equal(result.ok, true, result.issues?.join("; "));
  const { plan } = result;
  assert.deepEqual(plan.look, { backgroundHex: "#B5546B", accentHex: "#E8C07A", panelTextHex: "#FFFFFF" });
  assert.deepEqual(plan.clips.map((clip) => clip.layout), ["device_laptop", "device_phone", "device_laptop", "split", "framed"]);
  assert.ok(plan.clips.slice(0, 4).every((clip) => clip.motion.intensity <= 0.35), "aparelho/painel com câmera contida");
  assert.equal(plan.clips[3].overlays[0].position, "center", "texto central no painel do split é permitido");
  assert.equal(plan.clips[3].overlays[0].animation, "kinetic");
  assert.ok(plan.clips.slice(1).every((clip) => clip.transitionIn.type === "wipe" && clip.transitionIn.durationSeconds > 0), "wipe sobrepõe as cenas");
});

test("DaVinci (estacionado) recusa explicitamente as composições e efeitos que só o FFmpeg tem", () => {
  assert.throws(() => compileEditPlan(composedPlan(), { jobId: "job-x" }), (error) => error instanceof PlanCompilationError && /composição "parallax"/.test(error.message) && /texto cinético/.test(error.message) && /movimento "punch_in"/.test(error.message));
});

test("região de origem validada, preservada no plano e ampliada sem reenquadramento", () => {
  const input = { schemaVersion: 1, strategy: "detalhe", rationale: "", captions: false, music: "none", logo: "none", warnings: [], scenes: [
    scene("M1", "full", { region: { x: 0.27, y: 0.31, width: 0.52, height: 0.24 } }),
    scene("M2", "stage"),
  ] };
  const materials = [material("M1", "screenshot", 1920, 1080), material("M2", "product_photo", 1200, 1500)];
  assert.equal(validateVideoEditDraftStructure(input).valid, true);
  const plan = buildPlanFromDraft(input, ctx(materials)).plan;
  assert.deepEqual(plan.clips[0].framing.region, input.scenes[0].region);
  assert.equal(plan.clips[0].framing.fit, "fit");
  assert.equal(plan.clips[0].motion.type, "static");
  assert.equal(plan.clips[1].layout, "stage");
  assert.deepEqual(issues(plan), []);
  const invalid = structuredClone(input);
  invalid.scenes[0].region.width = 0.9;
  assert.equal(validateVideoEditDraftStructure(invalid).valid, false);
  invalid.scenes[0].region.width = 0.52;
  invalid.scenes[0].layout = "stage";
  assert.equal(buildPlanFromDraft(invalid, ctx(materials)).ok, false);
});

function makeImage(output, width, height, source = "testsrc2") {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-y", "-f", "lavfi", "-i", `${source}=s=${width}x${height}:d=1`, "-frames:v", "1", output], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-400)))));
  });
}

test("render real: todas as composições num MP4 aprovado pelo Quality Gate", { timeout: 300_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "vorix-comp-"));
  try {
    await makeImage(join(dir, "photo.png"), 600, 750);
    await makeImage(join(dir, "shot.png"), 960, 540, "rgbtestsrc");
    await makeTone(join(dir, "song.wav"), 12);
    const materials = [{ ...material("M1", "product_photo", 600, 750), fileName: "m1-x.png" }, { ...material("M2", "screenshot", 960, 540), fileName: "m2-x.png" }, { ...material("SONG", "music", undefined, undefined, "audio"), durationSeconds: 12 }];
    const draft = { schemaVersion: 1, strategy: "todas", rationale: "", captions: false, music: "subtle", logo: "none", warnings: [], scenes: [
      scene("M1", "parallax", { motion: "punch_in", transitionIn: "cut", durationSeconds: 1.6, texts: [{ role: "hook", text: "Novidade", position: "top", animation: "kinetic" }] }),
      scene("M1", "framed", { motion: "drift", transitionIn: "smooth_left", durationSeconds: 1.6 }),
      scene("M1", "inset", { transitionIn: "circle_open", durationSeconds: 1.6 }),
      scene("M1", "split", { transitionIn: "blur", durationSeconds: 1.6, texts: [{ role: "headline", text: "Painel da marca", position: "center", animation: "fade" }] }),
      scene("M2", "device_laptop", { transitionIn: "flash", durationSeconds: 1.6 }),
      scene("M2", "full", { transitionIn: "cut", durationSeconds: 1.6, region: { x: 0.31, y: 0.12, width: 0.65, height: 0.52 } }),
      scene("M1", "full", { transitionIn: "cut", durationSeconds: 2.2, region: { x: 0.12, y: 0.1, width: 0.72, height: 0.7, start: { x: 0.8, y: 0.2, scale: 0.4 } }, texts: [{ role: "headline", text: "3 2 1", position: "bottom", animation: "countdown" }] }),
      scene("M1", "stage", { motion: "pan_right", transitionIn: "cut", durationSeconds: 1.6 }),
      scene("CARD", null, { motion: "static", transitionIn: "wipe", durationSeconds: 1.6, texts: [{ role: "cta", text: "Saiba mais", position: "center", animation: "pop" }] }),
    ] };
    const built = buildPlanFromDraft(draft, { ...ctx(materials), aspect: "1:1", musicMaterialId: "SONG", style: { editing: "dinamico", transitions: "marcantes", captions: false, music: true } });
    assert.equal(built.ok, true, built.issues?.join("; "));
    const countdown = collectTextWindows(built.plan, []).filter((window) => /^[123]$/.test(window.text));
    assert.deepEqual(countdown.map((window) => window.text), ["3", "2", "1"]);
    assert.equal(countdown[0].endSeconds, countdown[1].startSeconds);
    const executor = new FfmpegEditExecutor({ workRoot: join(dir, "work"), ffmpeg: { threads: 2, preset: "veryfast" }, minFreeBytes: 1 });
    const out = join(dir, "out.mp4");
    const result = await executor.execute({ jobId: "job-comp-1", plan: built.plan, mediaSources: { M1: join(dir, "photo.png"), M2: join(dir, "shot.png"), SONG: join(dir, "song.wav") }, outputPath: out });
    const probe = await probeMedia(out);
    const analysis = await analyzeVideo(out, { hasAudio: true });
    const gate = evaluateVideoQualityGate({ plan: built.plan, probe: { exists: true, sizeBytes: result.sizeBytes, ...probe }, analysis, compilerWarnings: result.warnings, brandHasLogo: false });
    // A vitrine usa 5 transições de propósito (cobertura do compilador): o critério audiovisual de
    // continuidade a reprova — e essa deve ser a ÚNICA reprovação (todo o resto do gate passa).
    assert.deepEqual(gate.failures.filter((failure) => !failure.startsWith("Transições consistentes")), [], gate.failures.join("; "));
    assert.ok(gate.failures.some((failure) => failure.startsWith("Transições consistentes: 5 tipos")), "excesso de tipos de transição é reprovado");
    assert.ok(Math.abs(probe.durationSeconds - built.plan.durationSeconds) < 0.2);
    assert.equal(result.warnings.filter((w) => w.includes("composição")).length, 0, result.warnings.join("; "));
    const sheet = join(dir, "sheet.jpg");
    await renderSceneContactSheet(out, sheet, built.plan);
    const sheetBytes = readFileSync(sheet);
    const sheetInfo = await sharp(sheetBytes).metadata();
    assert.equal(sheetInfo.width, 3 * 300 + 4 * 6);
    assert.equal(sheetInfo.height, 9 * 300 + 10 * 6);
    const strip = (column) => sharp(sheetBytes).extract({ left: column * 306 + 56, top: 6 * 306 + 56, width: 200, height: 160 }).greyscale().raw().toBuffer();
    const [first, last] = await Promise.all([strip(0), strip(2)]);
    assert.ok(first.reduce((sum, value, index) => sum + Math.abs(value - last[index]), 0) / first.length > 6, "o zoom muda o conteúdo visível do detalhe");
  } finally {
    await cleanup(dir);
  }
});
