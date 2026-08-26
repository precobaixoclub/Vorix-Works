/**
 * Estimativa de custo do `gpt-image-1` — auditoria de custo urgente do motor criativo GPT.
 *
 * ACHADO CRÍTICO desta auditoria: `OpenAiCreativeImageProvider` sempre devolvia `cost: {estimated:
 * 0}` para geração de imagem — o passo mais caro de todo o pipeline nunca entrava em NENHUM total
 * de custo do motor (nem em `icaro_ai_calls`, nem no `estimatedCostUsd` devolvido pelo motor).
 * Confirmado em produção antes da correção: `avg(estimated_cost)` para
 * `task_type='image_generation'` = $0.000000 em 47 chamadas reais.
 *
 * Existe um preço já configurado em `ai_provider_models` (`usdPerImage: 0.04`, tabela `per_image`
 * fixa) — usado por `MediaGenerationService`, um sistema de billing PARALELO que este motor não
 * consome. Esse valor fixo é inconsistente com o preço real do `gpt-image-1`: a OpenAI cobra por
 * TOKEN de saída de imagem, e o número de tokens varia por tamanho/qualidade — a diferença entre
 * "low" e "high" é de mais de 15x. Nunca reaproveitar aquele valor aqui sem antes confirmar contra
 * a fatura real (ver relatório da auditoria de custo).
 *
 * Os números abaixo replicam a tabela de preços por token documentada publicamente da OpenAI para
 * `gpt-image-1` — SEMPRE uma ESTIMATIVA, nunca o valor exato da fatura (o endpoint de imagens não
 * devolve contagem real de tokens de uso como o endpoint de chat devolve). Reavaliar se a OpenAI
 * mudar a tabela de preços; conferir periodicamente contra o dashboard de billing real da conta.
 */

export type OpenAiImageSize = "1024x1024" | "1024x1536" | "1536x1024";
export type OpenAiImageQuality = "low" | "medium" | "high";

const USD_PER_1K_TEXT_INPUT_TOKENS = 0.005;
const USD_PER_1K_IMAGE_INPUT_TOKENS = 0.01;
const USD_PER_1K_IMAGE_OUTPUT_TOKENS = 0.04;

/** Tokens de SAÍDA (a imagem gerada em si) por combinação tamanho/qualidade — é isto que domina o
 * custo, não o prompt de entrada. */
const OUTPUT_TOKENS_BY_QUALITY_AND_SIZE: Record<OpenAiImageQuality, Record<OpenAiImageSize, number>> = {
  low: { "1024x1024": 272, "1024x1536": 408, "1536x1024": 408 },
  medium: { "1024x1024": 1056, "1024x1536": 1568, "1536x1024": 1568 },
  high: { "1024x1024": 4160, "1024x1536": 6208, "1536x1024": 6208 },
};

/** Estimativa fixa e deliberadamente conservadora (arredonda pra CIMA) pra imagem de referência de
 * entrada (`/v1/images/edits`, quando há foto real de produto) — a API não devolve a contagem real
 * de tokens de entrada de imagem; ~1500 tokens aproxima uma foto de produto em alto detalhe. */
const ESTIMATED_REFERENCE_IMAGE_INPUT_TOKENS = 1500;
const CHARS_PER_TOKEN_APPROX = 4;

export function estimateGptImage1CostUsd(input: {
  size: OpenAiImageSize;
  quality: OpenAiImageQuality;
  promptChars: number;
  hasReferenceImage: boolean;
}): number {
  const outputTokens = OUTPUT_TOKENS_BY_QUALITY_AND_SIZE[input.quality][input.size];
  const outputCost = (outputTokens / 1000) * USD_PER_1K_IMAGE_OUTPUT_TOKENS;
  const estimatedPromptTokens = Math.ceil(Math.max(0, input.promptChars) / CHARS_PER_TOKEN_APPROX);
  const textInputCost = (estimatedPromptTokens / 1000) * USD_PER_1K_TEXT_INPUT_TOKENS;
  const referenceImageInputCost = input.hasReferenceImage ? (ESTIMATED_REFERENCE_IMAGE_INPUT_TOKENS / 1000) * USD_PER_1K_IMAGE_INPUT_TOKENS : 0;
  return outputCost + textInputCost + referenceImageInputCost;
}
