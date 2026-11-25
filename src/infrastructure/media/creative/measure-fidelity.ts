import sharp from "sharp";
import { deltaE, dHash, dominantColors, rgbHex, textureStats, type Rect } from "./image-analysis.js";
import { cutoutProduct, locatePrint } from "./product-cutout.js";
import { hammingHex, type VisualFingerprint } from "../../../application/creative-engine/visual-variety.js";

/**
 * Medições do Quality Gate sobre a ARTE FINAL — o que o gate usa para decidir fidelidade.
 * Produto gerado pela IA (edição com referência): compara a região do produto na arte com a foto
 * original (forma, cor do tecido e estampa na mesma posição relativa). Tela: vazio/textura da área.
 */

async function medianColor(image: Buffer, rect: Rect): Promise<[number, number, number]> {
  const meta = await sharp(image).metadata();
  const left = Math.max(0, Math.round(rect.x));
  const top = Math.max(0, Math.round(rect.y));
  const width = Math.max(1, Math.min(Math.round(rect.w), (meta.width ?? 1) - left));
  const height = Math.max(1, Math.min(Math.round(rect.h), (meta.height ?? 1) - top));
  const { data } = await sharp(image).extract({ left, top, width, height }).ensureAlpha().resize(40, 40, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const channels: number[][] = [[], [], []];
  for (let index = 0; index < data.length; index += 4) if (data[index + 3] > 200) for (const channel of [0, 1, 2]) channels[channel].push(data[index + channel]);
  return channels.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0) as [number, number, number];
}

/** Janela do tecido (tronco) relativa à caixa do produto — onde a cor comercial é medida. */
const torso = (box: Rect): Rect => ({ x: box.x + box.w * 0.3, y: box.y + box.h * 0.45, w: box.w * 0.4, h: box.h * 0.2 });

export type ProductFidelityMeasure = { shapeDistance: number; colorDeltaE: number; printDistance: number; referenceColor: string; outputColor: string };

/**
 * Compara a foto original do produto com a região do produto numa arte gerada pela IA. A região
 * vem do gerador (áreas protegidas `product`) — se ela estiver errada, as distâncias sobem e a peça
 * é reprovada (na dúvida, recompõe com a foto original).
 */
export async function measureProductFidelity(reference: Buffer, output: Buffer, productRect: Rect): Promise<ProductFidelityMeasure> {
  const cutout = await cutoutProduct(reference);
  const box = cutout.bbox;
  const referenceCrop = await sharp(cutout.png).extract({ left: box.x, top: box.y, width: box.w, height: box.h }).png().toBuffer();
  const outputMeta = await sharp(output).metadata();
  const rect = {
    x: Math.max(0, productRect.x), y: Math.max(0, productRect.y),
    w: Math.min(productRect.w, (outputMeta.width ?? 0) - Math.max(0, productRect.x)), h: Math.min(productRect.h, (outputMeta.height ?? 0) - Math.max(0, productRect.y)),
  };
  const outputCrop = await sharp(output).extract({ left: Math.round(rect.x), top: Math.round(rect.y), width: Math.max(1, Math.round(rect.w)), height: Math.max(1, Math.round(rect.h)) }).png().toBuffer();
  const shapeDistance = hammingHex(await dHash(referenceCrop), await dHash(outputCrop));
  const referenceColor = await medianColor(cutout.png, torso(box));
  const outputColor = await medianColor(output, torso(rect));
  const print = await locatePrint(cutout);
  const relative = { x: (print.x - box.x) / box.w, y: (print.y - box.y) / box.h, w: print.w / box.w, h: print.h / box.h };
  const outputPrint = { x: rect.x + relative.x * rect.w, y: rect.y + relative.y * rect.h, w: relative.w * rect.w, h: relative.h * rect.h };
  const printDistance = hammingHex(await dHash(cutout.photo, print), await dHash(output, outputPrint));
  return { shapeDistance, colorDeltaE: deltaE(referenceColor, outputColor), printDistance, referenceColor: rgbHex(referenceColor), outputColor: rgbHex(outputColor) };
}

export async function measureScreen(output: Buffer, screenRect: Rect): Promise<{ luminanceStd: number; edgeDensity: number }> {
  const stats = await textureStats(output, screenRect);
  return { luminanceStd: Math.round(stats.luminanceStd * 1000) / 1000, edgeDensity: Math.round(stats.edgeDensity * 1000) / 1000 };
}

export async function fingerprintArt(output: Buffer, meta: Omit<VisualFingerprint, "dHash" | "palette">): Promise<VisualFingerprint> {
  const colors = await dominantColors(output, { k: 3 });
  return { ...meta, dHash: await dHash(output), palette: colors.map((color) => rgbHex(color.rgb)) };
}

/**
 * Localiza o produto numa imagem gerada pela cor comercial da foto original (o modelo de imagem não diz
 * onde desenhou a peça): maior região contínua com cor próxima do tecido. Devolve a caixa em px, ou
 * `undefined` quando não há região plausível — e aí a fidelidade fica inconclusiva (reprova).
 */
export async function locateProductByColor(image: Buffer, fabric: readonly number[], options: { maxDeltaE?: number } = {}): Promise<Rect | undefined> {
  const colorDistance = deltaE;
  const { data, info } = await sharp(image).removeAlpha().resize(216, 270, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const meta = await sharp(image).metadata();
  const mask = new Uint8Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (colorDistance([data[pixel * 3], data[pixel * 3 + 1], data[pixel * 3 + 2]], fabric) <= (options.maxDeltaE ?? 16)) mask[pixel] = 1;
  }
  const seen = new Uint8Array(width * height);
  let best: { size: number; x0: number; y0: number; x1: number; y1: number } | undefined;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const box = { size: 0, x0: width, y0: height, x1: 0, y1: 0 };
    while (stack.length) {
      const pixel = stack.pop()!;
      const x = pixel % width;
      const y = (pixel - x) / width;
      box.size += 1;
      box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x); box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
      for (const next of [x > 0 ? pixel - 1 : -1, x < width - 1 ? pixel + 1 : -1, pixel - width, pixel + width]) {
        if (next >= 0 && next < mask.length && mask[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
      }
    }
    if (!best || box.size > best.size) best = box;
  }
  if (!best || best.size < width * height * 0.03) return undefined;
  const sx = (meta.width ?? width) / width;
  const sy = (meta.height ?? height) / height;
  return { x: best.x0 * sx, y: best.y0 * sy, w: (best.x1 - best.x0 + 1) * sx, h: (best.y1 - best.y0 + 1) * sy };
}
