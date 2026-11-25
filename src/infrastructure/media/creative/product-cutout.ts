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
  /** Qualidade do recorte medida no resultado (buracos, fragmentos, halo, resto de fundo). */
  quality: CutoutQuality;
};

/**
 * Qualidade do recorte, medida no RESULTADO (não só na borda da foto). Correção 25/11/2026: o relógio
 * em fundo escuro saía com "confiança 1" porque a borda era uniforme, mas a inundação comia as partes
 * escuras do próprio produto (buracos na pulseira) e mantinha um bloco do fundo. Agora:
 * - `interiorHoles`: fração transparente no miolo do produto (produto comido pelo recorte);
 * - `fragments`: pedaços opacos relevantes além do principal (recorte esfarelado);
 * - `edgeNoise`: pixels semitransparentes por pixel opaco (halo/granulado de fundo);
 * - `residualBackground`: pixels mantidos com a cor do fundo (bloco de fundo que ficou).
 */
export type CutoutQuality = { ok: boolean; interiorHoles: number; fragments: number; edgeNoise: number; residualBackground: number; reasons: string[] };

// Medido em 64 fotos reais (25/11/2026): estúdio da CMKV = buracos 0, fragmentos 0, halo ≤ 0,035; fotos de
// cena (relógio, perfume, tênis…) = buracos 5–92%, até 6 fragmentos, halo 0,10–1,06. "Resto de fundo" sozinho
// não decide (camiseta bege/branca tem cor próxima do cinza do estúdio): só barra o caso extremo.
export const CUTOUT_LIMITS = { interiorHoles: 0.04, fragments: 1, edgeNoise: 0.08, residualBackground: 0.5 } as const;

function assessCutout(alpha: Uint8Array | Buffer, rgba: Buffer, width: number, height: number, bbox: Rect, background: readonly number[], threshold: number): CutoutQuality {
  // Miolo do produto: janela central da caixa — num recorte correto, é opaca.
  let holes = 0;
  let inner = 0;
  for (let y = Math.round(bbox.y + bbox.h * 0.3); y < bbox.y + bbox.h * 0.7; y += 2) {
    for (let x = Math.round(bbox.x + bbox.w * 0.3); x < bbox.x + bbox.w * 0.7; x += 2) {
      inner += 1;
      if (alpha[y * width + x] < 128) holes += 1;
    }
  }
  // Fragmentos: componentes opacos (máscara reduzida) com área relevante.
  const step = Math.max(1, Math.round(Math.max(width, height) / 260));
  const gw = Math.ceil(width / step);
  const gh = Math.ceil(height / step);
  const grid = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y += 1) for (let x = 0; x < gw; x += 1) grid[y * gw + x] = alpha[Math.min(height - 1, y * step) * width + Math.min(width - 1, x * step)] >= 128 ? 1 : 0;
  const seen = new Uint8Array(gw * gh);
  const sizes: number[] = [];
  for (let start = 0; start < grid.length; start += 1) {
    if (!grid[start] || seen[start]) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cell = stack.pop()!;
      size += 1;
      const x = cell % gw;
      for (const next of [x > 0 ? cell - 1 : -1, x < gw - 1 ? cell + 1 : -1, cell - gw, cell + gw]) {
        if (next >= 0 && next < grid.length && grid[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
      }
    }
    sizes.push(size);
  }
  sizes.sort((a, b) => b - a);
  const fragments = sizes.slice(1).filter((size) => size >= grid.length * 0.003).length;
  // Halo/granulado e resto de fundo.
  let soft = 0;
  let opaque = 0;
  let kept = 0;
  let residual = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const value = alpha[pixel];
    if (value > 20 && value < 235) soft += 1;
    if (value >= 235) opaque += 1;
    if (value >= 128) {
      kept += 1;
      const index = pixel * 4;
      if (Math.hypot(rgba[index] - background[0], rgba[index + 1] - background[1], rgba[index + 2] - background[2]) < threshold * 1.15) residual += 1;
    }
  }
  const quality = {
    interiorHoles: Math.round((holes / Math.max(1, inner)) * 1000) / 1000,
    fragments,
    edgeNoise: Math.round((soft / Math.max(1, opaque)) * 1000) / 1000,
    residualBackground: Math.round((residual / Math.max(1, kept)) * 1000) / 1000,
  };
  const reasons = [
    ...(quality.interiorHoles > CUTOUT_LIMITS.interiorHoles ? [`recorte comeu ${Math.round(quality.interiorHoles * 100)}% do miolo do produto`] : []),
    ...(quality.fragments > CUTOUT_LIMITS.fragments ? [`recorte esfarelado em ${quality.fragments + 1} pedaços`] : []),
    ...(quality.edgeNoise > CUTOUT_LIMITS.edgeNoise ? [`halo/granulado de fundo na borda (${quality.edgeNoise})`] : []),
    ...(quality.residualBackground > CUTOUT_LIMITS.residualBackground ? [`${Math.round(quality.residualBackground * 100)}% do que ficou é cor de fundo (bloco de fundo)`] : []),
  ];
  return { ok: reasons.length === 0, ...quality, reasons };
}

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
  let threshold = 24;
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
    threshold = Math.max(18, Math.min(46, p60 * 1.6 + 14));
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
  const bbox = count ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : { x: 0, y: 0, w: width, h: height };
  const finalAlpha = Buffer.alloc(total);
  for (let pixel = 0; pixel < total; pixel += 1) finalAlpha[pixel] = data[pixel * 4 + 3];
  const quality = transparentBorder >= 0.6
    ? { ok: true, interiorHoles: 0, fragments: 0, edgeNoise: 0, residualBackground: 0, reasons: [] }
    : assessCutout(finalAlpha, data, width, height, bbox, background, threshold);
  // Recorte com artefato nunca é "confiável": a composição usa a foto original inteira.
  const confidence = Math.round(Math.min(1, (transparentBorder >= 0.6 ? 1 : uniformity / 0.7)) * plausible * (quality.ok ? 1 : 0.3) * 100) / 100;
  const png = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { png, width, height, bbox, coverage, confidence, background, photo, quality };
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
