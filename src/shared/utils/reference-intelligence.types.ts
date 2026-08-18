/**
 * Fatos estruturados extraídos de imagens de referência anexadas pelo usuário — não é saída de
 * nenhuma Skill (é produzida por infraestrutura, antes do planejamento sequer começar), então
 * qualquer Skill pode importar este tipo diretamente sem violar ADR 0002 (só proíbe uma Skill
 * importar de OUTRA Skill). `src/shared` continua puro/sem estado: este arquivo só tem tipos e um
 * parser puro, nenhuma chamada de IA/rede (isso vive em
 * `src/infrastructure/ai-providers/openai-reference-intelligence-extractor.ts`).
 *
 * Corrige a falha crítica encontrada ao vivo: sem isto, uma foto de referência com preço, desconto
 * e condição de oferta claramente visíveis era reduzida a "tipo de produto/cena, cores, estilo" —
 * todo fato comercial era descartado antes mesmo de chegar ao planejamento.
 */

export const REFERENCE_INTELLIGENCE_RELATIONSHIPS = [
  "same_product",
  "different_products",
  "different_angles",
  "listing_and_detail",
  "visual_inspiration",
  "brand_identity",
  "unknown",
] as const;

export type ReferenceIntelligenceRelationship = (typeof REFERENCE_INTELLIGENCE_RELATIONSHIPS)[number];

export type ReferenceVerifiedFacts = {
  productType?: string;
  productName?: string;
  category?: string;
  brand?: string;
};

export type ReferenceVisualFacts = {
  colors: string[];
  visualCharacteristics: string[];
  relevantText: string[];
  ctaPresent: boolean;
  imageContext?: string;
  elementsToPreserve: string[];
};

export type ReferenceCommercialFacts = {
  currentPrice?: string;
  previousPrice?: string;
  discountPercent?: string;
  promotion?: string;
  commercialConditions: string[];
  shippingInfo?: string;
};

/**
 * `claimSourceMap` é o requisito de "toda afirmação relevante precisa ser rastreável até uma
 * fonte" (`claim -> source`, ex.: `"R$39,99" -> "imagem 2"`) — usado por Lucas para detectar
 * quando a copy inventa um dado que não existe em `claimSourceMap` nem em `commercialFacts`.
 */
export type ReferenceIntelligence = {
  imagesAnalyzed: number;
  /** Índice (0-based) da imagem mais representativa/limpa para virar entrada real de pixels na
   * geração (`Pedro`/`/v1/images/edits`) — corrige o achado ao vivo de a primeira imagem anexada
   * nem sempre ser a melhor referência (ex.: print de grade com vários produtos anexado antes da
   * foto limpa do produto). */
  primaryImageIndex: number;
  multiImageRelationship: ReferenceIntelligenceRelationship;
  relationshipReasoning?: string;
  verifiedFacts: ReferenceVerifiedFacts;
  visualFacts: ReferenceVisualFacts;
  commercialFacts: ReferenceCommercialFacts;
  /** Fatos que a imagem sugere mas não confirma com segurança — nunca devem ser tratados como
   * `verified_facts`/`commercial_facts` por nenhum consumidor downstream. */
  uncertainFacts: string[];
  claimSourceMap: Record<string, string>;
};

function asStringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const stringValue = asStringOrUndefined(raw);
    if (stringValue) result[key] = stringValue;
  }
  return result;
}

function asRelationship(value: unknown): ReferenceIntelligenceRelationship {
  return (REFERENCE_INTELLIGENCE_RELATIONSHIPS as readonly string[]).includes(value as string)
    ? (value as ReferenceIntelligenceRelationship)
    : "unknown";
}

/**
 * Nunca lança — entrada malformada/ausente vira `undefined`, tratado por todo consumidor como
 * "sem Reference Intelligence disponível" (mesmo comportamento de hoje, antes desta funcionalidade
 * existir). Mesma convenção best-effort de `OpenAiVisionDescriber.describe`.
 */
export function parseReferenceIntelligence(raw: string | undefined | null): ReferenceIntelligence | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const verifiedFactsRaw = (parsed.verifiedFacts ?? {}) as Record<string, unknown>;
    const visualFactsRaw = (parsed.visualFacts ?? {}) as Record<string, unknown>;
    const commercialFactsRaw = (parsed.commercialFacts ?? {}) as Record<string, unknown>;

    return {
      imagesAnalyzed: typeof parsed.imagesAnalyzed === "number" ? parsed.imagesAnalyzed : 0,
      primaryImageIndex: typeof parsed.primaryImageIndex === "number" && parsed.primaryImageIndex >= 0 ? parsed.primaryImageIndex : 0,
      multiImageRelationship: asRelationship(parsed.multiImageRelationship),
      relationshipReasoning: asStringOrUndefined(parsed.relationshipReasoning),
      verifiedFacts: {
        productType: asStringOrUndefined(verifiedFactsRaw.productType),
        productName: asStringOrUndefined(verifiedFactsRaw.productName),
        category: asStringOrUndefined(verifiedFactsRaw.category),
        brand: asStringOrUndefined(verifiedFactsRaw.brand),
      },
      visualFacts: {
        colors: asStringArray(visualFactsRaw.colors),
        visualCharacteristics: asStringArray(visualFactsRaw.visualCharacteristics),
        relevantText: asStringArray(visualFactsRaw.relevantText),
        ctaPresent: visualFactsRaw.ctaPresent === true,
        imageContext: asStringOrUndefined(visualFactsRaw.imageContext),
        elementsToPreserve: asStringArray(visualFactsRaw.elementsToPreserve),
      },
      commercialFacts: {
        currentPrice: asStringOrUndefined(commercialFactsRaw.currentPrice),
        previousPrice: asStringOrUndefined(commercialFactsRaw.previousPrice),
        discountPercent: asStringOrUndefined(commercialFactsRaw.discountPercent),
        promotion: asStringOrUndefined(commercialFactsRaw.promotion),
        commercialConditions: asStringArray(commercialFactsRaw.commercialConditions),
        shippingInfo: asStringOrUndefined(commercialFactsRaw.shippingInfo),
      },
      uncertainFacts: asStringArray(parsed.uncertainFacts),
      claimSourceMap: asStringRecord(parsed.claimSourceMap),
    };
  } catch {
    return undefined;
  }
}

/** Único fato comercial forte disponível (preço atual, desconto ou promoção) — usado por João/
 * Maria/Lucas para decidir se existe um argumento comercial concreto forte o suficiente para
 * superar uma manchete genérica (requisito de hierarquia de fatos comerciais). */
export function hasStrongCommercialFact(facts: ReferenceCommercialFacts | undefined): boolean {
  if (!facts) return false;
  return Boolean(facts.currentPrice || facts.discountPercent || facts.promotion);
}
