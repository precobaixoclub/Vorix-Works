/**
 * Beat Sync — análise da trilha: envelope de energia → força de ataque (onset) → tempo por
 * autocorrelação (60–180 BPM) → grade de batidas alinhada aos ataques mais fortes. Também marca as
 * mudanças de intensidade (seções). Sem dependência externa: decodifica com o FFmpeg empacotado.
 */

import { spawn } from "node:child_process";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";

export type BeatAnalysis = { bpm: number; beats: number[]; onsets: number[]; sections: { start: number; energy: number }[]; durationSeconds: number };

const RATE = 11025;
const HOP = 256;

function decodeMono(file: string, maxSeconds: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegBinaryPath(), ["-v", "error", "-t", String(maxSeconds), "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error("falha ao decodificar a trilha"));
      const raw = Buffer.concat(chunks);
      const out = new Float32Array(raw.length / 2);
      for (let i = 0; i < out.length; i += 1) out[i] = raw.readInt16LE(i * 2) / 32768;
      resolve(out);
    });
  });
}

/** Grade de batidas a partir da força de ataque (função pura, testável). */
export function beatsFromSamples(samples: Float32Array, rate = RATE): BeatAnalysis {
  const frames = Math.floor(samples.length / HOP);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    for (let i = 0; i < HOP; i += 1) sum += samples[f * HOP + i]! ** 2;
    energy[f] = Math.log(1e-6 + sum / HOP);
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f += 1) onset[f] = Math.max(0, energy[f]! - energy[f - 1]!);
  const frameSeconds = HOP / rate;
  // Tempo: autocorrelação da força de ataque em atrasos de 60–180 BPM.
  let bestLag = 0;
  let bestScore = -1;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const lag = Math.round(60 / bpm / frameSeconds);
    let score = 0;
    for (let f = lag; f < frames; f += 1) score += onset[f]! * onset[f - lag]!;
    score /= Math.max(1, frames - lag);
    // Leve preferência por andamentos comuns de Reels (90–130).
    const prior = 1 - Math.min(1, Math.abs(bpm - 110) / 140) * 0.25;
    if (score * prior > bestScore) { bestScore = score * prior; bestLag = lag; }
  }
  const period = Math.max(1, bestLag);
  // Fase: o deslocamento que soma mais ataques na grade.
  let bestPhase = 0;
  let phaseScore = -1;
  for (let phase = 0; phase < period; phase += 1) {
    let score = 0;
    for (let f = phase; f < frames; f += period) score += onset[f]!;
    if (score > phaseScore) { phaseScore = score; bestPhase = phase; }
  }
  const beats: number[] = [];
  for (let f = bestPhase; f < frames; f += period) beats.push(Math.round(f * frameSeconds * 1000) / 1000);
  // Ataques fortes (picos acima de média + 1,5 desvio).
  const mean = onset.reduce((a, b) => a + b, 0) / Math.max(1, frames);
  const sd = Math.sqrt(onset.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, frames));
  const onsets: number[] = [];
  for (let f = 1; f < frames - 1; f += 1) if (onset[f]! > mean + 1.5 * sd && onset[f]! >= onset[f - 1]! && onset[f]! >= onset[f + 1]!) onsets.push(Math.round(f * frameSeconds * 1000) / 1000);
  // Seções de intensidade por janelas de 2 s.
  const window = Math.round(2 / frameSeconds);
  const sections: { start: number; energy: number }[] = [];
  for (let f = 0; f < frames; f += window) {
    let sum = 0;
    for (let i = f; i < Math.min(frames, f + window); i += 1) sum += energy[i]!;
    sections.push({ start: Math.round(f * frameSeconds * 100) / 100, energy: Math.round((sum / Math.min(window, frames - f)) * 100) / 100 });
  }
  return { bpm: Math.round((60 / (period * frameSeconds)) * 10) / 10, beats, onsets, sections, durationSeconds: Math.round((samples.length / rate) * 100) / 100 };
}

export async function analyzeBeats(file: string, maxSeconds = 120): Promise<BeatAnalysis> {
  return beatsFromSamples(await decodeMono(file, maxSeconds));
}
