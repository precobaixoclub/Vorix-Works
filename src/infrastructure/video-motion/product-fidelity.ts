/**
 * Fidelidade do produto num clipe gerado por IA (verificação AUTOMÁTICA). Complementa a revisão visual —
 * não promete fidelidade perfeita, só bloqueia o que dá para medir:
 *
 * Para N quadros do clipe (do início ao fim), procura a região da estampa da foto ORIGINAL (busca em
 * várias escalas, correlação normalizada em tons de cinza) e mede, no melhor encaixe:
 *  - estrutura (correlação): estampa deformada ou desenho modificado derrubam o valor;
 *  - cor (diferença média de RGB): cores alteradas;
 *  - detalhe (densidade de bordas, quadro ÷ original): elementos que somem (desenho "lavado") ou aparecem.
 * Qualquer quadro abaixo do limite bloqueia (a estampa costuma degradar no meio do movimento).
 *
 * Gera também uma PRANCHA (original + recorte encontrado em cada quadro, com as notas) para a revisão
 * visual — que olha o que a medida não pega (logo errado, produto trocado).
 */

import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { probeMedia, runFfmpegCapture } from "../video-editing/ffmpeg-media-analysis.js";

export type Region = { x: number; y: number; w: number; h: number };

export type FrameFidelity = { atSeconds: number; structure: number; colorDelta: number; detailRatio: number; scale: number; pass: boolean; reasons: string[] };

export type FidelityReport = {
  verdict: "pass" | "fail";
  frames: FrameFidelity[];
  worst: { structure: number; colorDelta: number; detailRatio: number };
  reasons: string[];
  thresholds: typeof FIDELITY_THRESHOLDS;
};

/** Limites calibrados em teste sintético; ajustáveis pela prova comparativa (nunca afrouxados para aprovar). */
export const FIDELITY_THRESHOLDS = { minStructure: 0.6, maxColorDelta: 22, minDetailRatio: 0.65, maxDetailRatio: 1.6, frames: 8 } as const;

/** Região padrão da estampa em foto de catálogo de camiseta (peito, terço superior central). */
export const DEFAULT_PRINT_REGION: Region = { x: 0.28, y: 0.2, w: 0.44, h: 0.3 };

const WORK_W = 180;

async function grayAndColor(input: Buffer | string, width: number) {
  const image = sharp(input).rotate().resize({ width }).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const gray = new Float32Array(info.width * info.height);
  for (let i = 0; i < gray.length; i += 1) gray[i] = 0.299 * data[i * 3]! + 0.587 * data[i * 3 + 1]! + 0.114 * data[i * 3 + 2]!;
  return { gray, rgb: data, w: info.width, h: info.height };
}

function crop(src: { gray: Float32Array; rgb: Buffer; w: number }, x: number, y: number, w: number, h: number) {
  const gray = new Float32Array(w * h);
  const rgb = Buffer.alloc(w * h * 3);
  for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) {
    const s = (y + j) * src.w + (x + i);
    gray[j * w + i] = src.gray[s]!;
    rgb[(j * w + i) * 3] = src.rgb[s * 3]!; rgb[(j * w + i) * 3 + 1] = src.rgb[s * 3 + 1]!; rgb[(j * w + i) * 3 + 2] = src.rgb[s * 3 + 2]!;
  }
  return { gray, rgb, w, h };
}

function edgeDensity(gray: Float32Array, w: number, h: number): number {
  let sum = 0;
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
    const gx = gray[y * w + x + 1]! - gray[y * w + x - 1]!;
    const gy = gray[(y + 1) * w + x]! - gray[(y - 1) * w + x]!;
    sum += Math.hypot(gx, gy);
  }
  return sum / Math.max(1, (w - 2) * (h - 2));
}

function stats(values: Float32Array) {
  let mean = 0;
  for (const v of values) mean += v;
  mean /= values.length;
  let variance = 0;
  for (const v of values) variance += (v - mean) ** 2;
  return { mean, std: Math.sqrt(variance / values.length) };
}

/** Melhor encaixe do modelo (template) no quadro por correlação normalizada. */
function bestMatch(frame: { gray: Float32Array; w: number; h: number }, template: Float32Array, tw: number, th: number, step: number) {
  const t = stats(template);
  let best = { score: -1, x: 0, y: 0 };
  if (t.std < 1) return best;
  for (let y = 0; y + th <= frame.h; y += step) for (let x = 0; x + tw <= frame.w; x += step) {
    let sum = 0;
    let sumSq = 0;
    let cross = 0;
    for (let j = 0; j < th; j += 1) {
      const row = (y + j) * frame.w + x;
      for (let i = 0; i < tw; i += 1) {
        const v = frame.gray[row + i]!;
        sum += v; sumSq += v * v; cross += v * template[j * tw + i]!;
      }
    }
    const n = tw * th;
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    if (std < 1) continue;
    const score = (cross / n - mean * t.mean) / (std * t.std);
    if (score > best.score) best = { score, x, y };
  }
  return best;
}

async function resizeGray(rgb: Buffer, w: number, h: number, tw: number, th: number) {
  return grayAndColor(await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).resize(tw, th, { fit: "fill" }).png().toBuffer(), tw);
}

export async function checkProductFidelity(input: { originalImage: Buffer; clipPath: string; workDir: string; region?: Region; thresholds?: Partial<typeof FIDELITY_THRESHOLDS> }): Promise<{ report: FidelityReport; sheet: Buffer }> {
  const limits = { ...FIDELITY_THRESHOLDS, ...input.thresholds };
  const region = input.region ?? DEFAULT_PRINT_REGION;
  await mkdir(input.workDir, { recursive: true });
  try {
    const probe = await probeMedia(input.clipPath);
    const duration = probe.durationSeconds ?? 0;
    if (!probe.video || duration <= 0) throw new Error("clipe sem vídeo");
    const original = await grayAndColor(input.originalImage, 360);
    const rx = Math.round(region.x * original.w);
    const ry = Math.round(region.y * original.h);
    const rw = Math.max(8, Math.round(region.w * original.w));
    const rh = Math.max(8, Math.round(region.h * original.h));
    const reference = crop(original, rx, ry, rw, rh);
    const referenceDetail = edgeDensity(reference.gray, rw, rh);
    const frames: FrameFidelity[] = [];
    const patches: Buffer[] = [];
    for (let k = 0; k < limits.frames; k += 1) {
      const at = Math.min(duration - 0.05, (duration * k) / Math.max(1, limits.frames - 1));
      const file = join(input.workDir, `q${k}.png`);
      const result = await runFfmpegCapture(["-y", "-ss", at.toFixed(3), "-i", input.clipPath, "-frames:v", "1", "-vf", `scale=${WORK_W * 2}:-2`, file], { timeoutMs: 30_000 });
      if (result.exitCode !== 0) throw new Error(`falha ao extrair o quadro ${k}`);
      const frame = await grayAndColor(await readFile(file), WORK_W * 2);
      // Escala da estampa no quadro desconhecida (o provedor reenquadra): busca em várias escalas.
      let best = { score: -1, x: 0, y: 0, tw: 0, th: 0, scale: 1 };
      for (const scale of [0.7, 0.85, 1, 1.15, 1.3, 1.5]) {
        const tw = Math.round(((rw / original.w) * frame.w) * scale);
        const th = Math.round(tw * (rh / rw));
        if (tw < 12 || th < 8 || tw > frame.w || th > frame.h) continue;
        const template = await resizeGray(reference.rgb, rw, rh, tw, th);
        const found = bestMatch(frame, template.gray, tw, th, 3);
        if (found.score > best.score) best = { ...found, tw, th, scale };
      }
      const reasons: string[] = [];
      let colorDelta = 255;
      let detailRatio = 0;
      if (best.score > -1) {
        const patch = crop(frame, best.x, best.y, best.tw, best.th);
        const template = await resizeGray(reference.rgb, rw, rh, best.tw, best.th);
        let delta = 0;
        for (let i = 0; i < patch.gray.length; i += 1) for (let c = 0; c < 3; c += 1) delta += Math.abs(patch.rgb[i * 3 + c]! - template.rgb[i * 3 + c]!);
        colorDelta = delta / (patch.gray.length * 3);
        detailRatio = edgeDensity(patch.gray, best.tw, best.th) / Math.max(0.001, edgeDensity(template.gray, best.tw, best.th) || referenceDetail);
        patches.push(await sharp(patch.rgb, { raw: { width: best.tw, height: best.th, channels: 3 } }).resize(200, Math.round(200 * (rh / rw)), { fit: "fill" }).png().toBuffer());
      } else patches.push(await sharp({ create: { width: 200, height: Math.round(200 * (rh / rw)), channels: 3, background: "#300" } }).png().toBuffer());
      if (best.score < limits.minStructure) reasons.push("estampa deformada ou desenho diferente");
      if (colorDelta > limits.maxColorDelta) reasons.push("cores alteradas");
      if (detailRatio < limits.minDetailRatio) reasons.push("elementos da estampa sumiram ou borraram");
      if (detailRatio > limits.maxDetailRatio) reasons.push("elementos novos na estampa");
      frames.push({ atSeconds: Math.round(at * 100) / 100, structure: Math.round(best.score * 1000) / 1000, colorDelta: Math.round(colorDelta * 10) / 10, detailRatio: Math.round(detailRatio * 100) / 100, scale: best.scale, pass: reasons.length === 0, reasons });
    }
    const worst = { structure: Math.min(...frames.map((f) => f.structure)), colorDelta: Math.max(...frames.map((f) => f.colorDelta)), detailRatio: Math.min(...frames.map((f) => f.detailRatio)) };
    const failing = frames.filter((f) => !f.pass);
    const report: FidelityReport = { verdict: failing.length ? "fail" : "pass", frames, worst, reasons: [...new Set(failing.flatMap((f) => f.reasons.map((r) => `${r} (${f.atSeconds}s)`)))].slice(0, 12), thresholds: limits };
    // Prancha: estampa original à esquerda, o que foi encontrado em cada quadro em seguida.
    const ph = Math.round(200 * (rh / rw));
    const tiles = [await sharp(reference.rgb, { raw: { width: rw, height: rh, channels: 3 } }).resize(200, ph, { fit: "fill" }).png().toBuffer(), ...patches];
    const sheet = await sharp({ create: { width: tiles.length * 206 + 6, height: ph + 12, channels: 3, background: "#111111" } })
      .composite(tiles.map((tile, index) => ({ input: tile, left: 6 + index * 206, top: 6 })))
      .jpeg({ quality: 88 }).toBuffer();
    return { report, sheet };
  } finally {
    await rm(input.workDir, { recursive: true, force: true });
  }
}

/** Adaptador para o serviço de movimento (clipe em memória → arquivo temporário → verificação). */
export function fidelityCheckIn(workRoot: string) {
  return async (input: { originalImage: Buffer; clip: Buffer; region?: Region }) => {
    const { writeFile } = await import("node:fs/promises");
    const dir = join(workRoot, `fid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(dir, { recursive: true });
    const clipPath = join(dir, "clip.mp4");
    await writeFile(clipPath, input.clip);
    return checkProductFidelity({ originalImage: input.originalImage, clipPath, workDir: dir, region: input.region });
  };
}
