import type { MediaAssetRecord } from "../../../application/ports/media-catalog.port.js";

/**
 * LOCAL OFFICIAL ASSET QUALIFICATION (seção 10) — checagem ADICIONAL, ao lado de
 * `canStartProductCompositing` (Unified Coverage Model, nunca alterado): garante que a fonte
 * passou pelo Visual Candidate Validator reaproveitado (`visualValidationStage` presente, nunca
 * assumido) e carrega a capacidade `compositing_source`. As duas checagens juntas (a existente +
 * esta) é que decidem se o Product Compositing pode aceitar o asset — nenhuma das duas substitui
 * a outra.
 */
export type CompositingSourceEligibility = { eligible: true } | { eligible: false; reason: string };

export function assertCompositingSourceEligible(asset: MediaAssetRecord): CompositingSourceEligibility {
  if (asset.visualValidationStage === undefined) {
    return { eligible: false, reason: `Asset "${asset.assetId}" nunca passou pelo Visual Candidate Validator (visualValidationStage ausente) — rode --validate-local-asset antes de compor.` };
  }
  if (!(asset.capabilities ?? []).includes("compositing_source")) {
    return { eligible: false, reason: `Asset "${asset.assetId}" não tem a capacidade "compositing_source" — não é uma fonte apta para composição de produto.` };
  }
  return { eligible: true };
}
