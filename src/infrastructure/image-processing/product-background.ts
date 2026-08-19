import sharp from "sharp";
import { computeContrastRatio } from "../../shared/utils/color-contrast.js";
import { resolveAssetSuitabilityConfidence, IDEAL_ORIGINAL_ASSET_DIMENSION_PX, MIN_ORIGINAL_ASSET_DIMENSION_PX } from "../../shared/utils/product-asset.types.js";
import type { AssetSuitabilityFactors, AssetSuitabilityScore } from "../../shared/utils/product-asset.types.js";

/** Largura/altura (px) da faixa de borda amostrada em cada lado — grande o bastante pra não pegar
 * só ruído de compressão, pequena o bastante pra nunca alcançar o produto num recorte já razoável. */
const SAMPLE_STRIP_PX = 8;
/** Desvio-padrão (0-255, por canal RGB) na amostra de borda acima do qual `edgeUniformity` satura
 * em 0 — fotografia de produto em fundo de estúdio (branco/cinza/cor sólida) tipicamente fica bem
 * abaixo disto; fundo fotográfico/ambiente real fica bem acima. */
const MAX_STD_DEV_FOR_ZERO_UNIFORMITY = 60;
/** Distância euclidiana de cor (0-441, espaço RGB) abaixo da qual um pixel é tratado como parte do
 * fundo (chroma-key simples pela cor dominante da borda, nunca segmentação semântica). */
const CHROMA_KEY_DISTANCE_THRESHOLD = 32;
/** Proporção MÍNIMA de pixels opacos (produto), DEPOIS do trim, abaixo da qual a extração é
 * considerada não-confiável (fundo residual grande demais OU produto removido por engano) —
 * usada tanto como piso da rampa de `extractionCleanliness` quanto como corte de segurança em
 * `extractProductAsset`. Sem teto: um produto de contorno retangular pode legitimamente ocupar
 * 100% do retângulo já cortado por `trim()` — isso nunca é sinal de falha (confirmado com teste
 * sintético). */
const MIN_OPAQUE_PIXEL_RATIO = 0.15;
/** Tamanho (fração do menor lado) da região central amostrada como proxy do produto — pequena o
 * bastante pra não pegar o próprio fundo do meio da moldura em fotos com o produto fora de centro. */
const CENTER_SAMPLE_FRACTION = 0.25;

const FACTOR_WEIGHTS: Record<keyof AssetSuitabilityFactors, number> = {
  edgeUniformity: 0.3,
  resolutionAdequacy: 0.15,
  productBackgroundContrast: 0.2,
  extractionCleanliness: 0.35,
};

type Rgb = { r: number; g: number; b: number };

function toHex(rgb: Rgb): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${[rgb.r, rgb.g, rgb.b].map((channel) => clamp(channel).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function hexToRgb(hex: string): Rgb | undefined {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return undefined;
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function clamp01to100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

async function samplePixelsInRegion(buffer: Buffer, region: { left: number; top: number; width: number; height: number }): Promise<Rgb[]> {
  const { data, info } = await sharp(buffer).extract(region).raw().toBuffer({ resolveWithObject: true });
  const pixels: Rgb[] = [];
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  return pixels;
}

async function sampleBorderPixels(buffer: Buffer, width: number, height: number): Promise<Rgb[]> {
  const stripWidth = Math.max(1, Math.min(SAMPLE_STRIP_PX, Math.floor(width / 4)));
  const stripHeight = Math.max(1, Math.min(SAMPLE_STRIP_PX, Math.floor(height / 4)));

  const regions = [
    { left: 0, top: 0, width, height: stripHeight },
    { left: 0, top: height - stripHeight, width, height: stripHeight },
    { left: 0, top: 0, width: stripWidth, height },
    { left: width - stripWidth, top: 0, width: stripWidth, height },
  ];

  const pixels: Rgb[] = [];
  for (const region of regions) pixels.push(...(await samplePixelsInRegion(buffer, region)));
  return pixels;
}

async function sampleCenterPixels(buffer: Buffer, width: number, height: number): Promise<Rgb[]> {
  const regionWidth = Math.max(1, Math.round(width * CENTER_SAMPLE_FRACTION));
  const regionHeight = Math.max(1, Math.round(height * CENTER_SAMPLE_FRACTION));
  const left = Math.round((width - regionWidth) / 2);
  const top = Math.round((height - regionHeight) / 2);
  return samplePixelsInRegion(buffer, { left, top, width: regionWidth, height: regionHeight });
}

function computeMeanAndStdDev(pixels: Rgb[]): { mean: Rgb; stdDev: number } | undefined {
  if (pixels.length === 0) return undefined;
  const sum = pixels.reduce((acc, pixel) => ({ r: acc.r + pixel.r, g: acc.g + pixel.g, b: acc.b + pixel.b }), { r: 0, g: 0, b: 0 });
  const mean: Rgb = { r: sum.r / pixels.length, g: sum.g / pixels.length, b: sum.b / pixels.length };
  const variance =
    pixels.reduce((acc, pixel) => acc + ((pixel.r - mean.r) ** 2 + (pixel.g - mean.g) ** 2 + (pixel.b - mean.b) ** 2) / 3, 0) / pixels.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

/** Roda a MESMA lógica de recorte que `extractProductAsset` usaria de verdade (trim + chroma-key
 * por pixel), mas devolve a proporção de pixels opacos resultante em vez de aplicar um corte
 * binário — usado tanto pelo score (`extractionCleanliness`) quanto por `extractProductAsset`
 * (que aplica o piso `MIN_OPAQUE_PIXEL_RATIO` por cima do mesmo resultado). Nunca lança. */
async function runTrialExtraction(buffer: Buffer, dominantBackgroundColor: string): Promise<{ buffer: Buffer; opaqueRatio: number; width: number; height: number } | undefined> {
  const target = hexToRgb(dominantBackgroundColor);
  if (!target) return undefined;

  try {
    const trimmed = sharp(buffer).trim({ background: dominantBackgroundColor, threshold: 20 });
    const { data, info } = await trimmed.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    let opaqueCount = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const distance = Math.sqrt((data[i] - target.r) ** 2 + (data[i + 1] - target.g) ** 2 + (data[i + 2] - target.b) ** 2);
      if (distance <= CHROMA_KEY_DISTANCE_THRESHOLD) {
        data[i + 3] = 0;
      } else {
        opaqueCount += 1;
      }
    }

    const totalPixels = info.width * info.height;
    const opaqueRatio = totalPixels > 0 ? opaqueCount / totalPixels : 0;
    const resultBuffer = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
    return { buffer: resultBuffer, opaqueRatio, width: info.width, height: info.height };
  } catch {
    return undefined;
  }
}

/**
 * Asset Suitability Score (Fatia 2, Bloco 0.1) — substitui a decisão binária "fundo uniforme?
 * sim/não" por um score contínuo 0-100, multi-fator, calculado sobre pixels reais (nunca uma
 * estimativa): uniformidade de borda, resolução, contraste produto/fundo, e o resultado de uma
 * extração de TESTE de verdade (mesma lógica de `extractProductAsset`) — não insiste em
 * ORIGINAL_ASSET quando qualquer um desses sinais indica um recorte não confiável. Best-effort:
 * qualquer falha (bytes inválidos, imagem sem metadados legíveis) devolve `undefined` — o
 * chamador cai para `reference_edit` nesse caso.
 */
export async function computeAssetSuitabilityScore(buffer: Buffer): Promise<AssetSuitabilityScore | undefined> {
  try {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) return undefined;

    const borderPixels = await sampleBorderPixels(buffer, width, height);
    const borderStats = computeMeanAndStdDev(borderPixels);
    if (!borderStats) return undefined;

    const edgeUniformity = clamp01to100(100 * (1 - borderStats.stdDev / MAX_STD_DEV_FOR_ZERO_UNIFORMITY));

    const minDimension = Math.min(width, height);
    const resolutionAdequacy = clamp01to100(
      (100 * (minDimension - MIN_ORIGINAL_ASSET_DIMENSION_PX)) / (IDEAL_ORIGINAL_ASSET_DIMENSION_PX - MIN_ORIGINAL_ASSET_DIMENSION_PX),
    );

    const dominantBackgroundColor = toHex(borderStats.mean);
    const centerPixels = await sampleCenterPixels(buffer, width, height);
    const centerStats = computeMeanAndStdDev(centerPixels);
    const contrastRatio = centerStats ? computeContrastRatio(dominantBackgroundColor, toHex(centerStats.mean)) : undefined;
    // Razão WCAG vai de 1 (sem contraste) a 21 (preto/branco) — normaliza pra 0-100 com um teto
    // conservador (razão 9:1 já é claramente distinguível, não precisa do extremo pra saturar).
    const productBackgroundContrast = contrastRatio !== undefined ? clamp01to100((100 * (contrastRatio - 1)) / 8) : 0;

    const trial = await runTrialExtraction(buffer, dominantBackgroundColor);
    const extractionCleanliness = trial ? clamp01to100((100 * trial.opaqueRatio) / MIN_OPAQUE_PIXEL_RATIO) : 0;

    const factors: AssetSuitabilityFactors = { edgeUniformity, resolutionAdequacy, productBackgroundContrast, extractionCleanliness };
    const score = Math.round(
      factors.edgeUniformity * FACTOR_WEIGHTS.edgeUniformity +
        factors.resolutionAdequacy * FACTOR_WEIGHTS.resolutionAdequacy +
        factors.productBackgroundContrast * FACTOR_WEIGHTS.productBackgroundContrast +
        factors.extractionCleanliness * FACTOR_WEIGHTS.extractionCleanliness,
    );

    const weakestFactor = (Object.entries(factors) as Array<[keyof AssetSuitabilityFactors, number]>).sort((a, b) => a[1] - b[1])[0];
    const reasoning = describeWeakestFactor(weakestFactor[0], weakestFactor[1]);

    return {
      score,
      confidence: resolveAssetSuitabilityConfidence(score),
      factors,
      widthPx: width,
      heightPx: height,
      dominantBackgroundColor,
      reasoning,
    };
  } catch {
    return undefined;
  }
}

function describeWeakestFactor(factor: keyof AssetSuitabilityFactors, value: number): string {
  const rounded = Math.round(value);
  switch (factor) {
    case "edgeUniformity":
      return `fator mais fraco: uniformidade de borda (${rounded}/100) — o fundo não parece sólido o bastante.`;
    case "resolutionAdequacy":
      return `fator mais fraco: resolução (${rounded}/100) — abaixo do ideal para um recorte de qualidade.`;
    case "productBackgroundContrast":
      return `fator mais fraco: contraste produto/fundo (${rounded}/100) — produto e fundo podem ter cores parecidas demais.`;
    case "extractionCleanliness":
      return `fator mais fraco: limpeza da extração de teste (${rounded}/100) — o recorte real corre risco de sobrar fundo ou cortar parte do produto.`;
  }
}

/**
 * Recorta o produto de uma foto de fundo uniforme — corta a borda sólida (`sharp().trim()`) e
 * neutraliza o que sobrar do fundo por chroma-key simples (distância de cor até
 * `dominantBackgroundColor`, nunca segmentação real). Devolve um PNG com canal alpha (produto
 * opaco, fundo transparente), pronto para compor como hero asset.
 *
 * Preserva integralmente os pixels do produto (nunca recolore, redimensiona proporção ou distorce
 * — só decide opacidade por pixel). Best-effort: qualquer falha, ou um resultado que não parece um
 * recorte plausível, devolve `undefined` em vez de arriscar entregar um recorte quebrado. Reaproveita
 * `runTrialExtraction` — a MESMA lógica que já informou `computeAssetSuitabilityScore`, nunca uma
 * segunda implementação divergente.
 */
export async function extractProductAsset(buffer: Buffer, dominantBackgroundColor: string): Promise<Buffer | undefined> {
  const trial = await runTrialExtraction(buffer, dominantBackgroundColor);
  if (!trial || trial.opaqueRatio < MIN_OPAQUE_PIXEL_RATIO) return undefined;
  return trial.buffer;
}
