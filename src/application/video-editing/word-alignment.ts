/**
 * Alinhamento ROTEIRO × ÁUDIO REAL. O tempo de cada palavra vem do que o Whisper ouviu na narração
 * efetivamente gerada (word timestamps), não do roteiro: as palavras do roteiro são casadas com as
 * reconhecidas por alinhamento global (Needleman-Wunsch) tolerante a pequenas diferenças de grafia
 * ("Fé"/"fé", "CMKV"/"cê eme cá vê" via `alias`). Palavra sem par recebe tempo INTERPOLADO e é marcada
 * — nunca é apresentada como medida.
 */

export type TimedWord = { word: string; start: number; end: number };
export type AlignedWord = TimedWord & { source: "asr" | "interpolated"; heard?: string };

import { numberToWords } from "./speech-script.js";

const plain = (w: string) => w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** Forma canônica: o Whisper escreve números em dígitos ("3", "37") e o roteiro por extenso ("três", "000037"). */
export const normWord = (w: string) => {
  const x = plain(w);
  return /^\d{1,6}$/.test(x) ? plain(numberToWords(Number(x))) : x;
};

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j += 1) d[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

/** Semelhança 0–1 entre duas palavras (1 = iguais). */
export function wordSimilarity(a: string, b: string): number {
  const x = normWord(a), y = normWord(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return Math.max(0, 1 - lev(x, y) / Math.max(x.length, y.length));
}

/**
 * Casa as palavras do roteiro com as ouvidas. `alias` expande palavras do roteiro que o reconhecedor
 * escreve diferente (sigla falada por extenso). Devolve uma palavra alinhada para CADA palavra do roteiro.
 */
/** O Whisper junta sigla e número ("CMKV37"): separa em dois tokens, dividindo o tempo pelo tamanho. */
export function splitHeard(heard: readonly TimedWord[]): TimedWord[] {
  return heard.flatMap((h) => {
    const m = /^([^\d\s]+?)[-\s]?(\d+)([.,!?]*)$/u.exec(h.word.trim());
    if (!m || plain(m[1]!).length < 2) return [h];
    const cut = h.start + ((h.end - h.start) * m[1]!.length) / (m[1]!.length + m[2]!.length);
    return [{ word: m[1]!, start: h.start, end: cut }, { word: `${m[2]}${m[3]}`, start: cut, end: h.end }];
  });
}

export function alignScriptToAsr(script: readonly string[], heardRaw: readonly TimedWord[], alias: Readonly<Record<string, string>> = {}): { words: AlignedWord[]; coverage: number } {
  const heard = splitHeard(heardRaw);
  const n = script.length, m = heard.length;
  const sim = (i: number, j: number) => Math.max(wordSimilarity(script[i]!, heard[j]!.word), alias[normWord(script[i]!)] ? wordSimilarity(alias[normWord(script[i]!)]!, heard[j]!.word) : 0);
  // Subsequência: palavra OUVIDA sem par (a voz diz mais do que a tela mostra) custa quase nada; palavra do
  // ROTEIRO sem par custa caro. Com custo simétrico o alinhamento era forçado a casar palavras erradas.
  const GAP = -0.4, SKIP_HEARD = -0.05;
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1 diag, 2 up (roteiro sem par), 3 left (ouvida sem par)
  for (let i = 1; i <= n; i += 1) { score[i]![0] = i * GAP; move[i]![0] = 2; }
  for (let j = 1; j <= m; j += 1) { score[0]![j] = j * SKIP_HEARD; move[0]![j] = 3; }
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const s = sim(i - 1, j - 1);
      const diag = score[i - 1]![j - 1]! + (s >= 0.6 ? s : s - 1);
      const up = score[i - 1]![j]! + GAP, left = score[i]![j - 1]! + SKIP_HEARD;
      const best = Math.max(diag, up, left);
      score[i]![j] = best;
      move[i]![j] = best === diag ? 1 : best === up ? 2 : 3;
    }
  }
  const pair = new Array<number>(n).fill(-1);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const mv = move[i]![j]!;
    if (mv === 1) { if (sim(i - 1, j - 1) >= 0.6) pair[i - 1] = j - 1; i -= 1; j -= 1; } else if (mv === 2) i -= 1; else j -= 1;
  }
  const words: AlignedWord[] = script.map((word, i) => (pair[i]! >= 0 ? { word, start: heard[pair[i]!]!.start, end: heard[pair[i]!]!.end, source: "asr" as const, heard: heard[pair[i]!]!.word } : { word, start: NaN, end: NaN, source: "interpolated" as const }));
  // Interpolação das palavras sem par entre os vizinhos medidos (proporcional ao tamanho da palavra).
  for (let i = 0; i < n; i += 1) {
    if (words[i]!.source === "asr") continue;
    let a = i - 1; while (a >= 0 && words[a]!.source !== "asr") a -= 1;
    let b = i + 1; while (b < n && words[b]!.source !== "asr") b += 1;
    const from = a >= 0 ? words[a]!.end : b < n ? Math.max(0, words[b]!.start - 0.4 * (b - i)) : 0;
    const to = b < n ? words[b]!.start : from + 0.35 * (i - a);
    const span = words.slice(a + 1, b);
    const total = span.reduce((s, w) => s + Math.max(1, normWord(w.word).length), 0) || 1;
    let t = from;
    for (let k = a + 1; k < b; k += 1) {
      const d = ((to - from) * Math.max(1, normWord(words[k]!.word).length)) / total;
      words[k] = { ...words[k]!, start: +t.toFixed(3), end: +(t + d).toFixed(3) };
      t += d;
    }
    i = b - 1;
  }
  return { words, coverage: n ? words.filter((w) => w.source === "asr").length / n : 0 };
}

export type SyncReport = { words: number; measured: number; meanOffsetMs: number; maxOffsetMs: number; late: number; early: number; status: "ok" | "falha"; details?: { word: string; shownAt: number; heard?: string; heardAt?: number; offsetMs?: number }[] };

/**
 * Sincronia das legendas: compara o instante em que cada palavra APARECE na tela com o instante em que
 * ela é OUVIDA no vídeo final (Whisper sobre o áudio mixado, independente do roteiro). Tolerância ±120 ms
 * em média e ±250 ms no pior caso.
 */
export function captionSync(shown: readonly { word: string; at: number }[], heardRaw: readonly TimedWord[], alias: Readonly<Record<string, string>> = {}, windowSeconds = 1.2): SyncReport {
  const heard = splitHeard(heardRaw);
  // Cada palavra da tela é procurada entre as OUVIDAS perto do instante em que aparece (em ordem): a mesma
  // palavra dita 6 s depois não é "atraso", é outra fala.
  const sim = (a: string, b: string) => Math.max(wordSimilarity(a, b), alias[normWord(a)] ? wordSimilarity(alias[normWord(a)]!, b) : 0);
  const offsets: number[] = [];
  const details: NonNullable<SyncReport["details"]> = [];
  let last = -1;
  for (const s of shown) {
    let best = -1, bestD = Infinity;
    // Palavra curta ("A", "é", "o") é ambígua: só casa perto (±0,35 s) — senão casaria com outra fala.
    const win = normWord(s.word).length <= 2 ? Math.min(0.35, windowSeconds) : windowSeconds;
    for (let j = last + 1; j < heard.length; j += 1) {
      const d = heard[j]!.start - s.at;
      if (d > win) break;
      if (d < -win || sim(s.word, heard[j]!.word) < 0.6) continue;
      if (Math.abs(d) < bestD) { bestD = Math.abs(d); best = j; }
    }
    if (best >= 0) { offsets.push(s.at - heard[best]!.start); last = best; details.push({ word: s.word, shownAt: s.at, heard: heard[best]!.word, heardAt: heard[best]!.start, offsetMs: Math.round((s.at - heard[best]!.start) * 1000) }); }
    else details.push({ word: s.word, shownAt: s.at });
  }
  const abs = offsets.map(Math.abs);
  const mean = abs.length ? abs.reduce((a, b) => a + b, 0) / abs.length : Infinity;
  const max = abs.length ? Math.max(...abs) : Infinity;
  return { words: shown.length, measured: offsets.length, meanOffsetMs: Math.round(mean * 1000), maxOffsetMs: Math.round(max * 1000), late: offsets.filter((o) => o > 0.12).length, early: offsets.filter((o) => o < -0.12).length, status: offsets.length >= Math.max(1, shown.length * 0.7) && mean <= 0.12 && max <= 0.25 ? "ok" : "falha", details };
}

/** Inícios de fala pela energia: silêncio de pelo menos `minSilence` seguido de voz acima de `thresholdDb`. */
export function speechOnsets(samples: Float32Array, rate: number, thresholdDb = -35, minSilence = 0.08): number[] {
  const win = Math.max(1, Math.floor(rate * 0.01));
  const need = Math.round(minSilence / 0.01);
  const out: number[] = [];
  let quiet = need;
  for (let a = 0; a < samples.length; a += win) {
    let s = 0;
    for (let i = a; i < Math.min(samples.length, a + win); i += 1) s += samples[i]! ** 2;
    const loud = 10 * Math.log10(s / win + 1e-12) > thresholdDb;
    if (loud && quiet >= need) out.push(+(a / rate).toFixed(3));
    quiet = loud ? 0 : quiet + 1;
  }
  return out;
}

/**
 * Refino pelo ÁUDIO: o Whisper erra o início da 1ª palavra depois de um silêncio (medido: −0,3 a +0,4 s). Essa
 * palavra é ancorada no início de fala (energia) mais próximo, até ±`window` s; as demais ficam como estão.
 */
export function refineWordOnsets<W extends TimedWord>(words: readonly W[], samples: Float32Array, rate: number, window = 0.6): W[] {
  const onsets = speechOnsets(samples, rate);
  // Silêncio no início marcado: energia de 40 a 160 ms depois dele abaixo de −45 dBFS (os primeiros 40 ms
  // podem ainda ser a cauda da palavra anterior).
  const silentAt = (t: number) => {
    const a = Math.max(0, Math.floor((t + 0.04) * rate)), b = Math.min(samples.length, a + Math.floor(0.12 * rate));
    let e = 0;
    for (let k = a; k < b; k += 1) e += samples[k]! ** 2;
    return b <= a || 10 * Math.log10(e / (b - a) + 1e-12) < -45;
  };
  return words.map((w, i) => {
    const prevEnd = i > 0 ? words[i - 1]!.end : -Infinity;
    if (!Number.isFinite(w.start)) return w;
    // Uma palavra não começa em silêncio: o Whisper às vezes estende o início para trás através da pausa
    // (até ~1 s). Nesse caso a palavra vai para o próximo início real de fala (até 1,5 s adiante).
    if (silentAt(w.start)) {
      const next = onsets.find((o) => o > w.start && o - w.start <= 1.5);
      if (next !== undefined) return { ...w, start: next, end: Math.max(w.end, next + 0.05) };
    }
    if (i > 0 && w.start - prevEnd < 0.08) return w;
    let best: number | undefined;
    for (const o of onsets) if (Math.abs(o - w.start) <= window && o > prevEnd - 0.02 && (best === undefined || Math.abs(o - w.start) < Math.abs(best - w.start))) best = o;
    return best === undefined ? w : { ...w, start: best };
  });
}
