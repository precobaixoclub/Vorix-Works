import sharp from "sharp";
import type { CreativePlanRect } from "../../shared/utils/gpt-creative-plan.types.js";

/**
 * Rodada 4 (ETAPA 3, benchmark de qualidade criativa) — medida DETERMINÍSTICA e gratuita (sem
 * chamada de IA) do fundo real de uma região retangular (percentual do canvas) de uma imagem já
 * gerada. Usada tanto para a logo (escolher tratamento adaptativo) quanto para zonas de texto
 * (escolher backing/contraste real em vez de confiar só na instrução estática do plano) — nunca
 * assume branco/preto fixo (achado do brief: "não assumir branco/preto fixo").
 */
export type RegionPixelStats = {
  /** 0 (preto) a 255 (branco) — luminância média (tons de cinza) da região. */
  meanLuminance: number;
  /** Desvio padrão da luminância — proxy de "complexidade visual"/ruído da região: um valor baixo
   * é uma região lisa (céu, parede, fundo sólido); um valor alto é uma região com muito detalhe
   * (textura, múltiplos objetos, texto). */
  stdDevLuminance: number;
};

function clampRectToImageBounds(rect: CreativePlanRect, imageWidth: number, imageHeight: number): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.min(imageWidth - 1, Math.round((rect.xPct / 100) * imageWidth)));
  const top = Math.max(0, Math.min(imageHeight - 1, Math.round((rect.yPct / 100) * imageHeight)));
  const width = Math.max(1, Math.min(imageWidth - left, Math.round((rect.widthPct / 100) * imageWidth)));
  const height = Math.max(1, Math.min(imageHeight - top, Math.round((rect.heightPct / 100) * imageHeight)));
  return { left, top, width, height };
}

/** Nunca lança — uma falha de leitura (metadados ausentes, região degenerada) devolve `undefined`,
 * tratado pelos chamadores como "sem dado confiável" (mesmo princípio best-effort do resto do
 * motor). */
export async function computeRegionPixelStats(imageBuffer: Buffer, rect: CreativePlanRect): Promise<RegionPixelStats | undefined> {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    if (!metadata.width || !metadata.height) return undefined;
    const extractRect = clampRectToImageBounds(rect, metadata.width, metadata.height);
    const stats = await sharp(imageBuffer).extract(extractRect).greyscale().stats();
    const channel = stats.channels[0];
    if (!channel) return undefined;
    return { meanLuminance: channel.mean, stdDevLuminance: channel.stdev };
  } catch {
    return undefined;
  }
}

/** Recorta e aplica blur gaussiano numa região retangular (percentual do canvas), devolvendo a
 * imagem completa com SÓ aquela região borrada — usado pra neutralizar texto fantasma/fundo
 * confuso ANTES de desenhar texto determinístico por cima (`LOCAL_BLUR`, ver
 * `resolve-actual-safe-area.ts`). Nunca lança — falha devolve o buffer original intacto (never
 * worse than not blurring). */
export async function applyLocalBlur(imageBuffer: Buffer, rect: CreativePlanRect, sigma = 18): Promise<Buffer> {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    if (!metadata.width || !metadata.height) return imageBuffer;
    const extractRect = clampRectToImageBounds(rect, metadata.width, metadata.height);
    const blurredRegion = await sharp(imageBuffer).extract(extractRect).blur(sigma).toBuffer();
    return await sharp(imageBuffer)
      .composite([{ input: blurredRegion, left: extractRect.left, top: extractRect.top }])
      .toBuffer();
  } catch {
    return imageBuffer;
  }
}
