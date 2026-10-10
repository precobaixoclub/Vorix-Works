import sharp from "sharp";
import { rgbDistance, rgbToHex, type Rgb } from "../../shared/utils/brand-identity.js";

/**
 * Paleta dominante de uma logo, determinística (pixels, sem IA, sem OCR). Ignora pixels
 * transparentes; agrupa tons próximos. Usada só para SUGERIR cores ao usuário — nunca grava.
 */
export async function extractLogoPalette(buffer: Buffer, maxColors = 5): Promise<{ hex: string; share: number }[]> {
  const { data, info } = await sharp(buffer).ensureAlpha().resize(160, 160, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  let visible = 0;
  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 4;
    if (data[offset + 3]! < 128) continue;
    visible += 1;
    const r = data[offset]!;
    const g = data[offset + 1]!;
    const b = data[offset + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  if (visible === 0) return [];
  const merged: { c: Rgb; count: number }[] = [];
  for (const bucket of [...buckets.values()].sort((a, b) => b.count - a.count)) {
    const c = { r: bucket.r / bucket.count, g: bucket.g / bucket.count, b: bucket.b / bucket.count };
    const near = merged.find((item) => rgbDistance(item.c, c) < 48);
    if (near) {
      const total = near.count + bucket.count;
      near.c = { r: (near.c.r * near.count + c.r * bucket.count) / total, g: (near.c.g * near.count + c.g * bucket.count) / total, b: (near.c.b * near.count + c.b * bucket.count) / total };
      near.count = total;
    } else {
      merged.push({ c, count: bucket.count });
    }
  }
  return merged
    .sort((a, b) => b.count - a.count)
    .filter((item) => item.count / visible >= 0.01)
    .slice(0, maxColors)
    .map((item) => ({ hex: rgbToHex(item.c), share: item.count / visible }));
}
