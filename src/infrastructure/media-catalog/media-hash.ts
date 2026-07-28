import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";
import { isVideoExtension } from "../visual-assets/visual-asset-metadata.js";
import { extname } from "node:path";

/**
 * MEDIA INTELLIGENCE ENGINE — hash exato (deduplicação byte-a-byte) e um hash perceptual leve
 * (detecção de quase-duplicata) para imagens e vídeos. Não há biblioteca de processamento de
 * imagem instalada neste projeto (sem sharp/jimp/canvas — só `ffmpeg-static`), então o hash
 * perceptual é deliberadamente simples: um "average hash" (aHash) de 8x8 pixels em tons de cinza,
 * comparado por distância de Hamming. É uma heurística real e testável, não uma simulação — mas é
 * mais fraca que um pHash/dHash de verdade; documentado como limitação conhecida no relatório final.
 */

export async function computeFileHash(absolutePath: string): Promise<string> {
  const data = await readFile(absolutePath);
  return createHash("sha256").update(data).digest("hex");
}

/** Distância de Hamming entre dois hashes perceptuais de mesmo comprimento (hex de 16 dígitos = 64 bits). */
export function hammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < hashA.length; index += 1) {
    const bitsA = Number.parseInt(hashA[index], 16);
    const bitsB = Number.parseInt(hashB[index], 16);
    let xor = bitsA ^ bitsB;
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/** Limite de distância de Hamming (em bits, de um hash de 64 bits) abaixo do qual dois assets são tratados como quase-duplicata visual. */
export const NEAR_DUPLICATE_HAMMING_THRESHOLD = 6;

/**
 * Extrai um average-hash 8x8 (64 bits, devolvido como 16 dígitos hex) de uma imagem ou de um frame
 * do meio de um vídeo, via FFmpeg (`-vf scale=8:8,format=gray -f rawvideo`) — nunca decodifica
 * pixels manualmente. Devolve `undefined` quando o FFmpeg falha (arquivo corrompido/formato não
 * suportado) em vez de lançar, já que o hash perceptual é um enriquecimento opcional, não um
 * requisito para indexação.
 */
export async function computePerceptualHash(absolutePath: string): Promise<string | undefined> {
  const isVideo = isVideoExtension(extname(absolutePath));
  const binaryPath = resolveFfmpegBinaryPath();
  const args = isVideo
    ? ["-hide_banner", "-loglevel", "error", "-ss", "00:00:00.5", "-i", absolutePath, "-frames:v", "1", "-vf", "scale=8:8:flags=area,format=gray", "-f", "rawvideo", "pipe:1"]
    : ["-hide_banner", "-loglevel", "error", "-i", absolutePath, "-frames:v", "1", "-vf", "scale=8:8:flags=area,format=gray", "-f", "rawvideo", "pipe:1"];

  const pixels = await new Promise<Buffer | undefined>((resolvePromise) => {
    const child = spawn(binaryPath, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("close", (code) => {
      if (code !== 0 || chunks.length === 0) { resolvePromise(undefined); return; }
      resolvePromise(Buffer.concat(chunks));
    });
    child.on("error", () => resolvePromise(undefined));
  });

  if (!pixels || pixels.byteLength < 64) return undefined;

  const samples = Array.from(pixels.subarray(0, 64));
  const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const bits = samples.map((value) => (value >= average ? 1 : 0));

  let hex = "";
  for (let index = 0; index < 64; index += 4) {
    const nibble = (bits[index] << 3) | (bits[index + 1] << 2) | (bits[index + 2] << 1) | bits[index + 3];
    hex += nibble.toString(16);
  }
  return hex;
}
