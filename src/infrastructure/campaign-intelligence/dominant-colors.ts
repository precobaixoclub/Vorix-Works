import { spawn } from "node:child_process";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";

/**
 * Cores dominantes via FFmpeg (`scale=4:4,format=rgb24` + `rawvideo`) — mesma técnica/mesma
 * justificativa de `computePerceptualHash` em `media-hash.ts` (não há sharp/jimp/canvas instalado):
 * reduz a imagem a um grid 4x4, lê os 16 pixels crus e devolve as cores mais frequentes como hex.
 * Heurística real e determinística, mais fraca que clustering de verdade — limitação conhecida.
 */

export async function extractDominantColors(absolutePath: string, count = 4): Promise<string[]> {
  const binaryPath = resolveFfmpegBinaryPath();
  const args = ["-hide_banner", "-loglevel", "error", "-i", absolutePath, "-frames:v", "1", "-vf", "scale=4:4:flags=area,format=rgb24", "-f", "rawvideo", "pipe:1"];

  const pixels = await new Promise<Buffer | undefined>((resolvePromise) => {
    const child = spawn(binaryPath, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("close", (code) => resolvePromise(code === 0 && chunks.length > 0 ? Buffer.concat(chunks) : undefined));
    child.on("error", () => resolvePromise(undefined));
  });

  if (!pixels || pixels.byteLength < 48) return [];

  const counts = new Map<string, number>();
  for (let offset = 0; offset + 2 < pixels.byteLength; offset += 3) {
    const hex = `#${pixels[offset].toString(16).padStart(2, "0")}${pixels[offset + 1].toString(16).padStart(2, "0")}${pixels[offset + 2].toString(16).padStart(2, "0")}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([hex]) => hex);
}
