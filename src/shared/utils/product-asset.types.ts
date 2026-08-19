/**
 * Product Asset Pipeline (Rodada 2, Prioridade 1) — tipos e decisão PURA de `productRenderMode`,
 * sem I/O (a análise real de pixels vive em `src/infrastructure/image-processing/`, que depende de
 * `sharp`). Investigação prévia confirmou: não existe segmentação/remoção de fundo em lugar nenhum
 * do projeto (só `sharp` e `ffmpeg-static`, nenhuma lib de ML/CV) — `ORIGINAL_ASSET` só é viável
 * quando o fundo da referência já é uniforme/removível sem inteligência semântica (decisão travada
 * com o usuário: nunca adicionar dependência pesada de ML só pra isto nesta rodada).
 */

export const PRODUCT_RENDER_MODES = ["original_asset", "reference_edit", "generated_reference"] as const;
export type ProductRenderMode = (typeof PRODUCT_RENDER_MODES)[number];

/** Estatísticas de fundo já calculadas sobre pixels reais (ver `analyzeProductBackground` em
 * `src/infrastructure/image-processing/product-background.ts`) — esta camada só decide a partir
 * do resultado, nunca lê pixel diretamente. */
export type ProductBackgroundAnalysis = {
  widthPx: number;
  heightPx: number;
  /** Desvio de cor baixo o bastante na borda da imagem pra ser tratado como fundo sólido
   * removível por chroma-key simples — nunca segmentação semântica real. */
  backgroundUniform: boolean;
  /** Cor dominante da borda em hex, só quando `backgroundUniform` — usada pro chroma-key. */
  dominantBackgroundColor?: string;
};

export type ProductRenderModeDecision = {
  mode: ProductRenderMode;
  reasoning: string;
};

/** Abaixo disto (em qualquer dimensão), a referência não tem resolução suficiente pra virar um
 * recorte de qualidade usável como hero asset — melhor deixar o modelo usar como referência de
 * edição do que entregar um recorte pixelado. */
export const MIN_ORIGINAL_ASSET_DIMENSION_PX = 500;

/**
 * Decide o modo de renderização do produto — pura, dado o resultado já calculado da análise de
 * fundo. Prioridade sempre `ORIGINAL_ASSET > REFERENCE_EDIT > GENERATED_REFERENCE` quando
 * tecnicamente viável, degradando um degrau por vez a cada limitação real encontrada (nunca pula
 * direto pro pior caso só porque uma condição não é ideal).
 */
export function resolveProductRenderMode(input: { hasReferenceImage: boolean; analysis?: ProductBackgroundAnalysis }): ProductRenderModeDecision {
  if (!input.hasReferenceImage) {
    return { mode: "generated_reference", reasoning: "Nenhuma imagem de referência disponível — o modelo recria a cena a partir da descrição do briefing." };
  }
  if (!input.analysis) {
    return { mode: "reference_edit", reasoning: "Imagem de referência disponível, mas não foi possível analisar o fundo — usa a referência como entrada real de edição (/v1/images/edits)." };
  }
  if (input.analysis.widthPx < MIN_ORIGINAL_ASSET_DIMENSION_PX || input.analysis.heightPx < MIN_ORIGINAL_ASSET_DIMENSION_PX) {
    return {
      mode: "reference_edit",
      reasoning: `Resolução da referência (${input.analysis.widthPx}x${input.analysis.heightPx}px) abaixo do mínimo para recorte direto (${MIN_ORIGINAL_ASSET_DIMENSION_PX}px) — usa como entrada de edição.`,
    };
  }
  if (!input.analysis.backgroundUniform) {
    return {
      mode: "reference_edit",
      reasoning: "Fundo da referência não é uniforme/removível sem segmentação semântica — usa como entrada de edição (o produto real ainda guia a geração via /v1/images/edits).",
    };
  }
  return { mode: "original_asset", reasoning: "Fundo uniforme detectado e resolução adequada — o produto real pode ser recortado e usado diretamente como hero asset." };
}
