import sharp from "sharp";
import type { Rect } from "./image-analysis.js";

/**
 * Recorte controlado do produto a partir da FOTOGRAFIA ORIGINAL — remove só o fundo de estúdio
 * conectado à borda (inundação a partir das bordas, com tolerância medida no próprio fundo) e
 * mantém os pixels da peça intactos. É o que permite compor a peça real em cenários diferentes sem
 * a IA redesenhar a estampa. Quando o fundo não é uniforme o bastante (foto de ambiente), devolve
 * `confidence` baixa e o chamador usa a foto inteira emoldurada em vez do recorte.
 */

export type ProductCutout = {
  /** PNG RGBA do produto recortado (mesmo tamanho da foto, já reduzida a `maxSide`). */
  png: Buffer;
  width: number;
  height: number;
  /** Caixa do produto (alpha > 50%) em px da foto reduzida. */
  bbox: Rect;
  /** Fração da foto ocupada pelo produto. */
  coverage: number;
  /** 0–1: quão confiável é o recorte (fundo uniforme e produto de tamanho plausível). */
  confidence: number;
  background: [number, number, number];
  /** Foto reduzida original (sem recorte), para composições emolduradas. */
  photo: Buffer;
};

export async function cutoutProduct(image: Buffer, options: { maxSide?: number } = {}): Promise<ProductCutout> {
  const maxSide = options.maxSide ?? 1400;
  const photo = await sharp(image).rotate().resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const { data, info } = await sharp(photo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const total = width * height;
  const border: number[] = [];
  for (let x = 0; x < width; x += 1) border.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y += 1) border.push(y * width, y * width + width - 1);

  // Foto já com transparência real na borda: usa o alpha original.
  const transparentBorder = border.filter((pixel) => data[pixel * 4 + 3] < 20).length / border.length;
  let background: [number, number, number] = [255, 255, 255];
  let uniformity = 1;
  if (transparentBorder < 0.6) {
    const opaque = border.filter((pixel) => data[pixel * 4 + 3] > 200);
    const median = [0, 1, 2].map((channel) => opaque.map((pixel) => data[pixel * 4 + channel]).sort((a, b) => a - b)[Math.floor(opaque.length / 2)] ?? 255) as [number, number, number];
    background = median;
    const distance = (pixel: number) => Math.hypot(data[pixel * 4] - median[0], data[pixel * 4 + 1] - median[1], data[pixel * 4 + 2] - median[2]);
    const borderDistances = opaque.map(distance).sort((a, b) => a - b);
    const close = borderDistances.filter((value) => value < 30).length;
    uniformity = close / Math.max(1, opaque.length);
    // Tolerância: o "ruído" do próprio fundo (gradiente de luz do estúdio) + folga.
    const p60 = borderDistances[Math.floor(borderDistances.length * 0.6)] ?? 0;
    const threshold = Math.max(18, Math.min(46, p60 * 1.6 + 14));
    const visited = new Uint8Array(total);
    const stack = opaque.filter((pixel) => distance(pixel) < threshold);
    for (const pixel of stack) visited[pixel] = 1;
    while (stack.length) {
      const pixel = stack.pop()!;
      const d = distance(pixel);
      // Borda suave: quanto mais perto do limite, mais o pixel mantém de opacidade.
      data[pixel * 4 + 3] = Math.round(Math.max(0, Math.min(1, (d - threshold * 0.55) / (threshold * 0.45))) * data[pixel * 4 + 3]);
      const x = pixel % width;
      for (const next of [x > 0 ? pixel - 1 : -1, x < width - 1 ? pixel + 1 : -1, pixel - width, pixel + width]) {
        if (next >= 0 && next < total && !visited[next] && distance(next) < threshold) { visited[next] = 1; stack.push(next); }
      }
    }
  }
  // Alpha levemente suavizado na borda (sem "serrilhado" de recorte).
  const alpha = Buffer.alloc(total);
  for (let pixel = 0; pixel < total; pixel += 1) alpha[pixel] = data[pixel * 4 + 3];
  const softAlpha = await sharp(alpha, { raw: { width, height, channels: 1 } }).blur(0.8).extractChannel(0).raw().toBuffer();
  let count = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let pixel = 0; pixel < total; pixel += 1) {
    const value = Math.min(data[pixel * 4 + 3], softAlpha[pixel]);
    data[pixel * 4 + 3] = value;
    if (value > 128) {
      count += 1;
      const x = pixel % width;
      const y = (pixel - x) / width;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const coverage = count / total;
  const plausible = coverage > 0.08 && coverage < 0.9 ? 1 : 0.2;
  const confidence = Math.round(Math.min(1, (transparentBorder >= 0.6 ? 1 : uniformity / 0.7)) * plausible * 100) / 100;
  const png = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { png, width, height, bbox: count ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : { x: 0, y: 0, w: width, h: height }, coverage, confidence, background, photo };
}

/**
 * Região da estampa numa peça de vestuário: pixels do tronco que fogem da cor dominante do tecido.
 * Procura só na janela central do tronco (onde fica a estampa frontal); sem estampa clara, devolve a
 * janela do peito inteira.
 */
export async function locatePrint(cutout: ProductCutout): Promise<Rect> {
  const { data } = await sharp(cutout.png).raw().toBuffer({ resolveWithObject: true });
  const { width, bbox } = cutout;
  const window = { x: bbox.x + bbox.w * 0.22, y: bbox.y + bbox.h * 0.16, w: bbox.w * 0.56, h: bbox.h * 0.44 };
  const pixels: Array<[number, number, number, number, number]> = [];
  for (let y = Math.round(window.y); y < window.y + window.h; y += 2) {
    for (let x = Math.round(window.x); x < window.x + window.w; x += 2) {
      const index = (y * width + x) * 4;
      if (data[index + 3] > 200) pixels.push([data[index], data[index + 1], data[index + 2], x, y]);
    }
  }
  if (pixels.length < 50) return window;
  // Cor do tecido = mediana por canal (o tecido domina a janela).
  const fabric = [0, 1, 2].map((channel) => pixels.map((pixel) => pixel[channel]).sort((a, b) => a - b)[Math.floor(pixels.length / 2)]);
  const off = pixels.filter((pixel) => Math.hypot(pixel[0] - fabric[0], pixel[1] - fabric[1], pixel[2] - fabric[2]) > 42);
  if (off.length < pixels.length * 0.01) return window;
  const xs = off.map((pixel) => pixel[3]).sort((a, b) => a - b);
  const ys = off.map((pixel) => pixel[4]).sort((a, b) => a - b);
  const q = (values: number[], fraction: number) => values[Math.min(values.length - 1, Math.floor(values.length * fraction))];
  const x0 = q(xs, 0.02);
  const x1 = q(xs, 0.98);
  const y0 = q(ys, 0.02);
  const y1 = q(ys, 0.98);
  const pad = Math.max(x1 - x0, y1 - y0) * 0.18 + 12;
  return { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), w: Math.min(cutout.width, x1 - x0 + 2 * pad), h: Math.min(cutout.height, y1 - y0 + 2 * pad) };
}

/** Cor comercial do produto: mediana dos pixels do miolo do recorte (tronco, no vestuário). */
export async function productColor(cutout: ProductCutout): Promise<[number, number, number]> {
  const { data } = await sharp(cutout.png).raw().toBuffer({ resolveWithObject: true });
  const { bbox, width } = cutout;
  const channels: number[][] = [[], [], []];
  for (let y = Math.round(bbox.y + bbox.h * 0.45); y < bbox.y + bbox.h * 0.65; y += 3) {
    for (let x = Math.round(bbox.x + bbox.w * 0.3); x < bbox.x + bbox.w * 0.7; x += 3) {
      const index = (y * width + x) * 4;
      if (data[index + 3] > 200) for (const channel of [0, 1, 2]) channels[channel].push(data[index + channel]);
    }
  }
  return channels.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0) as [number, number, number];
}
