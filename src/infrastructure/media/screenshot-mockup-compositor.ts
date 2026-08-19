import sharp from "sharp";

export type ScreenshotMockupFrame = "phone" | "laptop";

export type CompositeScreenshotInput = {
  imageBuffer: Buffer;
  screenshotBuffer: Buffer;
  frame?: ScreenshotMockupFrame;
};

/**
 * Protótipo Paralelo — GPT/OpenAI como motor criativo principal (`scripts/run-gpt-creative-
 * prototype.mjs`). Cola o screenshot REAL de um site/app dentro de um frame simples (retângulo
 * arredondado — nunca um mockup 3D fotorrealista, fora de escopo deste protótipo), como pixels
 * reais por cima da imagem gerada — mesma técnica de `compositeLogoOntoImage`
 * (`logo-compositor.ts`), pelo mesmo motivo: um modelo generativo redesenhando uma interface real
 * perde fidelidade de texto pequeno (preços, nomes de produto, botões), que é exatamente o que
 * este protótipo promete preservar. Dimensões sempre calculadas a partir dos metadados REAIS das
 * duas imagens, nunca de um tamanho hardcoded.
 */
export async function compositeScreenshotIntoDeviceMockup(input: CompositeScreenshotInput): Promise<Buffer> {
  const baseImage = sharp(input.imageBuffer);
  const baseMeta = await baseImage.metadata();
  const imageWidth = baseMeta.width;
  const imageHeight = baseMeta.height;
  if (!imageWidth || !imageHeight) {
    throw new Error("SCREENSHOT_COMPOSITE_IMAGE_METADATA_MISSING: não foi possível ler largura/altura da imagem gerada.");
  }

  const frame = input.frame ?? "phone";
  // Celular: retrato, ocupa a região central-inferior (onde o Pedro deixou espaço, por instrução
  // do prompt derivado do creative_plan). Notebook: paisagem, um pouco mais largo e mais alto na
  // composição.
  const mockupWidth = frame === "phone" ? Math.round(imageWidth * 0.42) : Math.round(imageWidth * 0.62);
  const mockupHeight = frame === "phone" ? Math.round(imageHeight * 0.62) : Math.round(mockupWidth * 0.64);
  const bezel = Math.max(6, Math.round(mockupWidth * 0.035));
  const cornerRadius = frame === "phone" ? Math.round(mockupWidth * 0.12) : Math.round(mockupWidth * 0.04);
  const screenWidth = mockupWidth - bezel * 2;
  const screenHeight = mockupHeight - bezel * 2;

  const resizedScreenshot = await sharp(input.screenshotBuffer)
    .resize({ width: screenWidth, height: screenHeight, fit: "cover", position: "top" })
    .toBuffer();

  const deviceFrameSvg = Buffer.from(
    `<svg width="${mockupWidth}" height="${mockupHeight}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${mockupWidth}" height="${mockupHeight}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#0a0a0a"/>` +
      `</svg>`,
  );
  const deviceFrameBuffer = await sharp(deviceFrameSvg).png().toBuffer();

  const screenMaskSvg = Buffer.from(
    `<svg width="${screenWidth}" height="${screenHeight}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${screenWidth}" height="${screenHeight}" rx="${Math.max(0, cornerRadius - bezel)}" ry="${Math.max(0, cornerRadius - bezel)}" fill="#ffffff"/>` +
      `</svg>`,
  );
  const screenMaskBuffer = await sharp(screenMaskSvg).png().toBuffer();
  const maskedScreenshot = await sharp(resizedScreenshot)
    .composite([{ input: screenMaskBuffer, blend: "dest-in" }])
    .png()
    .toBuffer();

  const mockupComposed = await sharp(deviceFrameBuffer)
    .composite([{ input: maskedScreenshot, left: bezel, top: bezel }])
    .png()
    .toBuffer();

  const left = Math.round((imageWidth - mockupWidth) / 2);
  const top = Math.round(imageHeight * (frame === "phone" ? 0.3 : 0.34));

  return baseImage
    .composite([{ input: mockupComposed, left: Math.max(0, left), top: Math.max(0, top) }])
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90 })
    .toBuffer();
}
