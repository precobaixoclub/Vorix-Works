import type { AdLayoutZone, VisualDensity } from "./ad-layout.types.js";

/**
 * Controle de quantidade de informação (Fase 14) — cada formato/densidade tem um limite de
 * complexidade. Quando o número de zonas candidatas excede o orçamento, remove-se o item de MENOR
 * prioridade em vez de reduzir tipografia infinitamente para caber tudo.
 */

const BASE_ZONE_BUDGET_BY_DENSITY: Record<VisualDensity, number> = {
  clean: 3,
  performance: 5,
  max_performance: 8,
};

// 4:5 comporta mais informação; 1:1 intermediário; 9:16 precisa de mais respiro por causa das
// safe zones de UI (ver `ad-safe-zones.ts`).
const FORMAT_BUDGET_MULTIPLIER: Record<string, number> = {
  "4:5": 1,
  "1:1": 0.8,
  "9:16": 0.7,
  "16:9": 0.8,
};

const MIN_ZONE_BUDGET = 2;

export function resolveInformationBudget(density: VisualDensity, aspectRatio: string): number {
  const base = BASE_ZONE_BUDGET_BY_DENSITY[density];
  const multiplier = FORMAT_BUDGET_MULTIPLIER[aspectRatio] ?? 0.8;
  return Math.max(MIN_ZONE_BUDGET, Math.round(base * multiplier));
}

/** Mantém as zonas de maior prioridade (número menor = mais importante) até o orçamento; descarta
 * o resto. Nunca reordena as posições das zonas mantidas — só filtra. */
export function applyInformationBudget(zones: AdLayoutZone[], budget: number): AdLayoutZone[] {
  if (zones.length <= budget) return zones;
  return [...zones].sort((left, right) => left.priority - right.priority).slice(0, budget);
}
