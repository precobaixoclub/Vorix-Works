// Motion design (Remotion) no motor de vídeo: contrato do plano, construtor (templates por material, logo e
// legendas sem duplicar), executor (cena renderizada antes do FFmpeg, cache pela versão dos templates) e diretor.
// O Chromium não é usado aqui: um renderizador SIMULADO gera o MP4 da cena com o FFmpeg empacotado.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateVideoEditPlan } from "../dist/domain/video-editing/video-edit-plan.js";
import { buildPlanFromDraft } from "../dist/application/video-editing/build-plan-from-draft.js";
import { validateVideoEditDraftStructure } from "../dist/application/ai-gateway/schemas/video-edit-draft.v1.js";
import { FfmpegEditExecutor } from "../dist/infrastructure/video-editing/ffmpeg-edit-executor.js";
import { probeMedia, runFfmpegCapture } from "../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { toDraft, directorSchema, directorPrompt } from "../scripts/editorial/video-director.mjs";
import { cleanup, makeTone } from "./helpers/fake-davinci-bridge.mjs";

const brand = { name: "CMKV", primaryHex: "#0A0A0A", accentHex: "#C9A227", lightHex: "#FFFFFF", darkHex: "#111111", displayFont: "DM Serif Display", cardHex: "#FFFFFF" };
const photo = (id) => ({ id, fileName: `${id.toLowerCase()}-src.jpg`, kind: "image", role: "product_photo", width: 1440, height: 1920 });
const ctx = (materials, extra = {}) => ({ planId: "p", workspaceId: "ws", aspect: "9:16", request: "Pauta: estampa", style: { editing: "elegante", transitions: "moderadas", captions: true, music: false }, materials, transcripts: {}, sentences: [], brand, ...extra });
const scene = (materialId, purpose, extra = {}) => ({ materialId, purpose, durationSeconds: 3, motion: "static", motionIntensity: "medium", focus: "center", transitionIn: "cut", texts: [], ...extra });
const draft = (scenes, extra = {}) => ({ schemaVersion: 1, strategy: "s", rationale: "", captions: false, music: "none", logo: "end", warnings: [], scenes, ...extra });
const print = { x: 0.3, y: 0.25, width: 0.4, height: 0.12 };

test("construtor: props das cenas animadas, região obrigatória, logo e textos só na cena animada", () => {
  const logo = { id: "LOGO", fileName: "logo-src.png", kind: "image", role: "logo", width: 600, height: 300 };
  const d = draft([
    scene("M1", "hook", { region: print, design: { template: "detail_reveal", label: "Limonada no peito" } }),
    scene("M2", "product", { region: print, texts: [{ role: "headline", text: "ignorado", position: "top", animation: "fade" }], design: { template: "product_hero", kicker: "Nova estampa", headline: "Leve como o verão", label: "Estampa exclusiva" } }),
    scene("M3", "variety", { design: { template: "detail_reveal", label: "sem região" } }),
    scene("CARD", "cta", { design: { template: "title_card", lines: ["Garanta a sua"], cta: "Compre no site" } }),
  ]);
  assert.equal(validateVideoEditDraftStructure(d).valid, true);
  const built = buildPlanFromDraft(d, ctx([photo("M1"), photo("M2"), photo("M3"), logo], { logoMaterialId: "LOGO" }));
  assert.equal(built.ok, true, built.issues?.join("; "));
  const [reveal, hero, fallback, closing] = built.plan.clips;
  assert.deepEqual(reveal.design.props.detail, { x: 0.3, y: 0.25, w: 0.4, h: 0.12 });
  assert.equal(reveal.design.props.photo, "m1-src.jpg");
  assert.equal(hero.design.template, "product_hero");
  assert.equal(hero.overlays.length, 0, "textos ficam na cena animada");
  assert.equal(fallback.design, undefined, "detalhe sem região: cena segue sem animação");
  assert.ok(built.warnings.some((w) => w.includes("detail_reveal indisponível")));
  assert.equal(closing.design.props.logo, "logo-src.png");
  assert.equal(closing.design.props.background, "light", "logo para fundo claro: encerramento claro");
  assert.equal(built.plan.logo, undefined, "a logo não é sobreposta duas vezes");
  assert.deepEqual(validateVideoEditPlan(built.plan).issues, []);
  const bad = structuredClone(built.plan);
  bad.clips[0].design.props.photo = "outra.jpg";
  bad.clips[1].design.template = "explosao";
  const issues = validateVideoEditPlan(bad).issues.map((i) => i.message);
  assert.ok(issues.some((m) => m.includes("não pertence ao plano")));
  assert.ok(issues.some((m) => m.includes("template de motion design desconhecido")));
});

test("construtor: fala animada leva as palavras do trecho (tempo relativo) e tira a legenda duplicada", () => {
  const words = ["Os", "noivos", "recebem", "tudo", "sem", "taxa."].map((w, i) => ({ word: ` ${w}`, start: 10 + i * 0.5, end: 10 + i * 0.5 + 0.4 }));
  const transcript = { segments: [{ start: 10, end: 13, text: words.map((w) => w.word).join(""), words }] };
  const video = { id: "M1", fileName: "m1-src.mp4", kind: "video", role: "screen_recording", width: 1920, height: 1080, durationSeconds: 30, hasSpeech: true };
  const sentences = [{ id: "S1", materialId: "M1", start: 10, end: 12.9, text: "Os noivos recebem tudo sem taxa." }];
  const d = draft([scene("M1", "proof", { sentenceIds: ["S1"], layout: "framed", design: { template: "speech_captions", emphasis: ["taxa"] } }), scene("CARD", "cta", { texts: [{ role: "cta", text: "Crie o seu", position: "center", animation: "pop" }] })], { captions: true, logo: "none" });
  const built = buildPlanFromDraft(d, ctx([video], { transcripts: { M1: transcript }, sentences }));
  assert.equal(built.ok, true, built.issues?.join("; "));
  const props = built.plan.clips[0].design.props;
  assert.equal(props.fit, "contain", "gravação de tela inteira");
  assert.ok(props.words[0].start >= 0 && props.words[0].start < 0.3, "tempo relativo ao trecho (com a folga antes da palavra)");
  assert.deepEqual(props.emphasis, ["taxa"]);
  assert.equal(built.plan.clips[0].keepSourceAudio, true);
  assert.ok(!built.plan.captions?.segments?.length, "sem legenda duplicada no trecho animado");
});

function fakeRenderer(version) {
  const calls = [];
  return { calls, renderer: { version, render: async ({ outputPath, props }) => {
    calls.push(props.template);
    const seconds = (props.durationInFrames / props.fps).toFixed(3);
    const result = await runFfmpegCapture(["-y", "-f", "lavfi", "-i", `testsrc2=s=${props.width}x${props.height}:r=${props.fps}:d=${seconds}`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", outputPath], { timeoutMs: 120_000 });
    assert.equal(result.exitCode, 0);
    return { ms: 1 };
  } } };
}

test("executor: cena animada renderizada antes do FFmpeg, cache pela versão dos templates, sem renderizador = erro claro", { timeout: 300_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "vorix-md-"));
  try {
    await runFfmpegCapture(["-y", "-f", "lavfi", "-i", "testsrc2=s=1440x1920", "-frames:v", "1", join(dir, "m1.jpg")]);
    await makeTone(join(dir, "song.wav"), 10);
    const d = draft([scene("M1", "product", { durationSeconds: 2.5, region: print, design: { template: "product_hero", headline: "Leve" } }), scene("CARD", "cta", { durationSeconds: 2, transitionIn: "cross_dissolve", texts: [{ role: "cta", text: "Compre", position: "center", animation: "pop" }] })], { logo: "none" });
    const built = buildPlanFromDraft(d, ctx([photo("M1")]));
    assert.equal(built.ok, true, built.issues?.join("; "));
    const sources = { M1: join(dir, "m1.jpg") };
    const run = async (renderer, id) => new FfmpegEditExecutor({ workRoot: join(dir, "work"), cacheRoot: join(dir, "cache"), ffmpeg: { threads: 2, preset: "ultrafast" }, minFreeBytes: 1, ...(renderer ? { sceneRenderer: renderer } : {}) })
      .execute({ jobId: `job-md-${id}`, plan: built.plan, mediaSources: sources, outputPath: join(dir, `out-${id}.mp4`) });
    const first = fakeRenderer("v1");
    await run(first.renderer, 1);
    const probe = await probeMedia(join(dir, "out-1.mp4"));
    assert.ok(Math.abs(probe.durationSeconds - built.plan.durationSeconds) < 0.2);
    assert.deepEqual(first.calls, ["product_hero"]);
    const same = fakeRenderer("v1");
    await run(same.renderer, 2);
    assert.deepEqual(same.calls, [], "mesma versão e mesmas props: cena do cache");
    const changed = fakeRenderer("v2");
    await run(changed.renderer, 3);
    assert.deepEqual(changed.calls, ["product_hero"], "template novo: renderiza de novo");
    // Versão por template: mudar OUTRO template não invalida esta cena; mudar o dela, sim.
    const other = fakeRenderer("v3");
    other.renderer.versionOf = (template) => (template === "product_hero" ? "p1" : "x2");
    await run(other.renderer, 5);
    assert.deepEqual(other.calls, ["product_hero"]);
    const otherChanged = fakeRenderer("v4");
    otherChanged.renderer.versionOf = (template) => (template === "product_hero" ? "p1" : "x3");
    await run(otherChanged.renderer, 6);
    assert.deepEqual(otherChanged.calls, [], "outro template mudou: esta cena continua no cache");
    await assert.rejects(run(undefined, 4), /renderizador de cenas não está disponível/);
  } finally {
    await cleanup(dir);
  }
});

test("diretor: campo design no schema estrito e na conversão do rascunho", () => {
  const props = directorSchema.properties.scenes.items;
  assert.ok(props.required.includes("design"));
  assert.deepEqual([...props.properties.design.required].sort(), ["cta", "emphasis", "extraMaterialIds", "headline", "kicker", "label", "lines", "template"]);
  const out = toDraft({ strategy: "s", rationale: "", captions: false, music: "none", logo: "end", warnings: [], scenes: [{ materialId: "M1", purpose: "product", modality: "motion_graphics", motionPrompt: null, design: { template: "product_hero", kicker: null, headline: " Leve como o verão ", label: null, lines: [], cta: null, emphasis: [], extraMaterialIds: [] }, durationSeconds: 3, sentenceIds: [], sourceStartSeconds: null, motion: "static", layout: "full", motionIntensity: "medium", focus: "center", region: null, transitionIn: "cut", texts: [] }] });
  assert.deepEqual(out.scenes[0].design, { template: "product_hero", headline: "Leve como o verão" });
  assert.equal(validateVideoEditDraftStructure(out).valid, true);
  assert.match(directorPrompt({ selection: { brand: "CMKV", idea: { title: "t" } }, materials: [] }), /MOTION DESIGN/);
});
