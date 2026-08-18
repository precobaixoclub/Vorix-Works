import { normalize } from "./skill-parsing.js";
import type { ReferenceCommercialFacts } from "./reference-intelligence.types.js";

/**
 * Denylist de condições comerciais que NUNCA podem ser afirmadas sem confirmação explícita —
 * requisito "proibir alucinação comercial". A maioria destas categorias não é algo que se
 * confirma numa foto de produto (estoque, garantia, popularidade, avaliações, vendas), então
 * entram sempre como risco quando aparecem no texto. `frete grátis` é a única exceção tratada à
 * parte (pode ser legitimamente confirmada por `shippingInfo`).
 */
const ALWAYS_UNCONFIRMABLE_PHRASES: string[] = [
  "estoque limitado",
  "ultimas unidades",
  "poucas unidades",
  "promocao termina",
  "oferta termina",
  "so ate amanha",
  "acaba hoje",
  "garantia",
  "alta qualidade",
  "material premium",
  "mais vendido",
  "o mais popular",
  "produto exclusivo",
  "exclusividade",
  "avaliacoes positivas",
  "milhares de vendas",
  "vendas confirmadas",
  "aprovado por clientes",
];

const FREE_SHIPPING_PHRASES: string[] = ["frete gratis", "envio gratis", "frete gratuito"];

/**
 * Devolve as frases de condição comercial NÃO confirmadas encontradas literalmente no texto —
 * comparação normalizada (minúsculas, sem acento), mesmo padrão de `detectGenericPhrases`. Vazio
 * quando nada suspeito é encontrado. `confirmedFacts` é o que realmente foi extraído/confirmado
 * (Reference Intelligence) — usado só para liberar "frete grátis" quando `shippingInfo` confirma.
 */
export function detectUnconfirmedCommercialClaims(text: string, confirmedFacts?: ReferenceCommercialFacts): string[] {
  if (!text?.trim()) return [];
  const normalized = normalize(text);
  const found = ALWAYS_UNCONFIRMABLE_PHRASES.filter((phrase) => normalized.includes(normalize(phrase)));

  const shippingConfirmed = Boolean(confirmedFacts?.shippingInfo);
  if (!shippingConfirmed) {
    found.push(...FREE_SHIPPING_PHRASES.filter((phrase) => normalized.includes(normalize(phrase))));
  }

  return found;
}
