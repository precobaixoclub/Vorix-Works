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
  photoKind: "studio" | "scene";
  variantColorCheck?: { consistent: boolean; measured: string; expected: string; closest?: string };
}> {
  const score = await siteCaptureScore(data);
  const cutout = await cutoutProduct(data);
  // Recorte com artefato (buracos, fragmentos, halo) = foto de cena: o produto depende do ambiente.
  const photoKind = cutout.confidence >= 0.55 ? "studio" as const : "scene" as const;
  if (!variantLabel || photoKind === "scene") return { siteCaptureScore: score, photoKind };
  const onModel = cutout.bbox.y <= 2 && cutout.bbox.y + cutout.bbox.h >= cutout.height - 2;
  const candidates = onModel
    ? [await productColor(cutout)]
    : (await dominantColors(cutout.png, { k: 3 })).filter((color) => color.share >= 0.15).map((color) => color.rgb);
  const checks = candidates.map((rgb) => ({ rgb, check: checkVariantColor(variantLabel, rgb) })).filter((item) => item.check);
  if (!checks.length) return { siteCaptureScore: score, photoKind };
  const best = checks.find((item) => item.check!.consistent) ?? checks[0];
  return {
    siteCaptureScore: score, photoKind,
    variantColorCheck: { consistent: best.check!.consistent, measured: rgbHex(best.rgb), expected: best.check!.expected, closest: best.check!.closest },
  };
}
