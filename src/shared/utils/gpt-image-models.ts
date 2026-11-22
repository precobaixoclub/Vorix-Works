/**
 * Catálogo ÚNICO dos modelos de imagem da OpenAI que o Vorix sabe usar — fonte de verdade para
 * escolha de modelo, tamanho de geração e custo. Fica em `shared` (dados puros, sem dependência de
 * infraestrutura) para que motor, provedores e testes leiam a mesma tabela.
 *
 * Só entram aqui modelos VALIDADOS contra a documentação oficial e contra a lista de modelos da
 * conta. Um modelo fora do catálogo nunca é usado "no escuro": a geração falha com mensagem clara
 * (`unsupportedGptImageModelMessage`) — nunca cai em silêncio para outro modelo.
 *
 * Histórico: o `gpt-image-1` (3 tamanhos fixos, corte depois) deixou de existir na conta da OpenAI
 * em produção ("The model 'gpt-image-1' does not exist", teste real de 22/11/2026) e saiu daqui.
 *
 * Fonte (consultada em 22/11/2026):
 * - https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst
 * - https://developers.openai.com/api/docs/models/gpt-image-2.6-flare
 * - https://developers.openai.com/api/docs/guides/image-generation
 */

export type GptImageQuality = "low" | "medium" | "high" | "xhigh" | "max";
export type GptImageComplexity = "low" | "medium" | "high";
export type GptImageModelTier = "premium" | "fast";

export type GptImageModelSpec = {
  id: string;
  label: string;
  tier: GptImageModelTier;
  /** Aceita `WIDTHxHEIGHT` livre (bordas múltiplas de 16, proporção 1:3–3:1, 655.360–8.294.400 px). */
  customSize: boolean;
  qualities: readonly GptImageQuality[];
  /** Parâmetro `complexity` (quanto o modelo planeja antes de desenhar; sem custo extra). */
  complexity: boolean;
  /** `background: "transparent"` (exige PNG/WebP). */
  transparentBackground: boolean;
  /** Preço oficial por 1 milhão de tokens (USD). */
  pricingUsdPer1M: { textInput: number; imageInput: number; imageOutput: number };
};

const GPT_IMAGE_2_6_PRICING = { textInput: 5, imageInput: 8, imageOutput: 30 } as const;
const GPT_IMAGE_2_6_QUALITIES: readonly GptImageQuality[] = ["low", "medium", "high", "xhigh", "max"];

export const GPT_IMAGE_MODELS: Readonly<Record<string, GptImageModelSpec>> = Object.freeze({
  "gpt-image-2.6-sunburst": {
    id: "gpt-image-2.6-sunburst",
    label: "GPT Image 2.6 Sunburst (detalhe e edição precisa)",
    tier: "premium",
    customSize: true,
    qualities: GPT_IMAGE_2_6_QUALITIES,
    complexity: true,
    transparentBackground: true,
    pricingUsdPer1M: GPT_IMAGE_2_6_PRICING,
  },
  "gpt-image-2.6-flare": {
    id: "gpt-image-2.6-flare",
    label: "GPT Image 2.6 Flare (iteração rápida)",
    tier: "fast",
    customSize: true,
    qualities: GPT_IMAGE_2_6_QUALITIES,
    complexity: true,
    transparentBackground: true,
    pricingUsdPer1M: GPT_IMAGE_2_6_PRICING,
  },
});

export const DEFAULT_GPT_IMAGE_MODEL = "gpt-image-2.6-sunburst";
export const DEFAULT_GPT_IMAGE_FAST_MODEL = "gpt-image-2.6-flare";
export const DEFAULT_GPT_IMAGE_QUALITY: GptImageQuality = "high";

export function getGptImageModel(modelId: string | undefined): GptImageModelSpec | undefined {
  return modelId ? GPT_IMAGE_MODELS[modelId.trim()] : undefined;
}

export function unsupportedGptImageModelMessage(modelId: string | undefined): string {
  return `Modelo de imagem "${modelId ?? "(vazio)"}" não está no catálogo validado do Vorix (${Object.keys(GPT_IMAGE_MODELS).join(", ")}). Ajuste OPENAI_IMAGE_MODEL — o Vorix nunca troca de modelo em silêncio.`;
}

export function isGptImageQuality(value: unknown): value is GptImageQuality {
  return typeof value === "string" && (GPT_IMAGE_2_6_QUALITIES as readonly string[]).includes(value);
}

export function isGptImageComplexity(value: unknown): value is GptImageComplexity {
  return value === "low" || value === "medium" || value === "high";
}

/**
 * Canvas de geração por formato. Com tamanho livre, a imagem já nasce na proporção EXATA da peça
 * (nada é cortado depois): 4:5 sai em 1088x1360 — o próprio tamanho do feed do Instagram,
 * arredondado para múltiplos de 16. Os valores ficam entre ~1,2 e 2,4 megapixels: o custo de saída
 * cresce com a área, então não se gera maior do que a publicação usa.
 */
const EXACT_CANVAS_BY_ASPECT_RATIO: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  "1:1": [1088, 1088],
  "4:5": [1088, 1360],
  "9:16": [1152, 2048],
  "16:9": [2048, 1152],
  "3:4": [1056, 1408],
  "2:3": [1024, 1536],
  "3:2": [1536, 1024],
});

export type GptImageCanvas = {
  /** Valor enviado no parâmetro `size`. */
  size: string;
  width: number;
  height: number;
  /** `true` quando o canvas já tem a proporção pedida (nenhum corte depois da geração). */
  exact: boolean;
};

function parseRatio(label: string | undefined): number | undefined {
  const match = (label ?? "").trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return undefined;
  const ratio = Number(match[1]) / Number(match[2]);
  return ratio > 0 && Number.isFinite(ratio) ? ratio : undefined;
}

/** Valida as regras de tamanho livre da família 2.6 (bordas ×16, proporção 1:3–3:1, área). */
export function isValidCustomGptImageSize(width: number, height: number): boolean {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width % 16 !== 0 || height % 16 !== 0) return false;
  if (width > 3840 || height > 3840) return false;
  const ratio = width / height;
  if (ratio < 1 / 3 || ratio > 3) return false;
  const pixels = width * height;
  return pixels >= 655_360 && pixels <= 8_294_400;
}

/**
 * Canvas para a proporção pedida. Formato conhecido → tabela; outra proporção válida → calcula
 * ~1,5 MP em múltiplos de 16 (a proporção real fica a menos de 2% da pedida). Sem proporção → 1:1.
 */
export function resolveGptImageCanvas(model: GptImageModelSpec, aspectRatio: string | undefined): GptImageCanvas {
  const label = (aspectRatio ?? "").trim() || "1:1";
  if (!model.customSize) {
    // Nenhum modelo do catálogo atual cai aqui; mantém a regra de 3 tamanhos para um modelo futuro
    // que não aceite tamanho livre.
    const ratio = parseRatio(label) ?? 1;
    const [width, height] = ratio > 1.2 ? [1536, 1024] : ratio < 0.84 ? [1024, 1536] : [1024, 1024];
    return { size: `${width}x${height}`, width, height, exact: Math.abs(width / height - ratio) / ratio <= 0.02 };
  }
  const known = EXACT_CANVAS_BY_ASPECT_RATIO[label];
  if (known) return { size: `${known[0]}x${known[1]}`, width: known[0], height: known[1], exact: true };
  const ratio = parseRatio(label);
  if (!ratio || ratio < 1 / 3 || ratio > 3) {
    const [width, height] = EXACT_CANVAS_BY_ASPECT_RATIO["1:1"]!;
    return { size: `${width}x${height}`, width, height, exact: !ratio };
  }
  const targetPixels = 1_500_000;
  let height = Math.round(Math.sqrt(targetPixels / ratio) / 16) * 16;
  let width = Math.round((height * ratio) / 16) * 16;
  if (!isValidCustomGptImageSize(width, height)) {
    height = 1024;
    width = Math.max(16, Math.round((height * ratio) / 16) * 16);
  }
  return { size: `${width}x${height}`, width, height, exact: Math.abs(width / height - ratio) / ratio <= 0.02 };
}

export type GptImageUsage = {
  inputTextTokens: number;
  inputImageTokens: number;
  outputImageTokens: number;
  outputTextTokens: number;
  totalTokens: number;
};

/** Lê o objeto `usage` devolvido pela API de imagens (formato documentado do `ImagesResponse`). */
export function parseGptImageUsage(raw: unknown): GptImageUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const usage = raw as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const inputDetails = (usage.input_tokens_details ?? {}) as Record<string, unknown>;
  const outputDetails = (usage.output_tokens_details ?? {}) as Record<string, unknown>;
  const inputTotal = num(usage.input_tokens);
  const outputTotal = num(usage.output_tokens);
  const inputImageTokens = num(inputDetails.image_tokens);
  const inputTextTokens = inputDetails.text_tokens !== undefined ? num(inputDetails.text_tokens) : Math.max(0, inputTotal - inputImageTokens);
  const outputTextTokens = num(outputDetails.text_tokens);
  const outputImageTokens = outputDetails.image_tokens !== undefined ? num(outputDetails.image_tokens) : Math.max(0, outputTotal - outputTextTokens);
  return { inputTextTokens, inputImageTokens, outputImageTokens, outputTextTokens, totalTokens: num(usage.total_tokens) || inputTotal + outputTotal };
}

/** Custo REAL da chamada a partir do `usage` devolvido pela OpenAI e do preço oficial do modelo. */
export function computeGptImageCostUsd(model: GptImageModelSpec, usage: GptImageUsage): number {
  const price = model.pricingUsdPer1M;
  const cost =
    (usage.inputTextTokens * price.textInput +
      usage.inputImageTokens * price.imageInput +
      // Tokens de texto de saída (raros) cobrados como texto de entrada é conservador o bastante
      // para estimativa; a tabela oficial não lista um preço separado para eles.
      usage.outputTextTokens * price.textInput +
      usage.outputImageTokens * price.imageOutput) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
