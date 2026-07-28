import type { MediaCatalogPort } from "../../application/ports/media-catalog.port.js";
import { validateLocalAsset, type ValidateLocalAssetOutcome } from "./local-asset-validator.js";

/**
 * LOCAL OFFICIAL ASSET QUALIFICATION (seção 8) — validação em lote. Reaproveita `validateLocalAsset`
 * por asset (nenhuma lógica de validação própria aqui); o "não reprocessar assets idênticos" já é
 * garantido por `validateLocalAsset` (compara hash contra `validationDate`), então o lote só
 * precisa decidir QUAIS assets pertencem ao escopo pedido, nunca COMO validar cada um.
 */

export type BatchValidateLocalAssetsInput = {
  campaignId?: string;
  clientId?: string;
  force?: boolean;
};

export type BatchValidateLocalAssetsResult = {
  totalCandidates: number;
  validated: number;
  skipped: number;
  failed: number;
  outcomes: ValidateLocalAssetOutcome[];
};

function isInScope(absolutePath: string, campaign: string | undefined, input: BatchValidateLocalAssetsInput): boolean {
  const normalizedPath = absolutePath.replace(/\\/g, "/").toLowerCase();
  if (input.campaignId) {
    if (campaign === input.campaignId) return true;
    if (normalizedPath.includes(`campaign-uploads/${input.campaignId.toLowerCase()}`)) return true;
    if (normalizedPath.includes(`campaign-frames/${input.campaignId.toLowerCase()}`)) return true;
  }
  if (input.clientId && normalizedPath.includes("company-screenshots")) return true;
  return false;
}

export async function validateLocalAssetsForCampaign(catalog: MediaCatalogPort, input: BatchValidateLocalAssetsInput): Promise<BatchValidateLocalAssetsResult> {
  const assets = await catalog.list();
  const candidates = assets.filter((asset) => isInScope(asset.absolutePath, asset.campaign, input));

  const outcomes: ValidateLocalAssetOutcome[] = [];
  for (const asset of candidates) {
    try {
      const outcome = await validateLocalAsset(catalog, {
        assetId: asset.assetId,
        campaignId: input.campaignId,
        clientId: input.clientId,
        force: input.force,
      });
      outcomes.push(outcome);
    } catch (error) {
      outcomes.push({ assetId: asset.assetId, skipped: false, error: (error as Error).message });
    }
  }

  return {
    totalCandidates: candidates.length,
    validated: outcomes.filter((outcome) => !outcome.skipped && !outcome.error).length,
    skipped: outcomes.filter((outcome) => outcome.skipped).length,
    failed: outcomes.filter((outcome) => outcome.error).length,
    outcomes,
  };
}
