/**
 * PERFIL DE NARRAÇÃO de um vídeo (referência ou nossa peça), medido sobre as palavras ouvidas (Whisper,
 * com tempo) e os níveis do áudio. Complementa o perfil visual (`reference-profile.ts`): lá ritmo, cor e
 * enquadramento; aqui COMO a voz conta a história — tamanho das falas, velocidade, respiros, quanto do
 * vídeo a voz ocupa, voz × trilha e o estilo do texto (pergunta, conectivos, 2ª pessoa, códigos soletrados).
 *
 * O perfil orienta a escrita de uma fala ORIGINAL (números e estilo, nunca as frases da referência).
 */

import type { TimedWord } from "./word-alignment.js";

export type NarrationPhrase = { text: string; start: number; end: number; words: number; syllables: number; syllablesPerSecond: number };

export type NarrationProfile = {
  durationSeconds: number;
  phrases: NarrationPhrase[];
  /** Mediana de palavras por fala. */
  wordsPerPhrase: number;
  /** Sílabas por segundo de fala (soma das sílabas ÷ tempo falando). */
  syllablesPerSecond: number;
  /** Fração do vídeo com voz. */
  coverage: number;
  firstWordAt: number;
  /** Tempo entre a última palavra e o fim do vídeo. */
  tailSeconds: number;
  pauseMedian: number;
  pauseMax: number;
  /** Respiros acima de 1 s entre falas. */
  longPauses: number;
  /** Voz acima da trilha (dB): nível nas falas × nível nos respiros (só trilha). */
  voiceOverMusicDb?: number;
  questionShare: number;
  /** Falas que começam puxando a anterior ("E…", "Com…", "E sabe o melhor?"). */
  connectorShare: number;
  /** Falas dirigidas a quem assiste (você, seu, sua…). */
  secondPersonShare: number;
};

export const syllableCount = (text: string) => (text.toLowerCase().match(/[aeiouáéíóúâêôãõàü]+/g) ?? []).length;

// Bordas Unicode: `\b` do JavaScript não reconhece letras acentuadas ("você", "então").
const CONNECTOR = /^(?:e|com|na|no|nas|nos|mas|então|agora|só|é só|porque|pra|para|e aí|aí)(?![\p{L}\p{N}])/iu;
const SECOND_PERSON = /(?<![\p{L}\p{N}])(?:você|vocês|seu|sua|seus|suas|te|contigo)(?![\p{L}\p{N}])/iu;
const median = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Falas = sequências de palavras separadas por pontuação final ou por respiro ≥ `gap` segundos. */
export function segmentPhrases(words: readonly TimedWord[], gap = 0.35): NarrationPhrase[] {
  const out: NarrationPhrase[] = [];
  let cur: TimedWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map((w) => w.word.trim()).join(" ").replace(/\s+/g, " ").trim();
    const start = cur[0]!.start, end = cur[cur.length - 1]!.end;
    const syllables = syllableCount(text);
    out.push({ text, start: round(start), end: round(end), words: cur.length, syllables, syllablesPerSecond: round(syllables / Math.max(0.1, end - start), 1) });
    cur = [];
  };
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (!next || /[.?!]$/.test(w.word.trim()) || next.start - w.end >= gap) flush();
  });
  return out;
}

export function narrationProfile(words: readonly TimedWord[], durationSeconds: number, levels?: { speechDb: number[]; bedDb: number[] }): NarrationProfile {
  const phrases = segmentPhrases(words);
  const speaking = phrases.reduce((s, p) => s + (p.end - p.start), 0);
  const pauses = phrases.slice(1).map((p, i) => p.start - phrases[i]!.end);
  const share = (re: RegExp) => (phrases.length ? phrases.filter((p) => re.test(p.text)).length / phrases.length : 0);
  return {
    durationSeconds: round(durationSeconds),
    phrases,
    wordsPerPhrase: median(phrases.map((p) => p.words)),
    syllablesPerSecond: round(phrases.reduce((s, p) => s + p.syllables, 0) / Math.max(0.1, speaking), 1),
    coverage: round(speaking / Math.max(0.1, durationSeconds)),
    firstWordAt: round(phrases[0]?.start ?? durationSeconds),
    tailSeconds: round(durationSeconds - (phrases[phrases.length - 1]?.end ?? 0)),
    pauseMedian: round(median(pauses)),
    pauseMax: round(pauses.length ? Math.max(...pauses) : 0),
    longPauses: pauses.filter((p) => p > 1).length,
    ...(levels?.speechDb.length && levels.bedDb.length ? { voiceOverMusicDb: round(median(levels.speechDb) - median(levels.bedDb), 1) } : {}),
    questionShare: round(share(/\?\s*$/)),
    connectorShare: round(share(CONNECTOR)),
    secondPersonShare: round(share(SECOND_PERSON)),
  };
}

/** Faixa-alvo a partir de uma ou mais referências (mín.–máx. medidos, com folga pequena). */
export type NarrationTarget = { wordsPerPhrase: [number, number]; syllablesPerSecond: [number, number]; coverage: [number, number]; pauseMedian: [number, number]; pauseMax: number; firstWordAt: number; tailSeconds: number; voiceOverMusicDb?: number };

export function narrationTarget(profiles: readonly NarrationProfile[]): NarrationTarget {
  const span = (pick: (p: NarrationProfile) => number, pad: number, d = 2): [number, number] => [round(Math.min(...profiles.map(pick)) - pad, d), round(Math.max(...profiles.map(pick)) + pad, d)];
  const vom = profiles.map((p) => p.voiceOverMusicDb).filter((v): v is number => v !== undefined);
  return {
    wordsPerPhrase: span((p) => p.wordsPerPhrase, 1, 0),
    syllablesPerSecond: span((p) => p.syllablesPerSecond, 0.4, 1),
    coverage: span((p) => p.coverage, 0.05),
    pauseMedian: span((p) => p.pauseMedian, 0.1),
    pauseMax: round(Math.max(...profiles.map((p) => p.pauseMax)) + 0.2),
    firstWordAt: round(Math.max(0.3, ...profiles.map((p) => p.firstWordAt))),
    tailSeconds: round(Math.max(...profiles.map((p) => p.tailSeconds)) + 0.6),
    ...(vom.length ? { voiceOverMusicDb: round(median(vom), 1) } : {}),
  };
}

/** Orientação ao roteirista/diretor: números medidos + estilo, sem copiar frases. */
export function narrationGuidance(profiles: readonly { label: string; profile: NarrationProfile }[]): string[] {
  if (!profiles.length) return [];
  const t = narrationTarget(profiles.map((p) => p.profile));
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const lines = profiles.map(({ label, profile: p }) => `${label}: ${p.phrases.length} falas em ${p.durationSeconds} s; ${p.wordsPerPhrase} palavras por fala (mediana); ${p.syllablesPerSecond} sílabas/s; a voz ocupa ${pct(p.coverage)} do vídeo, entra em ${p.firstWordAt} s e termina ${p.tailSeconds} s antes do fim; respiro entre falas ${p.pauseMedian} s (máx. ${p.pauseMax} s); ${pct(p.questionShare)} perguntas, ${pct(p.connectorShare)} começam com conectivo, ${pct(p.secondPersonShare)} falam com "você"${p.voiceOverMusicDb !== undefined ? `; voz ${p.voiceOverMusicDb} dB acima da trilha` : ""}.`);
  lines.push(`Alvo para esta peça: ${t.wordsPerPhrase[0]}–${t.wordsPerPhrase[1]} palavras por fala (falas de 1–4 palavras só como virada: "E sabe o melhor?"), ${t.syllablesPerSecond[0]}–${t.syllablesPerSecond[1]} sílabas/s, voz ocupando ${pct(t.coverage[0])}–${pct(t.coverage[1])} do vídeo, primeira palavra até ${t.firstWordAt} s, respiro entre falas de ${t.pauseMedian[0]}–${t.pauseMedian[1]} s.`);
  return lines;
}

export type NarrationFinding = { code: "falas_fragmentadas" | "falas_longas" | "voz_rala" | "voz_lenta" | "voz_corrida" | "respiro_longo" | "entrada_tardia" | "codigo_falado" | "voz_baixa"; evidence: string };

/** Códigos que não se falam: números longos/com zeros à esquerda e SKUs alfanuméricos. Ficam na tela. */
export function spokenCodes(script: string): string[] {
  return [...script.matchAll(/\b(?:0\d{2,}|\d{4,}|[A-Za-z]+\d+[A-Za-z\d]*|\d+[A-Za-z]+[A-Za-z\d]*)\b/g)].map((m) => m[0]);
}

/** Nossa peça × alvo das referências: achados objetivos (com número), para revisão e reformulação. */
export function compareNarration(ours: NarrationProfile, target: NarrationTarget, script?: string): NarrationFinding[] {
  const out: NarrationFinding[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (ours.wordsPerPhrase < target.wordsPerPhrase[0]) out.push({ code: "falas_fragmentadas", evidence: `${ours.wordsPerPhrase} palavras por fala × ${target.wordsPerPhrase[0]}–${target.wordsPerPhrase[1]} nas referências (soa como legenda lida, não como locução)` });
  if (ours.wordsPerPhrase > target.wordsPerPhrase[1] + 3) out.push({ code: "falas_longas", evidence: `${ours.wordsPerPhrase} palavras por fala × até ${target.wordsPerPhrase[1]}` });
  if (ours.coverage < target.coverage[0]) out.push({ code: "voz_rala", evidence: `a voz ocupa ${pct(ours.coverage)} do vídeo × ${pct(target.coverage[0])}–${pct(target.coverage[1])}` });
  if (ours.syllablesPerSecond < target.syllablesPerSecond[0]) out.push({ code: "voz_lenta", evidence: `${ours.syllablesPerSecond} sílabas/s × ${target.syllablesPerSecond[0]}–${target.syllablesPerSecond[1]}` });
  if (ours.syllablesPerSecond > target.syllablesPerSecond[1] + 0.5) out.push({ code: "voz_corrida", evidence: `${ours.syllablesPerSecond} sílabas/s × ${target.syllablesPerSecond[0]}–${target.syllablesPerSecond[1]}` });
  if (ours.pauseMax > target.pauseMax) out.push({ code: "respiro_longo", evidence: `maior silêncio entre falas ${ours.pauseMax} s × ${target.pauseMax} s` });
  if (ours.firstWordAt > target.firstWordAt) out.push({ code: "entrada_tardia", evidence: `primeira palavra em ${ours.firstWordAt} s × até ${target.firstWordAt} s` });
  if (target.voiceOverMusicDb !== undefined && ours.voiceOverMusicDb !== undefined && ours.voiceOverMusicDb < Math.min(8, target.voiceOverMusicDb) - 1) out.push({ code: "voz_baixa", evidence: `voz ${ours.voiceOverMusicDb} dB acima da trilha × ${target.voiceOverMusicDb} dB` });
  const codes = script ? spokenCodes(script) : [];
  if (codes.length) out.push({ code: "codigo_falado", evidence: `a voz lê ${codes.map((c) => `"${c}"`).join(", ")} — código fica só na tela` });
  return out;
}
