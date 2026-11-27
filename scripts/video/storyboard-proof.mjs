#!/usr/bin/env node
// PROVA DA REFORMULAÇÃO CRIATIVA — pauta REAL do Bolsão da CMKV (CMKV-QUIZ-RECORTE), fotos oficiais do catálogo,
// dois vídeos de referência (estrutura × estética) e o Codex REAL como diretor de storyboard.
//
//   npm run build && node scripts/video/storyboard-proof.mjs --emit            (prepara materiais + prompt das 3 propostas)
//   (no servidor) node codex-director-proof.mjs <dir> CMKV-storyboard          (Codex escreve as 3 propostas)
//   node scripts/video/storyboard-proof.mjs --storyboards                       (valida, pontua, escolhe, storyboard visual)
//   node scripts/video/storyboard-proof.mjs --render [--quality preview|final] [--proposal P2]
//
// Nada é publicado; nenhum serviço pago; a trilha é composta aqui (obra própria).
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { analyzeProductPrints, lumaGrid, traceProfile, trimLogo } from "../../dist/infrastructure/video-editing/product-material-analysis.js";
import { analyzeReferenceVideo } from "../../dist/infrastructure/video-editing/reference-video-analysis.js";
import { referenceGuidance, compareProfiles } from "../../dist/application/video-editing/reference-profile.js";
import { compileProposal, selectProposal, tasteViolations, validateProposal } from "../../dist/application/video-editing/spot-storyboard.js";
import { composeScoreFile } from "../../dist/infrastructure/video-editing/score-composer.js";
import { analyzeVideo, probeMedia, runFfmpegCapture } from "../../dist/infrastructure/video-editing/ffmpeg-media-analysis.js";
import { measureLoudness } from "../../dist/infrastructure/video-editing/reference-video-analysis.js";
import { closeBrowser, renderScene, renderStills } from "../../motion-graphics/render.mjs";
import { revisionPrompt, revisionSchema, storyboardPrompt, storyboardSchema } from "../editorial/storyboard-director.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const has = (name) => process.argv.includes(name);
const ROOT = resolve("artifacts/reformulacao");
const CAT = join(ROOT, "material", "catalogo");
const JOB = join(ROOT, "cmkv", "job");
const OUT = join(ROOT, "cmkv");
const CODEX = join(ROOT, "codex-sb");
const FPS = 30;
const NAME = "CMKV-storyboard";

// Paleta e tipografia: a identidade da CMKV (logo serifada preta com filetes dourados).
const BRAND = { name: "CMKV Wears", tone: "premium, editorial, streetwear sofisticado", display: "DM Serif Display", palette: { dark: "#0B0B0B", light: "#F7F5F0", accent: "#C9A227", ink: "#111111" } };
// Preferências da marca registradas a partir de regras HUMANAS (prompt criativo da própria pauta + reprovações
// já dadas pelo usuário às provas anteriores). Ver application/video-editing/brand-video-taste.ts.
const TASTE = { preferred: ["montagem_da_estampa"], rejected: ["cartoes_de_foto", "cena_estatica_longa", "foto_em_cartao_sobre_fundo_desfocado"] };
const FACTS = ["A opção A é o modelo CMKV 000037 (estampa ♡fé em traço contínuo, com flores e borboleta).", "A opção B é o modelo CMKV 000043 (estampa de limonada).", "A resposta do quiz é A (000037).", "Chamada da pauta: \"Conta se você foi de A ou de B.\""];

const MATERIALS = [
  { id: "M1", file: "000037-preto.jpg", model: "000037", color: "preta", label: "Foto oficial: camiseta PRETA modelo 000037 — estampa ♡fé em traço branco (opção A, a resposta)" },
  { id: "M2", file: "000043-preto.jpg", model: "000043", color: "preta", label: "Foto oficial: camiseta PRETA modelo 000043 — estampa limonada (opção B)" },
  { id: "M3", file: "000037-branco.jpg", model: "000037", color: "branca", label: "Foto oficial: camiseta BRANCA modelo 000037 (mesma estampa, traço preto)" },
  { id: "M4", file: "000037-bege.jpg", model: "000037", color: "bege", label: "Foto oficial: camiseta BEGE modelo 000037 (mesma estampa, traço preto)" },
];

async function prepare() {
  await mkdir(JOB, { recursive: true });
  const files = Object.fromEntries(MATERIALS.map((m) => [m.id, join(CAT, m.file)]));
  const by37 = Object.fromEntries(MATERIALS.filter((m) => m.model === "000037").map((m) => [m.id, files[m.id]]));
  const by43 = Object.fromEntries(MATERIALS.filter((m) => m.model === "000043").map((m) => [m.id, files[m.id]]));
  const prints = { ...(await analyzeProductPrints(by37, { x: 0.31, y: 0.27, w: 0.48, h: 0.13 }, { cutoutDir: JOB, prefix: "recorte" })), ...(await analyzeProductPrints(by43, { x: 0.327, y: 0.272, w: 0.377, h: 0.1 }, { cutoutDir: JOB, prefix: "recorte" })) };
  const photos = {};
  for (const m of MATERIALS) {
    await copyFile(files[m.id], join(JOB, m.file));
    const p = prints[m.id];
    photos[m.id] = { src: m.file, w: p.photo.width, h: p.photo.height, print: { x: p.print.x, y: p.print.y, w: p.print.w, h: p.print.h }, name: m.color, fabric: p.fabricHex, luma: await lumaGrid(files[m.id]) };
  }
  // Recorte para o "traço se desenha": a estampa A (000037) na camiseta preta (traço branco, maior contraste).
  const cutoutFile = "recorte-M1.png";
  const cutProbe = await probeMedia(join(JOB, cutoutFile));
  const cutout = { src: cutoutFile, w: cutProbe.video.width, h: cutProbe.video.height, elements: prints.M1.elements, trace: await traceProfile(join(JOB, cutoutFile)) };
  const logo = await trimLogo(join(ROOT, "..", "video-b0", "materials", "cmkv-logo.png"), join(JOB, "logo.png"));
  const material = { photos, cutout, logo: "logo.png", logoAspect: logo.aspect, confidence: Object.fromEntries(Object.entries(prints).map(([k, v]) => [k, v.confidence])) };
  await writeFile(join(OUT, "materiais.json"), JSON.stringify(material, null, 2));
  return material;
}

async function references() {
  const dir = join(ROOT, "referencias");
  const refs = [
    { file: "ref1-estrutura.mp4", sheet: "ref1-sheet.jpg", role: "structure", label: "Vídeo 1", note: "Estrutura comercial, ritmo, gancho inicial, cortes rápidos, progressão da mensagem, texto curto e CTA; prender nos primeiros segundos, cara de anúncio que performa.",
      observed: ["abre com pergunta de 2 palavras em letras gigantes que chegam de perto, já no 1º quadro, sobre foto escurecida", "capítulos curtos: título em caixa alta serifada com UMA palavra de destaque na cor da marca", "legenda em pílula no terço inferior que acende palavra a palavra", "faixa persistente de fotos no rodapé dá continuidade", "fecha com logo + título + botão de CTA + endereço"] },
    { file: "ref2-estetica.mp4", sheet: "ref2-sheet.jpg", role: "aesthetic", label: "Vídeo 2", note: "Estética, composição, elegância, transições, organização dos elementos, apresentação de produto/tela e acabamento premium; visual mais bonito, limpo e profissional.",
      observed: ["fundo escuro constante com UMA cor de destaque usada com parcimônia", "título condensado ancorado no topo à esquerda, sempre no mesmo lugar; 2ª linha num bloco de destaque", "telas como cartões limpos com margens consistentes; colchetes de foco e toque com onda no elemento ativo", "logo nasce de uma linha de luz; fechamento empilha palavras com destaque na última"] },
  ];
  const out = [];
  for (const ref of refs) {
    const a = await analyzeReferenceVideo(join(dir, ref.file));
    out.push({ ...ref, path: join(dir, ref.sheet), profile: a.profile, audio: a.audio, guidance: referenceGuidance(a.profile, a.audio, ref.role === "structure" ? ["ritmo", "movimento"] : ["cor", "composicao", "movimento"]) });
  }
  return out;
}

async function emit() {
  const material = await prepare();
  const refs = await references();
  await mkdir(CODEX, { recursive: true });
  const pauta = JSON.parse(await readFile(join(ROOT, "pauta-CMKV-QUIZ-RECORTE.json"), "utf8"));
  const idea = { title: pauta.title, commercialObjective: pauta.commercial_objective, targetAudience: pauta.target_audience, concept: pauta.concept, visualDirection: pauta.visual_direction, narrativeStructure: pauta.narrative_structure, cta: pauta.cta, videoScript: pauta.video_script, creativePrompt: pauta.creative_prompt };
  const mats = [...MATERIALS.map((m) => ({ id: m.id, label: m.label })), { id: "LOGO", label: "Logo oficial CMKV Wears (serifada preta com filetes dourados, fundo transparente)" }];
  const prompt = storyboardPrompt({ idea, brand: BRAND, materials: mats, references: refs.map((r) => ({ role: r.role, label: r.label, note: r.note, guidance: r.guidance, observed: r.observed })), taste: TASTE, facts: FACTS })
    + `\n\nRECURSO DE MATERIAL: o recorte da estampa de M1 (000037) está pronto (confiança ${material.confidence.M1}) — trace_draw usa M1. Anexos, na ordem: ${MATERIALS.map((m) => m.id).join(", ")}, depois as miniaturas do Vídeo 1 e do Vídeo 2.`;
  const images = [];
  for (const m of MATERIALS) { const t = join(CODEX, `${NAME}-${m.id}.jpg`); await runFfmpegCapture(["-y", "-i", join(CAT, m.file), "-vf", "scale=720:-2", "-q:v", "3", t]); images.push(t); }
  for (const r of refs) { const t = join(CODEX, `${NAME}-${r.sheet}`); await copyFile(r.path, t); images.push(t); }
  await writeFile(join(CODEX, `${NAME}-prompt.txt`), prompt);
  await writeFile(join(CODEX, `${NAME}-imagens.json`), JSON.stringify(images));
  await writeFile(join(CODEX, "schema.json"), JSON.stringify(storyboardSchema()));
  await writeFile(join(OUT, "referencias-medidas.json"), JSON.stringify(refs.map(({ path: _p, ...r }) => r), null, 2));
  console.log(`[storyboard] prompt (${prompt.length} caracteres) e ${images.length} imagens em ${CODEX}`);
}

function spotContext(material) {
  return { fps: FPS, hasCutout: (material.confidence.M1 ?? 0) >= 0.6, palette: BRAND.palette, materials: [...MATERIALS.map((m) => ({ id: m.id, kind: "product_photo", name: m.color, fabricHex: material.photos[m.id].fabric, hasPrint: true })), { id: "LOGO", kind: "logo" }] };
}

function spotProps(proposal, compiled, material) {
  return {
    template: "spot", width: 1080, height: 1920, fps: FPS, durationInFrames: compiled.durationInFrames,
    brand: { name: BRAND.name, primary: BRAND.palette.dark, accent: BRAND.palette.accent, light: BRAND.palette.light, dark: BRAND.palette.dark, display: BRAND.display },
    language: proposal.language, emphasis: proposal.emphasis, align: proposal.align, palette: BRAND.palette, brandLabel: "CMKV Wears",
    photos: material.photos, cutout: material.cutout, logo: material.logo, logoAspect: material.logoAspect,
    motion: { easing: proposal.language === "graphic" ? "expo" : "quint", textCase: "sentence", grain: 0.12 },
    shots: compiled.shots.map(({ camera, ...s }) => ({ ...s, camera })),
  };
}

const REV = join(ROOT, "codex-rev");
const TASTE_LABEL = { cartoes_de_foto: "a marca reprova cartões de foto na mesma tela: a assinatura (logo_resolve) usa só LOGO em materials", cena_estatica_longa: "a marca reprova cena parada longa", foto_em_cartao_sobre_fundo_desfocado: "a marca reprova foto em cartão sobre fundo desfocado" };

/** Propostas do Codex; a escolhida é trocada pela versão refeita, se houver. */
async function loadProposals() {
  const raw = JSON.parse(await readFile(join(CODEX, `${NAME}-codex.json`), "utf8"));
  if (has("--original")) return raw.proposals;
  return Promise.all(raw.proposals.map(async (p) => {
    const revised = join(REV, `CMKV-revisao-${p.id}-codex.json`);
    if (!existsSync(revised)) return p;
    const r = JSON.parse(await readFile(revised, "utf8"));
    return { ...r.proposal, id: p.id, revised: r.changes };
  }));
}

/** Refação direcionada da proposta escolhida: pendências MEDIDAS + regras da marca + storyboard como imagem. */
async function revise() {
  const material = JSON.parse(await readFile(join(OUT, "materiais.json"), "utf8"));
  const sel = JSON.parse(await readFile(join(OUT, "selecao.json"), "utf8"));
  const raw = JSON.parse(await readFile(join(CODEX, `${NAME}-codex.json`), "utf8"));
  // Empate técnico (< 0,03) entre as duas primeiras: as duas passam pela refação e são pontuadas de novo.
  const [first, second] = sel.scores;
  const ids = second && first.total - second.total < 0.03 ? [first.id, second.id] : [first.id];
  await mkdir(REV, { recursive: true });
  await writeFile(join(REV, "schema.json"), JSON.stringify(revisionSchema()));
  for (const id of ids) {
  const p = raw.proposals.find((x) => x.id === id);
  const issues = [...validateProposal(p, spotContext(material)).map((i) => `${i.scene !== undefined ? `plano ${i.scene + 1}: ` : ""}${i.message}`), ...tasteViolations(p, TASTE).map((k) => TASTE_LABEL[k] ?? k)];
  const sheet = join(REV, `CMKV-revisao-storyboard-${p.id}.jpg`);
  await copyFile(join(OUT, `storyboard-${p.id}.jpg`), sheet);
  await writeFile(join(REV, `CMKV-revisao-${p.id}-prompt.txt`), revisionPrompt({ proposal: p, issues, notes: ["A imagem anexada é o storyboard renderizado desta proposta (2 quadros por plano)."] }));
  await writeFile(join(REV, `CMKV-revisao-${p.id}-imagens.json`), JSON.stringify([sheet]));
  console.log(`[refação] ${p.id}: ${issues.length} pendência(s)`);
  for (const issue of issues) console.log(`  - ${issue}`);
  }
  console.log(`[refação] nomes para o runner: ${ids.map((id) => `CMKV-revisao-${id}`).join(",")}`);
}

async function storyboards() {
  const material = JSON.parse(await readFile(join(OUT, "materiais.json"), "utf8"));
  const refs = JSON.parse(await readFile(join(OUT, "referencias-medidas.json"), "utf8"));
  const ctx = spotContext(material);
  const proposals = await loadProposals();
  const targets = { structureMedianShot: refs.find((r) => r.role === "structure")?.profile.shots.medianSeconds, aestheticLuma: refs.find((r) => r.role === "aesthetic")?.profile.luma.mean };
  const selection = selectProposal(proposals, ctx, targets, TASTE);
  const sheets = {};
  for (const p of proposals) {
    const compiled = compileProposal(p, ctx, material.cutout.elements.length, TASTE);
    const props = spotProps(p, compiled, material);
    // Storyboard visual: 2 quadros por plano (entrada e meio), renderizados SEM codificar vídeo.
    const frames = compiled.shots.flatMap((s) => [s.from + Math.min(s.frames - 1, (s.transitionFrames ?? 0) + 6), s.from + Math.round(s.frames * 0.62)]);
    const dir = join(OUT, "storyboard", p.id);
    await mkdir(dir, { recursive: true });
    const started = Date.now();
    const { files } = await renderStills({ jobDir: JOB, props, frames, outDir: dir, prefix: p.id, scale: 0.4 });
    const cols = Math.min(8, files.length);
    const sheet = join(OUT, `storyboard-${p.id}.jpg`);
    await runFfmpegCapture(["-y", ...files.flatMap((f) => ["-i", f]), "-filter_complex", `${files.map((_, i) => `[${i}:v]scale=216:384,setsar=1[t${i}]`).join(";")};${files.map((_, i) => `[t${i}]`).join("")}xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % cols) * 220}_${Math.floor(i / cols) * 388}`).join("|")}:fill=white[v]`, "-map", "[v]", "-frames:v", "1", "-q:v", "3", sheet], { timeoutMs: 120_000 });
    sheets[p.id] = { sheet, stills: files.length, ms: Date.now() - started, seconds: +(compiled.durationInFrames / FPS).toFixed(2), shots: compiled.shots.length, issues: validateProposal(p, ctx) };
    console.log(`[storyboard] ${p.id} "${p.title}" (${p.language}): ${sheets[p.id].seconds}s, ${compiled.shots.length} planos, ${files.length} quadros em ${(sheets[p.id].ms / 1000).toFixed(1)}s`);
  }
  await writeFile(join(OUT, "selecao.json"), JSON.stringify({ targets, taste: TASTE, ...selection, sheets }, null, 2));
  for (const s of selection.scores) console.log(`[seleção] ${s.id}: ${s.total} — ${s.criteria.map((c) => `${c.key} ${c.score.toFixed(2)}`).join(" · ")}${s.issues.length ? ` | pendências: ${s.issues.map((i) => i.message).join("; ")}` : ""}`);
  console.log(`[seleção] escolhida: ${selection.chosen} · todas distintas: ${selection.allDistinct} (${selection.distances.map((d) => `${d.a}×${d.b}: ${d.differences} diferenças`).join(", ")})`);
}

async function render() {
  const quality = arg("--quality", "preview");
  const material = JSON.parse(await readFile(join(OUT, "materiais.json"), "utf8"));
  const sel = JSON.parse(await readFile(join(OUT, "selecao.json"), "utf8"));
  const id = arg("--proposal", sel.chosen);
  const proposals = await loadProposals();
  const p = proposals.find((x) => x.id === id);
  const ctx = spotContext(material);
  const compiled = compileProposal(p, ctx, material.cutout.elements.length, TASTE);
  const props = spotProps(p, compiled, material);
  const name = `${id}-${quality === "final" ? "final" : "previa"}`;
  const started = Date.now();
  const video = join(OUT, `${name}-video.mp4`);
  const r = await renderScene({ jobDir: JOB, outputPath: video, props, quality });
  // Trilha composta para ESTE corte (mesmos quadros dos eventos visuais).
  const score = join(OUT, `${id}-trilha.wav`);
  const audio = await composeScoreFile(score, { bpm: compiled.bpm, seconds: compiled.durationInFrames / FPS, mood: p.audioTreatment.mood, sections: compiled.sections.map((s) => ({ from: s.from / FPS, to: s.to / FPS, energy: s.energy, kind: s.kind })), events: compiled.audio.map((e) => ({ at: e.frame / FPS, kind: e.kind, strength: e.strength })), tailSeconds: 0.2, seed: 37 });
  const output = join(OUT, `${name}.mp4`);
  const mux = await runFfmpegCapture(["-y", "-i", video, "-i", score, "-filter_complex", "[1:a]loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", output], { timeoutMs: 300_000 });
  if (mux.exitCode !== 0) throw new Error(mux.stderr.slice(-800));
  const ms = Date.now() - started;
  // Quality Gate TÉCNICO (integridade): decodificação, quadros pretos, silêncio, loudness, pico.
  const tech = await analyzeVideo(output, { hasAudio: true });
  const loud = await measureLoudness(output);
  const probe = await probeMedia(output);
  const measured = await analyzeReferenceVideo(output);
  const refs = JSON.parse(await readFile(join(OUT, "referencias-medidas.json"), "utf8"));
  const gate = {
    decodeErrors: tech.decodeErrors.length, blackSegments: tech.blackSegments, silence: tech.silenceSegments,
    loudness: loud, duration: probe.durationSeconds, size: `${probe.video?.width}x${probe.video?.height}`,
    pass: tech.decodeErrors.length === 0 && tech.blackSegments.length === 0 && (loud.integratedLufs ?? -99) > -16 && (loud.integratedLufs ?? 0) < -12 && (loud.truePeakDb ?? 0) <= -1,
  };
  const report = { proposal: id, title: p.title, quality, renderMs: r.ms, totalMs: ms, sizeMb: +((await stat(output)).size / 1e6).toFixed(2), score: audio, gate, measured: { profile: measured.profile, audio: measured.audio, guidance: referenceGuidance(measured.profile, measured.audio) }, vsReferences: refs.map((ref) => ({ ref: ref.label, role: ref.role, diffs: compareProfiles(measured.profile, ref.profile) })), editorial: { status: "awaiting_human", note: "O QG técnico verifica integridade; o padrão comercial só é declarado por avaliação humana (preferências/reprovações da marca)." } };
  await writeFile(join(OUT, `${name}-relatorio.json`), JSON.stringify(report, null, 2));
  console.log(`[render] ${name}: ${(compiled.durationInFrames / FPS).toFixed(1)}s em ${(ms / 1000).toFixed(1)}s (Remotion ${(r.ms / 1000).toFixed(1)}s) · ${report.sizeMb} MB · QG técnico ${gate.pass ? "OK" : "FALHOU"} · ${loud.integratedLufs} LUFS / ${loud.truePeakDb} dBTP`);
  for (const line of report.measured.guidance) console.log(`         ${line}`);
}

try {
  if (has("--emit")) await emit();
  else if (has("--storyboards")) await storyboards();
  else if (has("--render")) await render();
  else if (has("--revise")) await revise();
  else console.log("Use --emit, --storyboards ou --render.");
} finally {
  await closeBrowser();
}
