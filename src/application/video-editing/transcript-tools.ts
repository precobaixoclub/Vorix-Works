/**
 * Ferramentas determinísticas sobre a transcrição (faster-whisper com tempos por palavra).
 *
 * Regra central: a IA escolhe TRECHOS da mídia; o texto das legendas sai da transcrição, nunca da
 * IA. Assim a legenda não inventa fala nem muda o sentido. A única alteração permitida é a grafia
 * de termos da marca (glossário), por exemplo "rumo ao altar" → "Rumo ao Altar".
 */

import type { EditCaptionSegment, EditClip, EditMediaAsset, VideoAspect } from "../../domain/video-editing/video-edit-plan.js";
import { VIDEO_FORMATS } from "../../domain/video-editing/video-edit-plan.js";

export type TranscriptWord = { start: number; end: number; word: string; probability?: number };
export type TranscriptSegment = { start: number; end: number; text: string; words?: TranscriptWord[] };
export type Transcript = { language?: string; duration_seconds?: number; segments: TranscriptSegment[] };

export function transcriptWords(transcript: Transcript): TranscriptWord[] {
  return mergeAttachedWords(transcript.segments.flatMap((segment) => segment.words ?? []).filter((word) => word.word.trim().length > 0).sort((a, b) => a.start - b.start));
}

/** O Whisper marca com espaço inicial o começo de cada palavra; token sem espaço (".com", "%") gruda no anterior. */
export function mergeAttachedWords(words: TranscriptWord[]): TranscriptWord[] {
  const merged: TranscriptWord[] = [];
  for (const word of words) {
    const last = merged[merged.length - 1];
    if (last && !/^\s/.test(word.word)) merged[merged.length - 1] = { ...last, word: last.word + word.word, end: Math.max(last.end, word.end) };
    else merged.push({ ...word });
  }
  return merged;
}

/** Glossário por palavra: troca sequências de mesmo tamanho preservando a pontuação final, sem perder o tempo de cada palavra. */
export function applyGlossaryToTokens(tokens: string[], glossary: BrandGlossary): string[] {
  const result = [...tokens];
  const bare = (token: string) => token.replace(/[.,!?;:]+$/, "").toLowerCase();
  for (const entry of glossary) {
    const from = entry.from.trim().split(/\s+/).map((token) => token.toLowerCase());
    const to = entry.to.trim().split(/\s+/);
    if (from.length !== to.length) continue;
    for (let index = 0; index <= result.length - from.length; index += 1) {
      if (!from.every((token, offset) => bare(result[index + offset]!) === token)) continue;
      from.forEach((_, offset) => {
        const original = result[index + offset]!;
        const punctuation = /[.,!?;:]+$/.exec(original)?.[0] ?? "";
        result[index + offset] = to[offset]! + punctuation;
      });
    }
  }
  return result;
}

/** Glossário de grafia da marca: só troca a forma escrita de termos, nunca acrescenta palavras. */
export type BrandGlossary = { from: string; to: string }[];

function applyGlossary(text: string, glossary: BrandGlossary): string {
  let result = text;
  for (const entry of glossary) {
    const escaped = entry.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`(^|[^\\p{L}])${escaped}(?=$|[^\\p{L}])`, "giu"), (_, prefix: string) => `${prefix}${entry.to}`);
  }
  return result;
}

/**
 * Ajusta um trecho [início, fim] da fonte para não cortar palavra: começa um pouco antes da
 * primeira palavra e termina um pouco depois da última inteiramente contida, sem invadir as
 * palavras vizinhas.
 */
export function snapRangeToWords(words: TranscriptWord[], start: number, end: number, pad = { before: 0.12, after: 0.22 }): { start: number; end: number } | null {
  const inside = words.filter((word) => word.start >= start - 0.15 && word.end <= end + 0.15);
  if (inside.length === 0) return null;
  const first = inside[0]!;
  const last = inside[inside.length - 1]!;
  const previous = words.filter((word) => word.end <= first.start).at(-1);
  const next = words.find((word) => word.start >= last.end);
  // Nunca começa depois do início da 1ª palavra nem termina antes do fim da última, mesmo quando
  // as vizinhas encostam; a folga só existe se houver silêncio entre as palavras.
  const snappedStart = Math.min(first.start, Math.max(previous ? previous.end : 0, first.start - pad.before));
  const snappedEnd = Math.max(last.end, Math.min(next ? next.start : last.end + pad.after, last.end + pad.after));
  return { start: Math.max(0, snappedStart), end: snappedEnd };
}

/** Encontra o trecho que vai da frase `from` até a frase `to` (texto normalizado, sem acentos). */
export function findPhraseRange(words: TranscriptWord[], from: string, to: string): { start: number; end: number } | null {
  const norm = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, " ").trim();
  const tokens = words.map((word) => norm(word.word));
  const find = (phrase: string, after: number) => {
    const target = norm(phrase).split(" ");
    for (let index = after; index <= tokens.length - target.length; index += 1) {
      if (target.every((token, offset) => tokens[index + offset] === token)) return index;
    }
    return -1;
  };
  const startIndex = find(from, 0);
  if (startIndex < 0) return null;
  const endTokens = norm(to).split(" ");
  const endIndex = find(to, startIndex);
  if (endIndex < 0) return null;
  return { start: words[startIndex]!.start, end: words[endIndex + endTokens.length - 1]!.end };
}

export type CaptionOptions = { maxWords?: number; maxSeconds?: number; glossary?: BrandGlossary };

/**
 * Legendas na linha do tempo final a partir dos clipes que mantêm o áudio da fonte. Cada palavra
 * dentro do trecho do clipe é reposicionada: t' = início do clipe + (t − ponto de entrada).
 * Agrupa em blocos curtos (até 6 palavras ou 2,4 s), quebrando em pontuação.
 */
export function captionsFromTranscript(clips: EditClip[], sourceAssetId: string, transcript: Transcript, options: CaptionOptions = {}): EditCaptionSegment[] {
  const words = transcriptWords(transcript);
  const segments: EditCaptionSegment[] = [];
  for (const clip of clips) {
    if (clip.assetId !== sourceAssetId || !clip.keepSourceAudio) continue;
    const from = clip.sourceInSeconds;
    const to = clip.sourceInSeconds + clip.durationSeconds;
    const clipEnd = clip.recordStartSeconds + clip.durationSeconds;
    const mapped = words
      .filter((word) => word.start >= from - 0.05 && word.end <= to + 0.05)
      .map((word) => ({ text: word.word.trim(), startSeconds: Math.max(clip.recordStartSeconds, clip.recordStartSeconds + (word.start - from)), endSeconds: Math.min(clipEnd, clip.recordStartSeconds + (word.end - from)) }));
    segments.push(...groupCaptions(mapped, clipEnd, options));
  }
  return segments;
}

/** Legendas de uma narração que começa em `startSeconds` da linha do tempo. */
export function captionsFromNarration(transcript: Transcript, startSeconds: number, videoDurationSeconds: number, options: CaptionOptions = {}): EditCaptionSegment[] {
  const mapped = transcriptWords(transcript)
    .map((word) => ({ text: word.word.trim(), startSeconds: startSeconds + word.start, endSeconds: Math.min(videoDurationSeconds, startSeconds + word.end) }))
    .filter((word) => word.startSeconds < videoDurationSeconds - 0.2);
  return groupCaptions(mapped, videoDurationSeconds, options);
}

type TimedWord = { text: string; startSeconds: number; endSeconds: number };

/** Agrupa palavras já na linha do tempo final em blocos curtos, quebrando em pontuação; aplica o glossário. */
function groupCaptions(mapped: TimedWord[], limitEnd: number, options: CaptionOptions): EditCaptionSegment[] {
  const maxWords = options.maxWords ?? 6;
  const maxSeconds = options.maxSeconds ?? 2.4;
  const glossary = options.glossary ?? [];
  const fixed = applyGlossaryToTokens(mapped.map((word) => word.text), glossary);
  const words = mapped.map((word, index) => ({ ...word, text: fixed[index]! }));
  const segments: EditCaptionSegment[] = [];
  let group: TimedWord[] = [];
  const flush = () => {
    if (group.length === 0) return;
    const start = group[0]!.startSeconds;
    const end = Math.min(limitEnd, Math.max(group[group.length - 1]!.endSeconds, start + 0.4));
    const joined = group.map((word) => word.text).join(" ");
    const text = applyGlossary(joined, glossary);
    // Glossário de tamanho diferente muda o texto do bloco: mantém o texto, sem destaque por palavra.
    const timed = group.map((word) => ({ text: word.text, startSeconds: round(word.startSeconds), endSeconds: round(word.endSeconds) }));
    segments.push(text === joined ? { startSeconds: round(start), endSeconds: round(end), text, words: timed } : { startSeconds: round(start), endSeconds: round(end), text });
    group = [];
  };
  for (const word of words) {
    if (group.length > 0 && (group.length >= maxWords || word.endSeconds - group[0]!.startSeconds > maxSeconds)) flush();
    group.push(word);
    if (/[.!?,;:]$/.test(word.text) && group.length >= 2) flush();
  }
  flush();
  return segments;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Enquadramento automático por formato: preencher quando o corte é pequeno; mostrar inteiro sobre
 * fundo desfocado quando preencher cortaria demais (produto/tela protegidos toleram menos corte).
 */
export function chooseFraming(asset: Pick<EditMediaAsset, "width" | "height" | "protectedFidelity" | "kind">, aspect: VideoAspect): "fill" | "fit" {
  if (asset.kind === "card" || !asset.width || !asset.height) return "fill";
  const frame = VIDEO_FORMATS[aspect];
  const frameRatio = frame.width / frame.height;
  const mediaRatio = asset.width / asset.height;
  const keptArea = Math.min(frameRatio, mediaRatio) / Math.max(frameRatio, mediaRatio);
  // Produto/tela: retrato cortado nas laterais para 9:16 mantém o produto central; abaixo de 60%
  // da área (ex.: retrato em 16:9) o corte começa a comer o produto → mostrar inteiro.
  const minimumKept = asset.protectedFidelity ? 0.6 : 0.55;
  return keptArea >= minimumKept ? "fill" : "fit";
}
