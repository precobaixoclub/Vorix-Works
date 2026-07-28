import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { spawn } from "node:child_process";
import type { AuthenticityClass, VisualAssetKind, VisualAssetLicense, VisualAssetMetadata } from "../../application/ports/visual-asset-provider.port.js";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8];

export type VisualAssetManifestEntry = {
  id: string;
  path: string;
  provider?: string;
  origin?: VisualAssetMetadata["origin"];
  author?: string;
  sourceUrl?: string;
  license: VisualAssetLicense;
  downloadedAt?: string;
  tags?: string[];
  theme?: string;
  emotion?: string;
  kind?: VisualAssetKind;
  /** OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY (seção 7) — declaração explícita de proveniência no manifesto; nunca inferida automaticamente para entradas manifestadas (só o scan de diretório sem manifesto usa a inferência padrão do classificador). */
  authenticityClass?: AuthenticityClass;
  authenticityNotes?: string;
};

export function normalizeAspectRatio(width: number, height: number): string {
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

export function inferKind(tags: string[], fallback: VisualAssetKind = "photo"): VisualAssetKind {
  const normalized = tags.join(" ").toLowerCase();
  if (normalized.includes("mockup") || normalized.includes("celular") || normalized.includes("phone")) return "mockup";
  if (normalized.includes("illustration") || normalized.includes("ilustração") || normalized.includes("ilustracao")) return "illustration";
  if (normalized.includes("graphic") || normalized.includes("icone") || normalized.includes("ícone")) return "graphic";
  return fallback;
}

export async function readRasterDimensions(absolutePath: string): Promise<{ width: number; height: number }> {
  const bytes = await readFile(absolutePath);
  if (isPng(bytes)) {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  if (isJpeg(bytes)) return readJpegDimensions(bytes);
  throw new Error(`Formato de imagem não suportado para asset visual: ${extname(absolutePath) || "(sem extensão)"}. Use PNG ou JPG.`);
}

function isPng(bytes: Buffer): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function isJpeg(bytes: Buffer): boolean {
  return JPEG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function readJpegDimensions(bytes: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw new Error("Não foi possível ler dimensões do JPG.");
}

/**
 * Dimensões e duração real de um asset de vídeo/b-roll/cinemagraph, lidas via inspeção do próprio
 * FFmpeg (`-i <arquivo>` sem `-map`/output, que sempre imprime `Duration:` e a resolução do stream
 * de vídeo em stderr antes de falhar por não ter saída configurada — mesma técnica "ffprobe-lite"
 * já usada nos testes do adaptador de renderização; este projeto não empacota ffprobe separado).
 */
export async function readVideoMetadata(absolutePath: string): Promise<{ width: number; height: number; durationSeconds: number }> {
  const binaryPath = resolveFfmpegBinaryPath();
  const stderr = await new Promise<string>((resolvePromise) => {
    const child = spawn(binaryPath, ["-hide_banner", "-i", absolutePath], { windowsHide: true });
    let output = "";
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.on("close", () => resolvePromise(output));
    child.on("error", () => resolvePromise(output));
  });

  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  const dimensionsMatch = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  if (!durationMatch || !dimensionsMatch) {
    throw new Error(`Não foi possível ler metadados de vídeo para o asset: ${absolutePath}.`);
  }
  const durationSeconds = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  return {
    width: Number(dimensionsMatch[1]),
    height: Number(dimensionsMatch[2]),
    durationSeconds,
  };
}

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);

export function isVideoExtension(extension: string): boolean {
  return VIDEO_EXTENSIONS.has(extension.toLowerCase());
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}
