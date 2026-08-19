import sharp from "sharp";
import type { ProductBackgroundAnalysis } from "../../shared/utils/product-asset.types.js";

/** Largura/altura (px) da faixa de borda amostrada em cada lado — grande o bastante pra não pegar
 * só ruído de compressão, pequena o bastante pra nunca alcançar o produto num recorte já razoável. */
const SAMPLE_STRIP_PX = 8;
/** Desvio-padrão máximo (0-255, por canal RGB) na amostra de borda pra ser tratado como fundo
 * sólido — fotografia de produto em fundo de estúdio (branco/cinza/cor sólida) tipicamente fica
 * bem abaixo disto; fundo fotográfico/ambiente real fica bem acima. */
const UNIFORMITY_STD_DEV_THRESHOLD = 18;
/** Distância euclidiana de cor (0-441, espaço RGB) abaixo da qual um pixel é tratado como parte do
 * fundo (chroma-key simples pela cor dominante da borda, nunca segmentação semântica). */
const CHROMA_KEY_DISTANCE_THRESHOLD = 32;
/** Proporção MÍNIMA de pixels opacos (produto) que o resultado precisa ter, DEPOIS do trim, pra
 * ser considerado um recorte confiável. `sharp().trim()` já corta pro retângulo delimitador do
 * conteúdo não-fundo — abaixo disto, o chroma-key por pixel removeu quase tudo dentro desse
 * retângulo, sinal de que a cor de fundo estimada provavelmente bateu com o próprio produto (ex.:
 * produto da mesma cor do fundo). Não existe teto: um produto com contorno retangular pode
 * legitimamente ocupar 100% do retângulo já cortado — isso nunca é sinal de falha. */
const MIN_OPAQUE_PIXEL_RATIO = 0.15;

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
  for (const region of regions) {
    const { data, info } = await sharp(buffer).extract(region).raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i + 2 < data.length; i += info.channels) {
      pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
    }
  }
  return pixels;
}

function computeMeanAndStdDev(pixels: Rgb[]): { mean: Rgb; stdDev: number } | undefined {
  if (pixels.length === 0) return undefined;
  const sum = pixels.reduce((acc, pixel) => ({ r: acc.r + pixel.r, g: acc.g + pixel.g, b: acc.b + pixel.b }), { r: 0, g: 0, b: 0 });
  const mean: Rgb = { r: sum.r / pixels.length, g: sum.g / pixels.length, b: sum.b / pixels.length };
  const variance =
    pixels.reduce((acc, pixel) => acc + ((pixel.r - mean.r) ** 2 + (pixel.g - mean.g) ** 2 + (pixel.b - mean.b) ** 2) / 3, 0) / pixels.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

/**
 * Analisa se o fundo de uma foto de produto é uniforme o bastante pra virar um recorte confiável
 * sem segmentação semântica — amostra pixels só das bordas (nunca do centro, onde o produto
 * costuma estar) e mede o desvio de cor entre eles. Best-effort: qualquer falha (bytes inválidos,
 * imagem sem metadados legíveis) devolve `undefined`, nunca lança — o chamador cai para
 * `reference_edit` nesse caso.
 */
export async function analyzeProductBackground(buffer: Buffer): Promise<ProductBackgroundAnalysis | undefined> {
  try {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) return undefined;

    const borderPixels = await sampleBorderPixels(buffer, width, height);
    const stats = computeMeanAndStdDev(borderPixels);
    if (!stats) return { widthPx: width, heightPx: height, backgroundUniform: false };

    const backgroundUniform = stats.stdDev <= UNIFORMITY_STD_DEV_THRESHOLD;
    return {
      widthPx: width,
      heightPx: height,
      backgroundUniform,
      dominantBackgroundColor: backgroundUniform ? toHex(stats.mean) : undefined,
    };
  } catch {
    return undefined;
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
 * recorte plausível (proporção de pixels opacos fora de uma faixa razoável — produto sumiu inteiro
 * ou quase nada foi removido), devolve `undefined` em vez de arriscar entregar um recorte quebrado.
 */
export async function extractProductAsset(buffer: Buffer, dominantBackgroundColor: string): Promise<Buffer | undefined> {
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
    if (opaqueRatio < MIN_OPAQUE_PIXEL_RATIO) return undefined;

    return await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
  } catch {
    return undefined;
  }
}
