/**
 * Prepara os materiais de produto para o motion design: recorte da estampa (PNG com transparência,
 * cores originais), elementos da estampa e a caixa dela em cada variante (match-cut entre cores).
 * Decodifica com o FFmpeg empacotado; a lógica é pura (`print-extraction.ts`).
 */

import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { alignmentBetween, extractPrint, type Box } from "../../application/video-editing/print-extraction.js";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";
import { probeMedia, runFfmpegCapture } from "./ffmpeg-media-analysis.js";

export type Fraction = { x: number; y: number; w: number; h: number };

function decodeCrop(file: string, crop: { x: number; y: number; w: number; h: number }): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegBinaryPath(), ["-v", "error", "-i", file, "-vf", `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(new Uint8Array(Buffer.concat(chunks))) : reject(new Error("falha ao decodificar a foto do produto"))));
  });
}

export type PrintAnalysis = {
  photo: { width: number; height: number };
  /** Caixa da estampa na foto (frações). */
  print: Fraction;
  /** Elementos da estampa em frações da CAIXA da estampa. */
  elements: Fraction[];
  fabricHex: string;
  confidence: number;
  /** PNG da estampa recortada (caixa da estampa), se pedido. */
  cutout?: string;
};

const hex = (c: readonly number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/**
 * `region` é a área aproximada da estampa (frações da foto, do diretor ou do cadastro): a análise
 * acolchoa a região, separa a estampa do tecido e devolve a caixa exata.
 */
export async function analyzePrint(file: string, initial: Fraction, options: { cutoutPath?: string; workDir?: string; adaptive?: boolean } = {}): Promise<PrintAnalysis> {
  const probe = await probeMedia(file);
  if (!probe.video) throw new Error("foto sem imagem");
  const { width: W, height: H } = probe.video;
  // A região informada é aproximada: se um traço da estampa sai pela borda, a área cresce naquele lado.
  let region = { ...initial };
  for (let attempt = 0; ; attempt += 1) {
  const padX = region.w * 0.18, padY = region.h * 0.45;
  const even = (v: number) => Math.floor(v / 2) * 2;
  const x = even(Math.max(0, Math.floor((region.x - padX) * W)));
  const y = even(Math.max(0, Math.floor((region.y - padY) * H)));
  const w = even(Math.min(W - x, Math.ceil((region.w + 2 * padX) * W)));
  const h = even(Math.min(H - y, Math.ceil((region.h + 2 * padY) * H)));
  const rgb = await decodeCrop(file, { x, y, w, h });
  if (rgb.length !== w * h * 3) throw new Error(`recorte com tamanho inesperado (${rgb.length} ≠ ${w * h * 3})`);
  const inner = { x: Math.round(region.x * W) - x, y: Math.round((region.y - region.h * 0.25) * H) - y, w: Math.round(region.w * W), h: Math.round(region.h * 1.5 * H) };
  const result = extractPrint(rgb, w, h, inner);
  const c = result.clipped;
  if (options.adaptive !== false && attempt < 3 && (c.top || c.bottom || c.left || c.right)) {
    const gx = region.w * 0.35, gy = region.h * 0.6;
    const x0 = Math.max(0, region.x - (c.left ? gx : 0)), y0 = Math.max(0, region.y - (c.top ? gy : 0));
    region = { x: x0, y: y0, w: Math.min(1 - x0, region.x + region.w + (c.right ? gx : 0) - x0), h: Math.min(1 - y0, region.y + region.h + (c.bottom ? gy : 0) - y0) };
    continue;
  }
  const b = result.bounds;
  const margin = Math.round(Math.max(b.w, b.h) * 0.02);
  const box: Box = { x: Math.max(0, b.x - margin), y: Math.max(0, b.y - margin), w: Math.min(w - Math.max(0, b.x - margin), b.w + 2 * margin), h: Math.min(h - Math.max(0, b.y - margin), b.h + 2 * margin) };
  const print = { x: (x + box.x) / W, y: (y + box.y) / H, w: box.w / W, h: box.h / H };
  const elements = result.elements.map((e) => ({ x: (e.x - box.x) / box.w, y: (e.y - box.y) / box.h, w: e.w / box.w, h: e.h / box.h }));
  if (options.cutoutPath) {
    const raw = `${options.cutoutPath}.rgba`;
    const sub = new Uint8Array(box.w * box.h * 4);
    for (let row = 0; row < box.h; row += 1) sub.set(result.rgba.subarray(((box.y + row) * w + box.x) * 4, ((box.y + row) * w + box.x + box.w) * 4), row * box.w * 4);
    await writeFile(raw, sub);
    const encoded = await runFfmpegCapture(["-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${box.w}x${box.h}`, "-i", raw, "-frames:v", "1", options.cutoutPath], { timeoutMs: 60_000 });
    await rm(raw, { force: true });
    if (encoded.exitCode !== 0) throw new Error("falha ao gravar o recorte da estampa");
  }
  return { photo: { width: W, height: H }, print, elements, fabricHex: hex(result.fabric), confidence: result.confidence, ...(options.cutoutPath ? { cutout: options.cutoutPath } : {}) };
  }
}

/** Caixa da estampa em todas as variantes + transformação de cada uma para a referência (match-cut). */
export async function alignVariants(files: Record<string, string>, region: Fraction): Promise<Record<string, { print: Fraction; fabricHex: string; toReference: { scale: number; dx: number; dy: number } }>> {
  const entries = await Promise.all(Object.entries(files).map(async ([id, file]) => [id, await analyzePrint(file, region)] as const));
  const reference = entries[0]![1].print;
  return Object.fromEntries(entries.map(([id, a]) => [id, { print: a.print, fabricHex: a.fabricHex, toReference: alignmentBetween(a.print, reference) }]));
}

/**
 * Estampa de TODAS as variantes de um modelo (mesma sessão de fotos → estampa no mesmo lugar): mede cada
 * uma, toma a caixa mediana das medições confiáveis e refaz todas com ela, sem crescer a área. Uma foto
 * difícil (tecido escuro com cabelo na borda, estampa clara em tecido claro) herda a caixa das outras.
 */
export async function analyzeProductPrints(files: Record<string, string>, region: Fraction, options: { cutoutDir?: string; prefix?: string } = {}): Promise<Record<string, PrintAnalysis>> {
  const first = await Promise.all(Object.entries(files).map(async ([id, file]) => [id, await analyzePrint(file, region)] as const));
  const trusted = first.filter(([, a]) => a.confidence >= 0.6 && a.print.w < 0.7 && a.print.h < 0.5).map(([, a]) => a.print);
  const pool = trusted.length ? trusted : first.map(([, a]) => a.print);
  const mid = (key: keyof Fraction) => { const v = pool.map((p) => p[key]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]!; };
  const consensus = { x: mid("x"), y: mid("y"), w: mid("w"), h: mid("h") };
  // Margem pequena: a caixa já é a estampa; o acolchoamento de `analyzePrint` cuida do resto.
  const tight = { x: consensus.x + consensus.w * 0.04, y: consensus.y + consensus.h * 0.04, w: consensus.w * 0.92, h: consensus.h * 0.92 };
  const out: Record<string, PrintAnalysis> = {};
  for (const [id, file] of Object.entries(files)) {
    out[id] = await analyzePrint(file, tight, { adaptive: false, ...(options.cutoutDir ? { cutoutPath: `${options.cutoutDir}/${options.prefix ?? "recorte"}-${id}.png` } : {}) });
  }
  return out;
}

function decodeRaw(file: string, vf: string, pixFmt: "gray" | "rgba"): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegBinaryPath(), ["-v", "error", "-i", file, "-vf", vf, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", pixFmt, "-"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(new Uint8Array(Buffer.concat(chunks))) : reject(new Error("falha ao decodificar a imagem"))));
  });
}

/** Grade de luminância (0–255) da foto: o motion design escolhe a tinta do texto pela luz sob ele. */
export async function lumaGrid(file: string, cols = 16, rows = 21): Promise<{ cols: number; rows: number; values: number[] }> {
  const data = await decodeRaw(file, `scale=${cols}:${rows}:flags=area,format=gray`, "gray");
  return { cols, rows, values: Array.from(data.slice(0, cols * rows)) };
}

/** Altura do traço (0–1) em `buckets` faixas da largura do recorte — a ponta de luz segue a linha. */
export async function traceProfile(cutout: string, buckets = 64): Promise<number[]> {
  const probe = await probeMedia(cutout);
  const w = probe.video?.width ?? 0, h = probe.video?.height ?? 0;
  const data = await decodeRaw(cutout, "format=rgba", "rgba");
  const out: number[] = [];
  for (let b = 0; b < buckets; b += 1) {
    let sum = 0, weight = 0;
    for (let x = Math.floor((b / buckets) * w); x < Math.floor(((b + 1) / buckets) * w); x += 1) for (let y = 0; y < h; y += 1) { const a = data[(y * w + x) * 4 + 3]!; sum += a * y; weight += a; }
    out.push(weight > 0 ? sum / weight / h : NaN);
  }
  // Faixas sem traço herdam o vizinho (a ponta não "pula" para o meio).
  for (let i = 0; i < out.length; i += 1) if (Number.isNaN(out[i])) out[i] = out[i - 1] ?? out.find((v) => !Number.isNaN(v)) ?? 0.5;
  return out.map((v) => Math.round(v * 1000) / 1000);
}

/** Recorta a área transparente em volta da logo (centraliza de verdade) e devolve a proporção. */
export async function trimLogo(file: string, output: string): Promise<{ width: number; height: number; aspect: number }> {
  const probe = await probeMedia(file);
  const w = probe.video?.width ?? 0, h = probe.video?.height ?? 0;
  const data = await decodeRaw(file, "format=rgba", "rgba");
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (data[(y * w + x) * 4 + 3]! > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  if (maxX <= minX || maxY <= minY) throw new Error("logo sem conteúdo visível");
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const result = await runFfmpegCapture(["-y", "-i", file, "-vf", `crop=${cw}:${ch}:${minX}:${minY}`, "-frames:v", "1", output], { timeoutMs: 30_000 });
  if (result.exitCode !== 0) throw new Error("falha ao recortar a logo");
  return { width: cw, height: ch, aspect: cw / ch };
}
