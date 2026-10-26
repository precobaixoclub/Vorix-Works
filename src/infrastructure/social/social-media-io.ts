import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { signForExternalPublication } from "../../shared/utils/object-url-signing.js";
import type { SocialMediaProbePort } from "../../application/social/social-media-validation.js";
import type { SocialMediaItem } from "../../domain/social/social-publishing.model.js";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";

export type SocialMediaHttpClient = (url: string, init?: RequestInit) => Promise<Response>;

/** Baixa a mídia do storage (URL assinada quando é nossa), com teto de tamanho. */
export async function downloadSocialMedia(url: string, options: { maxBytes: number; timeoutMs?: number; httpClient?: SocialMediaHttpClient }): Promise<Buffer> {
  if (!/^https?:\/\//i.test(url)) throw new Error("MEDIA_URL_INVALID: URL de mídia inválida.");
  const response = await (options.httpClient ?? fetch)(signForExternalPublication(url), { signal: AbortSignal.timeout(options.timeoutMs ?? 120_000) });
  if (!response.ok || !response.body) throw new Error(`MEDIA_DOWNLOAD_FAILED: HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > options.maxBytes) throw new Error("MEDIA_TOO_LARGE: arquivo maior que o permitido.");
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > options.maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("MEDIA_TOO_LARGE: arquivo maior que o permitido.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Grava a mídia num diretório temporário próprio e garante a limpeza. */
export async function withTempMediaFiles<T>(items: readonly { bytes: Buffer; extension: string }[], run: (paths: string[]) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "vorix-social-media-"));
  try {
    const paths: string[] = [];
    for (const [index, item] of items.entries()) {
      const path = join(dir, `media-${index}.${item.extension}`);
      await writeFile(path, item.bytes);
      paths.push(path);
    }
    return await run(paths);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function extensionFor(item: SocialMediaItem): string {
  const mime = item.mimeType ?? "";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("quicktime")) return "mov";
  if (item.kind === "video") return "mp4";
  return "jpg";
}

export type VideoProbe = { width?: number; height?: number; durationSec?: number; hasAudio: boolean; videoCodec?: string };

/** Lê duração/dimensão/áudio de um vídeo com o ffmpeg vetado do projeto (sem ffprobe obrigatório). */
export async function probeVideoFile(path: string, timeoutMs = 60_000): Promise<VideoProbe> {
  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn(resolveFfmpegBinaryPath(), ["-hide_banner", "-i", path], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("ffmpeg probe timeout")); }, timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-20_000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", () => { clearTimeout(timer); resolve(output); });
  });
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const video = /Stream #[^\n]*Video:\s*([a-z0-9_]+)[^\n]*?,\s*(\d{2,5})x(\d{2,5})/i.exec(stderr);
  const rotation = /rotate\s*:\s*(-?\d+)|displaymatrix: rotation of (-?\d+(?:\.\d+)?)/i.exec(stderr);
  let width = video ? Number(video[2]) : undefined;
  let height = video ? Number(video[3]) : undefined;
  const degrees = rotation ? Math.abs(Number(rotation[1] ?? rotation[2])) : 0;
  if (width && height && Math.round(degrees) % 180 === 90) [width, height] = [height, width];
  return {
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(duration ? { durationSec: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) } : {}),
    hasAudio: /Stream #[^\n]*Audio:/i.test(stderr),
    ...(video ? { videoCodec: video[1]!.toLowerCase() } : {}),
  };
}

/**
 * Lê os metadados reais da mídia no servidor (não confia no que o navegador declarou).
 * Falha de leitura devolve o item como veio: a validação usa o que houver.
 */
export class SocialMediaProbe implements SocialMediaProbePort {
  constructor(private readonly options: { maxBytes?: number; httpClient?: SocialMediaHttpClient } = {}) {}

  async probe(item: SocialMediaItem): Promise<SocialMediaItem> {
    const bytes = await downloadSocialMedia(item.url, { maxBytes: this.options.maxBytes ?? 1_000_000_000, httpClient: this.options.httpClient });
    if (item.kind === "image") {
      const metadata = await sharp(bytes).metadata();
      return { ...item, sizeBytes: bytes.byteLength, ...(metadata.width ? { width: metadata.width } : {}), ...(metadata.height ? { height: metadata.height } : {}), ...(metadata.format ? { mimeType: `image/${metadata.format}` } : {}) };
    }
    const probe = await withTempMediaFiles([{ bytes, extension: extensionFor(item) }], ([path]) => probeVideoFile(path!));
    return { ...item, sizeBytes: bytes.byteLength, ...(probe.width ? { width: probe.width } : {}), ...(probe.height ? { height: probe.height } : {}), ...(probe.durationSec ? { durationSec: probe.durationSec } : {}), hasAudio: probe.hasAudio };
  }
}
