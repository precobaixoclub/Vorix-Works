#!/usr/bin/env node
// PROVA — NARRAÇÃO NATURAL, SINCRONIA REAL E MONTAGEM (CMKV-QUIZ-RECORTE, mesmas fotos oficiais).
//   A = versão anterior (preservada) · B = mesma estrutura visual + narração/sincronia corrigidas ·
//   C = nova proposta audiovisual (conceito, montagem, motion, voz e som).
//
//   npm run build && node scripts/video/sync-proof.mjs --emit          (prompts: fala de B + 3 conceitos de C)
//   (servidor) node codex-director-proof.mjs <dir> <nomes>
//   node scripts/video/sync-proof.mjs --lab          (frase × bloco, velocidades, validação do alinhador)
//   node scripts/video/sync-proof.mjs --storyboards  (C: distinção de conceitos, seleção, quadros)
//   node scripts/video/sync-proof.mjs --render       (B e C guiados pela fala + QG técnico/editorial)
// Sem API paga; nada é publicado. Requer TTS_PYTHON, TTS_MODEL_DIR e WHISPER_PYTHON (faster-whisper).
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compileProposal, GENRE_RHYTHM, proposalDistance, selectProposal, tasteViolations, validateProposal } from "../../dist/application/video-editing/spot-storyboard.js";
import { CAMPAIGN_SPEECH, directedSegments, normalizeForSpeech } from "../../dist/application/video-editing/speech-script.js";
import { alignScriptToAsr, captionSync, normWord, refineWordOnsets } from "../../dist/application/video-editing/word-alignment.js";
import { buildSpeechTimeline } from "../../dist/application/video-editing/speech-timeline.js";
import { reviewAudiovisual } from "../../dist/application/video-editing/av-review.js";
import { buildCreativeMemory } from "../../dist/application/creative-engine/creative-memory.js";
import { tasteFromMemory, videoFeedbackEvents } from "../../dist/domain/video-editing/brand-video-taste.js";
import { synthesizeLocal } from "../../dist/infrastructure/video-editing/local-tts.js";
import { WhisperVideoTranscriber } from "../../dist/infrastructure/video-editing/whisper-video-transcriber.js";
import { composeScoreFile } from "../../dist/infrastructure/video-editing/score-composer.js";
import { assembleVoiceTrack, masterAudio, processVoice } from "../../dist/infrastructure/video-editing/audio-master.js";
import { frameHash, motionBetween, pitchStd, readWavMono } from "../../dist/infrastructure/video-editing/av-measure.js";
import { analyzeReferenceVideo, measureLoudness } from "../../dist/infrastructure/video-editing/reference-video-analysis.js";
import { analyzeVideo, probeMedia, runFfmpegCapture } from "../../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { logoTone } from "../../dist/infrastructure/video-editing/product-material-analysis.js";
import { closeBrowser, renderScene, renderStills } from "../../motion-graphics/render.mjs";
import { revisionPrompt, revisionSchema, storyboardPrompt, storyboardSchema } from "../editorial/storyboard-director.mjs";

const has = (name) => process.argv.includes(name);
const ROOT = resolve("artifacts");
const PREV = join(ROOT, "reformulacao");
const EVO = join(ROOT, "evolucao");
const JOB = join(PREV, "cmkv", "job");
const OUT = join(ROOT, "sincronia");
const CODEX = join(OUT, "codex");
const FPS = 30;
const ENV = { ...process.env };
const LOGO_TONE = await logoTone(join(JOB, "logo.png"));
const BRAND = { name: "CMKV Wears", tone: "premium, editorial, streetwear sofisticado", display: "DM Serif Display", palette: { dark: "#0B0B0B", light: "#F7F5F0", accent: "#C9A227", ink: "#111111" } };
const PAUTA_RULES = { preferred: [], rejected: ["cartoes_de_foto"] };
const LEXICON = { CMKV: "cê eme cá vê" };
const FACTS = ["A opção A é o modelo CMKV 000037 (estampa ♡fé em traço contínuo, com flores e borboleta).", "A opção B é o modelo CMKV 000043 (estampa de limonada).", "A resposta do quiz é A (000037).", "A 000037 também existe nas cores branca e bege (fotos oficiais M3 e M4).", "Chamada da pauta: \"Conta se você foi de A ou de B.\""];
const MATERIALS = [
  { id: "M1", color: "preta", file: "000037-preto.jpg", label: "Foto oficial: camiseta PRETA modelo 000037 — estampa ♡fé em traço branco (opção A, a resposta)" },
  { id: "M2", color: "preta", file: "000043-preto.jpg", label: "Foto oficial: camiseta PRETA modelo 000043 — estampa limonada (opção B)" },
  { id: "M3", color: "branca", file: "000037-branco.jpg", label: "Foto oficial: camiseta BRANCA modelo 000037 (mesma estampa, traço preto)" },
  { id: "M4", color: "bege", file: "000037-bege.jpg", label: "Foto oficial: camiseta BEGE modelo 000037 (mesma estampa, traço preto)" },
];
// Avaliação HUMANA da versão anterior (C da fase "evolução"): vai à memória criativa existente e ao diretor.
const HUMAN = [
  { verdict: "approved", patterns: ["timbre_aceitavel"], note: "Os timbres das vozes (Kokoro e Piper) foram considerados aceitáveis." },
  { verdict: "rejected", patterns: ["narracao_lenta", "pausas_inadequadas"], note: "A narração ficou lenta e pausada demais; a interpretação não combina com publicidade." },
  { verdict: "rejected", patterns: ["legenda_dessincronizada"], note: "O texto na tela não acompanha a fala." },
  { verdict: "approved", patterns: ["montagem_melhorou"], note: "A melhoria visual foi reconhecida." },
  { verdict: "rejected", patterns: ["impacto_insuficiente"], note: "Ainda falta impacto e sofisticação na montagem." },
];
const HUMAN_TEXT = HUMAN.map((h) => `${h.verdict === "approved" ? "Aprovado" : "Reprovado"}: ${h.note}`);
// Estratégia e velocidade ESCOLHIDAS no laboratório (bloco ×1,08 no Kokoro; frase ×1,1 no Piper, que cria pausa no modo bloco).
const VOICES = { "kokoro-dora": { engine: "kokoro", voice: "pf_dora", strategy: "bloco", scale: 1.0 }, "piper-faber": { engine: "piper", voice: "pt_BR-faber-medium", strategy: "frase", scale: 1.0 } };

const MATS = () => JSON.parse(readFileSync(join(PREV, "cmkv", "materiais.json"), "utf8"));
const asr = new WhisperVideoTranscriber({ pythonPath: process.env.WHISPER_PYTHON ?? process.env.TTS_PYTHON, scriptPath: resolve("scripts/meetings/faster_whisper_transcribe.py"), model: process.env.WHISPER_MODEL ?? "small", computeType: "int8", threads: 8, language: "pt", timeoutMs: 600_000 });
const heardWords = async (file, workDir) => (await asr.transcribe(file, workDir)).segments.flatMap((s) => s.words ?? []).map((w) => ({ word: w.word.trim(), start: w.start, end: w.end }));

function spotContext(material) {
  return { fps: FPS, hasCutout: (material.confidence.M1 ?? 0) >= 0.6, palette: BRAND.palette, materials: [...MATERIALS.map((m) => ({ id: m.id, kind: "product_photo", name: m.color, fabricHex: material.photos[m.id].fabric, hasPrint: true })), { id: "LOGO", kind: "logo" }] };
}
function spotProps(p, shots, durationInFrames, material) {
  return {
    template: "spot", width: 1080, height: 1920, fps: FPS, durationInFrames,
    brand: { name: BRAND.name, primary: BRAND.palette.dark, accent: BRAND.palette.accent, light: BRAND.palette.light, dark: BRAND.palette.dark, display: BRAND.display },
    language: p.language, emphasis: p.emphasis, align: p.align, palette: BRAND.palette, brandLabel: "CMKV Wears",
    photos: material.photos, cutout: material.cutout, logo: material.logo, logoAspect: material.logoAspect, logoTone: LOGO_TONE,
    motion: { easing: p.language === "graphic" ? "expo" : "quint", textCase: "sentence", grain: 0.12 }, shots,
  };
}

// ------------------------------------------------------------------ emit
const narrationSchema = () => ({
  type: "object", additionalProperties: false, required: ["scenes", "notes"],
  properties: {
    scenes: { type: "array", minItems: 4, maxItems: 9, items: { type: "object", additionalProperties: false, required: ["index", "narration", "texts"], properties: {
      index: { type: "integer", minimum: 0, maximum: 8 },
      narration: { type: "object", additionalProperties: false, required: ["line", "intent", "pauseAfterMs"], properties: { line: { type: "string", maxLength: 100 }, intent: { type: "string", enum: ["curiosidade", "surpresa", "entusiasmo", "explicacao", "emocao", "chamada"] }, pauseAfterMs: { type: "integer", minimum: 0, maximum: 600 } } },
      texts: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["role", "text"], properties: { role: { type: "string", enum: ["headline", "kicker", "label", "cta", "caption"] }, text: { type: "string", maxLength: 80 } } } },
    } } },
    notes: { type: "array", maxItems: 6, items: { type: "string", maxLength: 200 } },
  },
});

async function baseProposalB() {
  const sel = JSON.parse(await readFile(join(EVO, "selecao.json"), "utf8"));
  const raw = JSON.parse(await readFile(join(EVO, "codex", "CMKV-v3-codex.json"), "utf8"));
  const revised = join(EVO, "codex-rev", `CMKV-v3-rev-${sel.chosen}-codex.json`);
  return existsSync(revised) ? { ...JSON.parse(await readFile(revised, "utf8")).proposal, id: sel.chosen } : raw.proposals.find((p) => p.id === sel.chosen);
}

async function emit() {
  await mkdir(join(CODEX, "b"), { recursive: true });
  await mkdir(join(CODEX, "c"), { recursive: true });
  const p = await baseProposalB();
  const promptB = [
    "Você é o diretor de locução e o editor de um anúncio vertical que JÁ TEM a montagem aprovada visualmente. NÃO mude cenas, tipos de plano, câmeras nem materiais.",
    "Reescreva SÓ a fala de cada cena e o texto da tela, resolvendo a avaliação humana:",
    ...HUMAN_TEXT.map((h) => `- ${h}`),
    "", "Regras:",
    "- Locução publicitária brasileira ágil e natural: frases curtas que soam faladas, sem reticências, sem pausas dramáticas (pauseAfterMs até 250; só antes da revelação até 450).",
    "- intent por fala: curiosidade, surpresa, entusiasmo, explicacao, emocao ou chamada.",
    "- O TEXTO DA TELA (headline/caption) de uma cena com fala usa as MESMAS palavras ditas nela, na mesma ordem (um trecho da fala, até 5 palavras): o texto aparece palavra a palavra quando é falado.",
    "- Rótulos A/B continuam como label. A contagem (countdown) pode ser falada ('três, dois, um') ou silenciosa.",
    "- Cena de assinatura: a fala é a chamada da pauta; o cta continua \"Conta se você foi de A ou de B.\"",
    "- Fatos: só estes —", ...FACTS.map((f) => `  · ${f}`),
    "", "CENAS ATUAIS (index, tipo, papel, textos, fala anterior):",
    ...p.scenes.map((s, i) => `- ${i}: ${s.kind} (${s.role}) · textos: ${s.texts.map((t) => `${t.role}:"${t.text}"`).join(", ") || "—"} · fala: "${s.narration?.line ?? ""}"`),
    "", "Devolva todas as cenas (mesmos índices) e notas curtas do que mudou. Responda só o JSON do schema.",
  ].join("\n");
  await writeFile(join(CODEX, "b", "CMKV-fala-B-prompt.txt"), promptB);
  await writeFile(join(CODEX, "b", "CMKV-fala-B-imagens.json"), JSON.stringify([join(EVO, "storyboard-P1.jpg")]));
  await copyFile(join(EVO, "storyboard-P1.jpg"), join(CODEX, "b", "storyboard-P1.jpg"));
  await writeFile(join(CODEX, "b", "CMKV-fala-B-imagens.json"), JSON.stringify([join(CODEX, "b", "storyboard-P1.jpg")]));
  await writeFile(join(CODEX, "b", "schema.json"), JSON.stringify(narrationSchema()));
  // C: três conceitos novos (com o vocabulário ampliado e a avaliação humana).
  const pauta = JSON.parse(await readFile(join(PREV, "pauta-CMKV-QUIZ-RECORTE.json"), "utf8"));
  const refs = JSON.parse(await readFile(join(PREV, "cmkv", "referencias-medidas.json"), "utf8"));
  const idea = { title: pauta.title, commercialObjective: pauta.commercial_objective, targetAudience: pauta.target_audience, concept: pauta.concept, visualDirection: pauta.visual_direction, narrativeStructure: pauta.narrative_structure, cta: pauta.cta, videoScript: pauta.video_script, creativePrompt: pauta.creative_prompt };
  const promptC = storyboardPrompt({ idea, brand: BRAND, materials: [...MATERIALS.map((m) => ({ id: m.id, label: m.label })), { id: "LOGO", label: "Logo oficial CMKV Wears" }], references: refs.map((r) => ({ role: r.role, label: r.label, note: r.note, guidance: r.guidance, observed: r.observed })), taste: PAUTA_RULES, facts: FACTS, feedback: HUMAN_TEXT, genre: GENRE_RHYTHM.moda.label })
    + "\n\nNÃO repita a montagem anterior (gancho tipográfico → macro → faixas A/B → contagem → foto → foto → assinatura): proponha conceitos novos. Recursos novos disponíveis: type_mask, editorial_split e a transição morph. Recorte da estampa de M1 pronto (trace_draw sobre a foto)."
    + `\nAnexos: ${MATERIALS.map((m) => m.id).join(", ")}, miniaturas do Vídeo 1 e do Vídeo 2 e os quadros da versão anterior (avaliada pelo cliente).`;
  const images = [];
  for (const m of MATERIALS) { const t = join(CODEX, "c", `CMKV-C-${m.id}.jpg`); await runFfmpegCapture(["-y", "-i", join(JOB, m.file), "-vf", "scale=720:-2", "-q:v", "3", t]); images.push(t); }
  for (const sheet of ["ref1-sheet.jpg", "ref2-sheet.jpg"]) { const t = join(CODEX, "c", `CMKV-C-${sheet}`); await copyFile(join(PREV, "referencias", sheet), t); images.push(t); }
  const prevSheet = join(CODEX, "c", "CMKV-C-anterior.jpg");
  await copyFile(join(EVO, "C-denso.jpg"), prevSheet);
  images.push(prevSheet);
  await writeFile(join(CODEX, "c", "CMKV-C-prompt.txt"), promptC);
  await writeFile(join(CODEX, "c", "CMKV-C-imagens.json"), JSON.stringify(images));
  await writeFile(join(CODEX, "c", "schema.json"), JSON.stringify(storyboardSchema()));
  // Memória criativa EXISTENTE: a avaliação desta pauta entra como eventos (uma pauta = observado, não regra).
  const now = new Date();
  const feedback = HUMAN.map((h, k) => ({ id: `cmkv-aval-${k}`, tenantId: "tenant-vorix", workspaceId: "workspace-cee-prelaunch-mv47cmfh", projectId: "CMKV-QUIZ-RECORTE", versionId: "evolucao-C", verdict: h.verdict, patterns: h.patterns, note: h.note, reviewerId: "cliente", createdAt: new Date(now.getTime() + k).toISOString() }));
  const memory = buildCreativeMemory(videoFeedbackEvents(feedback), { workspaceId: "workspace-cee-prelaunch-mv47cmfh", now });
  await writeFile(join(OUT, "memoria-cmkv.json"), JSON.stringify({ feedback, memory, taste: tasteFromMemory(memory) }, null, 2));
  console.log(`[emit] B: ${promptB.length} car. · C: ${promptC.length} car., ${images.length} imagens · memória: ${memory.videoPatterns.observed.length} padrões observados, ${memory.videoPatterns.avoid.length} a evitar (1 pauta ≠ regra)`);
}

// ------------------------------------------------------------------ laboratório de narração
const syl = (t) => (t.toLowerCase().match(/[aeiouáéíóúâêôãõà]+/g) ?? []).length;

async function narrationLines(which) {
  if (which === "B") {
    const p = await baseProposalB();
    const r = JSON.parse(await readFile(join(CODEX, "b", "CMKV-fala-B-codex.json"), "utf8"));
    const scenes = p.scenes.map((s, i) => { const n = r.scenes.find((x) => x.index === i); return n ? { ...s, narration: { ...s.narration, ...n.narration }, texts: n.texts.length ? n.texts : s.texts } : s; });
    return { proposal: { ...p, scenes }, notes: r.notes };
  }
  const sel = JSON.parse(await readFile(join(OUT, "selecao-C.json"), "utf8"));
  return { proposal: (await proposalsC()).find((p) => p.id === sel.chosen), notes: [] };
}

const linesOf = (p) => p.scenes.map((s, i) => ({ scene: i, text: s.narration?.line?.trim() ?? "", intent: s.narration?.intent ?? "explicacao" })).filter((l) => l.text);

async function synthGroups(p, voiceKey, strategy, dir, speedScale = 1) {
  const v = VOICES[voiceKey];
  const kind = p.campaignKind ?? "moda";
  const segs = directedSegments(linesOf(p), kind, strategy, LEXICON).map((s) => ({ ...s, speed: +(s.speed * speedScale).toFixed(3) }));
  const groups = [];
  for (const [k, seg] of segs.entries()) {
    const file = join(dir, `${voiceKey}-${strategy}-${speedScale}-g${k}.wav`);
    const r = await synthesizeLocal({ engine: v.engine, voice: v.voice, segments: [{ ...seg, pauseAfterMs: 0 }], output: file, env: ENV });
    groups.push({ file, scenes: seg.scenes, seconds: r.segments[0].end, pauseAfterMs: seg.pauseAfterMs, text: seg.text, display: seg.scenes.map((sc) => p.scenes[sc].narration.line.replace(/\*/g, "")).join(" "), ms: r.generationMs, rss: r.peakRssMb });
  }
  return groups;
}

/** Junta os grupos com o respiro de cada intenção (para ouvir/medir a fala corrida). */
async function joinGroups(groups, out) {
  let t = 0;
  const lines = groups.map((g) => { const at = t; t += g.seconds + g.pauseAfterMs / 1000; return { file: g.file, at }; });
  await assembleVoiceTrack({ lines, seconds: t + 0.3, output: out });
  return t;
}

async function measureSpeech(file, script, workDir) {
  const words = await heardWords(file, workDir);
  const { words: aligned, coverage } = alignScriptToAsr(script.split(/\s+/).filter(Boolean), words, { cmkv: "CMKV" });
  const gaps = aligned.slice(1).map((w, i) => w.start - aligned[i].end).filter((g) => Number.isFinite(g));
  const wav = await readWavMono(file);
  const speechSec = aligned.reduce((a, w) => a + Math.max(0, w.end - w.start), 0);
  const heardText = words.map((w) => w.word).join(" ");
  const ref = script.split(/\s+/).map(normWord).filter(Boolean), hyp = heardText.split(/\s+/).map(normWord).filter(Boolean);
  const d = Array.from({ length: ref.length + 1 }, (_, i) => [i, ...Array(hyp.length).fill(0)]);
  for (let j = 1; j <= hyp.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= ref.length; i += 1) for (let j = 1; j <= hyp.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  return { duration: +(wav.samples.length / wav.rate).toFixed(2), syllablesPerSecond: +(syl(script) / Math.max(0.1, speechSec)).toFixed(2), longPauses: gaps.filter((g) => g > 0.35).length, maxPause: +Math.max(0, ...gaps).toFixed(2), meanGap: +(gaps.reduce((a, b) => a + Math.max(0, b), 0) / Math.max(1, gaps.length)).toFixed(3), wer: +(d[ref.length][hyp.length] / Math.max(1, ref.length)).toFixed(3), coverage: +coverage.toFixed(2), pitchStd: +(pitchStd(wav.samples, wav.rate) ?? 0).toFixed(2), heard: heardText };
}

async function lab() {
  const dir = join(OUT, "lab");
  await mkdir(dir, { recursive: true });
  const { proposal: p } = await narrationLines("B");
  const script = linesOf(p).map((l) => l.text.replace(/\*/g, "")).join(" ");
  const results = [];
  // 0) Referência: a narração ANTERIOR (reprovada: lenta e pausada).
  const old = join(EVO, "C-kokoro-dora-voz-crua.wav");
  if (existsSync(old)) {
    const prevNarr = JSON.parse(await readFile(join(EVO, "narracao.json"), "utf8"));
    const prevScript = prevNarr.voices["kokoro-dora"].lines.map((l) => l.line.replace(/\*/g, "")).join(" ");
    results.push({ config: "anterior (frase, perfil lento)", voice: "kokoro-dora", file: old, ...(await measureSpeech(old, prevScript, dir)) });
  }
  for (const voice of Object.keys(VOICES)) {
    for (const [strategy, scale] of [["frase", 1], ["bloco", 0.95], ["bloco", 1], ["bloco", 1.08]]) {
      const groups = await synthGroups(p, voice, strategy, dir, scale);
      const file = join(dir, `${voice}-${strategy}-x${scale}.wav`);
      await joinGroups(groups, file);
      const m = await measureSpeech(file, script, dir);
      results.push({ config: `${strategy} ×${scale}`, voice, file, genMs: groups.reduce((a, g) => a + g.ms, 0), peakRssMb: Math.max(...groups.map((g) => g.rss)), ...m });
      console.log(`[lab] ${voice} ${strategy} ×${scale}: ${m.duration}s · ${m.syllablesPerSecond} síl/s · pausas>350ms ${m.longPauses} (máx ${m.maxPause}s) · WER ${m.wer} · tom ${m.pitchStd} st`);
    }
  }
  // Validação do ALINHADOR em pt-BR: palavras sintetizadas uma a uma (fronteiras CONHECIDAS) → alinhamento.
  const words = script.split(/\s+/).filter(Boolean).slice(0, 24);
  const truth = [];
  let t = 0.2;
  const pieces = [];
  for (const [k, w] of words.entries()) {
    const f = join(dir, `valid-${k}.wav`);
    const r = await synthesizeLocal({ engine: "kokoro", voice: "pf_dora", segments: [{ text: normalizeForSpeech(w, LEXICON), speed: 1.05, expressiveness: 0.6, pauseAfterMs: 0, lineIndex: 0, emphasis: false }], output: f, env: ENV });
    truth.push({ word: w, start: t, end: t + r.segments[0].end });
    pieces.push({ file: f, at: t });
    t += r.segments[0].end + 0.12;
  }
  const vfile = join(dir, "validacao-alinhador.wav");
  await assembleVoiceTrack({ lines: pieces, seconds: t + 0.3, output: vfile });
  const { words: got, coverage } = alignScriptToAsr(words.map((w) => w.replace(/\*/g, "")), await heardWords(vfile, dir), { cmkv: "CMKV" });
  const errs = got.map((w, k) => (w.source === "asr" ? Math.abs(w.start - truth[k].start) : null)).filter((x) => x !== null);
  const validation = { words: words.length, measured: errs.length, coverage: +coverage.toFixed(2), meanStartErrorMs: Math.round((errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length)) * 1000), p90StartErrorMs: Math.round(([...errs].sort((a, b) => a - b)[Math.floor(errs.length * 0.9)] ?? 0) * 1000) };
  console.log(`[lab] alinhador pt-BR: ${validation.measured}/${validation.words} palavras medidas · erro médio ${validation.meanStartErrorMs} ms · p90 ${validation.p90StartErrorMs} ms`);
  await writeFile(join(OUT, "laboratorio-narracao.json"), JSON.stringify({ script, results, validation }, null, 2));
}

// ------------------------------------------------------------------ C: conceitos
async function proposalsC() {
  const raw = JSON.parse(await readFile(join(CODEX, "c", "CMKV-C-codex.json"), "utf8"));
  return Promise.all(raw.proposals.map(async (p) => {
    for (const name of [`CMKV-C-div-${p.id}`, `CMKV-C-rev-${p.id}`]) {
      const file = join(CODEX, "c-rev", `${name}-codex.json`);
      if (existsSync(file)) p = { ...JSON.parse(await readFile(file, "utf8")).proposal, id: p.id };
    }
    return p;
  }));
}

async function storyboards() {
  const material = MATS();
  const refs = JSON.parse(await readFile(join(PREV, "cmkv", "referencias-medidas.json"), "utf8"));
  const ctx = spotContext(material);
  const list = await proposalsC();
  const targets = { structureMedianShot: refs.find((r) => r.role === "structure")?.profile.shots.medianSeconds, aestheticLuma: refs.find((r) => r.role === "aesthetic")?.profile.luma.mean };
  // A versão atual (B) entra como LINHA DE BASE: C precisa ser uma proposta nova, não B com efeitos.
  const selection = selectProposal(list, ctx, targets, PAUTA_RULES, (await narrationLines("B")).proposal);
  for (const p of list) {
    const c = compileProposal(p, ctx, material.cutout.elements.length, PAUTA_RULES);
    const frames = c.shots.flatMap((s) => [s.from + Math.min(s.frames - 1, (s.transitionFrames ?? 0) + 6), s.from + Math.round(s.frames * 0.62)]);
    const dir = join(OUT, "storyboard", p.id);
    await mkdir(dir, { recursive: true });
    const { files } = await renderStills({ jobDir: JOB, props: spotProps(p, c.shots, c.durationInFrames, material), frames, outDir: dir, prefix: p.id, scale: 0.4 });
    const cols = Math.min(8, files.length);
    await runFfmpegCapture(["-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex", `${files.map((_, i) => `[${i}:v]scale=216:384,setsar=1[t${i}]`).join(";")};${files.map((_, i) => `[t${i}]`).join("")}xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % cols) * 220}_${Math.floor(i / cols) * 388}`).join("|")}:fill=white[v]`, "-map", "[v]", "-frames:v", "1", "-q:v", "3", join(OUT, `storyboard-C-${p.id}.jpg`)], { timeoutMs: 120_000 });
  }
  await writeFile(join(OUT, "selecao-C.json"), JSON.stringify({ targets, ...selection }, null, 2));
  for (const s of selection.scores) console.log(`[C] ${s.id}: ${s.total} — ${s.criteria.map((c) => `${c.key} ${c.score.toFixed(2)}`).join(" · ")}${s.issues.length ? ` | ${s.issues.map((i) => i.message).join("; ")}` : ""}`);
  console.log(`[C] escolhida ${selection.chosen} · distintas: ${selection.allDistinct} (${selection.distances.map((d) => `${d.a}×${d.b}: ${d.differences} dif., conceito ${d.conceptSimilarity}, sequência ${d.sequenceSimilarity}`).join(" | ")})`);
}

/** Se duas propostas forem quase iguais: a de nota menor é REFORMULADA com outro conceito antes da seleção. */
async function diversify() {
  const list = await proposalsC();
  const sel = JSON.parse(await readFile(join(OUT, "selecao-C.json"), "utf8"));
  const dir = join(CODEX, "c-rev");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "schema.json"), JSON.stringify(revisionSchema()));
  const names = [];
  const close = sel.distances.filter((d) => !d.distinct);
  for (const d of close) {
    const rank = (id) => sel.scores.findIndex((s) => s.id === id);
    const loser = rank(d.a) > rank(d.b) ? d.a : d.b;
    const other = loser === d.a ? d.b : d.a;
    if (names.some((n) => n.endsWith(loser))) continue;
    const p = list.find((x) => x.id === loser);
    const o = list.find((x) => x.id === other);
    const issues = [`Esta proposta ficou parecida demais com ${other} ("${o.title}": ${o.conceptDevice ?? o.concept}). Troque o DISPOSITIVO NARRATIVO e a proposta visual — não só cores ou efeitos. Use outra abertura e outra sequência de planos.`, ...validateProposal(p, spotContext(MATS())).map((i) => i.message), ...tasteViolations(p, PAUTA_RULES).map(() => "a pauta proíbe cartões de foto: a assinatura usa só LOGO")];
    await writeFile(join(dir, `CMKV-C-div-${loser}-prompt.txt`), revisionPrompt({ proposal: p, issues }));
    await copyFile(join(OUT, `storyboard-C-${loser}.jpg`), join(dir, `sb-${loser}.jpg`));
    await writeFile(join(dir, `CMKV-C-div-${loser}-imagens.json`), JSON.stringify([join(dir, `sb-${loser}.jpg`)]));
    names.push(`CMKV-C-div-${loser}`);
  }
  // A escolhida também passa pela refação se tiver pendência verificável.
  const chosen = list.find((x) => x.id === sel.chosen);
  const pend = [...validateProposal(chosen, spotContext(MATS())).map((i) => i.message), ...tasteViolations(chosen, PAUTA_RULES).map(() => "a pauta proíbe cartões de foto: a assinatura usa só LOGO")];
  if (pend.length && !names.some((n) => n.endsWith(chosen.id))) {
    await writeFile(join(dir, `CMKV-C-rev-${chosen.id}-prompt.txt`), revisionPrompt({ proposal: chosen, issues: pend }));
    await copyFile(join(OUT, `storyboard-C-${chosen.id}.jpg`), join(dir, `sb-${chosen.id}.jpg`));
    await writeFile(join(dir, `CMKV-C-rev-${chosen.id}-imagens.json`), JSON.stringify([join(dir, `sb-${chosen.id}.jpg`)]));
    names.push(`CMKV-C-rev-${chosen.id}`);
  }
  console.log(`[C] reformular/refazer: ${names.join(",") || "nada"}`);
}

// ------------------------------------------------------------------ render guiado pela fala
async function speechLed(which, voiceKey, strategy) {
  const material = MATS();
  const ctx = spotContext(material);
  const { proposal: p } = await narrationLines(which);
  const dir = join(OUT, `voz-${which}-${voiceKey}`);
  await mkdir(dir, { recursive: true });
  const groups = await synthGroups(p, voiceKey, VOICES[voiceKey].strategy ?? strategy, dir, VOICES[voiceKey].scale ?? 1);
  // Alinhamento de CADA bloco com o áudio real gerado (Whisper + roteiro escrito).
  const sceneWords = p.scenes.map(() => []);
  const sceneBlock = p.scenes.map(() => undefined);
  const alignment = [];
  for (const [k, g] of groups.entries()) {
    const heard = await heardWords(g.file, dir);
    const display = g.scenes.flatMap((sc) => p.scenes[sc].narration.line.replace(/\*/g, "").split(/\s+/).filter(Boolean).map((w) => ({ w, sc })));
    const aligned = alignScriptToAsr(display.map((d) => d.w), heard, { cmkv: "CMKV" });
    const wav = await readWavMono(g.file);
    // Início da palavra depois de pausa pelo ÁUDIO (o Whisper marca tarde a primeira palavra após silêncio).
    const words = refineWordOnsets(aligned.words, wav.samples, wav.rate);
    const coverage = aligned.coverage;
    words.forEach((w, i) => { sceneWords[display[i].sc].push(w); sceneBlock[display[i].sc] = k; });
    alignment.push({ block: k, coverage: +coverage.toFixed(2), heard: heard.map((h) => h.word).join(" "), interpolated: words.filter((w) => w.source !== "asr").map((w) => w.word) });
  }
  // Locução cortada nas RESPIRAÇÕES: cada cena recebe a sua fatia do bloco (prosódia contínua preservada).
  const slices = [];
  p.scenes.forEach((s, i) => {
    const ws = sceneWords[i];
    if (!ws.length) return;
    const k = sceneBlock[i];
    const nextSame = p.scenes.findIndex((_, j) => j > i && sceneBlock[j] === k && sceneWords[j].length);
    const prevSame = [...p.scenes.keys()].reverse().find((j) => j < i && sceneBlock[j] === k && sceneWords[j].length);
    const from = prevSame === undefined ? 0 : Math.max(0, (sceneWords[prevSame].at(-1).end + ws[0].start) / 2);
    const to = nextSame < 0 ? groups[k].seconds : (ws.at(-1).end + sceneWords[nextSame][0].start) / 2;
    slices[i] = { scene: i, block: k, file: groups[k].file, from, to, words: ws.map((w) => ({ ...w, start: w.start - from, end: w.end - from })) };
  });
  const sliceIndex = p.scenes.map((_, i) => (slices[i] ? i : undefined));
  const tl = buildSpeechTimeline({ bpm: p.audioTreatment.bpm, scenes: p.scenes.map((s, i) => ({ beats: s.beats, role: s.role, words: slices[i]?.words ?? [] })), sceneBlock: sliceIndex, beatsWeight: 0.75 });
  // Plano compilado com as durações da FALA (não das batidas do storyboard).
  const compiled = compileProposal(p, ctx, material.cutout.elements.length, PAUTA_RULES);
  const bounds = [...tl.cuts, tl.end].map((t) => Math.round(t * FPS));
  const shots = compiled.shots.map((s, i) => {
    const from = bounds[i], frames = bounds[i + 1] - bounds[i];
    const words = slices[i] ? slices[i].words.map((w) => ({ word: w.word, start: Math.round((w.start + tl.blockOffsets[i] - from / FPS) * FPS), end: Math.round((w.end + tl.blockOffsets[i] - from / FPS) * FPS), source: w.source })) : undefined;
    return { ...s, from, frames, transitionFrames: Math.min(s.transitionFrames, Math.floor(frames / 3)), ...(words ? { words } : {}) };
  });
  const durationInFrames = bounds[bounds.length - 1];
  return { p, groups, alignment, tl, shots, durationInFrames, compiled, sceneWords, sceneBlock, slices };
}

async function renderVersion(name, which, voiceKey, strategy) {
  const material = MATS();
  const started = Date.now();
  const r = await speechLed(which, voiceKey, strategy);
  const video = join(OUT, `${name}-video.mp4`);
  const props = spotProps(r.p, r.shots, r.durationInFrames, material);
  const rend = has("--remix") && existsSync(video) ? { ms: 0 } : await renderScene({ jobDir: JOB, outputPath: video, props, quality: "final" });
  const seconds = r.durationInFrames / FPS;
  // Voz: blocos nos deslocamentos da linha do tempo; trilha com eventos NOS CORTES reais e ducking nas palavras.
  const raw = join(OUT, `${name}-voz-crua.wav`), voice = join(OUT, `${name}-voz.wav`);
  const placed = r.slices.filter(Boolean).map((sl) => ({ file: sl.file, at: r.tl.blockOffsets[sl.scene], from: sl.from, to: sl.to }));
  await assembleVoiceTrack({ lines: placed, seconds: seconds + 0.2, output: raw });
  await processVoice(raw, voice);
  const intervals = placed.map((l) => ({ from: l.at - 0.05, to: l.at + (l.to - l.from) + 0.1 }));
  const events = [];
  r.shots.forEach((s, i) => {
    // Impacto que antecede uma fala fica mais contido (a voz entra no decaimento dele).
    if (i === 0) events.push({ at: 0, kind: "hit", strength: 0.7 });
    else if (s.role === "reveal") { events.push({ at: s.from / FPS - 60 / r.p.audioTreatment.bpm, kind: "tension_stop", strength: 1 }, { at: s.from / FPS, kind: "drop", strength: 0.5 }); }
    else if (s.transition !== "cut" && s.kind !== "logo_resolve") events.push({ at: s.from / FPS, kind: "whoosh", strength: 0.5 });
    if (s.kind === "countdown") for (const e of s.events ?? []) events.push({ at: (s.from + e) / FPS, kind: "pop", strength: 0.8 });
    if (s.kind === "logo_resolve") events.push({ at: (s.from + (s.transitionFrames ?? 0) + 8) / FPS, kind: "logo", strength: 0.9 });
  });
  const ENERGY = { hook_type: 0.75, type_mask: 0.7, editorial_split: 0.75, trace_draw: 0.6, fullbleed: 0.85, macro: 0.6, bands: 0.9, countdown: 0.7, variant_cycle: 1, logo_resolve: 0.45, print_assemble: 0.55, type_card: 0.6 };
  const music = join(OUT, `${name}-trilha.wav`);
  await composeScoreFile(music, { bpm: r.p.audioTreatment.bpm, seconds, mood: r.p.audioTreatment.mood, sections: r.shots.map((s) => ({ from: s.from / FPS, to: (s.from + s.frames) / FPS, energy: ENERGY[s.kind] ?? 0.7, kind: s.kind })), events, tailSeconds: 0.2, seed: 41, duck: { intervals: intervals.map((iv) => (events.some((e) => (e.kind === "drop" || e.kind === "hit") && iv.from >= e.at - 0.1 && iv.from - e.at < 1.2) ? { ...iv, depthDb: 17 } : iv)), depthDb: 11 } });
  const out = join(OUT, "entrega", `${name}.mp4`);
  await mkdir(join(OUT, "entrega"), { recursive: true });
  const m = await masterAudio({ video, music, voice, output: out });
  return { name, file: out, voice, music, renderMs: rend.ms, totalMs: Date.now() - started, ...m, ...r };
}

/** Quando cada palavra do texto da tela APARECE (mesma regra do template: casa em ordem com a fala alinhada). */
function shownWords(shots) {
  const out = [];
  for (const s of shots) {
    if (!s.words?.length) continue;
    const toks = (s.texts ?? []).filter((t) => t.role === "headline" || t.role === "caption").flatMap((t) => t.text.replace(/\*/g, "").split(/\s+/).filter(Boolean));
    let k = 0;
    for (const tok of toks) {
      for (let j = k; j < s.words.length; j += 1) if (normWord(s.words[j].word) === normWord(tok) && normWord(tok)) { out.push({ word: tok, at: (s.from + s.words[j].start) / FPS }); k = j + 1; break; }
    }
  }
  return out;
}

async function qualityReport(v, reviewDir) {
  // TÉCNICO: integridade, formato, áudio, legendas no tempo da fala (ouvidas no ARQUIVO FINAL), vazios, volume.
  const probe = await probeMedia(v.file);
  const tech = await analyzeVideo(v.file, { hasAudio: true });
  const loud = await measureLoudness(v.file);
  const shown = shownWords(v.shots);
  const heard = await heardWords(v.file, reviewDir);
  const sync = captionSync(shown, heard, { cmkv: "CMKV" });
  const measured = await analyzeReferenceVideo(v.file);
  const technical = {
    arquivo: probe.video && probe.audio ? "íntegro" : "incompleto", formato: `${probe.video?.codec} ${probe.video?.width}x${probe.video?.height} · ${probe.audio?.codec}`, duracao: probe.durationSeconds,
    decodificacao: tech.decodeErrors.length, quadrosPretos: tech.blackSegments.length, quadrosVazios: `${Math.round(measured.profile.emptyFrames.share * 100)}%`,
    volume: `${loud.integratedLufs} LUFS / ${loud.truePeakDb} dBTP`, legendas: shown.length ? `${sync.status} (${sync.measured}/${sync.words} palavras ouvidas; desvio médio ${sync.meanOffsetMs} ms, máx ${sync.maxOffsetMs} ms)` : "sem texto falado na tela",
    marca: v.shots[v.shots.length - 1]?.kind === "logo_resolve" ? "logo oficial no fechamento" : "sem assinatura",
  };
  technical.status = technical.arquivo === "íntegro" && !tech.decodeErrors.length && !tech.blackSegments.length && Math.abs((loud.integratedLufs ?? 0) + 14) <= 1.5 && (loud.truePeakDb ?? 0) <= -1 && (!shown.length || sync.status === "ok") ? "aprovado" : "reprovado";
  // EDITORIAL: revisão temporal (recomendações fundamentadas; a aprovação é humana).
  const lines = v.slices ? v.slices.filter(Boolean).map((sl) => ({ line: v.p.scenes[sl.scene].narration.line, spoken: normalizeForSpeech(v.p.scenes[sl.scene].narration.line, LEXICON), start: sl.words[0].start + v.tl.blockOffsets[sl.scene], end: sl.words.at(-1).end + v.tl.blockOffsets[sl.scene] })) : [];
  const { measureLines } = await import("../../dist/infrastructure/video-editing/av-measure.js");
  const lm = lines.length ? await measureLines({ voiceWav: v.voice, musicWav: v.music, lines }) : [];
  const shots = [];
  for (const [i, s] of v.shots.entries()) {
    const start = s.from / FPS, end = (s.from + s.frames) / FPS;
    shots.push({ index: i, start, end, kind: s.kind, role: s.role, texts: (s.texts ?? []).map((t) => t.text), narration: s.narration?.line, hash: await frameHash(v.file, start + (end - start) * 0.62), motion: await motionBetween(v.file, start + 0.1, end - 0.05), product: s.kind !== "logo_resolve" && s.kind !== "type_card" });
  }
  const editorial = reviewAudiovisual({ duration: probe.durationSeconds ?? 0, shots, lines: lm, audio: { ...loud, voiceOverMusicDb: lm.map((x) => x.voiceOverMusicDb ?? 99) }, hasNarration: lm.length > 0 });
  // Montagem: tempo até o benefício, informação por cena, surpresa, exposição do produto, fechamento.
  const reveal = v.shots.find((s) => s.role === "reveal" || s.role === "proof");
  const g = GENRE_RHYTHM[v.p?.campaignKind ?? "moda"];
  const durs = v.shots.slice(0, -1).map((s) => s.frames / FPS).sort((a, b) => a - b);
  const montage = {
    tempoAteBeneficio: reveal ? +(reveal.from / FPS).toFixed(2) : null, alvoBeneficio: g.benefitBy,
    planoMediano: +(durs[Math.floor(durs.length / 2)] ?? 0).toFixed(2), faixaDoGenero: g.medianShot,
    palavrasNaTelaPorSegundo: +Math.max(...v.shots.map((s) => (s.texts ?? []).reduce((a, t) => a + t.text.split(/\s+/).length, 0) / Math.max(0.5, s.frames / FPS))).toFixed(2),
    momentosDeSurpresa: v.shots.filter((s) => s.role === "reveal" || s.kind === "type_mask" || s.transition === "morph").length,
    produtoNaTela: editorial.measured.produtoNaTela, fechamento: `${((v.shots.at(-1).frames) / FPS).toFixed(1)} s com ${v.shots.at(-1).narration?.line ? "fala + " : ""}CTA`,
  };
  const recommendations = [...editorial.findings.map((f) => `${f.from.toFixed(1)}–${f.to.toFixed(1)} s · ${f.code}: ${f.evidence}`)];
  if (montage.tempoAteBeneficio !== null && montage.tempoAteBeneficio > g.benefitBy) recommendations.push(`revelação aos ${montage.tempoAteBeneficio} s (gênero pede até ${g.benefitBy} s)`);
  if (montage.planoMediano < g.medianShot[0] || montage.planoMediano > g.medianShot[1]) recommendations.push(`plano mediano ${montage.planoMediano} s fora da faixa do gênero (${g.medianShot.join("–")} s)`);
  return { technical, sync, editorial: { findings: editorial.findings, montage, recommendations, status: "aguardando avaliação humana", limits: editorial.limits }, lines: lm };
}

async function render() {
  const reviewDir = join(OUT, "revisao");
  await mkdir(reviewDir, { recursive: true });
  const versions = [];
  const strategy = process.env.NARRATION_STRATEGY ?? "bloco";
  versions.push(await renderVersion("B-narracao-corrigida", "B", "kokoro-dora", strategy));
  versions.push(await renderVersion("C-evolucao-completa", "C", "kokoro-dora", strategy));
  versions.push(await renderVersion("C-evolucao-completa-piper", "C", "piper-faber", strategy));
  const report = {};
  // A: a versão anterior (sem refazer).
  const A = join(OUT, "entrega", "A-versao-anterior.mp4");
  await copyFile(join(EVO, "entrega", "C-narracao-kokoro-dora.mp4"), A);
  const planA = JSON.parse(await readFile(join(EVO, "plano-criativo.json"), "utf8"));
  const prevNarr = JSON.parse(await readFile(join(EVO, "narracao.json"), "utf8"));
  const shotsA = planA.compiled.shots.map((s, i) => ({ ...s, from: Math.round(s.from * FPS), frames: Math.round((s.to - s.from) * FPS), texts: s.texts ?? [], words: undefined }));
  report.A = await qualityReport({ file: A, shots: shotsA, p: planA.proposal, voice: join(EVO, "C-kokoro-dora-voz.wav"), music: join(EVO, "C-kokoro-dora-trilha.wav") }, reviewDir);
  // Sincronia de A com a mesma régua: texto da tela × fala ouvida (A mostrava o texto inteiro no início do plano).
  const shownA = planA.compiled.shots.flatMap((s) => (s.texts ?? []).filter((t) => t.role === "headline" || t.role === "caption").flatMap((t) => t.text.replace(/\*/g, "").split(/\s+/).map((w) => ({ word: w, at: s.from + 0.25 }))));
  report.A.sync = captionSync(shownA, await heardWords(A, reviewDir), { cmkv: "CMKV" });
  report.A.technical.legendas = `${report.A.sync.status} (${report.A.sync.measured}/${report.A.sync.words} palavras da tela são ditas; desvio médio ${report.A.sync.meanOffsetMs} ms)`;
  if (report.A.sync.status !== "ok") report.A.technical.status = "reprovado";
  for (const v of versions) report[v.name] = { ...(await qualityReport(v, reviewDir)), alignment: v.alignment, timeline: v.tl, renderMs: v.renderMs, totalMs: v.totalMs };
  await writeFile(join(OUT, "relatorio-qualidade.json"), JSON.stringify(report, (k, val) => (typeof val === "bigint" ? val.toString(16) : val), 2));
  await writeFile(join(OUT, "planos.json"), JSON.stringify(versions.map((v) => ({ name: v.name, proposal: v.p, shots: v.shots.map((s) => ({ kind: s.kind, role: s.role, from: +(s.from / FPS).toFixed(2), to: +((s.from + s.frames) / FPS).toFixed(2), frameFrom: s.from, frames: s.frames, transition: s.transition, texts: s.texts, narration: s.narration, words: s.words })), blocks: v.groups.map((g, k) => ({ text: g.text, at: v.tl.blockOffsets[k], seconds: g.seconds })) })), null, 2));
  for (const [k, r] of Object.entries(report)) {
    console.log(`[QG] ${k}: técnico ${r.technical.status} · ${r.technical.volume} · legendas: ${r.technical.legendas}`);
    for (const rec of r.editorial.recommendations.slice(0, 6)) console.log(`      ${rec}`);
    console.log(`      montagem: ${JSON.stringify(r.editorial.montage)}`);
  }
  for (const v of versions) console.log(`[tempo] ${v.name}: ${(v.totalMs / 1000).toFixed(0)} s (Remotion ${(v.renderMs / 1000).toFixed(0)} s) · ${(v.durationInFrames / FPS).toFixed(1)} s de vídeo · notas: ${v.tl.notes.join("; ") || "—"}`);
}

/**
 * QG da sincronia SEM re-render: TEMPO medido na faixa de voz ENTREGUE (o áudio real posicionado no vídeo —
 * Whisper + refino do início pela energia), INTELIGIBILIDADE medida no MP4 final mixado (Whisper com música).
 * O Whisper sozinho, sobre a mixagem, marca a 1ª palavra após silêncio com ±0,2–0,5 s de erro.
 */
async function qa() {
  const reviewDir = join(OUT, "revisao");
  const plans = JSON.parse(await readFile(join(OUT, "planos.json"), "utf8"));
  const report = JSON.parse(await readFile(join(OUT, "relatorio-qualidade.json"), "utf8"));
  for (const v of plans) {
    const shots = v.shots.map((s) => ({ ...s, from: s.frameFrom }));
    const shown = shownWords(shots);
    const stem = join(OUT, `${v.name}-voz.wav`);
    const wav = await readWavMono(stem);
    const stemHeard = refineWordOnsets(await heardWords(stem, reviewDir), wav.samples, wav.rate);
    const timing = captionSync(shown, stemHeard, { cmkv: "CMKV" });
    const mixHeard = await heardWords(join(OUT, "entrega", `${v.name}.mp4`), reviewDir);
    const mix = captionSync(shown, mixHeard, { cmkv: "CMKV" }, 1.2);
    const r = report[v.name];
    r.sync = { tempo: timing, mixagem: { ouvidas: mix.measured, de: mix.words } };
    r.technical.legendas = `${timing.status} — tempo: desvio médio ${timing.meanOffsetMs} ms, máx ${timing.maxOffsetMs} ms (${timing.measured}/${timing.words} palavras, faixa de voz entregue); mixagem: ${mix.measured}/${mix.words} palavras da tela reconhecidas com a música`;
    const loudOk = /-1[3-5]\.\d LUFS/.test(r.technical.volume);
    r.technical.status = r.technical.arquivo === "íntegro" && r.technical.decodificacao === 0 && r.technical.quadrosPretos === 0 && timing.status === "ok" && loudOk ? "aprovado" : "reprovado";
    console.log(`[QA] ${v.name}: técnico ${r.technical.status} · quadros pretos ${r.technical.quadrosPretos}, vazios ${r.technical.quadrosVazios} · ${r.technical.legendas}`);
  }
  await writeFile(join(OUT, "relatorio-qualidade.json"), JSON.stringify(report, null, 2));
}

try {
  if (has("--qa")) await qa();
  else if (has("--emit")) await emit();
  else if (has("--lab")) await lab();
  else if (has("--storyboards")) await storyboards();
  else if (has("--diversify")) await diversify();
  else if (has("--render")) await render();
  else console.log("Use --emit, --lab, --storyboards, --diversify ou --render.");
} finally {
  await closeBrowser();
}
