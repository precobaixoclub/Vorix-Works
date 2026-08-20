import type { CreativeContext, CreativeContextAsset, CreativeContextHistoryEntry } from "../../shared/utils/gpt-creative-plan.types.js";
import {
  commercialFactsFromReferenceIntelligence,
  extractCommercialFactsFromText,
  mergeCommercialFacts,
  COMMERCIAL_FACT_TYPE_LABELS_PT,
  type CommercialFact,
} from "../../shared/utils/commercial-fact-normalizer.js";
import type { ReferenceIntelligence } from "../../shared/utils/reference-intelligence.types.js";

/**
 * Monta o `creative_context` consolidado do motor GPT — migração "GPT como motor criativo único"
 * (PR 5/9). Promove `buildCreativeContext` de `run-gpt-creative-prototype.ts` (que só extraía
 * fatos comerciais de imagens de referência) para cobrir TODAS as fontes pedidas: fatos do texto
 * livre do usuário também, e o perfil de marca/negócio/público/histórico quando disponível.
 *
 * Dependências como PORTA ESTREITA (nunca `ClaraKnowledgePort`/`ContentGenerationHistoryPort`
 * completos importados diretamente aqui — mesmo padrão de `companyKnowledgeSource`/
 * `assetMetadataSource` já usado em `container.ts`): quem monta o container real adapta os ports
 * completos pra esta forma estreita, isolando este módulo de qualquer detalhe de infraestrutura.
 */

export type CreativeBrandProfile = {
  brandName?: string;
  positioning?: string;
  businessDescription?: string;
  targetAudience?: string;
  productsOrServices?: string[];
  brandColors?: string[];
  visualIdentityNotes?: string;
};

export type BuildCreativeContextDeps = {
  /** Porta estreita — devolve o perfil de marca já resolvido para o workspace, ou `undefined`
   * quando não há nenhum dado de marca cadastrado (nunca inventa um perfil). */
  resolveBrandProfile?(workspaceId: string): Promise<CreativeBrandProfile | undefined>;
  /** Memória editorial — últimas peças aprovadas do workspace, para o GPT evitar repetir
   * headline/CTA/conceito recentes. */
  resolveRecentHistory?(workspaceId: string, limit?: number): Promise<CreativeContextHistoryEntry[]>;
  /** Mesma porta que `run-gpt-creative-prototype.ts` já usa — reaproveitada sem alteração para
   * extrair fatos comerciais REAIS de imagens de referência (nunca inventados pelo GPT). */
  referenceIntelligenceExtractor?: { extract(imageUrls: string[]): Promise<ReferenceIntelligence | undefined> };
};

export type BuildCreativeContextInput = {
  workspaceId: string;
  /** Nome da marca — sempre fornecido explicitamente pelo caller; usado como fallback quando
   * `resolveBrandProfile` não devolve nada ou não define `brandName`. */
  brandName: string;
  objective: string;
  channel: string;
  /** Proporção/formato final, ex.: "4:5", "9:16", "1:1". */
  format: string;
  ideaText: string;
  assets: CreativeContextAsset[];
  brandColors?: string[];
  forbiddenElements?: string[];
};

function formatConfirmedFacts(facts: CommercialFact[]): string[] {
  return facts.map((fact) => `${COMMERCIAL_FACT_TYPE_LABELS_PT[fact.type]}: ${fact.value}${fact.currency ? ` ${fact.currency}` : ""}`);
}

export async function buildCreativeContext(deps: BuildCreativeContextDeps, input: BuildCreativeContextInput): Promise<CreativeContext> {
  const referenceUrls = input.assets.filter((asset) => asset.role === "product_photo" || asset.role === "screenshot").map((asset) => asset.url);

  let imageFacts: CommercialFact[] = [];
  if (deps.referenceIntelligenceExtractor && referenceUrls.length > 0) {
    const intelligence = await deps.referenceIntelligenceExtractor.extract(referenceUrls).catch(() => undefined);
    if (intelligence?.commercialFacts) imageFacts = commercialFactsFromReferenceIntelligence(intelligence.commercialFacts);
  }
  // Achado da auditoria "Rodada 3": o protótipo original só extraía fatos de imagens de
  // referência, nunca do texto livre do usuário — um preço mencionado só na ideia do cliente
  // (ex.: "de R$79,90 por R$39,99") nunca chegava ao `creative_context`. `mergeCommercialFacts`
  // aplica a mesma regra de precedência já usada pelo resto do produto (imagem vence por padrão,
  // texto só vence com linguagem explícita de atualização/correção).
  const textFacts = extractCommercialFactsFromText(input.ideaText);
  const { facts: mergedFacts } = mergeCommercialFacts(imageFacts, textFacts);
  const confirmedFacts = formatConfirmedFacts(mergedFacts);

  const brandProfile = await deps.resolveBrandProfile?.(input.workspaceId).catch(() => undefined);
  const recentHistory = await deps.resolveRecentHistory?.(input.workspaceId, 5).catch(() => []);

  return {
    brandName: brandProfile?.brandName ?? input.brandName,
    objective: input.objective,
    channel: input.channel,
    format: input.format,
    ideaText: input.ideaText,
    assets: input.assets,
    confirmedFacts,
    brandColors: input.brandColors ?? brandProfile?.brandColors,
    forbiddenElements: input.forbiddenElements,
    audience: brandProfile?.targetAudience,
    brandPositioning: brandProfile?.positioning,
    businessDescription: brandProfile?.businessDescription,
    productsOrServices: brandProfile?.productsOrServices,
    visualIdentityNotes: brandProfile?.visualIdentityNotes,
    recentHistory: recentHistory && recentHistory.length > 0 ? recentHistory : undefined,
  };
}
