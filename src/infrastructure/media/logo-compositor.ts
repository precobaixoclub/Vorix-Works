import sharp from "sharp";

export type LogoCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type LogoPlacementRect = { xPct: number; yPct: number; widthPct: number; heightPct: number };

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
};

/**
 * Cola a logo real da marca sobre a imagem gerada, como um selo/watermark — a técnica padrão de
 * agência para peças de anúncio (nunca a IA "desenha" a logo, ela é um arquivo real colado por
 * cima). Sempre dentro de um cartão branco semi-opaco com cantos arredondados: mesmo quando o
 * arquivo da logo é um JPG opaco sem transparência (não um PNG com fundo transparente), o
 * resultado ainda fica limpo sobre qualquer fundo de foto, porque o cartão garante contraste e uma
 * borda previsível em vez de um retângulo colado sem acabamento.
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

  const cornerRadius = Math.round(cardHeight * 0.16);

  const cardSvg = Buffer.from(
    `<svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${cardWidth}" height="${cardHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#ffffff" fill-opacity="0.94"/>` +
      `</svg>`,
  );
  const cardBuffer = await sharp(cardSvg).png().toBuffer();

  // JPEG, não PNG: a saída é uma peça publicitária fotográfica (sem necessidade de transparência),
  // e PNG é sem perdas — cada imagem saía com 3-4MB, deixando a tela de Revisão lenta pra carregar
  // com várias peças ao mesmo tempo. `flatten` garante fundo branco caso sobre algum canal alpha
  // residual em vez de compor sobre preto (padrão do sharp ao descartar transparência).
  return baseImage
    .composite([
      { input: cardBuffer, left: Math.max(0, cardLeft), top: Math.max(0, cardTop) },
      { input: resizedLogo, left: Math.max(0, cardLeft) + padding, top: Math.max(0, cardTop) + padding },
    ])
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90 })
    .toBuffer();
}
