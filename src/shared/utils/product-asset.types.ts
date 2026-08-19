/**
 * Product Asset Pipeline (Rodada 2, Prioridade 1 + Fatia 2, Bloco 0.1) — tipos e decisão PURA de
 * `productRenderMode`, sem I/O (a análise real de pixels vive em
 * `src/infrastructure/image-processing/`, que depende de `sharp`). Investigação prévia confirmou:
 * não existe segmentação/remoção de fundo em lugar nenhum do projeto (só `sharp` e
 * `ffmpeg-static`, nenhuma lib de ML/CV) — `ORIGINAL_ASSET` só é viável quando o fundo da
 * referência já é uniforme/removível sem inteligência semântica (decisão travada com o usuário:
 * nunca adicionar dependência pesada de ML só pra isto nesta rodada).
 *
 * Achado da Fatia 2: a decisão binária original ("fundo uniforme? sim/não") era adequada para
 * fotos limpas mas não expressava GRAU de confiança — um fundo quase uniforme com leve sombra, ou
 * um produto com cor próxima do fundo, passavam ou falhavam de forma abrupta. `AssetSuitabilityScore`
 * substitui isso por um score contínuo multi-fator, calculado sobre pixels reais (nunca uma
 * estimativa), com um limiar de confiança claro para a decisão final.
 */

export const PRODUCT_RENDER_MODES = ["original_asset", "reference_edit", "generated_reference"] as const;
export type ProductRenderMode = (typeof PRODUCT_RENDER_MODES)[number];

export type AssetSuitabilityFactors = {
  /** 0-100: uniformidade de cor na borda da imagem (proxy do fundo) — 100 = fundo sólido perfeito. */
  edgeUniformity: number;
  /** 0-100: resolução da referência em relação ao mínimo utilizável para um recorte de qualidade. */
  resolutionAdequacy: number;
  /** 0-100: contraste entre a região central (proxy do produto) e a cor dominante do fundo — baixo
   * contraste aumenta o risco real do chroma-key remover parte do produto por engano (produto e
   * fundo parecidos demais). */
  productBackgroundContrast: number;
  /** 0-100: quão plausível ficou uma extração de teste (mesma lógica de `extractProductAsset`,
   * não uma estimativa separada) — proporção de pixels opacos fora de uma faixa razoável indica
   * fundo residual sobrando (risco baixo) ou o produto sendo cortado por engano (risco baixo). */
  extractionCleanliness: number;
};

export type AssetSuitabilityConfidence = "high" | "medium" | "low";

export type AssetSuitabilityScore = {
  /** 0-100 — média ponderada de `factors`, `extractionCleanliness` e `edgeUniformity` pesando mais
   * (sinais mais diretos de "o recorte vai funcionar de verdade" do que resolução/contraste, que
   * são só corroborativos). */
  score: number;
  confidence: AssetSuitabilityConfidence;
  factors: AssetSuitabilityFactors;
  widthPx: number;
  heightPx: number;
  /** Cor dominante do fundo em hex — presente mesmo em score baixo (útil para diagnóstico/log). */
  dominantBackgroundColor?: string;
  /** Explica o fator mais fraco — nunca "score baixo" sem dizer por quê. */
  reasoning: string;
};

export type ProductRenderModeDecision = {
  mode: ProductRenderMode;
  reasoning: string;
  suitability?: AssetSuitabilityScore;
};

/** Abaixo disto (em qualquer dimensão), a referência não tem resolução suficiente pra virar um
 * recorte de qualidade usável como hero asset. */
export const MIN_ORIGINAL_ASSET_DIMENSION_PX = 500;
/** Resolução "ideal" — a partir daqui, `resolutionAdequacy` satura em 100. */
export const IDEAL_ORIGINAL_ASSET_DIMENSION_PX = 1200;

/** Score mínimo (inclusive) para confiança "high" — só nesse patamar o recorte vira ORIGINAL_ASSET. */
export const HIGH_CONFIDENCE_THRESHOLD = 75;
/** Score mínimo (inclusive) para confiança "medium" (abaixo disso é "low") — ambas ainda caem em
 * REFERENCE_EDIT (nunca ORIGINAL_ASSET), a distinção existe só para diagnóstico/observabilidade. */
export const MEDIUM_CONFIDENCE_THRESHOLD = 45;

export function resolveAssetSuitabilityConfidence(score: number): AssetSuitabilityConfidence {
  if (score >= HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (score >= MEDIUM_CONFIDENCE_THRESHOLD) return "medium";
  return "low";
}

/**
 * Decide o modo de renderização do produto — pura, dado o Asset Suitability Score já calculado
 * sobre pixels reais. Prioridade sempre `ORIGINAL_ASSET > REFERENCE_EDIT > GENERATED_REFERENCE`
 * quando tecnicamente viável. Nunca insiste em ORIGINAL_ASSET quando o recorte não é confiável —
 * confiança "medium" ou "low" sempre degradam para REFERENCE_EDIT (a referência ainda existe e
 * ainda guia a geração via `/v1/images/edits`; só o recorte direto é que não é confiável).
 */
export function resolveProductRenderMode(input: { hasReferenceImage: boolean; suitability?: AssetSuitabilityScore }): ProductRenderModeDecision {
  if (!input.hasReferenceImage) {
    return { mode: "generated_reference", reasoning: "Nenhuma imagem de referência disponível — o modelo recria a cena a partir da descrição do briefing." };
  }
  if (!input.suitability) {
    return { mode: "reference_edit", reasoning: "Imagem de referência disponível, mas não foi possível calcular o Asset Suitability Score — usa a referência como entrada real de edição (/v1/images/edits)." };
  }
  if (input.suitability.confidence === "high") {
    return {
      mode: "original_asset",
      reasoning: `Asset Suitability Score ${input.suitability.score}/100 (alta confiança) — ${input.suitability.reasoning}`,
      suitability: input.suitability,
    };
  }
  return {
    mode: "reference_edit",
    reasoning: `Asset Suitability Score ${input.suitability.score}/100 (confiança ${input.suitability.confidence}) — recorte direto não é confiável o bastante; usa a referência como entrada de edição em vez de arriscar um recorte quebrado. ${input.suitability.reasoning}`,
    suitability: input.suitability,
  };
}
