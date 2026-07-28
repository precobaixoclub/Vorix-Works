import { acquireMediaForExecution, mediaGapAnalysisForExecution } from "../../../../interfaces/cli/run-command.js";
import type { ActionDefinition } from "../autonomous-types.js";

function providerConfigured(): boolean {
  return Boolean(process.env.MEDIA_PROVIDER && process.env.MEDIA_PROVIDER_API_KEY);
}

/**
 * FAIL FAST (seção 10, exemplo "não tentar Footage Acquisition com internet desabilitada"): sem
 * `MEDIA_PROVIDER`/`MEDIA_PROVIDER_API_KEY`, `isApplicable` devolve `false` — o Engine nunca chega
 * a chamar `execute`, nunca gasta uma tentativa numa chamada que já sabe que vai falhar.
 */
export const footageAcquisitionAction: ActionDefinition = {
  id: "footage_acquisition",
  name: "Footage Acquisition",
  description: "Busca e baixa filmagem/foto real de um provider externo configurado (Pexels) para preencher os gaps identificados pelo Media Gap Analysis da execução — mesma aquisição por intenção de Shot já usada manualmente em sprints anteriores.",
  resolves: ["video_coverage_low", "asset_diversity_low", "scene_diversity_low"],
  prerequisites: ["MEDIA_PROVIDER e MEDIA_PROVIDER_API_KEY configurados", "Acesso à internet"],
  expectedDurationMsRange: [2000, 30000],
  sideEffects: ["Baixa arquivos reais para assets/media/acquired/", "Indexa novos assets no catálogo de mídia", "Registra entradas no log de aquisição"],
  limitations: ["Sem provider configurado, não tenta nada — nunca falha tentando uma chamada que sabe que vai falhar."],
  maxAttempts: 3,
  backoffMs: 3000,
  isApplicable: () => providerConfigured(),
  execute: async ({ executionId, dryRun }) => {
    const start = Date.now();
    try {
      if (dryRun) {
        const { gap } = await mediaGapAnalysisForExecution(executionId);
        const wouldSucceed = gap.itemsMissing.length > 0 || gap.itemsSubstitute.length > 0;
        const detail = `[dry-run] Buscaria filmagem real para ${gap.itemsMissing.length} item(ns) faltando e ${gap.itemsSubstitute.length} substituto(s) — nenhum download real foi feito.`;
        return { actionId: "footage_acquisition", ok: false, wouldSucceed, detail, sideEffectsApplied: [], durationMs: Date.now() - start };
      }
      const report = await acquireMediaForExecution(executionId);
      const ok = report.acquired > 0;
      const detail = `Buscados: ${report.searched}, baixados: ${report.downloaded}, aceitos no catálogo: ${report.acquired}, rejeitados: ${report.rejected}.`;
      return { actionId: "footage_acquisition", ok, detail, sideEffectsApplied: ok ? ["download_real_footage", "catalog_index"] : [], durationMs: Date.now() - start };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { actionId: "footage_acquisition", ok: false, detail: "Falha ao adquirir filmagem real.", sideEffectsApplied: [], durationMs: Date.now() - start, error: message };
    }
  },
};
