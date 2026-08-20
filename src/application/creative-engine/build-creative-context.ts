import type { CreativeContext, CreativeContextAsset, CreativeContextBrandMaterial, CreativeContextHistoryEntry } from "../../shared/utils/gpt-creative-plan.types.js";
import {
  commercialFactsFromReferenceIntelligence,
  extractCommercialFactsFromText,
  mergeCommercialFacts,
  COMMERCIAL_FACT_TYPE_LABELS_PT,
  type CommercialFact,
} from "../../shared/utils/commercial-fact-normalizer.js";
import type { ReferenceIntelligence } from "../../shared/utils/reference-intelligence.types.js";
import { describeProductionSettingsAsInstructions, type ProductionSettings } from "../../shared/utils/production-settings.types.js";
import { materialTypeToAssetRole, selectRelevantBrandMaterials, type SelectableBrandMaterial } from "./select-brand-materials.js";

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
  /** Diferenciais reais cadastrados em `ProductContext.differentiators` — distinto de
   * `productsOrServices` (o que a marca vende vs. o que a diferencia da concorrência). */
  differentiators?: string[];
  /** Migração "Marca & Materiais" (achado numa autorrevisão) — mesmo tratamento de
   * `positioning`: só real quando não é mais o texto genérico do bootstrap (ver
   * `GENERIC_BRAND_TONE_OF_VOICE` em `container.ts`). */
  toneOfVoice?: string;
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
  /** Migração "Prompt Persistente de Produção" — instruções permanentes + preferências de
   * comportamento do workspace. `undefined` de retorno = workspace nunca configurou nada, nunca
   * inventado. */
  resolveProductionSettings?(workspaceId: string): Promise<ProductionSettings | undefined>;
  /** Materiais da Asset Library do workspace já com URL real resolvida (só os que têm arquivo —
   * ver `SelectableBrandMaterial`). A seleção de relevância para o pedido atual acontece aqui
   * dentro (`selectRelevantBrandMaterials`), nunca no adapter que implementa esta porta — ele só
   * lista o que existe, nunca decide relevância. */
  resolveBrandMaterials?(workspaceId: string): Promise<SelectableBrandMaterial[]>;
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
  const productionSettings = await deps.resolveProductionSettings?.(input.workspaceId).catch(() => undefined);
  const availableMaterials = (await deps.resolveBrandMaterials?.(input.workspaceId).catch(() => [])) ?? [];

  const selection = selectRelevantBrandMaterials(availableMaterials, { ideaText: input.ideaText, objective: input.objective });
  const brandMaterials: CreativeContextBrandMaterial[] = selection.map(({ material, reason }) => ({
    id: material.id,
    name: material.name,
    type: material.materialType ?? "outro",
    priority: material.usagePriority ?? "automatic",
    aiInstructions: material.aiInstructions,
    usageRule: material.usageRule,
    source: "asset_library",
    url: material.url,
    selectionReason: reason,
  }));

  // Materiais selecionados com papel de composição claro (logo/screenshot/produto/referência de
  // estilo) também entram na lista plana `assets[]` — é ela que a composição determinística
  // (`run-gpt-creative-engine.ts`) já sabe consumir por `role`. Nunca duplica uma URL já presente
  // em `input.assets` (ex.: a mesma logo enviada explicitamente nesta chamada E cadastrada na
  // Asset Library).
  const existingAssetUrls = new Set(input.assets.map((asset) => asset.url));
  const materialAssets: CreativeContextAsset[] = [];
  for (const { material } of selection) {
    if (!material.url || existingAssetUrls.has(material.url)) continue;
    const role = materialTypeToAssetRole(material.materialType);
    if (!role) continue;
    materialAssets.push({ url: material.url, role, description: material.aiInstructions ?? material.usageRule ?? "" });
    existingAssetUrls.add(material.url);
  }

  const behaviorPreferences = productionSettings ? describeProductionSettingsAsInstructions(productionSettings) : undefined;
  const forbiddenElements = [...(input.forbiddenElements ?? [])];
  if (productionSettings && !productionSettings.allowFictionalInterfaces) {
    forbiddenElements.push("interface de site/app fictícia ou inventada (só use uma interface real quando houver screenshot real disponível para o que foi pedido)");
  }

  return {
    brandName: brandProfile?.brandName ?? input.brandName,
    objective: input.objective,
    channel: input.channel,
    format: input.format,
    ideaText: input.ideaText,
    assets: [...input.assets, ...materialAssets],
    confirmedFacts,
    brandColors: input.brandColors ?? brandProfile?.brandColors,
    forbiddenElements: forbiddenElements.length > 0 ? forbiddenElements : undefined,
    audience: brandProfile?.targetAudience,
    brandPositioning: brandProfile?.positioning,
    businessDescription: brandProfile?.businessDescription,
    productsOrServices: brandProfile?.productsOrServices,
    differentiators: brandProfile?.differentiators,
    toneOfVoice: brandProfile?.toneOfVoice,
    visualIdentityNotes: brandProfile?.visualIdentityNotes,
    recentHistory: recentHistory && recentHistory.length > 0 ? recentHistory : undefined,
    productionInstructions: productionSettings?.productionPrompt,
    productionInstructionsVersion: productionSettings?.version,
    behaviorPreferences,
    brandMaterials: brandMaterials.length > 0 ? brandMaterials : undefined,
  };
}
