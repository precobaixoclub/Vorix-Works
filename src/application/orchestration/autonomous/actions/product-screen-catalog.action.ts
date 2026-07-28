import { productScreenScan } from "../../../../interfaces/cli/run-command.js";
import type { ActionDefinition } from "../autonomous-types.js";

export const productScreenCatalogAction: ActionDefinition = {
  id: "product_screen_catalog",
  name: "Product Screen Catalog",
  description: "Reescaneia o catálogo de telas de produto (screenshots/mockups aprovados já salvos em disco) para descobrir novas telas disponíveis antes de tentar compositing.",
  resolves: ["product_coverage_low"],
  prerequisites: ["Arquivos de tela de produto (mockup/screenshot) já salvos em disco, aguardando indexação"],
  expectedDurationMsRange: [50, 2000],
  sideEffects: ["Indexa novas telas de produto encontradas em disco no catálogo"],
  limitations: ["Só descobre telas já existentes em disco — não gera nenhuma tela nova."],
  maxAttempts: 2,
  backoffMs: 500,
  isApplicable: () => true,
  execute: async ({ dryRun }) => {
    const start = Date.now();
    try {
      if (dryRun) {
        return { actionId: "product_screen_catalog", ok: false, wouldSucceed: true, detail: "[dry-run] Reescanearia o catálogo de telas de produto — nenhuma alteração real foi feita.", sideEffectsApplied: [], durationMs: Date.now() - start };
      }
      const result = await productScreenScan();
      const ok = result.added > 0 || result.updated > 0;
      const detail = `Escaneadas: ${result.scanned}, novas: ${result.added}, atualizadas: ${result.updated}, indisponíveis: ${result.unavailable}.`;
      return { actionId: "product_screen_catalog", ok, detail, sideEffectsApplied: ok ? ["catalog_index_product_screen"] : [], durationMs: Date.now() - start };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { actionId: "product_screen_catalog", ok: false, detail: "Falha ao escanear catálogo de telas de produto.", sideEffectsApplied: [], durationMs: Date.now() - start, error: message };
    }
  },
};
