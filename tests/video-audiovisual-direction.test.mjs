// Professional Video Engine: Emotion Engine, Brand Motion, Beat Sync, Sound Design, Smart Reframing,
// Visual Composition (layout sem sobreposição), contrato do plano, compilador (barramento de efeitos) e diretor.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { EMOTIONS, brandMotionProfile, sceneDirection, snapCutsToBeats, planSfx, audiovisualChecks, readingSeconds } from "../dist/application/video-editing/audiovisual-direction.js";
import { smoothReframeTrack } from "../dist/application/video-editing/reframe-track.js";
import { applyAudiovisualDirection, SCREEN_WINDOW } from "../dist/application/video-editing/apply-audiovisual-direction.js";
import { beatsFromSamples } from "../dist/infrastructure/video-editing/audio-analysis.js";
import { sfxFile } from "../dist/infrastructure/video-editing/sfx-library.js";
import { buildPlanFromDraft } from "../dist/application/video-editing/build-plan-from-draft.js";
import { validateVideoEditPlan } from "../dist/domain/video-editing/video-edit-plan.js";
import { validateVideoEditDraftStructure } from "../dist/application/ai-gateway/schemas/video-edit-draft.v1.js";
import { compileFfmpegEdit } from "../dist/infrastructure/video-editing/ffmpeg-edit-compiler.js";
import { probeMedia } from "../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { toDraft, directorSchema, directorPrompt, EMOTIONS as DIRECTOR_EMOTIONS } from "../scripts/editorial/video-director.mjs";

// ---------------------------------------------------------------- Emotion Engine × Brand Motion

test("emoção muda de verdade ritmo, intensidade, curva, transição, som e composição", () => {
  const brand = brandMotionProfile({ tone: "moderno e direto", businessKind: "software" });
  const urgency = sceneDirection(brand, "urgency");
  const trust = sceneDirection(brand, "trust");
  assert.ok(urgency.pace < trust.pace, "urgência é mais rápida");
  assert.ok(urgency.intensity > trust.intensity, "urgência move mais");
  assert.ok(urgency.sfxDensity > trust.sfxDensity, "urgência tem mais efeitos");
  assert.notEqual(urgency.easing, trust.easing);
  assert.equal(urgency.composition, "tight");
  assert.equal(trust.composition, "airy");
  // Toda emoção tem um perfil completo; transição sempre dentro da família da marca (ou corte).
  for (const emotion of EMOTIONS) {
    const d = sceneDirection(brand, emotion);
    assert.ok(d.pace > 0.5 && d.pace < 1.6, emotion);
    assert.ok(d.intensity >= 0.4 && d.intensity <= 1.5, emotion);
    assert.ok(brand.transitions.includes(d.transition) || d.transition === "cut", `${emotion}: ${d.transition}`);
  }
  assert.deepEqual([...DIRECTOR_EMOTIONS], [...EMOTIONS], "diretor e motor usam a mesma lista de emoções");
});

test("marcas diferentes não viram o mesmo template", () => {
  const cmkv = brandMotionProfile({ tone: "premium, editorial", displayFont: "DM Serif Display" });
  const vorix = brandMotionProfile({ tone: "tecnologia, precisão", businessKind: "software" });
  const raa = brandMotionProfile({ tone: "acolhedor, casamento" });
  const personalities = new Set([cmkv.personality, vorix.personality, raa.personality]);
  assert.equal(personalities.size, 3);
  assert.notEqual(cmkv.radius, vorix.radius);
  assert.notEqual(cmkv.sfxPalette, vorix.sfxPalette);
  assert.notDeepEqual(cmkv.transitions, vorix.transitions);
  // Marca elegante nunca ganha quique, mesmo numa cena de surpresa.
  assert.equal(sceneDirection(cmkv, "surprise").overshoot, 0);
  assert.notEqual(sceneDirection(cmkv, "surprise").easing, "back");
  // O tom da marca vence o tipo de negócio deduzido do material (gravação de tela não vira "tech").
  assert.equal(brandMotionProfile({ tone: "acolhedor, casamento", businessKind: "software" }).personality, "warm");
  assert.equal(brandMotionProfile({ tone: "", businessKind: "software" }).personality, "tech");
  // Configuração explícita da empresa prevalece.
  assert.equal(brandMotionProfile({ tone: "premium", override: { radius: 40 } }).radius, 40);
});

// ---------------------------------------------------------------- Beat Sync

test("batidas: cortes encaixam sem ferir o tempo de leitura nem mexer em fala", () => {
  const beats = Array.from({ length: 40 }, (_, i) => i * 0.6);
  const minimums = [1.2, 2.6, 1.2, 1.2];
  const result = snapCutsToBeats({ durations: [3.1, 2.7, 3.05, 3], overlaps: [0, 0, 0, 0], flexible: [true, true, false, true], minimums, beats });
  assert.equal(result.cuts, 3);
  assert.ok(result.snapped >= 1);
  result.durations.forEach((duration, i) => assert.ok(duration >= minimums[i], `cena ${i + 1} abaixo do mínimo de leitura`));
  assert.equal(result.durations[2], 3.05, "cena fixa (fala) não muda");
  // Primeiro corte (3,1 s) cai na batida 3,0.
  assert.equal(result.durations[0], 3);
  // Longe da batida (além da tolerância): fica como está.
  const far = snapCutsToBeats({ durations: [3.3], overlaps: [0, 0], flexible: [true, true], minimums: [1.2, 1.2], beats: [0, 3.6] });
  assert.equal(far.snapped, 0);
  assert.ok(readingSeconds(["Garanta a sua hoje mesmo no site"]) > 2);
});

test("detecção de batida: trilha de cliques a 120 BPM", () => {
  const rate = 8000;
  const samples = new Float32Array(rate * 12);
  for (let t = 0.25; t < 12; t += 0.5) for (let i = 0; i < 200; i += 1) samples[Math.round(t * rate) + i] = Math.exp(-i / 40) * (i % 2 ? 0.9 : -0.9);
  const result = beatsFromSamples(samples, rate);
  assert.ok(Math.abs(result.bpm - 120) < 4 || Math.abs(result.bpm - 60) < 2, `bpm ${result.bpm}`);
  assert.ok(result.beats.length >= 10);
  const offGrid = result.beats.filter((b) => Math.abs(((b - 0.25) / 0.5) - Math.round((b - 0.25) / 0.5)) > 0.2);
  assert.ok(offGrid.length <= result.beats.length * 0.2, "batidas na fase dos cliques");
});

// ---------------------------------------------------------------- Sound Design

test("equilíbrio de animação: fala legendada é material original; animação decorativa em excesso reprova", () => {
  const clip = (template, transition = "cut") => ({ durationSeconds: 4, transition, texts: [], ...(template ? { design: { template } } : {}) });
  const status = (clips) => audiovisualChecks({ durationSeconds: 16, clips, sfx: [], speech: [] }).find((c) => c.id === "animation_balance").status;
  assert.equal(status([clip("title_card"), clip("speech_captions"), clip("speech_captions"), clip("title_card")]), "pass");
  assert.equal(status([clip("detail_reveal"), clip("product_hero"), clip("lineup"), clip("title_card")]), "fail", "4/4 decorativas");
  assert.equal(status([clip(null), clip("software_focus"), clip("software_focus"), clip("title_card")]), "fail", "mesmo template decorativo em sequência");
  assert.equal(status([clip(null), clip("product_hero"), clip("lineup"), clip("title_card")]), "pass");
});

test("efeitos: sem excesso, sem repetição próxima, discretos sob a fala", () => {
  const events = Array.from({ length: 30 }, (_, i) => ({ atSeconds: i * 0.5, kind: i % 3 ? "transition" : "reveal", strength: 0.8, clipIndex: i % 5 }));
  const cues = planSfx({ events, durationSeconds: 15, density: () => 0.8, palette: "crisp", speech: [{ start: 6, end: 10 }] });
  assert.ok(cues.length <= Math.round((15 / 2.2) * 0.8));
  for (let i = 1; i < cues.length; i += 1) assert.ok(cues[i].atSeconds - cues[i - 1].atSeconds >= 0.9 - 1e-6, "espaçamento mínimo");
  for (const cue of cues) {
    const same = cues.filter((other) => other !== cue && other.kind === cue.kind && Math.abs(other.atSeconds - cue.atSeconds) < 2.5);
    assert.equal(same.length, 0, "mesmo efeito repetido em sequência");
    if (cue.atSeconds >= 6 && cue.atSeconds <= 10) assert.ok(cue.gainDb <= -20, "efeito sob fala precisa ficar baixo");
  }
  // Emoção calma: poucos efeitos ou nenhum.
  const calm = planSfx({ events, durationSeconds: 15, density: () => 0.1, palette: "soft", speech: [] });
  assert.equal(calm.length, 0);
});

test("biblioteca de efeitos própria: gera WAV curto, estéreo, sem clipar, e reaproveita", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sfx-"));
  const file = await sfxFile(dir, "whoosh");
  assert.ok(existsSync(file));
  const probe = await probeMedia(file);
  assert.ok(probe.audio);
  assert.ok(probe.durationSeconds > 0.1 && probe.durationSeconds < 2.5, `duração ${probe.durationSeconds}`);
  const mtime = statSync(file).mtimeMs;
  assert.equal(await sfxFile(dir, "whoosh"), file);
  assert.equal(statSync(file).mtimeMs, mtime, "arquivo reaproveitado, não regerado");
});

// ---------------------------------------------------------------- Smart Reframing

test("reenquadramento: zona morta, velocidade máxima, mudança sustentada e recorte dentro da mídia", () => {
  const samples = [];
  for (let i = 0; i <= 40; i += 1) {
    const t = i * 0.25;
    // Tremida em volta de 0,3 até 4 s; depois o interesse vai para 0,8 e fica.
    const cx = t < 4 ? 0.3 + (i % 2 ? 0.03 : -0.03) : 0.8;
    samples.push({ t, cx, cy: 0.5, weight: 0.8 });
  }
  const keys = smoothReframeTrack(samples, { sourceAspect: 16 / 9, targetAspect: 9 / 16 });
  const cropW = (9 / 16) / (16 / 9);
  const early = keys.filter((k) => k.t < 4).map((k) => k.cx);
  assert.ok(Math.max(...early) - Math.min(...early) < 1e-6, "não persegue tremida");
  for (let i = 1; i < keys.length; i += 1) {
    assert.ok(Math.abs(keys[i].cx - keys[i - 1].cx) <= 0.18 * 0.25 + 1e-6, "sem chicote");
    assert.ok(keys[i].cx >= cropW / 2 - 1e-6 && keys[i].cx <= 1 - cropW / 2 + 1e-6, "recorte fora da mídia");
  }
  assert.ok(keys.at(-1).cx > 0.6, "segue o novo interesse quando ele se sustenta");
  assert.ok(keys.find((k) => k.t === 4.25).cx < 0.35, "espera o interesse se sustentar");
});

// ---------------------------------------------------------------- Visual Composition (templates)

async function loadLayout() {
  const require = createRequire(join(process.cwd(), "motion-graphics", "package.json"));
  const esbuild = require("esbuild");
  const code = esbuild.transformSync(readFileSync(join("motion-graphics", "src", "lib", "layout.ts"), "utf8"), { loader: "ts", format: "esm" }).code;
  const dir = mkdtempSync(join(tmpdir(), "layout-"));
  const file = join(dir, "layout.mjs");
  (await import("node:fs")).writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}

test("composição: vitrine sem sobreposição e lupa da tela dentro da área segura", async () => {
  const { lineupRects, softwareFocusLayout, overlaps, inside } = await loadLayout();
  const box = { top: 0.12 * 1920, bottom: 1920 - 0.22 * 1920, left: 0.06 * 1080, right: 1080 - 0.14 * 1080 };
  box.width = box.right - box.left;
  box.height = box.bottom - box.top;
  for (const aspect of [0.75, 1, 0.8]) {
    for (const n of [2, 3]) {
      const rects = lineupRects(n, aspect, box, 200);
      assert.equal(rects.length, n);
      for (const rect of rects) {
        assert.ok(inside(rect, box), `fora da área segura (n=${n}, aspect=${aspect})`);
        assert.ok(Math.abs(rect.w / rect.h - aspect) < 1e-6, "proporção da foto preservada");
      }
      for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) assert.equal(overlaps(rects[i], rects[j], 27), false, `cartões ${i} e ${j} se sobrepõem`);
    }
  }
  const layout = softwareFocusLayout(16 / 9, { x: 0.6, y: 0.1, w: 0.3, h: 0.25 }, box, 170);
  assert.ok(inside(layout.card, box) && inside(layout.loupe, box));
  assert.equal(overlaps(layout.card, layout.loupe), false);
  assert.ok(layout.zoom > 1.5, `lupa amplia de verdade (${layout.zoom.toFixed(2)}×)`);
  // Região larga e baixa numa captura de 1920 px: pelo menos 2× os pixels originais, com a lupa percorrendo a região.
  const wide = softwareFocusLayout(16 / 9, { x: 0.455, y: 0.23, w: 0.41, h: 0.1 }, box, 170, 36, 1920);
  assert.ok(wide.sourceZoom >= 2 - 1e-6, `legível: ${wide.sourceZoom.toFixed(2)}× dos pixels originais`);
  assert.ok(inside(wide.card, box) && inside(wide.loupe, box) && !overlaps(wide.card, wide.loupe));
  assert.ok(wide.view.x0 >= wide.crop.x - 1e-9 && wide.view.x1 + wide.view.w <= wide.crop.x + wide.crop.w + 1e-9, "a janela anda só dentro da região");
  assert.ok(wide.view.x1 > wide.view.x0, "região maior que a janela: a lupa percorre");
  // Captura vertical de celular: a tela inteira continua com pelo menos metade da altura útil.
  const phone = softwareFocusLayout(900 / 1950, { x: 0.05, y: 0.2, w: 0.9, h: 0.25 }, box, 170, 36, 900);
  assert.ok(phone.card.h >= (box.bottom - box.top - 170) * 0.5, `tela do celular reconhecível (${phone.card.h.toFixed(0)} px)`);
  assert.ok(inside(phone.loupe, box) && !overlaps(phone.card, phone.loupe));
});

// ---------------------------------------------------------------- integração: construtor + plano + compilador

const brand = { name: "Vorix", primaryHex: "#0B1020", accentHex: "#3B82F6", lightHex: "#FFFFFF", darkHex: "#0B1020", displayFont: "Barlow Condensed", tone: "tecnologia, precisão" };
const shot = (id) => ({ id, fileName: `${id.toLowerCase()}.png`, kind: "image", role: "screenshot", width: 1920, height: 1080 });
const ctx = (materials, extra = {}) => ({ planId: "p", workspaceId: "ws", aspect: "9:16", request: "Pauta", style: { editing: "dinamico", transitions: "moderadas", captions: false, music: true }, materials, transcripts: {}, sentences: [], brand, ...extra });
const scene = (materialId, purpose, extra = {}) => ({ materialId, purpose, durationSeconds: 3, motion: "push_in", motionIntensity: "medium", focus: "center", transitionIn: "cut", texts: [], ...extra });

test("integração: emoção, batida, efeitos e verificações entram no plano válido e no compilador", () => {
  const song = { id: "SONG", fileName: "song.mp3", kind: "audio", role: "music", durationSeconds: 60 };
  const d = {
    schemaVersion: 1, strategy: "demo", rationale: "", captions: false, music: "subtle", logo: "none", warnings: [], story: "A agenda some no WhatsApp; a Vorix organiza; teste grátis.", sfx: "auto",
    scenes: [
      scene("M1", "hook", { emotion: "identification", texts: [{ role: "hook", text: "Sua agenda sumiu de novo?", position: "top", animation: "kinetic" }] }),
      scene("M2", "demo", { emotion: "authority", region: { x: 0.55, y: 0.1, width: 0.35, height: 0.3 }, design: { template: "software_focus", label: "Agenda automática" } }),
      scene("M1", "proof", { emotion: "trust", transitionIn: "flash" }),
      scene("CARD", "cta", { emotion: "urgency", design: { template: "title_card", lines: ["Teste grátis"], cta: "Comece hoje" } }),
    ],
  };
  assert.equal(validateVideoEditDraftStructure(d).valid, true);
  const beats = { bpm: 100, times: Array.from({ length: 60 }, (_, i) => i * 0.6) };
  const built = buildPlanFromDraft(d, ctx([shot("M1"), shot("M2"), song], { musicMaterialId: "SONG", beats, sfxLibrary: true }));
  assert.equal(built.ok, true, built.issues?.join("; "));
  const plan = built.plan;
  assert.deepEqual(validateVideoEditPlan(plan).issues, []);
  assert.equal(plan.direction.story, d.story);
  assert.equal(plan.direction.brandMotion.personality, "tech");
  assert.ok(plan.direction.beat && plan.direction.beat.cuts === 3);
  assert.equal(plan.clips[1].emotion, "authority");
  const focus = plan.clips[1].design.props;
  assert.ok(focus.motion && focus.safe && focus.timeline.click > 0, "props de movimento, área segura e linha do tempo");
  assert.ok(plan.sfx.length >= 1, "efeitos nos eventos visuais");
  for (const cue of plan.sfx) assert.ok(plan.assets.some((a) => a.id === cue.assetId && a.role === "sfx"));
  // Um clique de efeito no clique do cursor (mesma fração da linha do tempo do template).
  const clickAt = plan.clips[1].recordStartSeconds + focus.timeline.click * plan.clips[1].durationSeconds;
  assert.ok(plan.sfx.some((cue) => Math.abs(cue.atSeconds - clickAt) < 0.01), "efeito sincronizado ao clique");
  const checks = plan.direction.checks;
  assert.ok(checks.some((c) => c.kind === "objective") && checks.some((c) => c.kind === "subjective"));
  assert.ok(checks.filter((c) => c.kind === "objective").every((c) => c.status !== "fail"), JSON.stringify(checks.filter((c) => c.status === "fail")));
  // Mesma tela em sequência vira corte; transição fora da família da marca é trocada.
  assert.ok(plan.clips.every((clip) => clip.transitionIn.type !== "flash"), "flash não é da família tech");
  // Sem efeitos quando o diretor pede silêncio.
  const quiet = buildPlanFromDraft({ ...d, sfx: "none" }, ctx([shot("M1"), shot("M2"), song], { musicMaterialId: "SONG", sfxLibrary: true }));
  assert.equal(quiet.plan.sfx?.length ?? 0, 0);

  // Compilador: barramento de efeitos com atraso e ganho, antes da normalização.
  const facts = { M1: { hasAudio: false, width: 1920, height: 1080 }, M2: { hasAudio: false, width: 1920, height: 1080 }, SONG: { hasAudio: true, durationSeconds: 60 } };
  for (const asset of plan.assets) if (asset.role === "sfx") facts[asset.id] = { hasAudio: true, durationSeconds: 0.6 };
  const withoutDesign = { ...plan, clips: plan.clips.map(({ design, ...clip }) => clip) };
  const compiled = compileFfmpegEdit({ plan: withoutDesign, facts });
  const final = compiled.steps.at(-1).args.join(" ");
  assert.ok(final.includes("[fxbus]"), "barramento de efeitos");
  assert.ok(/volume=-[0-9.]+dB,adelay=\d+:all=1\[fx0\]/.test(final), "efeito com ganho e atrasado até o evento");
  assert.ok(final.indexOf("[fxbus]") < final.indexOf("loudnorm"), "efeitos entram antes da normalização");

  // Plano com efeito fora da duração ou ganho alto é recusado.
  const bad = structuredClone(plan);
  bad.sfx[0].atSeconds = plan.durationSeconds + 1;
  bad.sfx.push({ assetId: bad.sfx[0].assetId, atSeconds: 1, gainDb: 3 });
  assert.ok(validateVideoEditPlan(bad).issues.length >= 2);
});

test("reenquadramento entra na fala: tela na janela de cima, pessoa no quadro inteiro", () => {
  const words = ["A", "agenda", "se", "organiza", "sozinha."].map((w, i) => ({ word: ` ${w}`, start: 2 + i * 0.5, end: 2 + i * 0.5 + 0.4 }));
  const transcript = { segments: [{ start: 2, end: 4.5, text: words.map((w) => w.word).join(""), words }] };
  const sentences = [{ id: "S1", materialId: "V1", start: 2, end: 4.5, text: "A agenda se organiza sozinha." }];
  const samples = Array.from({ length: 40 }, (_, i) => ({ t: i * 0.25, cx: i < 16 ? 0.25 : 0.75, cy: 0.4, weight: 0.9 }));
  for (const role of ["screen_recording", "footage"]) {
    const video = { id: "V1", fileName: "v1.mp4", kind: "video", role, width: 1920, height: 1080, durationSeconds: 30, hasSpeech: true };
    const d = { schemaVersion: 1, strategy: "s", rationale: "", captions: true, music: "none", logo: "none", warnings: [], scenes: [scene("V1", "proof", { sentenceIds: ["S1"], emotion: "trust", ...(role === "screen_recording" ? { layout: "framed" } : {}), design: { template: "speech_captions", emphasis: ["sozinha"] } }), scene("CARD", "cta", { texts: [{ role: "cta", text: "Teste grátis", position: "center", animation: "pop" }] })] };
    const built = buildPlanFromDraft(d, ctx([video], { transcripts: { V1: transcript }, sentences, roi: { V1: { samples, aspect: 16 / 9 } } }));
    assert.equal(built.ok, true, built.issues?.join("; "));
    const props = built.plan.clips[0].design.props;
    assert.equal(props.fit, "reframe", role);
    assert.ok(props.reframe.length >= 2);
    assert.equal(props.screen, role === "screen_recording");
    const expected = role === "screen_recording" ? 1080 / (1920 * SCREEN_WINDOW) : 1080 / 1920;
    assert.ok(Math.abs(props.reframeAspect - expected) < 0.002, `${role}: ${props.reframeAspect}`);
    // O trecho da fala começa em 2 s: a trilha é relativa ao início da cena.
    assert.equal(props.reframe[0].t, 0);
    assert.deepEqual(validateVideoEditPlan(built.plan).issues, []);
  }
});

test("ritmo da emoção acelera sem ferir o tempo de leitura (caso real: CTA de energia na marca tech)", () => {
  const d = { schemaVersion: 1, strategy: "s", rationale: "", captions: false, music: "none", logo: "none", warnings: [], story: "dor → prova → ação", scenes: [
    scene("M1", "hook", { emotion: "curiosity", durationSeconds: 3 }),
    scene("CARD", "cta", { emotion: "energy", durationSeconds: 2.8, design: { template: "title_card", lines: ["O contexto segue com a conversa"], cta: "Conheça a Vorix" } }),
  ] };
  const built = buildPlanFromDraft(d, ctx([shot("M1")]));
  assert.equal(built.ok, true, built.issues?.join("; "));
  const check = built.plan.direction.checks.find((c) => c.id === "reading_time");
  assert.equal(check.status, "pass", check.detail);
  assert.ok(built.plan.clips[0].durationSeconds < 3, "cena sem texto continua acelerada pela emoção");
});

test("applyAudiovisualDirection não muda tempos do plano", () => {
  const built = buildPlanFromDraft({ schemaVersion: 1, strategy: "s", rationale: "", captions: false, music: "none", logo: "none", warnings: [], scenes: [scene("M1", "hook", { emotion: "energy" }), scene("M2", "cta", { emotion: "urgency", transitionIn: "push_up" })] }, ctx([shot("M1"), shot("M2")]));
  const before = built.plan.clips.map((c) => [c.recordStartSeconds, c.durationSeconds]);
  applyAudiovisualDirection(built.plan, { brandMotion: brandMotionProfile({ tone: "tecnologia" }) });
  assert.deepEqual(built.plan.clips.map((c) => [c.recordStartSeconds, c.durationSeconds]), before);
});

// ---------------------------------------------------------------- diretor (Codex)

test("diretor: história, emoção por cena e efeitos no esquema estrito e no rascunho", () => {
  assert.ok(directorSchema.required.includes("story") && directorSchema.required.includes("sfx"));
  const item = directorSchema.properties.scenes.items;
  assert.ok(item.required.includes("emotion"));
  assert.deepEqual(item.properties.emotion.enum, [...EMOTIONS]);
  const out = {
    concept: { hook: "h", arc: "a", feeling: "f" }, story: "  Dor → virada → ação  ", strategy: "s", rationale: "r", captions: false, music: "subtle", sfx: "none", logo: "none", warnings: [],
    scenes: [{ materialId: "M1", purpose: "hook", emotion: "curiosity", modality: "software_demo", motionPrompt: null, design: null, durationSeconds: 3, sentenceIds: [], sourceStartSeconds: null, motion: "static", layout: "full", motionIntensity: "medium", focus: "center", region: null, transitionIn: "cut", texts: [] },
      { materialId: "M1", purpose: "cta", emotion: "inventada", modality: "software_demo", motionPrompt: null, design: null, durationSeconds: 3, sentenceIds: [], sourceStartSeconds: null, motion: "static", layout: "full", motionIntensity: "medium", focus: "center", region: null, transitionIn: "cut", texts: [] }],
  };
  const draft = toDraft(out);
  assert.equal(draft.story, "Dor → virada → ação");
  assert.equal(draft.sfx, "none");
  assert.equal(draft.scenes[0].emotion, "curiosity");
  assert.equal(draft.scenes[1].emotion, undefined, "emoção fora da lista é descartada");
  const prompt = directorPrompt({ selection: { brand: "Vorix", idea: { title: "Agenda" } }, materials: [{ id: "M1", kind: "image", role: "screenshot" }] });
  assert.ok(prompt.includes("DIREÇÃO AUDIOVISUAL"));
  assert.ok(prompt.includes("lupa"));
  assert.ok(!prompt.includes("holofote"), "o template não escurece mais a tela");
});
