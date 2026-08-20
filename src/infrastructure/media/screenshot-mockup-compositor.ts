import sharp from "sharp";

export type ScreenshotMockupFrame = "phone" | "laptop";

export type ScreenshotPlacementRect = { xPct: number; yPct: number; widthPct: number; heightPct: number };

export type CompositeScreenshotInput = {
  imageBuffer: Buffer;
  screenshotBuffer: Buffer;
  /** Geometria exata decidida pelo `creative_plan` ANTES da geração (ver
   * `CreativePlanAssetPlacement`, `gpt-creative-plan.types.ts`) — OBRIGATÓRIA de propósito.
   * Migração "GPT como motor criativo único" (PR 4/9): antes desta mudança, o compositor colava
   * numa posição fixa (30-34% do topo, 42-62% da largura), totalmente desconectada de onde o
   * modelo de imagem realmente desenhou o dispositivo/cenário — risco real de sobrepor, em vez de
   * esconder, uma interface fictícia que o modelo alucinou na região errada. */
  placement: ScreenshotPlacementRect;
  frame?: ScreenshotMockupFrame;
};

/** Abaixo disto, texto de uma interface real fica ilegível — colar um screenshot verdadeiro numa
 * área menor que isso é pior que não colar nada. */
const MIN_SCREEN_DIMENSION_PX = 200;

/** Desvio máximo tolerado entre a proporção do screenshot real e a área reservada antes de
 * `fit: "cover"` mutilar a interface real o bastante pra ser pior que a alternativa (hard fail). */
const MAX_ASPECT_RATIO_DEVIATION = 0.4;

/**
 * Cola o screenshot REAL de um site/app dentro de um frame simples (retângulo arredondado —
 * nunca um mockup 3D fotorrealista, fora de escopo) na geometria exata que o `creative_plan` já
 * reservou, como pixels reais por cima da imagem gerada — mesma técnica de
 * `compositeLogoOntoImage` (`logo-compositor.ts`), pelo mesmo motivo: um modelo generativo
 * redesenhando uma interface real perde fidelidade de texto pequeno (preços, nomes de produto,
 * botões), que é exatamente o que este compositor promete preservar.
 *
 * Nunca degrada silenciosamente: geometria fora dos limites do canvas, área útil final ilegível
 * ou screenshot real com proporção incompatível com a área reservada são HARD FAILURES — nunca
 * uma composição malfeita seguindo em frente. Dimensões sempre calculadas a partir dos metadados
 * REAIS das duas imagens, nunca de um tamanho hardcoded.
 */
export async function compositeScreenshotIntoDeviceMockup(input: CompositeScreenshotInput): Promise<Buffer> {
  const baseImage = sharp(input.imageBuffer);
  const baseMeta = await baseImage.metadata();
  const imageWidth = baseMeta.width;
  const imageHeight = baseMeta.height;
  if (!imageWidth || !imageHeight) {
    throw new Error("SCREENSHOT_COMPOSITE_IMAGE_METADATA_MISSING: não foi possível ler largura/altura da imagem gerada.");
  }

  const { xPct, yPct, widthPct, heightPct } = input.placement;
  if (xPct < 0 || yPct < 0 || widthPct <= 0 || heightPct <= 0 || xPct + widthPct > 100 || yPct + heightPct > 100) {
    throw new Error(
      `SCREENSHOT_COMPOSITE_PLACEMENT_OUT_OF_BOUNDS: retângulo (x=${xPct}%, y=${yPct}%, w=${widthPct}%, h=${heightPct}%) sai dos limites do canvas (0-100 em cada eixo).`,
    );
  }

  const frame = input.frame ?? "phone";
  const mockupWidth = Math.round((widthPct / 100) * imageWidth);
  const mockupHeight = Math.round((heightPct / 100) * imageHeight);
  const bezel = Math.max(6, Math.round(mockupWidth * 0.035));
  const cornerRadius = frame === "phone" ? Math.round(mockupWidth * 0.12) : Math.round(mockupWidth * 0.04);
  const screenWidth = mockupWidth - bezel * 2;
  const screenHeight = mockupHeight - bezel * 2;

  if (screenWidth < MIN_SCREEN_DIMENSION_PX || screenHeight < MIN_SCREEN_DIMENSION_PX) {
    throw new Error(
      `SCREENSHOT_COMPOSITE_PLACEMENT_TOO_SMALL: área útil ${screenWidth}x${screenHeight}px abaixo do mínimo de ${MIN_SCREEN_DIMENSION_PX}px — uma interface real colada aí ficaria ilegível.`,
    );
  }

  const screenshotMeta = await sharp(input.screenshotBuffer).metadata();
  const screenshotWidth = screenshotMeta.width;
  const screenshotHeight = screenshotMeta.height;
  if (screenshotWidth && screenshotHeight) {
    const sourceAspect = screenshotWidth / screenshotHeight;
    const targetAspect = screenWidth / screenHeight;
    const deviation = Math.abs(sourceAspect - targetAspect) / targetAspect;
    if (deviation > MAX_ASPECT_RATIO_DEVIATION) {
      throw new Error(
        `SCREENSHOT_COMPOSITE_SOURCE_ASPECT_MISMATCH: screenshot real ${screenshotWidth}x${screenshotHeight} (proporção ${sourceAspect.toFixed(2)}) desvia ${(deviation * 100).toFixed(0)}% da área reservada ${screenWidth}x${screenHeight} (proporção ${targetAspect.toFixed(2)}) — "fit: cover" mutilaria a interface real além do aceitável.`,
      );
    }
  }

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

  const left = Math.round((xPct / 100) * imageWidth);
  const top = Math.round((yPct / 100) * imageHeight);

  return baseImage
    .composite([{ input: mockupComposed, left: Math.max(0, left), top: Math.max(0, top) }])
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90 })
    .toBuffer();
}
