/**
 * Storyboard → Spot. O diretor (Codex) escreve PROPOSTAS criativas; este módulo (puro):
 *  - valida cada proposta contra os materiais reais e as regras de leitura/gancho/CTA;
 *  - mede se as três propostas são realmente DIFERENTES (linguagem, abertura, sequência de planos);
 *  - pontua e escolhe com critérios EXPLÍCITOS e medidos (não com a opinião do próprio Codex);
 *  - compila a escolhida em planos com quadros na grade da batida, e os eventos de áudio (a trilha é
 *    composta com os mesmos números — o corte cai na batida por construção, não por ajuste posterior).
 */

import { spokenCodes } from "./narration-profile.js";

export const SPOT_SHOT_KINDS = ["hook_type", "type_mask", "editorial_split", "print_assemble", "trace_draw", "fullbleed", "macro", "bands", "variant_cycle", "countdown", "type_card", "logo_resolve"] as const;
export type SpotShotKind = (typeof SPOT_SHOT_KINDS)[number];
export const SPOT_TRANSITIONS = ["cut", "color_wipe", "mask_reveal", "iris_print", "match_print", "dissolve", "slide_up", "morph"] as const;
export type SpotTransition = (typeof SPOT_TRANSITIONS)[number];
export const SPOT_FRAMINGS = ["full", "print", "chest", "top", "bottom", "macro", "detail", "detail2"] as const;
export type SpotFraming = (typeof SPOT_FRAMINGS)[number];
export const SPOT_LANGUAGES = ["editorial", "graphic", "cinematic"] as const;
export type SpotLanguage = (typeof SPOT_LANGUAGES)[number];

/** Função narrativa do plano: nenhum plano existe só para "ocupar tempo". */
export const NARRATIVE_ROLES = ["hook", "clue", "question", "tension", "reveal", "proof", "offer", "cta"] as const;
export type NarrativeRole = (typeof NARRATIVE_ROLES)[number];
/** Fala do plano (roteiro para VOZ humana) com a orientação de interpretação. */
export type SceneNarration = { line: string; pauseAfterMs: number; delivery: string; intent?: "curiosidade" | "surpresa" | "entusiasmo" | "explicacao" | "emocao" | "chamada" };

export type ProposalText = { role: "headline" | "kicker" | "label" | "cta" | "body" | "caption"; text: string };
export type ProposalScene = {
  kind: SpotShotKind;
  purpose: string;
  beats: number;
  materials: string[];
  camera: { from: SpotFraming; to: SpotFraming };
  texts: ProposalText[];
  placement: "top" | "bottom" | "center";
  transition: SpotTransition;
  field: "dark" | "light" | "accent" | "fabric";
  focus: boolean;
  storyboardNote: string;
  role?: NarrativeRole;
  narration?: SceneNarration;
};
export type CreativeProposal = {
  id: string;
  title: string;
  concept: string;
  script: string[];
  language: SpotLanguage;
  emphasis: "color" | "block";
  align: "left" | "center";
  artDirection: string;
  animationLanguage: string;
  audioTreatment: { mood: "elegant" | "pop" | "cinematic"; bpm: number; notes: string };
  fromStructureReference: string;
  fromAestheticReference: string;
  materialsNeeded: string[];
  technicalResources: string[];
  limitations: string[];
  scenes: ProposalScene[];
  /** Tipo de campanha (define a interpretação da voz) e direção de voz em uma frase. */
  campaignKind?: "moda" | "tecnologia" | "casamento" | "ofertas";
  voiceDirection?: string;
  /** Dispositivo narrativo do conceito (o "como conta"): base da comparação ENTRE conceitos. */
  conceptDevice?: string;
};

export type SpotMaterial = { id: string; kind: "product_photo" | "logo"; name?: string; fabricHex?: string; hasPrint?: boolean };
export type SpotContext = { fps: number; materials: SpotMaterial[]; hasCutout: boolean; palette: { dark: string; light: string; accent: string; ink: string } };

const TRANSITION_FRAMES: Record<SpotTransition, number> = { cut: 0, color_wipe: 12, mask_reveal: 10, iris_print: 12, match_print: 8, dissolve: 10, slide_up: 10, morph: 14 };
/** Leitura: ~15 caracteres/s + 0,6 s para "achar" o texto (mesma régua do Quality Gate). */
export const readingSeconds = (text: string) => 0.6 + text.replace(/\*/g, "").length / 15;

// ---------------------------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------------------------

export type ProposalIssue = { scene?: number; code: string; message: string };

export function validateProposal(p: CreativeProposal, ctx: SpotContext): ProposalIssue[] {
  const issues: ProposalIssue[] = [];
  const ids = new Set(ctx.materials.map((m) => m.id));
  const photos = new Set(ctx.materials.filter((m) => m.kind === "product_photo").map((m) => m.id));
  const beat = 60 / p.audioTreatment.bpm;
  if (p.audioTreatment.bpm < 80 || p.audioTreatment.bpm > 132) issues.push({ code: "bpm", message: `andamento ${p.audioTreatment.bpm} fora de 80–132 BPM` });
  const total = p.scenes.reduce((a, s) => a + s.beats * beat, 0);
  if (total < 10 || total > 32) issues.push({ code: "duration", message: `duração ${total.toFixed(1)} s fora de 10–32 s` });
  if (p.scenes.length < 4) issues.push({ code: "scenes", message: "menos de 4 planos: vira slideshow" });
  p.scenes.forEach((s, i) => {
    if (!SPOT_SHOT_KINDS.includes(s.kind)) issues.push({ scene: i, code: "kind", message: `tipo de plano desconhecido: ${s.kind}` });
    for (const id of s.materials) if (!ids.has(id)) issues.push({ scene: i, code: "material", message: `material inexistente: ${id}` });
    const needsPhoto = ["hook_type", "type_mask", "editorial_split", "fullbleed", "macro", "bands", "variant_cycle"].includes(s.kind);
    if (needsPhoto && !s.materials.some((id) => photos.has(id))) issues.push({ scene: i, code: "material", message: `${s.kind} sem foto do produto` });
    if ((s.kind === "bands" || s.kind === "variant_cycle") && s.materials.filter((id) => photos.has(id)).length < 2) issues.push({ scene: i, code: "variants", message: `${s.kind} precisa de 2+ variantes` });
    if ((s.kind === "print_assemble" || s.kind === "trace_draw") && !ctx.hasCutout) issues.push({ scene: i, code: "cutout", message: "montagem/traço da estampa sem recorte confiável" });
    const seconds = s.beats * beat;
    const text = s.texts.filter((t) => t.role !== "caption").map((t) => t.text).join(" ");
    if (text && readingSeconds(text) > seconds + 0.2 && s.kind !== "logo_resolve") issues.push({ scene: i, code: "reading", message: `texto "${text}" pede ${readingSeconds(text).toFixed(1)} s e o plano tem ${seconds.toFixed(1)} s` });
    if (seconds > 4.2 && !["logo_resolve", "variant_cycle"].includes(s.kind)) issues.push({ scene: i, code: "long_static", message: `plano de ${seconds.toFixed(1)} s (máx. 4,2 s): cena longa demais` });
  });
  const first = p.scenes[0];
  if (first) {
    const hook = first.texts.find((t) => t.role === "headline");
    if (first.beats * beat > 2.2) issues.push({ scene: 0, code: "hook", message: "gancho passa de 2,2 s" });
    if (!hook || hook.text.replace(/\*/g, "").split(/\s+/).length > 5) issues.push({ scene: 0, code: "hook", message: "gancho precisa de título curto (≤ 5 palavras)" });
  }
  // Revelação (quiz, "era a…", antes/depois): o gancho segura o palpite — não mostra o produto inteiro.
  const reveals = p.scenes.slice(1).some((s) => s.texts.some((t) => /\b(era a|era o|era b|resposta|revela)/i.test(t.text.replace(/\*/g, ""))));
  if (first && reveals && (["full", "chest", "print", "macro"].includes(first.camera.from) || ["full", "chest", "print", "macro"].includes(first.camera.to))) {
    issues.push({ scene: 0, code: "spoiler", message: `o gancho mostra a estampa inteira (câmera ${first.camera.from}→${first.camera.to}) antes da revelação; num quiz o gancho segura o palpite com detail→detail` });
  }
  // Mistério: antes do plano de revelação, nenhum plano mostra a estampa INTEIRA da resposta (traço,
  // montagem ou foto aberta). A comparação A/B é a pergunta — essa pode mostrar as opções.
  const revealAt = p.scenes.findIndex((s) => s.role === "reveal" || s.texts.some((t) => /\b(era a|era o|era b|resposta)/i.test(t.text.replace(/\*/g, ""))));
  if (revealAt > 0) {
    p.scenes.slice(1, revealAt).forEach((s, k) => {
      const opens = s.kind === "trace_draw" || s.kind === "print_assemble" || ((s.kind === "fullbleed" || s.kind === "macro") && !["detail", "detail2"].includes(s.camera.to));
      if (opens) issues.push({ scene: k + 1, code: "spoiler", message: `plano ${k + 2} (${s.kind}) mostra a estampa inteira antes da revelação: guarde o traço completo para a revelação` });
    });
  }
  // Redundância: dois planos seguidos com o mesmo tipo, os mesmos materiais e a mesma câmera.
  p.scenes.forEach((s, i) => {
    const prev = p.scenes[i - 1];
    if (prev && prev.kind === s.kind && prev.materials.join() === s.materials.join() && prev.camera.from === s.camera.from && prev.camera.to === s.camera.to) issues.push({ scene: i, code: "redundant", message: `plano ${i + 1} repete o plano ${i} (mesmo tipo, material e câmera)` });
  });
  // Narração: frase falada (até 16 palavras), sem código lido, e que caiba no plano (≈ 14 caracteres/s falados + a pausa).
  p.scenes.forEach((s, i) => {
    if (!s.narration?.line) return;
    const words = s.narration.line.replace(/\*/g, "").split(/\s+/).filter(Boolean).length;
    const speak = s.narration.line.replace(/\*/g, "").length / 14 + (s.narration.pauseAfterMs ?? 0) / 1000 * 0.5 + 0.15;
    if (words > 16) issues.push({ scene: i, code: "narration_long", message: `fala do plano ${i + 1} tem ${words} palavras (máx. 16): divida em duas frases` });
    if (speak > s.beats * beat + 0.35) issues.push({ scene: i, code: "narration_fit", message: `fala do plano ${i + 1} pede ~${speak.toFixed(1)} s e o plano tem ${(s.beats * beat).toFixed(1)} s` });
    const codes = spokenCodes(s.narration.line);
    if (codes.length) issues.push({ scene: i, code: "narration_code", message: `fala do plano ${i + 1} lê ${codes.join(", ")}: código fica só na tela, a voz diz o nome` });
  });
  // Locução, não legenda lida: a mediana de palavras por fala precisa soar como frase (referências: 6–8).
  const spoken = p.scenes.map((s) => s.narration?.line?.replace(/\*/g, "").split(/\s+/).filter(Boolean).length ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  const mid = spoken[Math.floor((spoken.length - 1) / 2)] ?? 0;
  if (spoken.length >= 3 && mid < 4) issues.push({ code: "narration_fragmented", message: `falas de ${mid} palavras (mediana): soa como legenda lida — escreva frases completas que continuam de um plano para o outro` });
  const durations = p.scenes.slice(0, -1).map((s) => s.beats * beat);
  const mean = durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length);
  const cv = Math.sqrt(durations.reduce((a, d) => a + (d - mean) ** 2, 0) / Math.max(1, durations.length)) / Math.max(0.01, mean);
  if (durations.length >= 4 && cv < 0.18) issues.push({ code: "flat_rhythm", message: `ritmo uniforme (variação ${Math.round(cv * 100)}%): alterne planos rápidos de pista com um respiro antes da revelação` });
  const last = p.scenes[p.scenes.length - 1];
  if (!last || last.kind !== "logo_resolve" || !last.texts.some((t) => t.role === "cta")) issues.push({ code: "cta", message: "o último plano precisa ser a assinatura com CTA" });
  return issues;
}

// ---------------------------------------------------------------------------------------------
// Distinção entre propostas
// ---------------------------------------------------------------------------------------------

function jaccard(a: string[], b: string[]) {
  const pairs = (x: string[]) => new Set(x.slice(1).map((k, i) => `${x[i]}>${k}`));
  const A = pairs(a), B = pairs(b);
  const inter = [...A].filter((k) => B.has(k)).length;
  return inter / Math.max(1, new Set([...A, ...B]).size);
}

/** Duas propostas são "a mesma com retoques" se dividem linguagem, abertura e quase toda a sequência. */
const STOP = new Set(["a", "o", "e", "de", "da", "do", "que", "com", "para", "em", "um", "uma", "na", "no", "os", "as", "se", "por", "ao", "dos", "das", "mais"]);
const conceptTokens = (p: CreativeProposal) => new Set(`${p.conceptDevice ?? ""} ${p.concept}`.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));

/** Duas propostas são "a mesma com retoques" se dividem conceito, linguagem, abertura e quase toda a sequência. */
export function proposalDistance(a: CreativeProposal, b: CreativeProposal) {
  const seqA = a.scenes.map((s) => s.kind), seqB = b.scenes.map((s) => s.kind);
  const ta = conceptTokens(a), tb = conceptTokens(b);
  const conceptSimilarity = [...ta].filter((w) => tb.has(w)).length / Math.max(1, new Set([...ta, ...tb]).size);
  const diffs = [a.language !== b.language, seqA[0] !== seqB[0], jaccard(seqA, seqB) < 0.5, a.emphasis !== b.emphasis || a.align !== b.align, Math.abs(a.audioTreatment.bpm - b.audioTreatment.bpm) >= 10, conceptSimilarity < 0.3];
  const differences = diffs.filter(Boolean).length;
  // Conceito parecido + sequência parecida = variação do mesmo vídeo, mesmo com cores/fonte diferentes.
  return { differences, sequenceSimilarity: Math.round(jaccard(seqA, seqB) * 100) / 100, conceptSimilarity: Math.round(conceptSimilarity * 100) / 100, distinct: differences >= 3 && !(conceptSimilarity >= 0.3 && jaccard(seqA, seqB) >= 0.5) };
}

// ---------------------------------------------------------------------------------------------
// Seleção com critérios explícitos
// ---------------------------------------------------------------------------------------------

export type ReferenceTargets = {
  /** Plano mediano (s) da referência de ESTRUTURA. */
  structureMedianShot?: number;
  /** Luminância média (0–255) da referência de ESTÉTICA. */
  aestheticLuma?: number;
};
export type BrandTaste = { preferred: string[]; rejected: string[] };

export type ProposalScore = { id: string; total: number; criteria: { key: string; label: string; weight: number; score: number; evidence: string }[]; issues: ProposalIssue[] };

const PATTERN_OF: Record<string, (p: CreativeProposal) => boolean> = {
  // Padrões que a marca pode reprovar/preferir (vindos do feedback humano registrado).
  cena_estatica_longa: (p) => p.scenes.some((s) => s.beats * (60 / p.audioTreatment.bpm) > 3.5 && s.camera.from === s.camera.to && s.kind !== "logo_resolve"),
  texto_centralizado: (p) => p.align === "center",
  fundo_escuro: (p) => p.scenes.filter((s) => s.field === "dark").length >= p.scenes.length / 2,
  transicoes_variadas: (p) => new Set(p.scenes.map((s) => s.transition).filter((t) => t !== "cut")).size > 3,
  montagem_da_estampa: (p) => p.scenes.some((s) => s.kind === "print_assemble" || s.kind === "trace_draw"),
  cartoes_de_foto: (p) => p.scenes.some((s) => s.kind === "logo_resolve" && s.materials.some((id) => id !== "LOGO")),
  gancho_tipografico: (p) => p.scenes[0]?.kind === "hook_type",
  legenda_em_pilula: (p) => p.scenes.some((s) => s.texts.some((t) => t.role === "caption")),
  troca_de_cor_com_match: (p) => p.scenes.some((s) => s.kind === "variant_cycle"),
};
export const BRAND_PATTERNS = Object.keys(PATTERN_OF);

export function scoreProposal(p: CreativeProposal, ctx: SpotContext, targets: ReferenceTargets = {}, taste: BrandTaste = { preferred: [], rejected: [] }, baseline?: CreativeProposal): ProposalScore {
  const beat = 60 / p.audioTreatment.bpm;
  const secs = p.scenes.map((s) => s.beats * beat);
  const total = secs.reduce((a, b) => a + b, 0);
  const sorted = [...secs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const issues = validateProposal(p, ctx);
  const first = p.scenes[0]!;
  const productKinds = new Set(["hook_type", "type_mask", "editorial_split", "print_assemble", "trace_draw", "fullbleed", "macro", "bands", "variant_cycle"]);
  const productShare = p.scenes.reduce((a, s, i) => a + (productKinds.has(s.kind) || (s.kind === "logo_resolve") ? secs[i]! * (s.kind === "logo_resolve" ? 0.5 : 1) : 0), 0) / Math.max(0.1, total);
  const hookWords = first.texts.find((t) => t.role === "headline")?.text.replace(/\*/g, "").split(/\s+/).length ?? 99;
  const darkShare = p.scenes.filter((s) => s.field === "dark" || ["hook_type", "fullbleed", "macro", "variant_cycle", "bands"].includes(s.kind)).length / p.scenes.length;
  const transitionKinds = new Set(p.scenes.map((s) => s.transition).filter((t) => t !== "cut")).size;
  const moving = p.scenes.filter((s) => s.camera.from !== s.camera.to || ["print_assemble", "trace_draw", "variant_cycle", "bands", "countdown", "logo_resolve", "hook_type"].includes(s.kind)).length / p.scenes.length;
  const readingFails = issues.filter((i) => i.code === "reading").length;
  const pref = taste.preferred.filter((k) => PATTERN_OF[k]?.(p)).length;
  const rej = taste.rejected.filter((k) => PATTERN_OF[k]?.(p));
  const c = (key: string, label: string, weight: number, score: number, evidence: string) => ({ key, label, weight, score: Math.max(0, Math.min(1, score)), evidence });
  const roles = p.scenes.map((s) => s.role).filter(Boolean) as NarrativeRole[];
  const arc = (roles[0] === "hook" ? 0.3 : 0) + (roles.includes("reveal") || roles.includes("proof") ? 0.3 : 0) + (roles[roles.length - 1] === "cta" ? 0.2 : 0) + (new Set(roles).size >= 4 ? 0.2 : 0) - issues.filter((i) => i.code === "redundant").length * 0.25;
  const durs = secs.slice(0, -1);
  const meanD = durs.reduce((a, b) => a + b, 0) / Math.max(1, durs.length);
  const cvD = Math.sqrt(durs.reduce((a, d) => a + (d - meanD) ** 2, 0) / Math.max(1, durs.length)) / Math.max(0.01, meanD);
  const narrationIssues = issues.filter((i) => i.code === "narration_long" || i.code === "narration_fit").length;
  const criteria = [
    c("hook", "Gancho nos 2 primeiros segundos", 0.16, (secs[0]! <= 2.2 ? 0.5 : 0) + (hookWords <= 4 ? 0.3 : hookWords <= 5 ? 0.15 : 0) + (productKinds.has(first.kind) ? 0.2 : 0), `${secs[0]!.toFixed(1)} s, ${hookWords} palavras, ${first.kind}`),
    c("rhythm", "Ritmo da referência de estrutura", 0.1, targets.structureMedianShot ? 1 - Math.min(1, Math.abs(median - targets.structureMedianShot) / (targets.structureMedianShot * 1.5)) : 0.5, `plano mediano ${median.toFixed(2)} s × referência ${targets.structureMedianShot?.toFixed(2) ?? "—"} s`),
    c("product", "Produto em cena", 0.14, productShare / 0.85, `${Math.round(productShare * 100)}% do tempo com o produto`),
    c("movement", "Movimento com intenção (sem cena parada)", 0.1, moving, `${Math.round(moving * 100)}% dos planos com movimento/animação`),
    c("aesthetic", "Linguagem da referência de estética", 0.1, targets.aestheticLuma !== undefined ? (targets.aestheticLuma < 100 ? darkShare : 1 - darkShare) * 0.6 + (transitionKinds <= 3 ? 0.4 : 0.1) : 0.5, `${Math.round(darkShare * 100)}% de planos escuros, ${transitionKinds} tipos de transição`),
    c("legibility", "Leitura, fala e mistério até a revelação", 0.1, (1 - (readingFails + narrationIssues) / Math.max(1, p.scenes.length)) * (issues.some((i) => i.code === "spoiler") ? 0.4 : 1), `${readingFails} plano(s) curtos para o texto, ${narrationIssues} fala(s) fora do tempo${issues.some((i) => i.code === "spoiler") ? "; revela antes da hora" : ""}`),
    c("cta", "CTA claro no fim", 0.08, issues.some((i) => i.code === "cta") ? 0 : 1, p.scenes[p.scenes.length - 1]?.texts.find((t) => t.role === "cta")?.text ?? "sem CTA"),
    c("feasibility", "Viável com os materiais (sem inventar)", 0.05, 1 - Math.min(1, issues.filter((i) => ["material", "cutout", "variants", "kind"].includes(i.code)).length / 2), `${issues.filter((i) => ["material", "cutout", "variants", "kind"].includes(i.code)).length} pendência(s) de material`),
    c("narrative", "Progressão narrativa (gancho → pista → revelação → CTA, sem plano redundante)", 0.08, arc, roles.length ? roles.join(" → ") : "sem papéis narrativos"),
    c("variation", "Ritmo variável", 0.05, Math.min(1, cvD / 0.35), `variação da duração dos planos ${Math.round(cvD * 100)}%`),
    c("taste", "Preferências e reprovações da marca", 0.04, rej.length ? 0 : taste.preferred.length ? pref / taste.preferred.length : 0.5, rej.length ? `reprovado pela marca: ${rej.join(", ")}` : `${pref}/${taste.preferred.length} preferências atendidas`),
  ];
  // Novidade em relação à versão ATUAL (quando há): a evolução não pode ser a mesma montagem com mais efeito.
  if (baseline) {
    const d = proposalDistance(p, baseline);
    criteria.push(c("novelty", "Proposta nova em relação à versão atual", 0.1, d.differences / 6, `${d.differences}/6 diferenças da versão atual (conceito ${d.conceptSimilarity}, sequência ${d.sequenceSimilarity})`));
    const sum = criteria.reduce((a, k) => a + k.weight, 0);
    for (const k of criteria) k.weight = +(k.weight / sum).toFixed(4);
  }
  const totalScore = criteria.reduce((a, k) => a + k.weight * k.score, 0) - (rej.length ? 0.15 : 0) - (issues.some((i) => ["material", "kind", "cta", "cutout"].includes(i.code)) ? 0.3 : 0);
  return { id: p.id, total: Math.round(totalScore * 1000) / 1000, criteria, issues };
}

/** Padrões reprovados pela marca presentes na proposta (entram na refação direcionada). */
export function tasteViolations(p: CreativeProposal, taste: BrandTaste): string[] {
  return taste.rejected.filter((k) => PATTERN_OF[k]?.(p));
}

export function selectProposal(list: CreativeProposal[], ctx: SpotContext, targets?: ReferenceTargets, taste?: BrandTaste, baseline?: CreativeProposal) {
  const scores = list.map((p) => scoreProposal(p, ctx, targets, taste, baseline)).sort((a, b) => b.total - a.total);
  const distances = list.flatMap((a, i) => list.slice(i + 1).map((b) => ({ a: a.id, b: b.id, ...proposalDistance(a, b) })));
  return { chosen: scores[0]!.id, scores, distances, allDistinct: distances.every((d) => d.distinct) };
}

// ---------------------------------------------------------------------------------------------
// Compilação (quadros na grade da batida + eventos de áudio)
// ---------------------------------------------------------------------------------------------

export type AudioEvent = { frame: number; kind: "hit" | "pop" | "whoosh" | "switch" | "land" | "riser_end" | "logo" | "click" | "tension_stop" | "drop"; strength: number };
export type CompiledShot = {
  kind: SpotShotKind; from: number; frames: number; photo?: string; photos?: string[]; camera: { from: SpotFraming; to: SpotFraming };
  texts: ProposalText[]; placement: "top" | "bottom" | "center"; field: string; transition: SpotTransition; transitionFrames: number; transitionColor?: string;
  events?: number[]; focus?: boolean; strip?: string[]; role?: NarrativeRole; narration?: SceneNarration;
};
export type CompiledSpot = { durationInFrames: number; fps: number; bpm: number; beatFrames: number; shots: CompiledShot[]; audio: AudioEvent[]; sections: { from: number; to: number; energy: number; kind: SpotShotKind }[] };

const ENERGY: Record<SpotShotKind, number> = { hook_type: 0.75, type_mask: 0.7, editorial_split: 0.75, print_assemble: 0.55, trace_draw: 0.55, fullbleed: 0.85, macro: 0.6, bands: 0.9, variant_cycle: 1, countdown: 0.7, type_card: 0.6, logo_resolve: 0.45 };

/**
 * `taste`: regras da marca valem na COMPILAÇÃO, não só na nota — ex.: marca que reprova cartões de foto
 * não recebe a faixa de fotos na assinatura, mesmo que a proposta peça.
 */
export function compileProposal(p: CreativeProposal, ctx: SpotContext, elementCount: number, taste: BrandTaste = { preferred: [], rejected: [] }): CompiledSpot {
  const fps = ctx.fps;
  const beatFrames = (60 / p.audioTreatment.bpm) * fps;
  const byId = new Map(ctx.materials.map((m) => [m.id, m]));
  const fieldHex = (s: ProposalScene) => {
    if (s.field === "light") return ctx.palette.light;
    if (s.field === "accent") return ctx.palette.accent;
    if (s.field === "fabric") return byId.get(s.materials[0] ?? "")?.fabricHex ?? ctx.palette.dark;
    return ctx.palette.dark;
  };
  const shots: CompiledShot[] = [];
  const audio: AudioEvent[] = [];
  let cursor = 0;
  p.scenes.forEach((s, i) => {
    // Bordas dos planos em batidas INTEIRAS desde o início: o corte cai na batida por construção.
    const end = Math.round((p.scenes.slice(0, i + 1).reduce((a, x) => a + x.beats, 0)) * beatFrames);
    const frames = Math.max(6, end - cursor);
    const photos = s.materials.filter((id) => byId.get(id)?.kind === "product_photo");
    const transition = i === 0 ? "cut" : s.transition;
    const tf = Math.min(TRANSITION_FRAMES[transition], Math.floor(frames / 3));
    const shot: CompiledShot = { kind: s.kind, from: cursor, frames, camera: s.camera, texts: s.texts, placement: s.placement, field: fieldHex(s), transition, transitionFrames: tf, focus: s.focus || undefined };
    if (photos[0]) shot.photo = photos[0];
    if (["bands", "variant_cycle", "logo_resolve"].includes(s.kind) && photos.length) shot.photos = photos;
    if (s.kind === "logo_resolve" && photos.length && !taste.rejected.includes("cartoes_de_foto")) shot.strip = photos.slice(0, 3);
    if (s.kind === "bands" || s.kind === "countdown") shot.photos = photos.slice(0, 3);
    if (s.kind === "countdown" && !s.texts.some((t) => t.role === "label")) {
      const prev = [...p.scenes.slice(0, i)].reverse().find((x) => x.kind === "bands");
      if (prev) shot.texts = [...s.texts, ...prev.texts.filter((t) => t.role === "label")];
    }
    if (transition === "color_wipe") {
      const fabric = byId.get(photos[0] ?? "")?.fabricHex;
      const lum = fabric ? (parseInt(fabric.slice(1, 3), 16) * 0.2126 + parseInt(fabric.slice(3, 5), 16) * 0.7152 + parseInt(fabric.slice(5, 7), 16) * 0.0722) : 0;
      shot.transitionColor = s.kind === "variant_cycle" && fabric && lum > 70 ? fabric : ctx.palette.accent;
    }
    if (s.kind === "print_assemble") {
      // Um elemento a cada meia batida, depois de um respiro de meia batida; a estampa pousa no fim.
      shot.events = Array.from({ length: elementCount }, (_, k) => Math.round(beatFrames * 0.5 * (k + 1)));
      for (const e of shot.events) audio.push({ frame: cursor + e, kind: "pop", strength: 0.6 });
      audio.push({ frame: cursor + frames, kind: "land", strength: 0.8 });
    }
    if (s.kind === "variant_cycle" && photos.length > 1) {
      const per = Math.max(1, Math.floor(s.beats / photos.length));
      shot.events = photos.slice(1).map((_, k) => Math.round((k + 1) * per * beatFrames));
      for (const e of shot.events) audio.push({ frame: cursor + e - 9, kind: "switch", strength: 0.7 });
    }
    if (s.kind === "bands") {
      shot.events = photos.slice(0, 3).map((_, k) => Math.round(k * beatFrames * 0.5));
      for (const e of shot.events) audio.push({ frame: cursor + e, kind: "whoosh", strength: 0.5 });
    }
    if (s.kind === "trace_draw") {
      // O traço se desenha em ~70% do plano (som de "risco" contínuo) e pousa no fim.
      shot.events = [0, Math.round(frames * 0.78)];
      audio.push({ frame: cursor + shot.events[0]!, kind: "whoosh", strength: 0.35 });
      audio.push({ frame: cursor + frames, kind: "land", strength: 0.7 });
    }
    if (s.kind === "countdown") {
      const n = 3;
      const per = Math.max(1, Math.floor(s.beats / n));
      shot.events = Array.from({ length: n }, (_, k) => Math.round(k * per * beatFrames));
      for (const e of shot.events) audio.push({ frame: cursor + e, kind: "pop", strength: 0.8 });
    }
    if (s.kind === "hook_type") audio.push({ frame: cursor, kind: "hit", strength: 1 });
    if (s.kind === "logo_resolve") {
      audio.push({ frame: cursor + tf + 1, kind: "riser_end", strength: 0.8 });
      audio.push({ frame: cursor + tf + 8, kind: "logo", strength: 0.9 });
      if (s.texts.some((t) => t.role === "cta")) audio.push({ frame: cursor + tf + 31, kind: "click", strength: 0.6 });
    }
    if (i > 0 && transition !== "cut" && s.kind !== "logo_resolve") audio.push({ frame: cursor, kind: "whoosh", strength: transition === "match_print" ? 0.3 : 0.6 });
    if (s.role) shot.role = s.role;
    if (s.narration?.line) shot.narration = s.narration;
    // Tensão → revelação: a música SEGURA uma batida antes e cai junto com a resposta.
    if (s.role === "reveal" && i > 0) {
      audio.push({ frame: Math.max(0, cursor - Math.round(beatFrames)), kind: "tension_stop", strength: 1 });
      audio.push({ frame: cursor, kind: "drop", strength: 1 });
    }
    shots.push(shot);
    cursor += frames;
  });
  const sections = shots.map((s) => ({ from: s.from, to: s.from + s.frames, energy: ENERGY[s.kind], kind: s.kind }));
  return { durationInFrames: cursor, fps, bpm: p.audioTreatment.bpm, beatFrames, shots, audio: audio.sort((a, b) => a.frame - b.frame), sections };
}

/**
 * Ritmo por GÊNERO (cortes rápidos não são regra universal): faixa de duração mediana dos planos e do
 * tempo até o benefício/revelação, por tipo de campanha.
 */
export const GENRE_RHYTHM: Readonly<Record<"moda" | "tecnologia" | "casamento" | "ofertas", { medianShot: [number, number]; benefitBy: number; label: string }>> = {
  moda: { medianShot: [1.4, 2.8], benefitBy: 9, label: "moda: planos de 1,4–2,8 s, produto revelado até 9 s" },
  tecnologia: { medianShot: [2, 4], benefitBy: 6, label: "tecnologia: planos de 2–4 s (a tela precisa ser lida), benefício até 6 s" },
  casamento: { medianShot: [2.4, 4.5], benefitBy: 8, label: "casamento: planos de 2,4–4,5 s, emoção antes da oferta" },
  ofertas: { medianShot: [0.9, 2], benefitBy: 3, label: "ofertas: planos de 0,9–2 s, oferta até 3 s" },
};
