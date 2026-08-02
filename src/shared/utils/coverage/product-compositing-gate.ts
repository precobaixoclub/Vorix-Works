import { assetSignalFromMediaAssetRecord } from "./asset-signal.js";
import { evaluateInteractionForCompositing } from "./requirement-evaluator.js";
import { isRequirementResolved } from "./requirement-state.js";
import type { MediaAssetRecord } from "../../../application/ports/media-catalog.port.js";
import type { ProductScreenRecord } from "../../../application/ports/product-screen-catalog.port.js";

/**
 * UNIFIED COVERAGE MODEL — GATE CONJUNTO DE PRODUCT COMPOSITING (seção 8 da sprint): "Executar
 * somente quando Phone Screen Approved + Real Video Approved + Interaction Approved. Caso
 * contrário: nem iniciar." Antes, as três condições eram checadas em lugares diferentes (duas
 * dentro de `compositeProductScreenForAsset`, a terceira nunca era checada) — agora é UMA função,
 * chamada uma vez, antes de qualquer tentativa de composição.
 */
export type ProductCompositingGateResult = { allowed: true } | { allowed: false; reason: string };

export function canStartProductCompositing(input: {
  sourceAsset: MediaAssetRecord;
  productScreen: ProductScreenRecord;
}): ProductCompositingGateResult {
  if (input.sourceAsset.type !== "video") {
    return { allowed: false, reason: `Asset de origem "${input.sourceAsset.assetId}" não é vídeo — Real Video não se aplica.` };
  }
  if (input.sourceAsset.approvalStatus !== "approved") {
    return { allowed: false, reason: `Real Video não aprovado: asset de origem "${input.sourceAsset.assetId}" precisa de approvalStatus="approved" antes de servir de base para composição.` };
  }
  if (input.productScreen.approvalStatus !== "approved") {
    return { allowed: false, reason: `Phone Screen não aprovado: tela de produto "${input.productScreen.screenId}" precisa estar aprovada antes de ser usada em uma composição.` };
  }
  const interactionEvaluation = evaluateInteractionForCompositing(assetSignalFromMediaAssetRecord(input.sourceAsset));
  if (!isRequirementResolved(interactionEvaluation.state)) {
    return { allowed: false, reason: `Interaction não confirmada: ${interactionEvaluation.evidence.detail}` };
  }
  return { allowed: true };
}
