import type { ReferenceCommercialFacts, ReferenceIntelligence } from "./reference-intelligence.types.js";

/**
 * Camada única de normalização de fatos comerciais (Rodada 2, Prioridade 4) — antes desta
 * funcionalidade, preço/desconto só alimentavam `performanceCreativePlan` quando vinham de uma
 * imagem de referência (`ReferenceIntelligence.commercialFacts`); um preço mencionado só no texto
 * livre da ideia do usuário (ex.: "de R$79,90 por R$39,99") nunca chegava à mesma pipeline —
 * achado ao vivo na Rodada 1 (Story do fone SoundMax: preço apareceu na copy/headline, mas nunca
 * como campo estruturado do plano). Esta camada aceita fatos de múltiplas fontes e devolve o MESMO
 * formato — quem consome (`buildPerformanceCreativePlan`) não precisa saber se `R$39,99` veio de
 * uma foto ou de uma frase.
 */

export const COMMERCIAL_FACT_TYPES = [
  "current_price",
  "previous_price",
  "discount_percent",
  "promotion",
  "rating",
  "sales_count",
  "shipping",
  "payment_terms",
] as const;
export type CommercialFactType = (typeof COMMERCIAL_FACT_TYPES)[number];

export const COMMERCIAL_FACT_SOURCES = ["reference_image", "user_text", "registered_product", "workspace_catalog", "other"] as const;
export type CommercialFactSource = (typeof COMMERCIAL_FACT_SOURCES)[number];

export type CommercialFactConfidence = "high" | "medium" | "low";

export type CommercialFact = {
  type: CommercialFactType;
  value: string;
  currency?: string;
  source: CommercialFactSource;
  confidence: CommercialFactConfidence;
  verified: boolean;
};

export type NormalizedCommercialFacts = {
  facts: CommercialFact[];
};

const BRL_PRICE_TOKEN = String.raw`R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+(?:\.\d{2})?)`;
const BRL_PRICE_PATTERN = new RegExp(BRL_PRICE_TOKEN, "gi");
const BRL_FROM_TO_PATTERN = new RegExp(`de\\s+${BRL_PRICE_TOKEN}\\s+por\\s+(?:apenas\\s+)?${BRL_PRICE_TOKEN}`, "i");
const DISCOUNT_PATTERN = /(\d{1,3})\s*%\s*(?:de\s+desconto|off\b|OFF\b)/i;
const DISCOUNT_PREFIX_PATTERN = /-\s*(\d{1,3})\s*%/;
const FREE_SHIPPING_PATTERN = /frete\s+gr[aá]tis/i;
const URGENCY_KEYWORDS = [
  /s[oó]\s+hoje/i,
  /por\s+tempo\s+limitado/i,
  /[uú]ltimas?\s+unidades?/i,
  /estoque\s+limitado/i,
  /oferta\s+relâmpago/i,
  /(?:\d+\s*)?(?:horas?|hrs?)\s+(?:restantes?|para\s+acabar)/i,
];

function formatPriceValue(rawDigits: string): string {
  return `R$ ${rawDigits.trim()}`;
}

/**
 * Extrai fatos comerciais LITERALMENTE presentes no texto livre da ideia do usuário — nunca
 * infere/inventa um valor que não esteja escrito. Regex-based, determinístico, custo zero (sem
 * chamada de IA) — cobre os padrões de português comercial mais comuns ("R$ X,XX", "de X por Y",
 * "X% de desconto/OFF", "frete grátis", urgência). Casos ambíguos (0 ou mais de 2 preços sem um
 * padrão "de...por" explícito) deliberadamente NÃO extraem preço — melhor não extrair nada do que
 * arriscar inverter preço atual/anterior.
 */
export function extractCommercialFactsFromText(text: string): CommercialFact[] {
  const facts: CommercialFact[] = [];
  if (!text?.trim()) return facts;

  const fromTo = text.match(BRL_FROM_TO_PATTERN);
  if (fromTo) {
    facts.push({ type: "previous_price", value: formatPriceValue(fromTo[1]), currency: "BRL", source: "user_text", confidence: "high", verified: true });
    facts.push({ type: "current_price", value: formatPriceValue(fromTo[2]), currency: "BRL", source: "user_text", confidence: "high", verified: true });
  } else {
    const priceMatches = [...text.matchAll(BRL_PRICE_PATTERN)].map((match) => match[1]);
    if (priceMatches.length === 1) {
      facts.push({ type: "current_price", value: formatPriceValue(priceMatches[0]), currency: "BRL", source: "user_text", confidence: "high", verified: true });
    } else if (priceMatches.length === 2) {
      const parsed = priceMatches.map((raw) => ({ raw, numeric: Number(raw.replace(/\./g, "").replace(",", ".")) }));
      const [lower, higher] = parsed[0].numeric <= parsed[1].numeric ? parsed : [parsed[1], parsed[0]];
      facts.push({ type: "current_price", value: formatPriceValue(lower.raw), currency: "BRL", source: "user_text", confidence: "medium", verified: true });
      facts.push({ type: "previous_price", value: formatPriceValue(higher.raw), currency: "BRL", source: "user_text", confidence: "medium", verified: true });
    }
    // 0 ou 3+ preços: ambíguo demais pra decidir sozinho, não extrai nada.
  }

  const discountMatch = text.match(DISCOUNT_PATTERN) ?? text.match(DISCOUNT_PREFIX_PATTERN);
  if (discountMatch) {
    facts.push({ type: "discount_percent", value: `${discountMatch[1]}%`, source: "user_text", confidence: "high", verified: true });
  }

  if (FREE_SHIPPING_PATTERN.test(text)) {
    facts.push({ type: "shipping", value: "Frete grátis", source: "user_text", confidence: "high", verified: true });
  }

  const urgencyMatch = URGENCY_KEYWORDS.map((pattern) => text.match(pattern)?.[0]).find((match): match is string => Boolean(match));
  if (urgencyMatch) {
    facts.push({ type: "promotion", value: urgencyMatch.trim(), source: "user_text", confidence: "medium", verified: true });
  }

  return facts;
}

/** Reaproveita `ReferenceCommercialFacts` (já extraído por visão computacional sobre uma imagem
 * real, Rodada 1) no formato unificado — sempre `confidence: "high"`/`verified: true`, já passou
 * pelo próprio extrator de Reference Intelligence. */
export function commercialFactsFromReferenceIntelligence(facts: ReferenceCommercialFacts | undefined): CommercialFact[] {
  if (!facts) return [];
  const result: CommercialFact[] = [];
  if (facts.currentPrice) result.push({ type: "current_price", value: facts.currentPrice, source: "reference_image", confidence: "high", verified: true });
  if (facts.previousPrice) result.push({ type: "previous_price", value: facts.previousPrice, source: "reference_image", confidence: "high", verified: true });
  if (facts.discountPercent) result.push({ type: "discount_percent", value: facts.discountPercent, source: "reference_image", confidence: "high", verified: true });
  if (facts.promotion) result.push({ type: "promotion", value: facts.promotion, source: "reference_image", confidence: "high", verified: true });
  if (facts.shippingInfo) result.push({ type: "shipping", value: facts.shippingInfo, source: "reference_image", confidence: "high", verified: true });
  for (const condition of facts.commercialConditions) {
    result.push({ type: "payment_terms", value: condition, source: "reference_image", confidence: "high", verified: true });
  }
  return result;
}

/**
 * Combina fatos já extraídos de duas fontes num único formato — quem consome nunca precisa saber
 * a origem. Quando o MESMO `type` aparece nas duas listas, `imageFacts` sempre vence (visão
 * computacional sobre uma foto real é mais confiável que regex sobre texto livre); nunca mistura
 * metade de uma fonte com metade de outra para o mesmo tipo de fato. Genérico o bastante pra
 * aceitar fatos de QUALQUER fonte em `imageFacts`/`textFacts` — o nome reflete o caso de uso mais
 * comum hoje (imagem de referência vs. texto livre), não uma restrição do tipo.
 */
export function mergeCommercialFacts(imageFacts: CommercialFact[], textFacts: CommercialFact[]): CommercialFact[] {
  const typesFromImage = new Set(imageFacts.map((fact) => fact.type));
  return [...imageFacts, ...textFacts.filter((fact) => !typesFromImage.has(fact.type))];
}

export type CommercialFactNormalizerInput = {
  referenceIntelligence?: ReferenceIntelligence;
  ideaText?: string;
};

/**
 * Unifica fatos comerciais a partir das fontes BRUTAS disponíveis (imagem de referência ainda não
 * extraída para o formato unificado + texto livre da ideia) — ponto de entrada usado onde as duas
 * fontes brutas estão disponíveis juntas (hoje, só em testes/uso direto; no pipeline real, a
 * extração de texto roda mais cedo — ver `extractCommercialFactsFromText` em
 * `generate-visual-from-idea.ts` — e o merge final roda em Bianca via `mergeCommercialFacts`,
 * porque `referenceIntelligence` e o texto extraído chegam a Bianca por caminhos diferentes do
 * pipeline, nunca juntos na mesma função).
 */
export function normalizeCommercialFacts(input: CommercialFactNormalizerInput): NormalizedCommercialFacts {
  const fromImage = commercialFactsFromReferenceIntelligence(input.referenceIntelligence?.commercialFacts);
  const fromText = extractCommercialFactsFromText(input.ideaText ?? "");
  return { facts: mergeCommercialFacts(fromImage, fromText) };
}

/** Acesso por tipo — evita todo consumidor reimplementar `facts.find(f => f.type === ...)`. */
export function findCommercialFact(normalized: NormalizedCommercialFacts, type: CommercialFactType): CommercialFact | undefined {
  return normalized.facts.find((fact) => fact.type === type);
}

function isCommercialFact(value: unknown): value is CommercialFact {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === "string" &&
    (COMMERCIAL_FACT_TYPES as readonly string[]).includes(candidate.type) &&
    typeof candidate.value === "string" &&
    typeof candidate.source === "string" &&
    (COMMERCIAL_FACT_SOURCES as readonly string[]).includes(candidate.source) &&
    typeof candidate.confidence === "string" &&
    typeof candidate.verified === "boolean"
  );
}

/** Nunca lança — entrada malformada/ausente vira lista vazia, mesma convenção de
 * `parseReferenceIntelligence`. Usado nos limites do pipeline (JSON bruto salvo como campo de
 * briefing) para reidratar o array tipado. */
export function parseCommercialFacts(raw: string | undefined | null): CommercialFact[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCommercialFact);
  } catch {
    return [];
  }
}
