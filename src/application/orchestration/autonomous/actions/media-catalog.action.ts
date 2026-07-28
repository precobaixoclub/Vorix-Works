import { mediaGapAnalysisForExecution } from "../../../../interfaces/cli/run-command.js";
import type { ActionDefinition } from "../autonomous-types.js";

/**
 * Não existe API para forçar o `VisualAssetResolver` a escolher um candidato específico para um
 * Shot específico (protegido, decide sozinho a cada chamada). O único papel honesto desta ação é
 * verificar se candidatos alternativos existem no catálogo — nunca reivindica ter resolvido o
 * bloqueio (`ok` nunca é `true`), deixando o Engine seguir para Footage Acquisition (próximo na
 * prioridade padrão), que de fato adiciona oferta nova.
 */
export const mediaCatalogAction: ActionDefinition = {
  id: "media_catalog",
  name: "Media Catalog",
  description: "Verifica no catálogo de mídia local se há candidato alternativo (substituto) para os Shots que causaram o bloqueio de diversidade.",
  resolves: ["asset_diversity_low", "scene_diversity_low"],
  prerequisites: ["Catálogo de mídia local escaneado (`--media-scan`)"],
  expectedDurationMsRange: [100, 1000],
  sideEffects: [],
  limitations: [
    "Não existe API para forçar o Asset Resolver a escolher um candidato específico para um Shot específico — só verifica se candidatos alternativos existem.",
    "Repetição persistente do mesmo arquivo físico entre Shots é uma limitação conhecida do próprio algoritmo de scoring do Resolver, não algo que esta ação corrige diretamente.",
  ],
  maxAttempts: 2,
  backoffMs: 500,
  isApplicable: () => true,
  execute: async ({ executionId }) => {
    const start = Date.now();
    try {
      const { gap } = await mediaGapAnalysisForExecution(executionId);
      const hasAlternatives = gap.itemsSubstitute.length > 0;
      const detail = hasAlternatives
        ? `${gap.itemsSubstitute.length} candidato(s) substituto(s) encontrado(s) no catálogo, mas o Asset Resolver decide sozinho qual usar — esta ação não pode forçar a escolha.`
        : "Nenhum candidato alternativo encontrado no catálogo local para os Shots em déficit de diversidade.";
      return { actionId: "media_catalog", ok: false, detail, sideEffectsApplied: [], durationMs: Date.now() - start };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { actionId: "media_catalog", ok: false, detail: "Falha ao consultar o catálogo de mídia.", sideEffectsApplied: [], durationMs: Date.now() - start, error: message };
    }
  },
};
