#!/usr/bin/env node
// PROVA — EVOLUÇÃO DO MOTOR CRIATIVO (impacto, narração humanizada, acabamento) na MESMA pauta real da CMKV
// (CMKV-QUIZ-RECORTE), com as fotos oficiais. Compara A (vídeo anterior), B (direção/motion/som refinados, sem
// voz) e C (B + narração local), com revisão audiovisual temporal dos três.
//
//   npm run build && node scripts/video/campaign-proof.mjs --emit
//   (servidor) node codex-director-proof.mjs <dir> CMKV-v3
//   node scripts/video/campaign-proof.mjs --storyboards     → seleção (+ --revise se houver pendência/empate)
//   node scripts/video/campaign-proof.mjs --narrate         → falas por voz (Kokoro, Piper; Chatterbox = referência)
//   node scripts/video/campaign-proof.mjs --render          → B e C (+ variantes de voz), revisão e comparativos
// Sem API paga; nada é publicado.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { compileProposal, selectProposal, tasteViolations, validateProposal } from "../../dist/application/video-editing/spot-storyboard.js";
import { normalizeForSpeech, toSegments, VOICE_PROFILES } from "../../dist/application/video-editing/speech-script.js";
import { reviewAudiovisual } from "../../dist/application/video-editing/av-review.js";
import { synthesizeLocal } from "../../dist/infrastructure/video-editing/local-tts.js";
import { composeScoreFile } from "../../dist/infrastructure/video-editing/score-composer.js";
import { assembleVoiceTrack, masterAudio, processVoice } from "../../dist/infrastructure/video-editing/audio-master.js";
import { frameHash, measureLines, motionBetween, readWavMono } from "../../dist/infrastructure/video-editing/av-measure.js";
import { measureLoudness } from "../../dist/infrastructure/video-editing/reference-video-analysis.js";
import { probeMedia, runFfmpegCapture } from "../../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { logoTone } from "../../dist/infrastructure/video-editing/product-material-analysis.js";
const LOGO_TONE = await logoTone(join(resolve("artifacts"), "reformulacao", "cmkv", "job", "logo.png"));
import { closeBrowser, renderScene, renderStills } from "../../motion-graphics/render.mjs";
import { revisionPrompt, revisionSchema, storyboardPrompt, storyboardSchema } from "../editorial/storyboard-director.mjs";

const has = (name) => process.argv.includes(name);
const ROOT = resolve("artifacts");
const PREV = join(ROOT, "reformulacao");
const JOB = join(PREV, "cmkv", "job");
const OUT = join(ROOT, "evolucao");
const CODEX = join(OUT, "codex");
const REV = join(OUT, "codex-rev");
const NAME = "CMKV-v3";
const FPS = 30;
const S = process.env.TTS_SCRATCH;
const env = { ...process.env, TTS_PYTHON: process.env.TTS_PYTHON, TTS_MODEL_DIR: process.env.TTS_MODEL_DIR };

const BRAND = { name: "CMKV Wears", tone: "premium, editorial, streetwear sofisticado", display: "DM Serif Display", palette: { dark: "#0B0B0B", light: "#F7F5F0", accent: "#C9A227", ink: "#111111" } };
// Regras da PAUTA (prompt criativo do Bolsão): sem cartões/grade de fotos. Não é "gosto aprendido".
const PAUTA_RULES = { preferred: [], rejected: ["cartoes_de_foto"] };
const LEXICON = { CMKV: "cê eme cá vê" };
const FACTS = ["A opção A é o modelo CMKV 000037 (estampa ♡fé em traço contínuo, com flores e borboleta).", "A opção B é o modelo CMKV 000043 (estampa de limonada).", "A resposta do quiz é A (000037).", "A 000037 também existe nas cores branca e bege (fotos oficiais M3 e M4).", "Chamada da pauta: \"Conta se você foi de A ou de B.\""];
const MATERIALS = [
  { id: "M1", color: "preta", label: "Foto oficial: camiseta PRETA modelo 000037 — estampa ♡fé em traço branco (opção A, a resposta)" },
  { id: "M2", color: "preta", label: "Foto oficial: camiseta PRETA modelo 000043 — estampa limonada (opção B)" },
  { id: "M3", color: "branca", label: "Foto oficial: camiseta BRANCA modelo 000037 (mesma estampa, traço preto)" },
  { id: "M4", color: "bege", label: "Foto oficial: camiseta BEGE modelo 000037 (mesma estampa, traço preto)" },
];
// Auditoria do vídeo anterior (A) — vai ao diretor para não repetir os defeitos.
const AUDIT = [
  "0,0–1,8 s: o gancho é só texto + recorte; sem voz e sem impacto de câmera; o recorte já mostra coração e 'f'.",
  "1,8–3,5 s: o traço é desenhado INTEIRO antes da pergunta A ou B — quebra o mistério do quiz.",
  "3,5–10,6 s: a mesma estampa ♡fé aparece em 3 planos seguidos (traço, faixa A, revelação): sem progressão.",
  "3,5–8,2 s: 4,7 s na mesma comparação quase parada; legenda pequena.",
  "8,2 s: a 'revelação' não revela nada (o público já viu tudo); sem respiro nem impacto sonoro.",
  "12,9–17,1 s: o fechamento repete a pergunta do gancho depois da resposta; botão com seta de link num CTA de comentário.",
  "Áudio: sem narração; trilha plana (−16 a −11,6 LUFS do início ao fim), sem tensão antes da revelação.",
];

const MATS = () => JSON.parse(readFileSyncSafe(join(PREV, "cmkv", "materiais.json")));
import { readFileSync } from "node:fs";
function readFileSyncSafe(p) { return readFileSync(p, "utf8"); }

function spotContext(material) {
  return { fps: FPS, hasCutout: (material.confidence.M1 ?? 0) >= 0.6, palette: BRAND.palette, materials: [...MATERIALS.map((m) => ({ id: m.id, kind: "product_photo", name: m.color, fabricHex: material.photos[m.id].fabric, hasPrint: true })), { id: "LOGO", kind: "logo" }] };
}
function spotProps(p, compiled, material) {
  return {
    template: "spot", width: 1080, height: 1920, fps: FPS, durationInFrames: compiled.durationInFrames,
    brand: { name: BRAND.name, primary: BRAND.palette.dark, accent: BRAND.palette.accent, light: BRAND.palette.light, dark: BRAND.palette.dark, display: BRAND.display },
    language: p.language, emphasis: p.emphasis, align: p.align, palette: BRAND.palette, brandLabel: "CMKV Wears",
    photos: material.photos, cutout: material.cutout, logo: material.logo, logoAspect: material.logoAspect, logoTone: LOGO_TONE,
    motion: { easing: p.language === "graphic" ? "expo" : "quint", textCase: "sentence", grain: 0.12 },
    shots: compiled.shots,
  };
}

async function emit() {
  await mkdir(CODEX, { recursive: true });
  const pauta = JSON.parse(await readFile(join(PREV, "pauta-CMKV-QUIZ-RECORTE.json"), "utf8"));
  const refs = JSON.parse(await readFile(join(PREV, "cmkv", "referencias-medidas.json"), "utf8"));
  const idea = { title: pauta.title, commercialObjective: pauta.commercial_objective, targetAudience: pauta.target_audience, concept: pauta.concept, visualDirection: pauta.visual_direction, narrativeStructure: pauta.narrative_structure, cta: pauta.cta, videoScript: pauta.video_script, creativePrompt: pauta.creative_prompt };
  const mats = [...MATERIALS.map((m) => ({ id: m.id, label: m.label })), { id: "LOGO", label: "Logo oficial CMKV Wears" }];
  const prompt = storyboardPrompt({ idea, brand: BRAND, materials: mats, references: refs.map((r) => ({ role: r.role, label: r.label, note: r.note, guidance: r.guidance, observed: r.observed })), taste: PAUTA_RULES, facts: FACTS })
    + `\n\nAUDITORIA DO VÍDEO ANTERIOR DESTA MESMA PAUTA (não repita):\n${AUDIT.map((a) => `- ${a}`).join("\n")}`
    + "\n\nMEMÓRIA CRIATIVA DA MARCA: ainda não há lição de vídeo repetida em 2+ pautas para a CMKV (nada a evitar além das regras da pauta)."
    + `\n\nRECURSO: recorte da estampa de M1 (000037) pronto — trace_draw sobre a foto (materials ["M1"]) desenha o traço dourado sobre a estampa real e se dissolve nela (ideal como PAGAMENTO da revelação). Anexos: ${MATERIALS.map((m) => m.id).join(", ")}, miniaturas do Vídeo 1 e do Vídeo 2 e os quadros do vídeo anterior.`;
  const images = [];
  for (const m of MATERIALS) { const t = join(CODEX, `${NAME}-${m.id}.jpg`); await runFfmpegCapture(["-y", "-i", join(JOB, `${m.id === "M1" ? "000037-preto" : m.id === "M2" ? "000043-preto" : m.id === "M3" ? "000037-branco" : "000037-bege"}.jpg`), "-vf", "scale=720:-2", "-q:v", "3", t]); images.push(t); }
  for (const sheet of ["ref1-sheet.jpg", "ref2-sheet.jpg"]) { const t = join(CODEX, `${NAME}-${sheet}`); await copyFile(join(PREV, "referencias", sheet), t); images.push(t); }
  const prevSheet = join(CODEX, `${NAME}-anterior.jpg`);
  await runFfmpegCapture(["-y", "-i", join(PREV, "entrega", "CMKV-QUIZ-RECORTE-novo.mp4"), "-vf", "fps=2,scale=135:-2,tile=12x3:padding=2:color=white", "-frames:v", "1", prevSheet]);
  images.push(prevSheet);
  await writeFile(join(CODEX, `${NAME}-prompt.txt`), prompt);
  await writeFile(join(CODEX, `${NAME}-imagens.json`), JSON.stringify(images));
  await writeFile(join(CODEX, "schema.json"), JSON.stringify(storyboardSchema()));
  console.log(`[v3] prompt ${prompt.length} caracteres, ${images.length} imagens em ${CODEX}`);
}

async function proposals() {
  const raw = JSON.parse(await readFile(join(CODEX, `${NAME}-codex.json`), "utf8"));
  return Promise.all(raw.proposals.map(async (p) => {
    const file = join(REV, `${NAME}-rev-${p.id}-codex.json`);
    if (!existsSync(file)) return p;
    const r = JSON.parse(await readFile(file, "utf8"));
    return { ...r.proposal, id: p.id, revised: r.changes };
  }));
}

async function storyboards() {
  const material = MATS();
  const refs = JSON.parse(await readFile(join(PREV, "cmkv", "referencias-medidas.json"), "utf8"));
  const ctx = spotContext(material);
  const list = await proposals();
  const targets = { structureMedianShot: refs.find((r) => r.role === "structure")?.profile.shots.medianSeconds, aestheticLuma: refs.find((r) => r.role === "aesthetic")?.profile.luma.mean };
  const selection = selectProposal(list, ctx, targets, PAUTA_RULES);
  for (const p of list) {
    const compiled = compileProposal(p, ctx, material.cutout.elements.length, PAUTA_RULES);
    const frames = compiled.shots.flatMap((s) => [s.from + Math.min(s.frames - 1, (s.transitionFrames ?? 0) + 6), s.from + Math.round(s.frames * 0.62)]);
    const dir = join(OUT, "storyboard", p.id);
    await mkdir(dir, { recursive: true });
    const { files } = await renderStills({ jobDir: JOB, props: spotProps(p, compiled, material), frames, outDir: dir, prefix: p.id, scale: 0.4 });
    const cols = Math.min(8, files.length);
    await runFfmpegCapture(["-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex", `${files.map((_, i) => `[${i}:v]scale=216:384,setsar=1[t${i}]`).join(";")};${files.map((_, i) => `[t${i}]`).join("")}xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % cols) * 220}_${Math.floor(i / cols) * 388}`).join("|")}:fill=white[v]`, "-map", "[v]", "-frames:v", "1", "-q:v", "3", join(OUT, `storyboard-${p.id}.jpg`)], { timeoutMs: 120_000 });
  }
  await writeFile(join(OUT, "selecao.json"), JSON.stringify({ targets, rules: PAUTA_RULES, ...selection }, null, 2));
  for (const s of selection.scores) console.log(`[seleção] ${s.id}: ${s.total} — ${s.criteria.map((c) => `${c.key} ${c.score.toFixed(2)}`).join(" · ")}${s.issues.length ? ` | pendências: ${s.issues.map((i) => i.message).join("; ")}` : ""}`);
  console.log(`[seleção] escolhida: ${selection.chosen} · distintas: ${selection.allDistinct} (${selection.distances.map((d) => `${d.a}×${d.b}: ${d.differences}`).join(", ")})`);
}

async function revise() {
  const material = MATS();
  const sel = JSON.parse(await readFile(join(OUT, "selecao.json"), "utf8"));
  const list = await proposals();
  const [first, second] = sel.scores;
  const ids = second && first.total - second.total < 0.03 ? [first.id, second.id] : [first.id];
  await mkdir(REV, { recursive: true });
  await writeFile(join(REV, "schema.json"), JSON.stringify(revisionSchema()));
  const names = [];
  for (const id of ids) {
    const p = list.find((x) => x.id === id);
    const issues = [...validateProposal(p, spotContext(material)).map((i) => `${i.scene !== undefined ? `plano ${i.scene + 1}: ` : ""}${i.message}`), ...tasteViolations(p, PAUTA_RULES).map(() => "a pauta proíbe cartões de foto: a assinatura usa só LOGO em materials")];
    if (!issues.length) { console.log(`[refação] ${id}: sem pendências`); continue; }
    const sheet = join(REV, `${NAME}-rev-storyboard-${id}.jpg`);
    await copyFile(join(OUT, `storyboard-${id}.jpg`), sheet);
    await writeFile(join(REV, `${NAME}-rev-${id}-prompt.txt`), revisionPrompt({ proposal: p, issues, notes: ["A imagem anexada é o storyboard renderizado desta proposta (2 quadros por plano)."] }));
    await writeFile(join(REV, `${NAME}-rev-${id}-imagens.json`), JSON.stringify([sheet]));
    names.push(`${NAME}-rev-${id}`);
    console.log(`[refação] ${id}:\n  - ${issues.join("\n  - ")}`);
  }
  console.log(`[refação] runner: ${names.join(",")}`);
}

// ------------------------------------------------------------------ narração
const VOICES = [
  { key: "kokoro-dora", engine: "kokoro", voice: "pf_dora", label: "Kokoro pf_dora (Apache-2.0)" },
  { key: "piper-faber", engine: "piper", voice: "pt_BR-faber-medium", label: "Piper faber-medium (dataset CC0)" },
  { key: "chatterbox-dora", engine: "chatterbox", voice: "timbre sintético dora", label: "Chatterbox multilingual (MIT) — só referência de qualidade" },
];

function run(program, args, stdin) {
  return new Promise((ok, fail) => {
    const child = spawn(program, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, TTS_THREADS: "12" } });
    const out = []; const err = [];
    child.stdout.on("data", (b) => out.push(b)); child.stderr.on("data", (b) => err.push(b));
    child.on("close", (code) => (code === 0 ? ok(Buffer.concat(out).toString("utf8")) : fail(new Error(Buffer.concat(err).toString("utf8").slice(-800)))));
    child.stdin.end(stdin);
  });
}

async function chosenProposal() {
  const sel = JSON.parse(await readFile(join(OUT, "selecao.json"), "utf8"));
  return (await proposals()).find((p) => p.id === sel.chosen);
}

async function narrate() {
  const p = await chosenProposal();
  const profile = VOICE_PROFILES[p.campaignKind ?? "moda"];
  const dir = join(OUT, "voz");
  await mkdir(dir, { recursive: true });
  const lines = p.scenes.map((s, i) => ({ scene: i, ...s.narration })).filter((l) => l.line?.trim());
  const report = {};
  for (const v of VOICES) {
    const started = Date.now();
    const items = [];
    if (v.engine === "chatterbox") {
      const job = { prompt: join(ROOT, "narracao", "prompt-sintetico-dora.wav"), exaggeration: 0.55, lines: lines.map((l) => ({ text: normalizeForSpeech(l.line, LEXICON), out: join(dir, `${v.key}-cena${l.scene + 1}.wav`) })) };
      // O Chatterbox imprime avisos próprios no stdout: o JSON é a última linha.
      const res = JSON.parse((await run(join(S, "venv-cb", "Scripts", "python.exe"), [resolve("scripts/tts/chatterbox_lines.py")], JSON.stringify(job))).trim().split(/\r?\n/).pop());
      res.forEach((r, k) => items.push({ scene: lines[k].scene, line: lines[k].line, file: r.out, seconds: r.seconds, words: [] }));
    } else {
      for (const l of lines) {
        const prof = { ...profile, engine: v.engine, voice: v.voice };
        const file = join(dir, `${v.key}-cena${l.scene + 1}.wav`);
        const r = await synthesizeLocal({ engine: v.engine, voice: v.voice, segments: toSegments([{ text: l.line, pauseAfterMs: 0 }], prof, LEXICON), output: file, env });
        const last = r.segments[r.segments.length - 1];
        items.push({ scene: l.scene, line: l.line, file, seconds: last ? last.end : r.durationSeconds, words: r.segments.flatMap((s) => s.words), peakRssMb: r.peakRssMb });
      }
    }
    report[v.key] = { label: v.label, ms: Date.now() - started, lines: items };
    console.log(`[voz] ${v.key}: ${items.length} falas em ${((Date.now() - started) / 1000).toFixed(1)} s — ${items.map((i) => `${i.seconds.toFixed(2)}s`).join(" ")}`);
  }
  await writeFile(join(OUT, "narracao.json"), JSON.stringify({ proposal: p.id, campaignKind: p.campaignKind, profile, voiceDirection: p.voiceDirection, voices: report }, null, 2));
}

/** Planos crescem (em batidas inteiras) até a fala da voz principal caber. */
const LEAD = (role, i) => (i === 0 ? 0.3 : role === "reveal" ? 0.45 : 0.15);
/**
 * Encaixe: cada fala entra depois do impacto do plano dela; o GANCHO nunca estica (a fala pode atravessar o
 * corte, como num L-cut); os demais planos crescem em batidas inteiras se a fala não couber até o próximo.
 */
function fitToNarration(p, primary) {
  const beat = 60 / p.audioTreatment.bpm;
  const changes = [];
  const scenes = p.scenes.map((s) => ({ ...s }));
  let cursor = 0;
  let start = 0;
  scenes.forEach((s, i) => {
    const line = primary.lines.find((l) => l.scene === i);
    if (line) {
      const at = Math.max(start + LEAD(s.role, i), cursor + 0.12);
      const end = at + line.seconds;
      const sceneEnd = start + s.beats * beat;
      if (i > 0 && end + 0.25 > sceneEnd) {
        const need = Math.ceil((end + 0.25 - start) / beat);
        changes.push(`plano ${i + 1}: ${s.beats}→${need} batidas para a fala caber`);
        s.beats = need;
      }
      cursor = end;
    }
    start += s.beats * beat;
  });
  return { proposal: { ...p, scenes }, changes };
}

function placements(compiled, primaryLines, lines) {
  let cursor = 0;
  return lines.map((l) => {
    const shot = compiled.shots[l.scene];
    const at = Math.max(shot.from / FPS + LEAD(shot.role, l.scene), cursor + 0.12);
    cursor = at + (primaryLines.find((x) => x.scene === l.scene)?.seconds ?? l.seconds);
    return { file: l.file, at: +at.toFixed(3), seconds: l.seconds, line: l.line, scene: l.scene };
  });
}

async function render() {
  const material = MATS();
  const ctx = spotContext(material);
  const narr = JSON.parse(await readFile(join(OUT, "narracao.json"), "utf8"));
  const base = await chosenProposal();
  const { proposal: p, changes } = fitToNarration(base, narr.voices["kokoro-dora"]);
  const compiled = compileProposal(p, ctx, material.cutout.elements.length, PAUTA_RULES);
  const seconds = compiled.durationInFrames / FPS;
  const primaryPlaced = placements(compiled, narr.voices["kokoro-dora"].lines, narr.voices["kokoro-dora"].lines);
  const at = (scene) => primaryPlaced.find((l) => l.scene === scene)?.at ?? compiled.shots[scene].from / FPS + 0.15;
  const entrega = join(OUT, "entrega");
  await mkdir(entrega, { recursive: true });
  const timings = {};
  // B: direção/motion/som refinados, sem voz.
  const propsB = spotProps(p, compiled, material);
  let t0 = Date.now();
  const videoB = join(OUT, "B-video.mp4");
  // --remix: refaz só o áudio (trilha, voz, master) sobre os vídeos já renderizados.
  const rB = has("--remix") && existsSync(videoB) ? { ms: 0 } : await renderScene({ jobDir: JOB, outputPath: videoB, props: propsB, quality: "final" });
  timings.renderB = rB.ms;
  const scoreInput = (duck) => ({ bpm: compiled.bpm, seconds, mood: p.audioTreatment.mood, sections: compiled.sections.map((s) => ({ from: s.from / FPS, to: s.to / FPS, energy: s.energy, kind: s.kind })), events: compiled.audio.map((e) => ({ at: e.frame / FPS, kind: e.kind, strength: e.strength })), tailSeconds: 0.2, seed: 37, ...(duck ? { duck } : {}) });
  const musicB = join(OUT, "B-trilha.wav");
  await composeScoreFile(musicB, scoreInput());
  const outB = join(entrega, "B-direcao-motion-som.mp4");
  const mB = await masterAudio({ video: videoB, music: musicB, output: outB });
  timings.totalB = Date.now() - t0;
  // C: mesmo corte + narração (legenda acende na fala da voz principal).
  const primary = narr.voices["kokoro-dora"];
  const shotsC = compiled.shots.map((s, i) => {
    const line = primary.lines.find((l) => l.scene === i);
    if (!line?.words?.length) return s;
    const start = at(i) - s.from / FPS;
    return { ...s, words: line.words.map((w) => ({ word: w.word, start: Math.round((start + w.start) * FPS), end: Math.round((start + w.end) * FPS) })) };
  });
  t0 = Date.now();
  const videoC = join(OUT, "C-video.mp4");
  const rC = has("--remix") && existsSync(videoC) ? { ms: 0 } : await renderScene({ jobDir: JOB, outputPath: videoC, props: { ...propsB, shots: shotsC }, quality: "final" });
  timings.renderC = rC.ms;
  const results = { B: { file: outB, ...mB } };
  for (const [key, v] of Object.entries(narr.voices)) {
    const placed = placements(compiled, narr.voices["kokoro-dora"].lines, v.lines);
    const voiceWav = join(OUT, `C-${key}-voz.wav`);
    const rawVoice = join(OUT, `C-${key}-voz-crua.wav`);
    await assembleVoiceTrack({ lines: placed, seconds: seconds + 0.2, output: rawVoice });
    await processVoice(rawVoice, voiceWav);
    const music = join(OUT, `C-${key}-trilha.wav`);
    await composeScoreFile(music, scoreInput({ intervals: placed.map((l) => ({ from: l.at - 0.05, to: l.at + l.seconds + 0.1 })), depthDb: narr.profile.duckDb }));
    const out = join(entrega, `C-narracao-${key}.mp4`);
    const m = await masterAudio({ video: videoC, music, voice: voiceWav, output: out });
    // Fala que atravessa o corte só conta como estouro se invadir a fala seguinte.
    const overflow = placed.filter((l, k) => placed[k + 1] && l.at + l.seconds > placed[k + 1].at - 0.08).map((l) => `cena ${l.scene + 1}`);
    results[`C-${key}`] = { file: out, ...m, voiceWav, music, placed, overflow, label: v.label };
  }
  timings.totalC = Date.now() - t0;
  await writeFile(join(OUT, "plano-criativo.json"), JSON.stringify({ proposal: p, fitChanges: changes, compiled: { bpm: compiled.bpm, seconds, shots: compiled.shots.map((s) => ({ kind: s.kind, role: s.role, from: +(s.from / FPS).toFixed(2), to: +((s.from + s.frames) / FPS).toFixed(2), transition: s.transition, texts: s.texts, narration: s.narration })) }, timings, results }, null, 2));
  console.log(`[render] ${seconds.toFixed(1)} s · B ${(timings.totalB / 1000).toFixed(0)} s (Remotion ${(timings.renderB / 1000).toFixed(0)} s) · C ${(timings.totalC / 1000).toFixed(0)} s · ajustes: ${changes.join("; ") || "nenhum"}`);
  for (const [k, r] of Object.entries(results)) console.log(`         ${k}: ${r.integratedLufs} LUFS / ${r.truePeakDb} dBTP${r.overflow?.length ? ` · fala além do plano: ${r.overflow.join(", ")}` : ""}`);
  await review(compiled, results);
}

async function shotsForReview(video, shots) {
  const out = [];
  for (const [i, s] of shots.entries()) {
    const start = s.from / FPS, end = (s.from + s.frames) / FPS;
    out.push({ index: i, start, end, kind: s.kind, role: s.role, texts: s.texts.map((t) => t.text), narration: s.narration?.line, hash: await frameHash(video, start + (end - start) * 0.62), motion: await motionBetween(video, start + 0.1, end - 0.05), product: s.kind !== "logo_resolve" && s.kind !== "type_card" });
  }
  return out;
}

async function review(compiled, results) {
  const material = MATS();
  const ctx = spotContext(material);
  // A: o vídeo anterior, com o plano dele (proposta P3 refeita da fase anterior).
  const prevP = JSON.parse(await readFile(join(PREV, "codex-rev", "CMKV-revisao-P3-codex.json"), "utf8")).proposal;
  const prevC = compileProposal(prevP, ctx, material.cutout.elements.length, PAUTA_RULES);
  const A = join(PREV, "entrega", "CMKV-QUIZ-RECORTE-novo.mp4");
  const reports = {};
  const loudA = await measureLoudness(A);
  reports.A = reviewAudiovisual({ duration: prevC.durationInFrames / FPS, shots: await shotsForReview(A, prevC.shots), lines: [], audio: loudA, hasNarration: false });
  const shotsNew = await shotsForReview(results.B.file, compiled.shots);
  reports.B = reviewAudiovisual({ duration: compiled.durationInFrames / FPS, shots: shotsNew, lines: [], audio: await measureLoudness(results.B.file), hasNarration: false });
  for (const [k, r] of Object.entries(results).filter(([k]) => k.startsWith("C-"))) {
    const measured = await measureLines({ voiceWav: r.voiceWav, musicWav: r.music, lines: r.placed.map((l) => ({ line: l.line, start: l.at, end: l.at + l.seconds })) });
    const shotsC = await shotsForReview(r.file, compiled.shots);
    reports[k] = reviewAudiovisual({ duration: compiled.durationInFrames / FPS, shots: shotsC, lines: measured, audio: { ...(await measureLoudness(r.file)), voiceOverMusicDb: measured.map((m) => m.voiceOverMusicDb ?? 99) }, hasNarration: true });
    reports[k].lines = measured;
  }
  await writeFile(join(OUT, "revisao-audiovisual.json"), JSON.stringify(reports, (key, value) => (typeof value === "bigint" ? value.toString(16) : value), 2));
  for (const [k, r] of Object.entries(reports)) {
    console.log(`[revisão] ${k}: ${r.findings.length} achado(s) · ${JSON.stringify(r.measured)}`);
    for (const f of r.findings.slice(0, 8)) console.log(`   ${f.severity.padEnd(5)} ${f.from.toFixed(1)}–${f.to.toFixed(1)} s ${f.code}: ${f.evidence}`);
  }
}

try {
  if (has("--emit")) await emit();
  else if (has("--storyboards")) await storyboards();
  else if (has("--revise")) await revise();
  else if (has("--narrate")) await narrate();
  else if (has("--render")) await render();
  else console.log("Use --emit, --storyboards, --revise, --narrate ou --render.");
} finally {
  await closeBrowser();
}
