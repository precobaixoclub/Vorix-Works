/**
 * Smart Reframing — região de interesse de um vídeo ao longo do tempo, sem modelo externo:
 * quadros reduzidos (4 por segundo) → mudança entre quadros (o que se mexe: cursor, rolagem, rosto,
 * mão) + densidade de detalhe (onde há conteúdo) → centro ponderado de cada instante.
 * Em gravação de tela, o que muda é o que está sendo mostrado; parado, vale onde há conteúdo.
 */

import { spawn } from "node:child_process";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";
import type { RoiSample } from "../../application/video-editing/reframe-track.js";

const W = 96;
const H = 54;

export async function analyzeRegionOfInterest(file: string, input: { start: number; duration: number; fps?: number }): Promise<RoiSample[]> {
  const fps = input.fps ?? 4;
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(resolveFfmpegBinaryPath(), ["-v", "error", "-ss", String(input.start), "-t", String(input.duration), "-i", file, "-vf", `fps=${fps},scale=${W}:${H},format=gray`, "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("falha ao analisar o vídeo"))));
  });
  const size = W * H;
  const frames = Math.floor(raw.length / size);
  const samples: RoiSample[] = [];
  for (let f = 0; f < frames; f += 1) {
    let sx = 0;
    let sy = 0;
    let total = 0;
    let motion = 0;
    for (let y = 1; y < H - 1; y += 1) {
      for (let x = 1; x < W - 1; x += 1) {
        const i = f * size + y * W + x;
        const change = f > 0 ? Math.abs(raw[i]! - raw[i - size]!) : 0;
        const detail = Math.abs(raw[i + 1]! - raw[i - 1]!) + Math.abs(raw[i + W]! - raw[i - W]!);
        // Mudança pesa muito mais que detalhe: o que se mexe é o que está sendo mostrado.
        const w = change > 10 ? change * 4 : detail * 0.15;
        sx += w * x;
        sy += w * y;
        total += w;
        if (change > 10) motion += 1;
      }
    }
    samples.push({ t: Math.round((f / fps) * 1000) / 1000, cx: total ? sx / total / W : 0.5, cy: total ? sy / total / H : 0.5, weight: Math.min(1, motion / (size * 0.02)) });
  }
  return samples;
}
