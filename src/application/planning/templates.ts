import type { BriefingType } from "../../domain/briefing/briefing.model.js";

/**
 * Registro de templates de planejamento por tipo de `PreparedCommand` — mesmo padrão de
 * `schema-registry.ts` (Sprint 07): `Partial<Record<...>>`. `content_request` acrescentado depois
 * (caminho reduzido, só geração visual, sem publicação — ver `arthur-planner.ts`). Quem chama
 * trata a ausência como "sem template ainda" (`ValidationReport` cobre isso), nunca monta um
 * Planning pela metade.
 *
 * `content_request-visual-only-v2` substitui a v1 (3 tasks: content_brief → visual_generation →
 * approval) por um grafo de 6 tasks que liga João (estratégia real), Maria (copy real) e Lucas
 * (quality gate real) — antes ausentes do caminho de produção real, ver auditoria da rodada
 * "Ajuste das Skills de Geração de Conteúdo". Versão nova (não sobrescreve o id da v1) para poder
 * reverter trocando 1 linha aqui se algo quebrar em produção, sem precisar reverter migration.
 */
export const PLANNING_TEMPLATES_BY_PREPARED_COMMAND_TYPE: Partial<Record<BriefingType, string>> = {
  campaign_creation: "campaign_creation-standard-pipeline-v1",
  content_request: "content_request-visual-only-v2",
};

export function getPlanningTemplateId(type: BriefingType): string | undefined {
  return PLANNING_TEMPLATES_BY_PREPARED_COMMAND_TYPE[type];
}
