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
