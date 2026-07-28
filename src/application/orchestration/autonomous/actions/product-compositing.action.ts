import { listProductScreens, productCompositingCapabilities } from "../../../../interfaces/cli/run-command.js";
import type { ActionDefinition } from "../autonomous-types.js";

/**
 * Nunca fabrica keyframes/marcação de cantos (`compositeProductScreenForAsset` exige coordenadas
 * reais) — restrição herdada de sprints anteriores: marcação de cantos exige julgamento
 * humano/assistido genuíno. Esta ação só confirma se os ingredientes já existem prontos; `ok`
 * nunca é `true`, honestamente, porque uma composição nova de verdade está fora do alcance de uma
 * ação automática segura.
 */
export const productCompositingAction: ActionDefinition = {
  id: "product_compositing",
  name: "Product Compositing",
  description: "Verifica se já existem telas de produto aprovadas e capacidade de compositing disponível — nunca fabrica marcação de cantos; quando a composição exige marcação manual, reporta a limitação honestamente em vez de inventar coordenadas.",
  resolves: ["product_coverage_low"],
  prerequisites: ["Ao menos uma tela de produto aprovada no catálogo", "Filmagem real com tela visível já catalogada"],
  expectedDurationMsRange: [50, 1000],
  sideEffects: [],
  limitations: [
    "Nunca fabrica keyframes/marcação de cantos — isso exige julgamento humano/assistido real (Manual Assisted Compositing).",
    "Só confirma se os ingredientes (tela aprovada + filmagem-base) já existem prontos; não executa uma composição nova sozinho.",
  ],
  maxAttempts: 2,
  backoffMs: 500,
  isApplicable: () => true,
  execute: async () => {
    const start = Date.now();
    try {
      const [capabilities, approvedScreens] = await Promise.all([
        productCompositingCapabilities(),
        listProductScreens({ approvalStatus: "approved" }),
      ]);
      const compositingSupported = capabilities.some((capability) => capability.status === "implemented");
      const detail = compositingSupported
        ? `${approvedScreens.length} tela(s) de produto aprovada(s) disponível(is); composição real exige marcação de cantos assistida/humana, que esta ação não fabrica.`
        : "Nenhuma capacidade de compositing de produto totalmente implementada pelo adaptador atual.";
      return { actionId: "product_compositing", ok: false, wouldSucceed: false, detail, sideEffectsApplied: [], durationMs: Date.now() - start };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { actionId: "product_compositing", ok: false, detail: "Falha ao verificar viabilidade de compositing de produto.", sideEffectsApplied: [], durationMs: Date.now() - start, error: message };
    }
  },
};
