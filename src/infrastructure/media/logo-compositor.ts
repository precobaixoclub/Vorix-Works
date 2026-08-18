import sharp from "sharp";

export type CompositeLogoInput = {
  imageBuffer: Buffer;
  logoBuffer: Buffer;
};

/**
 * Cola a logo real da marca sobre a imagem gerada, como um selo/watermark no canto inferior
 * direito — a técnica padrão de agência para peças de anúncio (nunca a IA "desenha" a logo, ela é
 * um arquivo real colado por cima). Sempre dentro de um cartão branco semi-opaco com cantos
 * arredondados: mesmo quando o arquivo da logo é um JPG opaco sem transparência (não um PNG com
 * fundo transparente), o resultado ainda fica limpo sobre qualquer fundo de foto, porque o cartão
 * garante contraste e uma borda previsível em vez de um retângulo colado sem acabamento.
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

  const targetLogoWidth = Math.max(48, Math.round(imageWidth * 0.14));
  const resizedLogo = await sharp(input.logoBuffer)
    .resize({ width: targetLogoWidth, fit: "inside", withoutEnlargement: false })
    .toBuffer();
  const logoMeta = await sharp(resizedLogo).metadata();
  const logoWidth = logoMeta.width ?? targetLogoWidth;
  const logoHeight = logoMeta.height ?? targetLogoWidth;

  const padding = Math.round(logoWidth * 0.18);
  const cardWidth = logoWidth + padding * 2;
  const cardHeight = logoHeight + padding * 2;
  const cornerRadius = Math.round(cardHeight * 0.16);
  const margin = Math.max(16, Math.round(imageWidth * 0.04));

  const cardLeft = imageWidth - margin - cardWidth;
  const cardTop = imageHeight - margin - cardHeight;

  const cardSvg = Buffer.from(
    `<svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${cardWidth}" height="${cardHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#ffffff" fill-opacity="0.94"/>` +
      `</svg>`,
  );
  const cardBuffer = await sharp(cardSvg).png().toBuffer();

  return baseImage
    .composite([
      { input: cardBuffer, left: Math.max(0, cardLeft), top: Math.max(0, cardTop) },
      { input: resizedLogo, left: Math.max(0, cardLeft) + padding, top: Math.max(0, cardTop) + padding },
    ])
    .png()
    .toBuffer();
}
