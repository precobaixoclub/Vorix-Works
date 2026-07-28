import { mediaGapAnalysisForExecution } from "../../../../interfaces/cli/run-command.js";
import type { ActionDefinition } from "../autonomous-types.js";

/**
 * FAIL FAST honesto (seção 10) — "unknown" não tem solução conhecida por definição. Esta ação
 * nunca reporta `ok: true`; sua única função é enriquecer o histórico/relatório com o diagnóstico
 * real do Media Gap Analysis antes do Engine escalonar para um humano.
 */
export const gapAnalysisAction: ActionDefinition = {
  id: "gap_analysis",
  name: "Gap Analysis",
  description: "Recalcula o diagnóstico de lacunas de mídia (Media Gap Analysis) para a execução, sem alterar catálogo nem baixar nada — enriquecimento diagnóstico para bloqueios não classificados.",
  resolves: ["unknown"],
  prerequisites: ["asset-report.json já gravado pelo VisualAssetResolver para a execução"],
  expectedDurationMsRange: [50, 500],
  sideEffects: [],
  limitations: ["Nunca resolve um bloqueio sozinho — só produz diagnóstico para o histórico/relatório antes do escalonamento."],
  maxAttempts: 1,
  backoffMs: 0,
  isApplicable: () => true,
  execute: async ({ executionId }) => {
    const start = Date.now();
    try {
      const { gap } = await mediaGapAnalysisForExecution(executionId);
      const detail = `Diagnóstico: ${gap.itemsMissing.length} item(ns) faltando, ${gap.itemsSubstitute.length} substituto(s), ${gap.shotsWithoutRealFootage.length} Shot(s) sem filmagem real.`;
      return { actionId: "gap_analysis", ok: false, wouldSucceed: false, detail, sideEffectsApplied: [], durationMs: Date.now() - start };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { actionId: "gap_analysis", ok: false, detail: "Falha ao gerar diagnóstico de gap de mídia.", sideEffectsApplied: [], durationMs: Date.now() - start, error: message };
    }
  },
};
