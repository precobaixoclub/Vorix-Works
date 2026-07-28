import type { VisualAssetMetadata } from "../../../application/ports/visual-asset-provider.port.js";
import { classifyAuthenticity, type AuthenticityClassificationInput } from "./authenticity-classification.js";

/** Adaptador `VisualAssetMetadata` → `AuthenticityClassificationInput`, para não espalhar o mapeamento de campos pelo resolver. */
export function classifyVisualAsset(asset: VisualAssetMetadata, now?: Date): ReturnType<typeof classifyAuthenticity> {
  const input: AuthenticityClassificationInput = {
    authenticityClassOverride: asset.authenticityClassOverride,
    ingestionSource: asset.ingestionSource,
    origin: asset.origin,
    kind: asset.kind,
    tags: asset.tags,
    capabilities: asset.capabilities,
    approvalStatus: asset.approvalStatus,
    footageClassification: asset.footageClassification,
    validationDate: asset.validationDate,
    indexedAt: asset.downloadedAt,
    now,
  };
  return classifyAuthenticity(input);
}
