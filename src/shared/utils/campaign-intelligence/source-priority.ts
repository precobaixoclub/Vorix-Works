import { SOURCE_PRIORITY_TIERS, type SourcePriorityOrigin, type SourcePriorityTierId } from "../../../domain/campaign-intelligence/campaign-intelligence.model.js";

/**
 * Prioridade de fonte (seção 10) — tabela fixa e explícita, nunca um julgamento implícito.
 * "Nunca substituir um material oficial por um mockup": `rankBySourcePriority` sempre ordena do
 * tier mais confiável (1) para o menos confiável (7), então `pickHighestPriority` nunca escolhe
 * um item de tier pior quando um de tier melhor está disponível.
 */

const ORIGIN_TO_TIER: Record<SourcePriorityOrigin, SourcePriorityTierId> = {
  campaign_upload: 1,
  official_brand_library: 2,
  company_intelligence: 3,
  official_website: 4,
  historical_library: 5,
  stock_provider: 6,
  generic_content: 7,
};

export function tierForOrigin(origin: SourcePriorityOrigin): SourcePriorityTierId {
  return ORIGIN_TO_TIER[origin];
}

export function tierLabel(tier: SourcePriorityTierId): string {
  return SOURCE_PRIORITY_TIERS.find((entry) => entry.tier === tier)?.label ?? "Desconhecido";
}

export function rankBySourcePriority<T>(items: T[], tierOf: (item: T) => SourcePriorityTierId): T[] {
  return [...items].sort((a, b) => tierOf(a) - tierOf(b));
}

export function pickHighestPriority<T>(items: T[], tierOf: (item: T) => SourcePriorityTierId): T | undefined {
  return rankBySourcePriority(items, tierOf)[0];
}
