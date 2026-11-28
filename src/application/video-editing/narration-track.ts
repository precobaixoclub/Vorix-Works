/**
 * LOCUÇÃO NO MOTOR OPERACIONAL — a parte pura (sem áudio nem processo): quais falas existem, quanto cada
 * cena precisa durar para caber a própria fala, onde cada fala entra na linha do tempo e como as palavras
 * ouvidas viram legenda. O worker sintetiza (voz local), monta a faixa e transcreve; aqui só se decide.
 *
 * Regras (provadas no laboratório de sincronia — versão D da CMKV, sincronia média 10 ms):
 * - a fala orienta a edição: cena narrada nunca fica mais curta que lead + fala + respiro;
 * - cada fala começa no início da SUA cena (+ lead), nunca atravessa para a cena seguinte;
 * - a legenda mostra as palavras do roteiro nos tempos em que foram de fato ouvidas (Whisper).
 */

import type { EditCaptionSegment, EditClip } from "../../domain/video-editing/video-edit-plan.js";
import type { VideoEditDraft } from "../ai-gateway/schemas/video-edit-draft.v1.js";

export type VoiceoverLine = { scene: number; text: string; intent?: string };

export const NARRATION_LEAD_SECONDS = 0.15;
export const NARRATION_TAIL_SECONDS = 0.3;

/** Falas válidas do rascunho: uma por cena existente, em ordem, sem vazias. */
export function voiceoverLines(draft: Pick<VideoEditDraft, "scenes" | "voiceover">): VoiceoverLine[] {
  const seen = new Set<number>();
  return (draft.voiceover?.lines ?? [])
    .map((line) => ({ scene: line.scene, text: line.text.replace(/\s+/g, " ").trim(), ...(line.intent ? { intent: line.intent } : {}) }))
    .filter((line) => line.text.length >= 2 && line.scene >= 0 && line.scene < draft.scenes.length && !seen.has(line.scene) && (seen.add(line.scene), true))
    .sort((a, b) => a.scene - b.scene);
}

/** Duração mínima de cada cena (por índice) para caber a fala sintetizada: lead + fala + respiro. */
export function narrationMinimums(lines: readonly VoiceoverLine[], spokenSeconds: readonly number[], sceneCount: number): (number | undefined)[] {
  const out: (number | undefined)[] = Array.from({ length: sceneCount }, () => undefined);
  lines.forEach((line, index) => {
    const seconds = spokenSeconds[index];
    if (seconds !== undefined && Number.isFinite(seconds)) out[line.scene] = Math.round((NARRATION_LEAD_SECONDS + seconds + NARRATION_TAIL_SECONDS) * 1000) / 1000;
  });
  return out;
}

export type NarrationPlacement = { scene: number; at: number; end: number; clipStart: number; clipEnd: number };

/**
 * Onde cada fala entra: no início do clipe da sua cena (+ lead). O clipe da cena i é `c{i+1}` (o construtor
 * preserva o índice). Fala que não cabe no próprio clipe vira problema — nunca invade a cena seguinte.
 */
export function placeNarration(clips: ReadonlyArray<Pick<EditClip, "id" | "recordStartSeconds" | "durationSeconds">>, lines: readonly VoiceoverLine[], spokenSeconds: readonly number[]): { placements: NarrationPlacement[]; issues: string[] } {
  const placements: NarrationPlacement[] = [];
  const issues: string[] = [];
  let previousEnd = 0;
  lines.forEach((line, index) => {
    const clip = clips.find((item) => item.id === `c${line.scene + 1}`);
    const seconds = spokenSeconds[index] ?? 0;
    if (!clip) { issues.push(`fala da cena ${line.scene + 1} sem clipe correspondente`); return; }
    const clipStart = clip.recordStartSeconds;
    const clipEnd = clip.recordStartSeconds + clip.durationSeconds;
    const at = Math.max(clipStart + NARRATION_LEAD_SECONDS, previousEnd + 0.12);
    const end = at + seconds;
    if (end > clipEnd + 0.05) issues.push(`fala da cena ${line.scene + 1} (${seconds.toFixed(2)} s) não cabe no clipe (${(clipEnd - at).toFixed(2)} s)`);
    placements.push({ scene: line.scene, at: round3(at), end: round3(end), clipStart: round3(clipStart), clipEnd: round3(clipEnd) });
    previousEnd = end;
  });
  return { placements, issues };
}

/** Palavras ouvidas (já alinhadas ao roteiro) → legenda em blocos curtos com destaque palavra a palavra. */
export function captionsFromWords(raw: ReadonlyArray<{ word: string; start: number; end: number }>, opts: { maxWords?: number; maxGap?: number; durationSeconds?: number } = {}): EditCaptionSegment[] {
  const maxWords = opts.maxWords ?? 4;
  const maxGap = opts.maxGap ?? 0.45;
  const limit = opts.durationSeconds ?? Number.POSITIVE_INFINITY;
  // Saneamento (o reconhecimento pode devolver palavras sobrepostas, fora de ordem ou além do fim): ordem pelo
  // início, tempos monotônicos, nada depois do fim do vídeo — a legenda nunca invalida o plano.
  const words: { word: string; start: number; end: number }[] = [];
  for (const item of [...raw].filter((w) => w.word.trim() && Number.isFinite(w.start) && Number.isFinite(w.end)).sort((a, b) => a.start - b.start)) {
    const previous = words[words.length - 1];
    const start = Math.max(0, item.start, previous ? previous.end : 0);
    const end = Math.min(limit, Math.max(item.end, start + 0.05));
    if (start >= limit - 0.25) break;
    words.push({ word: item.word.trim().slice(0, 40), start, end });
  }
  const out: EditCaptionSegment[] = [];
  let group: typeof words[number][] = [];
  const flush = () => {
    if (!group.length) return;
    out.push({ startSeconds: round3(group[0]!.start), endSeconds: round3(Math.max(group[group.length - 1]!.end, group[0]!.start + 0.3)), text: group.map((w) => w.word).join(" "),
      words: group.map((w) => ({ text: w.word, startSeconds: round3(w.start), endSeconds: round3(w.end) })) });
    group = [];
  };
  words.forEach((word, index) => {
    const previous = words[index - 1];
    if (group.length && (group.length >= maxWords || (previous && word.start - previous.end > maxGap) || /[.!?]$/.test(previous?.word ?? ""))) flush();
    group.push(word);
  });
  flush();
  // Sem sobreposição: cada bloco termina antes do próximo começar e dentro do vídeo; bloco curto demais sai.
  for (let i = 0; i < out.length; i += 1) {
    const next = out[i + 1];
    out[i]!.endSeconds = round3(Math.min(out[i]!.endSeconds, next ? next.startSeconds : limit, limit));
    for (const word of out[i]!.words ?? []) word.endSeconds = round3(Math.min(word.endSeconds, out[i]!.endSeconds));
  }
  return out.filter((segment) => segment.endSeconds - segment.startSeconds >= 0.25);
}

/** Resumo para o Quality Gate e o relatório: falas dentro da própria cena e inteligibilidade medida. */
export function narrationQuality(input: { placements: readonly NarrationPlacement[]; issues: readonly string[]; coverage: number; lines: number }): { status: "ok" | "falha"; findings: string[] } {
  const findings = [...input.issues];
  if (input.placements.length < input.lines) findings.push(`${input.lines - input.placements.length} fala(s) sem lugar na linha do tempo`);
  if (input.coverage < 0.7) findings.push(`narração pouco inteligível: ${Math.round(input.coverage * 100)}% das palavras reconhecidas (mínimo 70%)`);
  return { status: findings.length ? "falha" : "ok", findings };
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;
