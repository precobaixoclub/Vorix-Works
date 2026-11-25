import { checkVariantColor, dominantColors, rgbHex, siteCaptureScore } from "./image-analysis.js";
import { cutoutProduct, productColor } from "./product-cutout.js";

/**
 * Sinais de uma foto de catálogo antes de ela virar referência: parece captura de tela/site? A cor
 * da peça bate com o nome da variante? (Auditoria 25/11/2026: a variante "Azul-Marinho" do modelo
 * 000033 da CMKV tem foto turquesa — anunciar com ela mostraria a cor errada.)
 *
 * - Peça vestida por modelo (recorte encosta no topo e na base da foto): mede o tecido no tronco.
 * - Outros produtos: a foto é coerente se alguma cor dominante relevante do recorte bate com o nome.
 * - Recorte pouco confiável (foto de ambiente): não opina, em vez de bloquear sem motivo.
 */
export async function catalogPhotoSignals(data: Buffer, variantLabel?: string): Promise<{
  siteCaptureScore: number;
  variantColorCheck?: { consistent: boolean; measured: string; expected: string; closest?: string };
}> {
  const score = await siteCaptureScore(data);
  if (!variantLabel) return { siteCaptureScore: score };
  const cutout = await cutoutProduct(data);
  if (cutout.confidence < 0.55) return { siteCaptureScore: score };
  const onModel = cutout.bbox.y <= 2 && cutout.bbox.y + cutout.bbox.h >= cutout.height - 2;
  const candidates = onModel
    ? [await productColor(cutout)]
    : (await dominantColors(cutout.png, { k: 3 })).filter((color) => color.share >= 0.15).map((color) => color.rgb);
  const checks = candidates.map((rgb) => ({ rgb, check: checkVariantColor(variantLabel, rgb) })).filter((item) => item.check);
  if (!checks.length) return { siteCaptureScore: score };
  const best = checks.find((item) => item.check!.consistent) ?? checks[0];
  return {
    siteCaptureScore: score,
    variantColorCheck: { consistent: best.check!.consistent, measured: rgbHex(best.rgb), expected: best.check!.expected, closest: best.check!.closest },
  };
}
