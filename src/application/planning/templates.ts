import type { BriefingType } from "../../domain/briefing/briefing.model.js";
import type { CreativeEngineMode } from "../creative-engine/creative-engine-mode.js";

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
 *
 * `content_request-gpt-creative-v3` (migração "GPT como motor criativo único", PR 6/9) — grafo
 * exclusivo do motor GPT: `content_brief → visual_generation → quality_review → approval`, SEM
 * nós de `strategic_planning`/`copywriting` (João/Maria nunca são agendados nesta árvore — prova
 * estrutural, não apenas ausência de chamada). Selecionado só quando `creativeEngine === "gpt"`;
 * com `"legacy"`, `content_request` continua resolvendo para `-v2` exatamente como antes desta
 * migração.
 */
export const PLANNING_TEMPLATES_BY_PREPARED_COMMAND_TYPE: Partial<Record<BriefingType, string>> = {
  campaign_creation: "campaign_creation-standard-pipeline-v1",
  content_request: "content_request-visual-only-v2",
};

export const CONTENT_REQUEST_GPT_CREATIVE_TEMPLATE = "content_request-gpt-creative-v3";

export function getPlanningTemplateId(type: BriefingType, creativeEngine: CreativeEngineMode = "legacy"): string | undefined {
  if (type === "content_request" && creativeEngine === "gpt") return CONTENT_REQUEST_GPT_CREATIVE_TEMPLATE;
  return PLANNING_TEMPLATES_BY_PREPARED_COMMAND_TYPE[type];
}
