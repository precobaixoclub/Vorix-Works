import sharp from "sharp";
import { hasRealTransparency } from "../image-processing/transparency-check.js";

export type LogoCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type LogoPlacementRect = { xPct: number; yPct: number; widthPct: number; heightPct: number };

/**
 * ETAPA 3 (Rodada 4, benchmark de qualidade criativa) — achado confirmado: a logo era SEMPRE
 * colada sobre um cartão branco semi-opaco fixo, independente do asset ou do fundo real por trás
 * — a "aparência de sticker" documentada no benchmark. Vocabulário do brief, simplificado pro que
 * é de fato implementável sem auditoria de asset (sem `logoLight`/`logoDark` reais cadastrados
 * nesta rodada — ver limitação em `docs/vorix-creative-engine-quality-fixes.md`):
 * - `direct`: a logo (com transparência real) é colada sem nenhum fundo — o ganho real de não ter
 *   mais nenhuma caixa.
 * - `subtle_scrim`: a logo (com transparência real) é colada sobre uma forma suave e discreta —
 *   usada só quando o fundo real por trás é visualmente ruidoso o bastante pra arriscar legibilidade.
 * - `card_fallback`: o comportamento histórico (cartão sólido, cor adaptada ao fundo em vez de
 *   sempre branco) — reservado para quando o arquivo da logo NÃO tem transparência real (JPEG, ou
 *   PNG "achatado") e por isso SEMPRE mostra seu próprio fundo quando colado, com ou sem cartão.
 */
export const LOGO_TREATMENTS = ["direct", "subtle_scrim", "card_fallback"] as const;
export type LogoTreatment = (typeof LOGO_TREATMENTS)[number];

export type CompositeLogoInput = {
  imageBuffer: Buffer;
  logoBuffer: Buffer;
  /** Canto onde a logo é colada. Padrão "top-left" — convenção mais comum de marca em anúncios de
   * e-commerce (o canto inferior direito é mais um padrão de "marca d'água de foto"). Ver
   * `resolveLogoCorner` em real-skill-execution-handlers.ts para como isto é decidido a partir do
   * `logoPlacement` que a Bianca já planeja. Ignorado quando `placement` está presente. */
  corner?: LogoCorner;
  /** Geometria exata do `creative_plan.assetPlacements` (migração "GPT como motor criativo
   * único", PR 4/9) — quando presente, tem prioridade sobre `corner`. Diferente do screenshot, a
   * logo continua com um fallback por canto (nunca hard-fail): errar o canto de uma logo é um
   * defeito estético menor, nunca uma interface fictícia visível. */
  placement?: LogoPlacementRect;
  /** ETAPA 3 — auditoria/telemetria: reporta qual tratamento foi de fato escolhido (nunca muda o
   * comportamento, só observa a decisão) — usado pelo motor pra registrar em `compositionSteps` e
   * pelos testes de smoke local. Best-effort, nunca lançado por causa disto. */
  onTreatmentChosen?: (treatment: LogoTreatment) => void;
};

/** Acima deste desvio-padrão de luminância, a região de fundo é considerada "ruidosa" o bastante
 * pra arriscar legibilidade de uma logo colada sem nenhum fundo — mesmo limiar de
 * `resolve-actual-safe-area.ts` (`BUSY_STDDEV_THRESHOLD`), mantido em duplicado de propósito (a
 * logo e o texto são composições independentes, nunca devem compartilhar um módulo que misture
 * as duas decisões). */
const LOGO_BUSY_STDDEV_THRESHOLD = 35;

async function computeLogoBackgroundStats(imageBuffer: Buffer, left: number, top: number, width: number, height: number): Promise<{ meanLuminance: number; stdDevLuminance: number } | undefined> {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    if (!metadata.width || !metadata.height) return undefined;
    const extractLeft = Math.max(0, Math.min(metadata.width - 1, left));
    const extractTop = Math.max(0, Math.min(metadata.height - 1, top));
    const extractWidth = Math.max(1, Math.min(metadata.width - extractLeft, width));
    const extractHeight = Math.max(1, Math.min(metadata.height - extractTop, height));
    const stats = await sharp(imageBuffer).extract({ left: extractLeft, top: extractTop, width: extractWidth, height: extractHeight }).greyscale().stats();
    const channel = stats.channels[0];
    if (!channel) return undefined;
    return { meanLuminance: channel.mean, stdDevLuminance: channel.stdev };
  } catch {
    return undefined;
  }
}

/**
 * Cola a logo real da marca sobre a imagem gerada, como um selo/watermark — a técnica padrão de
 * agência para peças de anúncio (nunca a IA "desenha" a logo, ela é um arquivo real colado por
 * cima). Tratamento ADAPTATIVO (ver `LogoTreatment`) a partir de dois dados REAIS: se o arquivo
 * tem transparência de verdade (`hasRealTransparency`) e o quão visualmente ruidoso é o fundo real
 * por trás da posição onde a logo vai cair (`computeLogoBackgroundStats`) — nunca mais um cartão
 * branco fixo independente do asset/fundo.
 *
 * Dimensões são todas calculadas a partir dos metadados REAIS da imagem baixada (nunca de um
 * tamanho hardcoded) — funciona igual não importa o `size` pedido à OpenAI.
 */
export async function compositeLogoOntoImage(input: CompositeLogoInput): Promise<Buffer> {
  const baseImage = sharp(input.imageBuffer);
  const baseMeta = await baseImage.metadata();
  const imageWidth = baseMeta.width;
  const imageHeight = baseMeta.height;
  if (!imageWidth || !imageHeight) {
    throw new Error("LOGO_COMPOSITE_IMAGE_METADATA_MISSING: não foi possível ler largura/altura da imagem gerada.");
  }

  let resizedLogo: Buffer;
  let cardWidth: number;
  let cardHeight: number;
  let cardLeft: number;
  let cardTop: number;
  let padding: number;

  if (input.placement) {
    // Migração "GPT como motor criativo único" (PR 4/9) — geometria vem do
    // `creative_plan.assetPlacements`: o cartão ocupa exatamente a área reservada pelo plano (não
    // o tamanho fixo de 14% da largura), e a logo é redimensionada pra caber dentro dela.
    const { xPct, yPct, widthPct, heightPct } = input.placement;
    cardWidth = Math.max(32, Math.round((widthPct / 100) * imageWidth));
    cardHeight = Math.max(32, Math.round((heightPct / 100) * imageHeight));
    cardLeft = Math.round((xPct / 100) * imageWidth);
    cardTop = Math.round((yPct / 100) * imageHeight);
    padding = Math.round(Math.min(cardWidth, cardHeight) * 0.18);
    resizedLogo = await sharp(input.logoBuffer)
      .resize({ width: Math.max(1, cardWidth - padding * 2), height: Math.max(1, cardHeight - padding * 2), fit: "inside", withoutEnlargement: false })
      .toBuffer();
  } else {
    const targetLogoWidth = Math.max(48, Math.round(imageWidth * 0.14));
    resizedLogo = await sharp(input.logoBuffer)
      .resize({ width: targetLogoWidth, fit: "inside", withoutEnlargement: false })
      .toBuffer();
    const logoMeta = await sharp(resizedLogo).metadata();
    const logoWidth = logoMeta.width ?? targetLogoWidth;
    const logoHeight = logoMeta.height ?? targetLogoWidth;

    padding = Math.round(logoWidth * 0.18);
    cardWidth = logoWidth + padding * 2;
    cardHeight = logoHeight + padding * 2;
    const margin = Math.max(16, Math.round(imageWidth * 0.04));

    const corner = input.corner ?? "top-left";
    cardLeft = corner.endsWith("right") ? imageWidth - margin - cardWidth : margin;
    cardTop = corner.startsWith("bottom") ? imageHeight - margin - cardHeight : margin;
  }
  cardLeft = Math.max(0, cardLeft);
  cardTop = Math.max(0, cardTop);

  const transparent = await hasRealTransparency(input.logoBuffer, "image/png").catch(() => false);
  const backgroundStats = await computeLogoBackgroundStats(input.imageBuffer, cardLeft, cardTop, cardWidth, cardHeight);
  const backgroundIsBusy = backgroundStats ? backgroundStats.stdDevLuminance > LOGO_BUSY_STDDEV_THRESHOLD : true; // sem dado confiável, assume ruidoso (tratamento mais seguro)
  const backgroundIsDark = backgroundStats ? backgroundStats.meanLuminance < 128 : false;

  const treatment: LogoTreatment = !transparent ? "card_fallback" : backgroundIsBusy ? "subtle_scrim" : "direct";
  input.onTreatmentChosen?.(treatment);

  const cornerRadius = Math.round(cardHeight * 0.16);

  if (treatment === "direct") {
    // JPEG, não PNG: a saída é uma peça publicitária fotográfica (sem necessidade de
    // transparência), e PNG é sem perdas — cada imagem saía com 3-4MB, deixando a tela de Revisão
    // lenta pra carregar com várias peças ao mesmo tempo.
    return baseImage
      .composite([{ input: resizedLogo, left: cardLeft + padding, top: cardTop + padding }])
      .flatten({ background: backgroundIsDark ? "#000000" : "#ffffff" })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  if (treatment === "subtle_scrim") {
    // Forma suave e discreta (nunca um retângulo duro de cor sólida 94% opaca): opacidade bem mais
    // baixa que o cartão histórico, cor escolhida pra contrastar com o fundo real medido — o
    // objetivo é só reduzir ruído visual atrás da logo, nunca "colar um cartão".
    const scrimColor = backgroundIsDark ? "255,255,255" : "0,0,0";
    const scrimSvg = Buffer.from(
      `<svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="${cardWidth}" height="${cardHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="rgba(${scrimColor},0.28)"/>` +
        `</svg>`,
    );
    const scrimBuffer = await sharp(scrimSvg).png().toBuffer();
    return baseImage
      .composite([
        { input: scrimBuffer, left: cardLeft, top: cardTop },
        { input: resizedLogo, left: cardLeft + padding, top: cardTop + padding },
      ])
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  // card_fallback — último recurso (arquivo sem transparência real: SEMPRE mostra seu próprio
  // fundo quando colado, com ou sem cartão por baixo). Cor do cartão ADAPTADA ao fundo medido
  // (branco sobre fundo escuro, um cartão escuro translúcido sobre fundo claro) — nunca mais
  // sempre branco independente do que está atrás.
  const cardFill = backgroundIsDark ? "#ffffff" : "#15171c";
  const cardSvg = Buffer.from(
    `<svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${cardWidth}" height="${cardHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="${cardFill}" fill-opacity="0.94"/>` +
      `</svg>`,
  );
  const cardBuffer = await sharp(cardSvg).png().toBuffer();

  return baseImage
    .composite([
      { input: cardBuffer, left: cardLeft, top: cardTop },
      { input: resizedLogo, left: cardLeft + padding, top: cardTop + padding },
    ])
    .flatten({ background: cardFill })
    .jpeg({ quality: 90 })
    .toBuffer();
}
