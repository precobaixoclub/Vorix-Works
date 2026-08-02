import type { BriefingType } from "../../domain/briefing/briefing.model.js";

/**
 * Registro de templates de planejamento por tipo de `PreparedCommand` — mesmo padrão de
 * `schema-registry.ts` (Sprint 07): `Partial<Record<...>>`, só `campaign_creation` populado.
 * Quem chama trata a ausência como "sem template ainda" (`ValidationReport` cobre isso), nunca
 * monta um Planning pela metade.
 */
export const PLANNING_TEMPLATES_BY_PREPARED_COMMAND_TYPE: Partial<Record<BriefingType, string>> = {
  campaign_creation: "campaign_creation-standard-pipeline-v1",
};

export function getPlanningTemplateId(type: BriefingType): string | undefined {
  return PLANNING_TEMPLATES_BY_PREPARED_COMMAND_TYPE[type];
}
