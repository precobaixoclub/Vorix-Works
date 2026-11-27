/**
 * Medidas para a revisão audiovisual: quadro do meio de cada plano (dHash) e movimento por plano (vídeo),
 * voz × trilha em cada fala, entonação, velocidade e pausas internas (áudio). FFmpeg empacotado, sem
 * modelo externo.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";

function raw(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegBinaryPath(), ["-v", "error", ...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => chunks.push(b));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("falha ao medir a mídia"))));
  });
}

/** dHash (9×8 em cinza) do quadro no instante `at`. */
export async function frameHash(file: string, at: number): Promise<bigint> {
  const px = await raw(["-ss", at.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale=9:8:flags=area,format=gray", "-f", "rawvideo", "-"]);
  let h = 0n;
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) h = (h << 1n) | (px[y * 9 + x]! > px[y * 9 + x + 1]! ? 1n : 0n);
  return h;
}

/** Movimento médio (diferença entre quadros a 6 q/s, ×5) dentro de um trecho. */
export async function motionBetween(file: string, from: number, to: number): Promise<number> {
  const w = 48, h = 84;
  const data = await raw(["-ss", from.toFixed(3), "-t", Math.max(0.2, to - from).toFixed(3), "-i", file, "-vf", `fps=6,scale=${w}:${h}:flags=area,format=gray`, "-f", "rawvideo", "-"]);
  const n = Math.floor(data.length / (w * h));
  if (n < 2) return 0;
  let sum = 0;
  for (let f = 1; f < n; f += 1) for (let p = 0; p < w * h; p += 1) sum += Math.abs(data[f * w * h + p]! - data[(f - 1) * w * h + p]!);
  return (sum / ((n - 1) * w * h)) * 5;
}

export async function readWavMono(path: string): Promise<{ rate: number; samples: Float32Array }> {
  const buf = await readFile(path);
  const channels = buf.readUInt16LE(22), rate = buf.readUInt32LE(24), bits = buf.readUInt16LE(34);
  let offset = 12;
  while (offset < buf.length && buf.toString("ascii", offset, offset + 4) !== "data") offset += 8 + buf.readUInt32LE(offset + 4);
  const start = offset + 8, bytes = bits / 8, frames = Math.floor((buf.length - start) / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let s = 0;
    for (let c = 0; c < channels; c += 1) s += buf.readInt16LE(start + (i * channels + c) * bytes) / 32768;
    out[i] = s / channels;
  }
  return { rate, samples: out };
}

const rmsDb = (x: Float32Array, a: number, b: number) => { let s = 0, n = 0; for (let i = Math.max(0, a); i < Math.min(x.length, b); i += 1) { s += x[i]! ** 2; n += 1; } return 10 * Math.log10(s / Math.max(1, n) + 1e-12); };

/** Desvio do tom (semitons) por autocorrelação — proxy de entonação viva × leitura plana. */
export function pitchStd(x: Float32Array, rate: number): number | undefined {
  const hop = Math.floor(rate * 0.01), win = Math.floor(rate * 0.04);
  const f0: number[] = [];
  let e = 0;
  for (let i = 0; i < x.length; i += 1) e += Math.abs(x[i]!);
  const floor = (e / Math.max(1, x.length)) * 1.2;
  for (let i = 0; i + win < x.length; i += hop) {
    let energy = 0;
    for (let k = 0; k < win; k += 1) energy += Math.abs(x[i + k]!);
    if (energy / win < floor) continue;
    const lo = Math.floor(rate / 400), hi = Math.floor(rate / 70);
    let best = 0, lag = 0, zero = 0;
    for (let k = 0; k < win; k += 1) zero += x[i + k]! * x[i + k]!;
    for (let L = lo; L < hi; L += 1) { let c = 0; for (let k = 0; k + L < win; k += 1) c += x[i + k]! * x[i + k + L]!; if (c > best) { best = c; lag = L; } }
    if (lag && best / (zero + 1e-9) > 0.45) f0.push(rate / lag);
  }
  if (f0.length < 8) return undefined;
  const med = [...f0].sort((a, b) => a - b)[Math.floor(f0.length / 2)]!;
  const st = f0.map((v) => 12 * Math.log2(v / med));
  const mean = st.reduce((a, b) => a + b, 0) / st.length;
  return Math.sqrt(st.reduce((a, v) => a + (v - mean) ** 2, 0) / st.length);
}

const syllables = (text: string) => (text.toLowerCase().match(/[aeiouáéíóúâêôãõà]+/g) ?? []).length;

/** Medidas de cada fala na faixa de voz (posições conhecidas) e da trilha no mesmo trecho. */
export async function measureLines(input: { voiceWav: string; musicWav?: string; lines: { line: string; start: number; end: number }[] }) {
  const voice = await readWavMono(input.voiceWav);
  const music = input.musicWav ? await readWavMono(input.musicWav) : undefined;
  return input.lines.map((l) => {
    const a = Math.floor(l.start * voice.rate), b = Math.floor(l.end * voice.rate);
    const seg = voice.samples.subarray(a, b);
    // Pausa interna: maior trecho abaixo de −40 dBFS (janelas de 20 ms) dentro da fala.
    const win = Math.floor(voice.rate * 0.02);
    let run = 0, longest = 0;
    for (let i = 0; i + win <= seg.length; i += win) { const db = rmsDb(seg, i, i + win); run = db < -40 ? run + 0.02 : 0; longest = Math.max(longest, run); }
    const voiceDb = rmsDb(voice.samples, a, b);
    const musicDb = music ? rmsDb(music.samples, Math.floor(l.start * music.rate), Math.floor(l.end * music.rate)) : undefined;
    return { ...l, syllablesPerSecond: syllables(l.line) / Math.max(0.1, l.end - l.start), pitchStd: pitchStd(seg, voice.rate), longestInnerPause: +longest.toFixed(2), voiceOverMusicDb: musicDb === undefined ? undefined : +(voiceDb - musicDb).toFixed(1) };
  });
}
