/**
 * Visual Grammar (Rodada 2, Fatia 2, Prioridade 7) — camada ACIMA dos tokens de marca
 * (`BrandVisualProfile`): descreve COMO a marca organiza informação visualmente, não só quais
 * cores/fontes usa. Duas marcas com o mesmo `layoutFamily` não devem produzir peças
 * essencialmente iguais com cores diferentes — é esta camada que produz a diferença estrutural
 * (alinhamento, densidade de espaço em branco, uso de cards/bordas, tratamento do produto).
 * `deriveVisualGrammar` é uma função determinística pura: mesmo perfil, mesma gramática, sempre —
 * nunca uma chamada de IA nem um valor aleatório.
 */

import type { BrandVisualProfile } from "./brand-visual-profile.types.js";

export const ALIGNMENT_PREFERENCES = ["centered", "left_aligned", "asymmetric"] as const;
export type AlignmentPreference = (typeof ALIGNMENT_PREFERENCES)[number];

export const SYMMETRY_PREFERENCES = ["symmetric", "asymmetric"] as const;
export type SymmetryPreference = (typeof SYMMETRY_PREFERENCES)[number];

export const WHITESPACE_PREFERENCES = ["tight", "balanced", "generous"] as const;
export type WhitespacePreference = (typeof WHITESPACE_PREFERENCES)[number];

export const CARD_USAGE_LEVELS = ["none", "selective", "heavy"] as const;
export type CardUsageLevel = (typeof CARD_USAGE_LEVELS)[number];

export const BORDER_USAGE_LEVELS = ["none", "subtle", "bold"] as const;
export type BorderUsageLevel = (typeof BORDER_USAGE_LEVELS)[number];

export const GEOMETRIC_LANGUAGES = ["sharp", "mixed", "rounded"] as const;
export type GeometricLanguage = (typeof GEOMETRIC_LANGUAGES)[number];

export const LABEL_TREATMENTS = ["minimal", "tag", "pill"] as const;
export type LabelTreatment = (typeof LABEL_TREATMENTS)[number];

export const HIERARCHY_STYLES = ["subtle", "balanced", "scale_dominant"] as const;
export type HierarchyStyle = (typeof HIERARCHY_STYLES)[number];

export const PRODUCT_FRAMINGS = ["contained", "floating", "full_bleed"] as const;
export type ProductFraming = (typeof PRODUCT_FRAMINGS)[number];

export const BACKGROUND_COMPLEXITIES = ["minimal", "moderate", "rich"] as const;
export type BackgroundComplexity = (typeof BACKGROUND_COMPLEXITIES)[number];

export const ACCENT_USAGES = ["sparse", "moderate", "bold"] as const;
export type AccentUsage = (typeof ACCENT_USAGES)[number];

export type VisualGrammar = {
  alignmentPreference: AlignmentPreference;
  symmetryPreference: SymmetryPreference;
  whitespacePreference: WhitespacePreference;
  cardUsage: CardUsageLevel;
  borderUsage: BorderUsageLevel;
  diagonalElements: boolean;
  geometricLanguage: GeometricLanguage;
  labelTreatment: LabelTreatment;
  hierarchyStyle: HierarchyStyle;
  productFraming: ProductFraming;
  backgroundComplexity: BackgroundComplexity;
  accentUsage: AccentUsage;
};

/**
 * Deriva a gramática visual inteiramente de `personality` + `shapeLanguage` + `imagery` do
 * perfil de marca — nunca de preferência estética isolada do gerador. Cada dimensão tem uma
 * regra própria e nomeada (não um único "score geral" espalhado em 12 campos), para que o
 * teste de identidade (Marca A agressiva vs. Marca B premium) produza diferenças rastreáveis
 * dimensão a dimensão.
 */
export function deriveVisualGrammar(profile: BrandVisualProfile): VisualGrammar {
  const { personality, shapeLanguage } = profile;
  const isAggressive = personality.commercialAggressiveness === "aggressive";
  const isPremium = personality.sophistication === "premium";
  const isDense = personality.graphicDensityPreference === "dense";
  const isMinimalDensity = personality.graphicDensityPreference === "minimal";
  const isHighEnergy = personality.visualEnergy === "high";
  const isHighContrast = personality.contrastPreference === "high";

  return {
    // Marcas agressivas/densas quebram a grade com composição assimétrica para gerar tensão
    // visual e "puxar o olho"; marcas premium/calmas centralizam para transmitir controle.
    alignmentPreference: isAggressive || isDense ? "asymmetric" : isPremium ? "centered" : "left_aligned",
    symmetryPreference: isPremium && !isDense ? "symmetric" : "asymmetric",
    // Espelha diretamente a densidade gráfica preferida — é a dimensão mais literal da gramática.
    whitespacePreference: isMinimalDensity ? "generous" : isDense ? "tight" : "balanced",
    // Marcas mais densas/agressivas usam cards para conter a quantidade de informação; marcas
    // premium evitam blocos fechados, preferindo o produto "solto" na composição.
    cardUsage: isDense ? "heavy" : isMinimalDensity || isPremium ? "none" : "selective",
    borderUsage: shapeLanguage.cardStyle === "outlined" ? "bold" : isPremium ? "subtle" : isAggressive ? "bold" : "subtle",
    // Elementos diagonais (selos rotacionados, faixas) são uma assinatura de urgência comercial —
    // nunca aparecem em perfis de sofisticação alta, mesmo que agressivos noutro eixo.
    diagonalElements: isAggressive && !isPremium,
    geometricLanguage: shapeLanguage.borderRadius === "sharp" ? "sharp" : shapeLanguage.borderRadius === "pill" ? "rounded" : "mixed",
    labelTreatment: isAggressive ? "pill" : isPremium ? "minimal" : "tag",
    hierarchyStyle: isHighContrast || isAggressive ? "scale_dominant" : isPremium ? "subtle" : "balanced",
    // Produto "protagonista solto" (floating) em marcas premium; contido em moldura/card quando a
    // marca é densa (compete por espaço com outros elementos); full_bleed quando a energia visual
    // é alta e a marca não é premium (composição de impacto, produto ocupando a cena inteira).
    productFraming: isDense ? "contained" : isPremium ? "floating" : isHighEnergy ? "full_bleed" : "contained",
    backgroundComplexity: profile.imagery.backgroundComplexity,
    accentUsage: isHighContrast || isAggressive ? "bold" : isMinimalDensity ? "sparse" : "moderate",
  };
}
