/**
 * Análise de vídeo de REFERÊNCIA (e das nossas peças, para diagnóstico) com o FFmpeg empacotado:
 * quadros reduzidos → `analyzeFrames` (cortes, ritmo, movimento, câmera, cor, composição, quadros
 * vazios); áudio → loudness (EBU R128) e batida; miniaturas para o diretor LER tipografia e direção de
 * arte (o que não é medido). Nada daqui entra na peça renderizada.
 */

import { spawn } from "node:child_process";
import { analyzeFrames, type AudioProfile, type ReferenceProfile } from "../../application/video-editing/reference-profile.js";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";
import { analyzeBeats } from "./audio-analysis.js";
import { probeMedia, renderContactSheet, runFfmpegCapture } from "./ffmpeg-media-analysis.js";

const FPS = 6;
const WIDTH = 72;
const MAX_SECONDS = 180;

function decodeRgb(file: string, width: number, height: number, seconds: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegBinaryPath(), ["-v", "error", "-t", String(seconds), "-i", file, "-vf", `fps=${FPS},scale=${width}:${height}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(new Uint8Array(Buffer.concat(chunks))) : reject(new Error("falha ao decodificar o vídeo de referência"))));
  });
}

export async function measureLoudness(file: string): Promise<{ integratedLufs?: number; truePeakDb?: number }> {
  const result = await runFfmpegCapture(["-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { timeoutMs: 180_000 });
  const summary = result.stderr.slice(result.stderr.lastIndexOf("Summary:"));
  const integrated = /I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1];
  const peak = /Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1];
  return { ...(integrated ? { integratedLufs: Number(integrated) } : {}), ...(peak ? { truePeakDb: Number(peak) } : {}) };
}

export type ReferenceVideoAnalysis = { profile: ReferenceProfile; audio: AudioProfile; sheet?: string; analysisMs: number };

/**
 * Mede um vídeo. `sheetPath` (opcional) grava as miniaturas que o diretor lê (tipografia, direção de
 * arte) — arquivo de trabalho, privado, nunca usado como material da peça.
 */
export async function analyzeReferenceVideo(file: string, options: { sheetPath?: string } = {}): Promise<ReferenceVideoAnalysis> {
  const started = Date.now();
  const probe = await probeMedia(file);
  if (!probe.video) throw new Error("o arquivo de referência não tem vídeo");
  const seconds = Math.min(MAX_SECONDS, probe.durationSeconds || MAX_SECONDS);
  const height = Math.max(2, Math.round((WIDTH * probe.video.height) / probe.video.width / 2) * 2);
  const data = await decodeRgb(file, WIDTH, height, seconds);
  const profile = analyzeFrames({ width: WIDTH, height, fps: FPS, data }, seconds);
  let audio: AudioProfile = {};
  if (probe.audio) {
    const loud = await measureLoudness(file).catch(() => ({}));
    const beats = await analyzeBeats(file, seconds).catch(() => undefined);
    const onBeat = beats && profile.cuts.length ? profile.cuts.filter((cut) => [...beats.beats, ...beats.onsets].some((b) => Math.abs(b - cut) <= 0.09)).length / profile.cuts.length : undefined;
    audio = { ...loud, ...(beats ? { bpm: beats.bpm } : {}), ...(onBeat !== undefined ? { cutsOnBeat: Math.round(onBeat * 100) / 100 } : {}) };
  }
  if (options.sheetPath) await renderContactSheet(file, options.sheetPath, { everySeconds: Math.max(0.5, seconds / 18), columns: 6, tileWidth: 200, maxTiles: 18 });
  return { profile, audio, ...(options.sheetPath ? { sheet: options.sheetPath } : {}), analysisMs: Date.now() - started };
}
