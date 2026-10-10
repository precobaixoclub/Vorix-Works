import sharp from "sharp";

export type ImageAlphaCoverage = {
  hasAlphaChannel: boolean;
  /** alfa <= 16 (praticamente invisível). */
  transparentRatio: number;
  /** 16 < alfa < 240 (bordas suaves, véus parciais). */
  semiTransparentRatio: number;
  /** alfa >= 240. */
  opaqueRatio: number;
};

/** Cobertura de alfa de uma imagem decodificada (sem IA). Imagem sem canal alfa = 100% opaca. */
export async function measureImageAlphaCoverage(buffer: Buffer): Promise<ImageAlphaCoverage> {
  const meta = await sharp(buffer).metadata();
  if (!meta.hasAlpha) return { hasAlphaChannel: false, transparentRatio: 0, semiTransparentRatio: 0, opaqueRatio: 1 };
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const total = info.width * info.height;
  let transparent = 0;
  let semi = 0;
  for (let index = info.channels - 1; index < data.length; index += info.channels) {
    const alpha = data[index]!;
    if (alpha <= 16) transparent += 1;
    else if (alpha < 240) semi += 1;
  }
  const round = (value: number): number => Number(value.toFixed(4));
  return {
    hasAlphaChannel: true,
    transparentRatio: round(transparent / total),
    semiTransparentRatio: round(semi / total),
    opaqueRatio: round((total - transparent - semi) / total),
  };
}

/**
 * Versão OPACA de uma imagem para leitura por visão: transparência achatada sobre cinza neutro, em
 * JPEG. Achado do benchmark final: bases PNG com alfa (recortes do modelo de imagem) levavam o
 * gpt-4o a RECUSAR a leitura de texto ("I'm sorry, I can't assist with that.") de forma
 * determinística; achatadas sobre cinza, a mesma base é lida normalmente. Pixels transparentes
 * nunca aparecem na peça (o renderer desenha por cima), e texto da base só existe nos pixels opacos —
 * a leitura continua sendo da mesma base. Imagem já opaca: só recodifica.
 */
export async function flattenImageForVision(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).flatten({ background: "#808080" }).jpeg({ quality: 90 }).toBuffer();
}
