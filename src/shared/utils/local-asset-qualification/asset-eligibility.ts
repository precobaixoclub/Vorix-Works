import type { AssetQualityProfile } from "../../../application/ports/asset-quality-profile.js";
import type { MediaAssetRecord, MediaAssetType } from "../../../application/ports/media-catalog.port.js";
import { MIN_INTERACTION_THRESHOLD } from "../coverage/requirement-evaluator.js";
import { isCapableOfDesiredType } from "./desired-kind-compatibility.js";

/**
 * LOCAL OFFICIAL ASSET QUALIFICATION (seção 7) — avaliação canônica de elegibilidade de um asset
 * para um Shot. Reaproveita constantes/campos já existentes (nunca reimplementa um threshold ou
 * um campo de validação visual) — o único código novo aqui é a COMBINAÇÃO das checagens em um
 * único lugar, para o Media Gap Analysis, Rafa e o Product Compositing nunca precisarem manter
 * regras próprias e divergentes (o motivo explícito da seção 7).
 */

export type ShotEligibilityRequirements = {
  desiredType?: MediaAssetType;
  screenVisibleRequired?: boolean;
  compositingRequired?: boolean;
  interactionRequired?: boolean;
  campaignId?: string;
  clientId?: string;
  qualityProfile?: AssetQualityProfile;
};

export type EligibilityResult = { eligible: boolean; reasons: string[] };

export function isEligibleForShot(asset: MediaAssetRecord, requirements: ShotEligibilityRequirements): EligibilityResult {
  const reasons: string[] = [];

  if (!asset.available) reasons.push("Arquivo físico não encontrado no último rescan (available=false).");
  if (asset.approvalStatus === "rejected") reasons.push("Asset rejeitado (approvalStatus=rejected).");
  if (asset.approvalStatus === "license_blocked") reasons.push("Asset bloqueado por licença (approvalStatus=license_blocked).");
  if (asset.license && asset.license.allowsCommercialUse === false) reasons.push("Licença não permite uso comercial.");

  if (!isCapableOfDesiredType(asset, requirements.desiredType)) {
    reasons.push(`Nem o tipo físico (${asset.type}) nem as capacidades (${(asset.capabilities ?? []).join(", ") || "nenhuma"}) atendem o tipo desejado "${requirements.desiredType}".`);
  }

  if (requirements.screenVisibleRequired && asset.screenVisible !== true) {
    reasons.push(`Tela visível exigida, mas screenVisible=${asset.screenVisible ?? "nunca validado"}.`);
  }

  if (requirements.compositingRequired && asset.compositingReady !== true) {
    reasons.push(`Composição de produto exigida, mas compositingReady=${asset.compositingReady ?? "nunca validado"}.`);
  }

  if (requirements.interactionRequired && (asset.humanInteractionScore ?? 0) < MIN_INTERACTION_THRESHOLD) {
    reasons.push(`Interação exigida, mas humanInteractionScore=${asset.humanInteractionScore ?? "nunca validado"} (mínimo ${MIN_INTERACTION_THRESHOLD}).`);
  }

  if (requirements.campaignId && asset.campaign && asset.campaign !== requirements.campaignId) {
    reasons.push(`Asset pertence à campanha "${asset.campaign}", não a "${requirements.campaignId}".`);
  }

  if (requirements.clientId && asset.client && asset.client !== requirements.clientId) {
    reasons.push(`Asset pertence ao cliente "${asset.client}", não a "${requirements.clientId}".`);
  }

  return { eligible: reasons.length === 0, reasons };
}
