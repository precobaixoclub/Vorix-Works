/**
 * Direção audiovisual (puro, testável): traduz decisões do diretor criativo em PARÂMETROS concretos.
 *
 * - Emotion Engine: a emoção de cada cena muda ritmo, intensidade de movimento, curva de animação,
 *   transição, densidade de efeitos sonoros, energia da trilha e composição.
 * - Brand Motion System: a personalidade audiovisual da marca (movimento, curvas, cantos, tipografia,
 *   transições, paleta sonora) — empresas diferentes não saem do mesmo molde.
 * - Beat Sync: cortes encaixados na batida quando cabem, sem sacrificar o tempo de leitura.
 * - Sound Design: plano de efeitos a partir de eventos visuais reais, com limites de densidade/repetição
 *   e intensidade menor sob a fala.
 * - Áreas seguras das plataformas (Reels/TikTok/Shorts) e verificações objetivas do Quality Gate.
 */

import type { EditTransitionType } from "../../domain/video-editing/video-edit-plan.js";

// ---------------------------------------------------------------- emoção

export const EMOTIONS = ["curiosity", "desire", "urgency", "trust", "sophistication", "energy", "authority", "surprise", "identification"] as const;
export type Emotion = (typeof EMOTIONS)[number];
export type Easing = "expo" | "quint" | "sine" | "back";
export type SfxKind = "whoosh" | "whoosh_soft" | "click" | "soft_click" | "tick" | "pop" | "impact" | "impact_soft" | "reveal" | "shimmer" | "riser";
/** Duração de cada efeito da biblioteca (s). A biblioteca gera exatamente isso; o plano declara a mesma duração. */
export const SFX_SECONDS: Record<SfxKind, number> = { click: 0.08, soft_click: 0.1, tick: 0.05, pop: 0.18, impact: 0.7, impact_soft: 0.55, whoosh: 0.5, whoosh_soft: 0.55, reveal: 0.8, shimmer: 0.9, riser: 1 };

export type EmotionProfile = {
  /** Multiplicador de duração (menor = mais rápido). */
  pace: number;
  /** Multiplicador da intensidade de movimento de câmera. */
  motion: number;
  easing: Easing;
  /** Transições coerentes com a emoção (a primeira é a preferida). */
  transitions: readonly EditTransitionType[];
  /** 0–1: quantos eventos visuais ganham efeito sonoro. */
  sfxDensity: number;
  sfx: readonly SfxKind[];
  /** Energia da trilha (ganho relativo). */
  musicEnergy: "low" | "mid" | "high";
  /** Composição: respiro (mais margem, menos elementos) ou fechada (detalhe, impacto). */
  composition: "airy" | "tight";
  /** Ultrapassagem nas molas (0 = sem "quique"). */
  overshoot: number;
};

export const EMOTION_PROFILES: Record<Emotion, EmotionProfile> = {
  curiosity: { pace: 1, motion: 0.9, easing: "quint", transitions: ["blur", "circle_open", "cut"], sfxDensity: 0.5, sfx: ["tick", "whoosh_soft", "reveal"], musicEnergy: "mid", composition: "tight", overshoot: 0 },
  desire: { pace: 1.15, motion: 0.8, easing: "sine", transitions: ["cross_dissolve", "smooth_left"], sfxDensity: 0.3, sfx: ["shimmer", "whoosh_soft"], musicEnergy: "low", composition: "airy", overshoot: 0 },
  urgency: { pace: 0.8, motion: 1.25, easing: "expo", transitions: ["cut", "flash", "push_left"], sfxDensity: 0.8, sfx: ["impact", "tick", "whoosh"], musicEnergy: "high", composition: "tight", overshoot: 0.05 },
  trust: { pace: 1.1, motion: 0.7, easing: "sine", transitions: ["cross_dissolve", "smooth_left", "cut"], sfxDensity: 0.25, sfx: ["soft_click", "whoosh_soft"], musicEnergy: "mid", composition: "airy", overshoot: 0 },
  sophistication: { pace: 1.2, motion: 0.7, easing: "sine", transitions: ["cross_dissolve", "dip_to_black", "smooth_left"], sfxDensity: 0.25, sfx: ["shimmer", "whoosh_soft"], musicEnergy: "low", composition: "airy", overshoot: 0 },
  energy: { pace: 0.82, motion: 1.3, easing: "back", transitions: ["push_left", "flash", "zoom_in", "wipe"], sfxDensity: 0.85, sfx: ["whoosh", "impact", "pop"], musicEnergy: "high", composition: "tight", overshoot: 0.12 },
  authority: { pace: 1.05, motion: 0.8, easing: "quint", transitions: ["cut", "wipe", "push_up"], sfxDensity: 0.4, sfx: ["impact_soft", "soft_click"], musicEnergy: "mid", composition: "airy", overshoot: 0 },
  surprise: { pace: 0.9, motion: 1.2, easing: "back", transitions: ["flash", "circle_open", "zoom_in"], sfxDensity: 0.7, sfx: ["reveal", "pop", "riser"], musicEnergy: "high", composition: "tight", overshoot: 0.15 },
  identification: { pace: 1, motion: 0.85, easing: "sine", transitions: ["cross_dissolve", "push_up", "cut"], sfxDensity: 0.35, sfx: ["soft_click", "whoosh_soft"], musicEnergy: "mid", composition: "airy", overshoot: 0 },
};

// ---------------------------------------------------------------- identidade de movimento da marca

export type BrandPersonality = "elegant" | "bold" | "tech" | "warm" | "playful" | "minimal";

export type BrandMotion = {
  personality: BrandPersonality;
  /** Ritmo base (multiplica as durações). */
  pace: number;
  /** Intensidade base das animações (0,5–1,4). */
  intensity: number;
  easing: Easing;
  /** Raio dos cantos em px (1080 de largura). */
  radius: number;
  textCase: "upper" | "sentence";
  letterSpacing: number;
  /** Família de transições da marca (cruza com a da emoção). */
  transitions: readonly EditTransitionType[];
  sfxPalette: "soft" | "crisp" | "punchy" | "warm";
  /** Textura do fundo: granulação e brilho (0–1). */
  grain: number;
  glow: number;
};

const PERSONALITIES: Record<BrandPersonality, BrandMotion> = {
  elegant: { personality: "elegant", pace: 1.12, intensity: 0.75, easing: "sine", radius: 6, textCase: "sentence", letterSpacing: -0.01, transitions: ["cross_dissolve", "smooth_left", "dip_to_black"], sfxPalette: "soft", grain: 0.35, glow: 0.25 },
  bold: { personality: "bold", pace: 0.88, intensity: 1.2, easing: "back", radius: 28, textCase: "upper", letterSpacing: 0.02, transitions: ["push_left", "flash", "wipe", "zoom_in"], sfxPalette: "punchy", grain: 0.15, glow: 0.45 },
  tech: { personality: "tech", pace: 0.95, intensity: 1, easing: "expo", radius: 18, textCase: "upper", letterSpacing: 0.03, transitions: ["push_up", "wipe", "smooth_left", "cut"], sfxPalette: "crisp", grain: 0.05, glow: 0.55 },
  warm: { personality: "warm", pace: 1.08, intensity: 0.85, easing: "sine", radius: 24, textCase: "sentence", letterSpacing: 0, transitions: ["cross_dissolve", "circle_open", "smooth_left"], sfxPalette: "warm", grain: 0.3, glow: 0.35 },
  playful: { personality: "playful", pace: 0.9, intensity: 1.15, easing: "back", radius: 36, textCase: "sentence", letterSpacing: 0, transitions: ["circle_open", "push_up", "zoom_in"], sfxPalette: "punchy", grain: 0.1, glow: 0.4 },
  minimal: { personality: "minimal", pace: 1.05, intensity: 0.7, easing: "quint", radius: 10, textCase: "sentence", letterSpacing: -0.005, transitions: ["cut", "cross_dissolve"], sfxPalette: "soft", grain: 0, glow: 0.15 },
};

const PERSONALITY_WORDS: [BrandPersonality, RegExp][] = [
  ["elegant", /premium|luxu|sofistic|elegan|editorial|requint|clássic|classic/],
  ["tech", /tecnol|tech|digital|software|corporativ|precis/],
  ["bold", /ousad|bold|esportiv|forte|impact/],
  ["playful", /descontra|divertid|playful|jovem|alegr/],
  ["warm", /orgânic|organic|acolhed|afetiv|român|romant|casament|famil|cuidad/],
  ["minimal", /minimal|clean|simples/],
];

/**
 * Personalidade audiovisual da marca a partir do Perfil da Marca (estilo, tom e tipografia). Um
 * `override` explícito (configuração da empresa) prevalece campo a campo.
 */
export function brandMotionProfile(input: { tone?: string; displayFont?: string; businessKind?: string; override?: Partial<BrandMotion> }): BrandMotion {
  const text = (input.tone ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // O TOM da marca manda; o tipo de negócio (ex.: há gravação de tela) só decide quando o tom não diz nada.
  const businessText = (input.businessKind ?? "").toLowerCase();
  const found = PERSONALITY_WORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? PERSONALITY_WORDS.find(([, pattern]) => pattern.test(businessText))?.[0];
  const personality: BrandPersonality = found ?? (input.businessKind === "software" ? "tech" : input.displayFont === "DM Serif Display" ? "elegant" : "bold");
  return { ...PERSONALITIES[personality], ...(input.override ?? {}) };
}

/** Parâmetros da cena: marca × emoção (a emoção ajusta, a marca dá o limite do estilo). */
export function sceneDirection(brand: BrandMotion, emotion: Emotion | undefined) {
  const e = EMOTION_PROFILES[emotion ?? "identification"];
  const transitions = e.transitions.filter((t) => brand.transitions.includes(t) || t === "cut");
  return {
    pace: round(brand.pace * e.pace),
    intensity: round(Math.max(0.4, Math.min(1.5, brand.intensity * e.motion))),
    easing: brand.personality === "elegant" || brand.personality === "minimal" ? (e.easing === "back" ? "quint" : e.easing === "expo" ? "quint" : e.easing) : e.easing,
    overshoot: brand.easing === "back" ? Math.max(e.overshoot, 0.06) : brand.personality === "elegant" ? 0 : e.overshoot,
    transition: (transitions[0] ?? brand.transitions[0] ?? "cut") as EditTransitionType,
    sfxDensity: e.sfxDensity,
    sfx: e.sfx,
    composition: e.composition,
    musicEnergy: e.musicEnergy,
  };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

// ---------------------------------------------------------------- leitura e batida

/** Tempo mínimo para ler os textos de uma cena (0,35 s + 0,28 s por palavra; nunca menos de 1,2 s). */
export function readingSeconds(texts: readonly string[]): number {
  const words = texts.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1.2, 0.35 + words * 0.28);
}

/**
 * Encaixa os cortes nas batidas mais próximas (tolerância ±tolerance s) sem deixar nenhuma cena abaixo do
 * seu mínimo de leitura e sem mexer em cenas fixas (fala). Devolve as novas durações e quantos cortes
 * caíram na batida. Nem todo corte precisa cair: só os que cabem.
 */
export function snapCutsToBeats(input: { durations: number[]; overlaps: number[]; flexible: boolean[]; minimums: number[]; beats: readonly number[]; tolerance?: number }): { durations: number[]; snapped: number; cuts: number } {
  const tolerance = input.tolerance ?? 0.22;
  const durations = [...input.durations];
  let start = 0;
  let snapped = 0;
  for (let i = 0; i < durations.length - 1; i += 1) {
    const cut = start + durations[i]! - (input.overlaps[i + 1] ?? 0);
    if (input.flexible[i] && input.beats.length) {
      const beat = input.beats.reduce((best, b) => (Math.abs(b - cut) < Math.abs(best - cut) ? b : best), input.beats[0]!);
      const delta = beat - cut;
      if (Math.abs(delta) <= tolerance && durations[i]! + delta >= input.minimums[i]!) {
        durations[i] = round(durations[i]! + delta);
        snapped += 1;
      }
    }
    start = start + durations[i]! - (input.overlaps[i + 1] ?? 0);
  }
  return { durations, snapped, cuts: Math.max(0, durations.length - 1) };
}

// ---------------------------------------------------------------- efeitos sonoros

export type VisualEvent = { atSeconds: number; kind: "transition" | "reveal" | "click" | "text" | "impact" | "move"; strength: number; clipIndex: number };
export type SfxCue = { kind: SfxKind; atSeconds: number; gainDb: number };

const PALETTE: Record<BrandMotion["sfxPalette"], Partial<Record<VisualEvent["kind"], SfxKind>>> = {
  soft: { transition: "whoosh_soft", reveal: "shimmer", click: "soft_click", text: "soft_click", impact: "impact_soft", move: "whoosh_soft" },
  crisp: { transition: "whoosh_soft", reveal: "reveal", click: "click", text: "tick", impact: "impact_soft", move: "whoosh_soft" },
  punchy: { transition: "whoosh", reveal: "pop", click: "click", text: "tick", impact: "impact", move: "whoosh" },
  warm: { transition: "whoosh_soft", reveal: "shimmer", click: "soft_click", text: "soft_click", impact: "impact_soft", move: "whoosh_soft" },
};

/**
 * Plano de efeitos: só eventos visuais reais, mais fortes primeiro; respeita densidade da emoção, espaço
 * mínimo entre efeitos (0,9 s), nunca o mesmo efeito em menos de 2,5 s, e reduz (ou pula) sob a fala.
 */
export function planSfx(input: { events: readonly VisualEvent[]; durationSeconds: number; density: (clipIndex: number) => number; palette: BrandMotion["sfxPalette"]; speech: readonly { start: number; end: number }[] }): SfxCue[] {
  const budget = Math.max(1, Math.round((input.durationSeconds / 2.2) * Math.max(...input.events.map((e) => input.density(e.clipIndex)), 0.3)));
  const ranked = [...input.events].sort((a, b) => b.strength * input.density(b.clipIndex) - a.strength * input.density(a.clipIndex));
  const cues: SfxCue[] = [];
  for (const event of ranked) {
    if (cues.length >= budget) break;
    if (input.density(event.clipIndex) * event.strength < 0.2) continue;
    const kind = PALETTE[input.palette][event.kind];
    if (!kind) continue;
    if (cues.some((cue) => Math.abs(cue.atSeconds - event.atSeconds) < 0.9)) continue;
    if (cues.some((cue) => cue.kind === kind && Math.abs(cue.atSeconds - event.atSeconds) < 2.5)) continue;
    const underSpeech = input.speech.some((s) => event.atSeconds >= s.start - 0.1 && event.atSeconds <= s.end + 0.1);
    if (underSpeech && event.kind !== "click" && event.kind !== "transition") continue;
    const base = kind.startsWith("impact") ? -14 : kind === "riser" ? -18 : -16;
    cues.push({ kind, atSeconds: round(Math.max(0, event.atSeconds)), gainDb: base - (underSpeech ? 8 : 0) - (1 - event.strength) * 4 });
  }
  return cues.sort((a, b) => a.atSeconds - b.atSeconds);
}

// ---------------------------------------------------------------- áreas seguras e verificações objetivas

/** Áreas ocupadas pela interface do Instagram Reels / TikTok / Shorts no 9:16 (frações do quadro). */
export const PLATFORM_SAFE_ZONE = { top: 0.12, bottom: 0.22, left: 0.06, right: 0.14 } as const;

export type AudiovisualCheck = { id: string; label: string; kind: "objective" | "subjective"; status: "pass" | "fail" | "warn" | "review"; detail: string };

/**
 * Verificações OBJETIVAS do plano audiovisual (as subjetivas ficam para a revisão visual).
 */
export function audiovisualChecks(input: {
  durationSeconds: number;
  clips: readonly { durationSeconds: number; design?: { template: string }; transition: EditTransitionType; texts: readonly string[]; emotion?: string }[];
  sfx: readonly SfxCue[];
  speech: readonly { start: number; end: number }[];
  music?: { gainDb: number; duck: boolean };
  truePeakDb?: number;
  beats?: { snapped: number; cuts: number };
}): AudiovisualCheck[] {
  const checks: AudiovisualCheck[] = [];
  const add = (check: AudiovisualCheck) => checks.push(check);
  // Fala legendada é o material ORIGINAL com legenda (não animação decorativa): não conta como excesso, e dois
  // trechos de fala seguidos são a mesma fala continuando.
  const decorative = (clip: (typeof input.clips)[number]) => Boolean(clip.design && clip.design.template !== "speech_captions");
  const designs = input.clips.filter(decorative).length;
  const consecutive = input.clips.some((clip, i) => i > 0 && decorative(clip) && input.clips[i - 1]!.design?.template === clip.design!.template);
  add({ id: "animation_balance", label: "Animação sem excesso", kind: "objective", status: designs / Math.max(1, input.clips.length) > 0.8 || consecutive ? "fail" : "pass", detail: `${designs}/${input.clips.length} cenas com animação decorativa${consecutive ? "; mesmo template em cenas seguidas" : ""}` });
  const transitionKinds = new Set(input.clips.slice(1).map((clip) => clip.transition).filter((t) => t !== "cut"));
  add({ id: "transition_continuity", label: "Transições consistentes", kind: "objective", status: transitionKinds.size > 3 ? "fail" : "pass", detail: `${transitionKinds.size} tipos além do corte` });
  const short = input.clips.filter((clip) => clip.texts.length && clip.durationSeconds + 0.05 < readingSeconds(clip.texts));
  add({ id: "reading_time", label: "Tempo de leitura dos textos", kind: "objective", status: short.length ? "fail" : "pass", detail: short.length ? `${short.length} cena(s) curtas demais para o texto` : "ok" });
  const perSecond = input.sfx.length / Math.max(1, input.durationSeconds);
  const repeated = input.sfx.some((cue, i) => input.sfx.some((other, j) => j > i && other.kind === cue.kind && Math.abs(other.atSeconds - cue.atSeconds) < 2.5));
  add({ id: "sfx_density", label: "Efeitos sonoros sem excesso nem repetição", kind: "objective", status: perSecond > 0.55 || repeated ? "fail" : "pass", detail: `${input.sfx.length} efeito(s) em ${input.durationSeconds.toFixed(1)} s${repeated ? "; repetição próxima" : ""}` });
  const loudUnderSpeech = input.sfx.filter((cue) => input.speech.some((s) => cue.atSeconds >= s.start && cue.atSeconds <= s.end) && cue.gainDb > -20);
  add({ id: "speech_priority", label: "Fala em primeiro plano", kind: "objective", status: loudUnderSpeech.length || (input.speech.length && input.music && !input.music.duck) ? "fail" : "pass", detail: loudUnderSpeech.length ? "efeito alto sobre a fala" : input.speech.length && input.music && !input.music.duck ? "trilha sem ducking sob a fala" : "ok" });
  if (input.truePeakDb !== undefined) add({ id: "true_peak", label: "Sem distorção (pico real)", kind: "objective", status: input.truePeakDb > -1 ? "fail" : "pass", detail: `${input.truePeakDb.toFixed(1)} dBTP` });
  if (input.beats) add({ id: "beat_sync", label: "Cortes na batida (informativo)", kind: "objective", status: "pass", detail: `${input.beats.snapped}/${input.beats.cuts} cortes na batida` });
  for (const [id, label] of [["visual_hierarchy", "Hierarquia e equilíbrio visual"], ["fidelity", "Fidelidade dos materiais"], ["brand_consistency", "Consistência da identidade"], ["av_sync", "Sincronia som × imagem"], ["continuity", "Continuidade entre cenas"]] as const) {
    add({ id, label, kind: "subjective", status: "review", detail: "revisão visual (prancha + plano)" });
  }
  return checks;
}
