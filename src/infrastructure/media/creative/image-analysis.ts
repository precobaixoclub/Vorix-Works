import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * Medições de imagem do motor criativo (determinísticas, sem IA): impressão perceptual (dHash),
 * cor dominante, diferença de cor (ΔE), textura de uma região e o "quão print de tela" uma imagem
 * parece. Base do Quality Gate de fidelidade e do controle de repetição.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export function sha256Prefix(buffer: Buffer, length = 16): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, length);
}

async function regionPipeline(image: Buffer, rect?: Rect) {
  let pipeline = sharp(image).rotate();
  if (rect) {
    const meta = await sharp(image).metadata();
    const left = Math.max(0, Math.round(rect.x));
    const top = Math.max(0, Math.round(rect.y));
    const width = Math.max(1, Math.min(Math.round(rect.w), (meta.width ?? 1) - left));
    const height = Math.max(1, Math.min(Math.round(rect.h), (meta.height ?? 1) - top));
    pipeline = sharp(await sharp(image).rotate().extract({ left, top, width, height }).toBuffer());
  }
  return pipeline;
}

/** dHash 64 bits (9×8, gradiente horizontal), em hexadecimal. Pixels transparentes viram cinza médio. */
export async function dHash(image: Buffer, rect?: Rect): Promise<string> {
  const pipeline = await regionPipeline(image, rect);
  const raw = await pipeline.flatten({ background: "#808080" }).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) bits += raw[y * 9 + x] > raw[y * 9 + x + 1] ? "1" : "0";
  let hex = "";
  for (let index = 0; index < 64; index += 4) hex += parseInt(bits.slice(index, index + 4), 2).toString(16);
  return hex;
}

const toLinear = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

export function rgbToLab([r, g, b]: readonly number[]): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function deltaE(a: readonly number[], b: readonly number[]): number {
  const [la, lb] = [rgbToLab(a), rgbToLab(b)];
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

export const rgbHex = (rgb: readonly number[]) => `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/**
 * Cores dominantes (k-means simples sobre pixels opacos). Com `ignore`, descarta pixels próximos
 * dessa cor (ex.: o fundo de estúdio) antes de agrupar.
 */
export async function dominantColors(image: Buffer, options: { rect?: Rect; k?: number; ignore?: readonly number[] } = {}): Promise<Array<{ rgb: [number, number, number]; share: number }>> {
  const pipeline = await regionPipeline(image, options.rect);
  const { data, info } = await pipeline.ensureAlpha().resize(64, 64, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const pixels: number[][] = [];
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 160) continue;
    const rgb = [data[index], data[index + 1], data[index + 2]];
    if (options.ignore && Math.hypot(rgb[0] - options.ignore[0], rgb[1] - options.ignore[1], rgb[2] - options.ignore[2]) < 28) continue;
    pixels.push(rgb);
  }
  if (!pixels.length) return [];
  const k = Math.min(options.k ?? 3, pixels.length);
  let centers = Array.from({ length: k }, (_, index) => [...pixels[Math.floor((index + 0.5) * pixels.length / k)]]);
  let assignment = new Array<number>(pixels.length).fill(0);
  for (let round = 0; round < 8; round += 1) {
    assignment = pixels.map((pixel) => centers.reduce((best, center, index) => (Math.hypot(pixel[0] - center[0], pixel[1] - center[1], pixel[2] - center[2]) < Math.hypot(pixel[0] - centers[best][0], pixel[1] - centers[best][1], pixel[2] - centers[best][2]) ? index : best), 0));
    centers = centers.map((center, index) => {
      const members = pixels.filter((_, pixelIndex) => assignment[pixelIndex] === index);
      return members.length ? [0, 1, 2].map((channel) => members.reduce((sum, member) => sum + member[channel], 0) / members.length) : center;
    });
  }
  void info;
  return centers.map((center, index) => ({ rgb: center.map(Math.round) as [number, number, number], share: assignment.filter((value) => value === index).length / pixels.length }))
    .filter((item) => item.share > 0).sort((a, b) => b.share - a.share);
}

/** Textura de uma região: desvio-padrão de luminância e densidade de bordas (0–1). */
export async function textureStats(image: Buffer, rect?: Rect): Promise<{ luminanceStd: number; edgeDensity: number; mean: number }> {
  const pipeline = await regionPipeline(image, rect);
  const { data, info } = await pipeline.flatten({ background: "#000" }).greyscale().resize(256, 256, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let sum = 0;
  for (const value of data) sum += value;
  const mean = sum / data.length;
  let variance = 0;
  for (const value of data) variance += (value - mean) ** 2;
  let edges = 0;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const index = y * width + x;
      if (Math.abs(data[index] - data[index + 1]) + Math.abs(data[index] - data[index + width]) > 40) edges += 1;
    }
  }
  return { luminanceStd: Math.sqrt(variance / data.length) / 255, edgeDensity: edges / ((width - 1) * (height - 1)), mean: mean / 255 };
}

/**
 * Quão "captura de tela/site" a imagem parece (0–1). Interfaces e vitrines têm muitas bordas
 * horizontais e verticais longas e perfeitamente retas (barras, cartões, colunas) e grandes áreas
 * chapadas; fotografias de produto têm transições suaves e quase nenhuma linha reta longa.
 */
export async function siteCaptureScore(image: Buffer): Promise<number> {
  const { data, info } = await sharp(image).rotate().flatten({ background: "#fff" }).greyscale().resize(320, 320, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const at = (x: number, y: number) => data[y * width + x];
  let longRows = 0;
  for (let y = 1; y < height; y += 1) {
    let run = 0;
    let best = 0;
    for (let x = 0; x < width; x += 1) {
      if (Math.abs(at(x, y) - at(x, y - 1)) > 18) { run += 1; best = Math.max(best, run); } else run = 0;
    }
    if (best > width * 0.35) longRows += 1;
  }
  let longColumns = 0;
  for (let x = 1; x < width; x += 1) {
    let run = 0;
    let best = 0;
    for (let y = 0; y < height; y += 1) {
      if (Math.abs(at(x, y) - at(x - 1, y)) > 18) { run += 1; best = Math.max(best, run); } else run = 0;
    }
    if (best > height * 0.35) longColumns += 1;
  }
  // Áreas perfeitamente chapadas (fundo de interface) — fotos quase nunca têm 8×8 idênticos.
  let flatBlocks = 0;
  let blocks = 0;
  for (let y = 0; y + 8 <= height; y += 8) {
    for (let x = 0; x + 8 <= width; x += 8) {
      blocks += 1;
      let min = 255;
      let max = 0;
      for (let dy = 0; dy < 8; dy += 1) for (let dx = 0; dx < 8; dx += 1) { const value = at(x + dx, y + dy); min = Math.min(min, value); max = Math.max(max, value); }
      if (max - min <= 1) flatBlocks += 1;
    }
  }
  const lines = Math.min(1, (longRows + longColumns) / 14);
  const flat = Math.min(1, (flatBlocks / Math.max(1, blocks)) / 0.45);
  return Math.round((0.7 * lines + 0.3 * flat * (lines > 0.15 ? 1 : 0.4)) * 100) / 100;
}

/** Cores comerciais comuns em catálogos brasileiros (referência aproximada, sRGB). */
const NAMED_COLORS: Record<string, [number, number, number]> = {
  preto: [24, 23, 25], branco: [236, 236, 236], cinza: [140, 140, 140], bege: [228, 200, 166], marrom: [110, 60, 45], caramelo: [176, 112, 60],
  "verde-militar": [62, 86, 64], verde: [40, 140, 70], "azul-marinho": [26, 42, 69], "azul-claro": [80, 190, 220], azul: [40, 90, 180],
  vermelho: [190, 30, 40], vinho: [110, 25, 45], rosa: [235, 150, 175], amarelo: [240, 205, 50], laranja: [235, 120, 40], roxo: [110, 60, 150], lilas: [190, 160, 220],
};

const colorKey = (label: string) => label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s*-\s*logo.*$/, "").trim().replace(/\s+/g, "-");

/**
 * Confere se a foto cadastrada para uma variante mostra mesmo aquela cor (ex.: "Azul-Marinho" com
 * foto turquesa = erro de cadastro). Só para nomes conhecidos; nome desconhecido = sem opinião.
 */
export function checkVariantColor(label: string, measured: readonly number[]): { consistent: boolean; expected: string; closest: string; deltaE: number } | undefined {
  const key = colorKey(label);
  const expected = NAMED_COLORS[key];
  if (!expected) return undefined;
  const distances = Object.entries(NAMED_COLORS).map(([name, rgb]) => ({ name, value: deltaE(rgb, measured) })).sort((a, b) => a.value - b.value);
  const own = deltaE(expected, measured);
  // Coerente se a cor do nome é a mais próxima ou está razoavelmente perto (luz de estúdio varia).
  const consistent = distances[0].name === key || own <= 22 || own - distances[0].value <= 6;
  return { consistent, expected: key, closest: distances[0].name, deltaE: Math.round(own * 10) / 10 };
}
