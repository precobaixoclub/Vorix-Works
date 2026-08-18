import { LAYOUT_FAMILIES, VISUAL_DENSITIES, type AdLayoutZoneType, type LayoutFamily, type VisualDensity } from "./ad-layout.types.js";

/**
 * Sistema de famílias de layout (Fase 6) — regras por família (dados), nunca um layout fixo nem um
 * switch gigante. `selectLayoutFamily` é uma função pura: mesma entrada, mesma saída, sem I/O,
 * testável isoladamente com objetos simples.
 */

export type LayoutFamilySelectionInput = {
  objective: string;
  infoQuantity: number;
  hasStrongPrice: boolean;
  hasDiscount: boolean;
  hasSocialProof: boolean;
  hasUrgency: boolean;
  hasManyBenefits: boolean;
  format: string;
  hasReferenceImage: boolean;
};

export type LayoutFamilyRule = {
  family: LayoutFamily;
  requiredZoneTypes: AdLayoutZoneType[];
  allowedZoneTypes: AdLayoutZoneType[];
  defaultZonePriority: Partial<Record<AdLayoutZoneType, number>>;
  densityCompatibility: VisualDensity[];
  selectionScore(input: LayoutFamilySelectionInput): number;
};

const COMMERCIAL_OBJECTIVES = new Set(["promocao_oferta", "venda_conversao"]);

export const LAYOUT_FAMILY_RULES: Record<LayoutFamily, LayoutFamilyRule> = {
  flash_sale: {
    family: "flash_sale",
    requiredZoneTypes: ["price", "discount", "cta"],
    allowedZoneTypes: ["price", "discount", "badge", "headline", "cta", "heroProduct"],
    defaultZonePriority: { discount: 1, price: 1, headline: 2, cta: 2, badge: 3 },
    densityCompatibility: ["performance", "max_performance"],
    selectionScore: (input) =>
      (input.hasDiscount ? 3 : 0) + (input.hasUrgency ? 3 : 0) + (input.hasStrongPrice ? 1 : 0) + (COMMERCIAL_OBJECTIVES.has(input.objective) ? 1 : 0),
  },
  price_dominant: {
    family: "price_dominant",
    requiredZoneTypes: ["price", "cta"],
    allowedZoneTypes: ["price", "discount", "headline", "cta", "badge", "heroProduct"],
    defaultZonePriority: { price: 1, discount: 1, headline: 2, cta: 2 },
    densityCompatibility: ["performance", "max_performance"],
    selectionScore: (input) => (input.hasStrongPrice ? 3 : 0) + (input.hasDiscount ? 1 : 0) + (COMMERCIAL_OBJECTIVES.has(input.objective) ? 1 : 0),
  },
  hero_offer: {
    family: "hero_offer",
    requiredZoneTypes: ["headline", "cta"],
    allowedZoneTypes: ["headline", "price", "discount", "cta", "heroProduct"],
    defaultZonePriority: { headline: 1, price: 2, cta: 2 },
    densityCompatibility: ["clean", "performance"],
    // Pesos deliberadamente mais baixos que os sinais dedicados (preço forte, prova social, etc.)
    // — hero_offer é o fallback pra "pouca informação, sem sinal comercial específico dominante",
    // nunca deveria vencer um sinal mais específico só por ter poucos itens.
    selectionScore: (input) => (input.hasStrongPrice ? 2 : 0) + (input.infoQuantity <= 3 ? 1 : 0),
  },
  comparison: {
    family: "comparison",
    requiredZoneTypes: ["price", "discount"],
    allowedZoneTypes: ["price", "discount", "benefits", "headline", "cta"],
    defaultZonePriority: { discount: 1, price: 1, benefits: 2, headline: 2, cta: 3 },
    densityCompatibility: ["performance", "max_performance"],
    selectionScore: (input) => (input.hasDiscount && input.hasStrongPrice ? 3 : 0) + (input.hasManyBenefits ? 1 : 0),
  },
  benefit_grid: {
    family: "benefit_grid",
    requiredZoneTypes: ["benefits", "cta"],
    allowedZoneTypes: ["headline", "benefits", "specs", "cta", "badge", "heroProduct"],
    defaultZonePriority: { headline: 1, benefits: 2, cta: 3, specs: 3 },
    densityCompatibility: ["performance", "max_performance"],
    selectionScore: (input) => (input.hasManyBenefits ? 3 : 0) + (!input.hasStrongPrice ? 1 : 0),
  },
  product_feature: {
    family: "product_feature",
    requiredZoneTypes: ["headline", "specs"],
    allowedZoneTypes: ["headline", "specs", "benefits", "cta", "heroProduct"],
    defaultZonePriority: { headline: 1, specs: 2, benefits: 2, cta: 3 },
    densityCompatibility: ["clean", "performance"],
    selectionScore: (input) => (!input.hasStrongPrice && input.hasManyBenefits ? 2 : 0) + (!COMMERCIAL_OBJECTIVES.has(input.objective) ? 1 : 0),
  },
  social_proof: {
    family: "social_proof",
    requiredZoneTypes: ["rating", "cta"],
    allowedZoneTypes: ["rating", "salesProof", "headline", "cta", "heroProduct"],
    defaultZonePriority: { rating: 1, salesProof: 1, headline: 2, cta: 3 },
    densityCompatibility: ["performance", "max_performance"],
    selectionScore: (input) => (input.hasSocialProof ? 3 : 0),
  },
  premium_product: {
    family: "premium_product",
    requiredZoneTypes: ["headline"],
    allowedZoneTypes: ["headline", "cta", "heroProduct", "logo"],
    defaultZonePriority: { headline: 1, cta: 2 },
    densityCompatibility: ["clean"],
    selectionScore: (input) => (input.infoQuantity <= 2 ? 3 : 0) + (!COMMERCIAL_OBJECTIVES.has(input.objective) ? 1 : 0),
  },
  minimal_offer: {
    family: "minimal_offer",
    requiredZoneTypes: ["price", "cta"],
    allowedZoneTypes: ["price", "headline", "cta", "heroProduct"],
    defaultZonePriority: { price: 1, headline: 2, cta: 2 },
    densityCompatibility: ["clean", "performance"],
    selectionScore: (input) => (input.hasStrongPrice && input.infoQuantity <= 3 ? 2 : 0),
  },
  performance_product: {
    family: "performance_product",
    requiredZoneTypes: ["price", "headline", "cta"],
    allowedZoneTypes: ["price", "discount", "headline", "benefits", "specs", "badge", "cta", "heroProduct"],
    defaultZonePriority: { price: 1, headline: 1, cta: 2, discount: 2, benefits: 3, specs: 3, badge: 3 },
    densityCompatibility: ["performance", "max_performance"],
    // Fallback generalista — sempre pontua algo, garante que sempre exista uma família vencedora.
    selectionScore: (input) => 1 + (input.hasStrongPrice ? 1 : 0) + (input.infoQuantity >= 4 ? 1 : 0),
  },
};

/** Escolhe a família com maior pontuação; empate resolvido pela ordem de `LAYOUT_FAMILIES`
 * (determinístico, nunca aleatório). Sempre devolve uma família — `performance_product` garante
 * pontuação mínima 1, nunca fica sem vencedor. */
export function selectLayoutFamily(input: LayoutFamilySelectionInput): LayoutFamily {
  let best: LayoutFamily = "performance_product";
  let bestScore = -Infinity;
  for (const family of LAYOUT_FAMILIES) {
    const score = LAYOUT_FAMILY_RULES[family].selectionScore(input);
    if (score > bestScore) {
      bestScore = score;
      best = family;
    }
  }
  return best;
}

/** Densidade compatível com a família escolhida mais próxima da densidade preferida (VISUAL_
 * DENSITIES por ordem crescente) — nunca devolve uma densidade que a família não suporta. */
export function resolveCompatibleDensity(family: LayoutFamily, preferred: VisualDensity): VisualDensity {
  const compatible = LAYOUT_FAMILY_RULES[family].densityCompatibility;
  if (compatible.includes(preferred)) return preferred;
  return compatible[0] ?? VISUAL_DENSITIES[1];
}
