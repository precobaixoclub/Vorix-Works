import type { VisualAssetMetadata } from "../../../application/ports/visual-asset-provider.port.js";
import type { MediaAssetRecord, MediaFootageClassification } from "../../../application/ports/media-catalog.port.js";

/**
 * UNIFIED COVERAGE MODEL — `AssetSignal` é o denominador comum entre os DOIS formatos de asset que
 * hoje o pipeline usa em pontos diferentes: `VisualAssetMetadata` (Production Readiness/Asset
 * Diversity Gate, pós-resolução) e `MediaAssetRecord` (Gap Analysis/catálogo, pré-resolução) — um é
 * um subconjunto estrutural do outro, mas nenhum dos dois pode ser trocado pelo outro sem alterar
 * as Skills que os consomem. `requirement-evaluator.ts` avalia contra `AssetSignal`, nunca contra
 * um dos dois tipos concretos — é isso que permite Gap Analysis e Production Readiness chegarem à
 * MESMA conclusão sobre o MESMO asset, corrigindo a causa raiz das divergências desta sprint.
 */
export type AssetSignal = {
  kind: string;
  tags: string[];
  theme?: string;
  emotion?: string;
  deviceType?: string;
  deviceConfidence?: number;
  screenVisible?: boolean;
  compositingReady?: boolean;
  humanInteractionScore?: number;
  footageClassification?: MediaFootageClassification;
  approvalStatus?: string;
  physicalKey?: string;
};

function physicalKeyOf(absolutePath: string): string {
  return absolutePath.replace(/\\/g, "/").toLowerCase();
}

export function assetSignalFromVisualAssetMetadata(asset: VisualAssetMetadata): AssetSignal {
  return {
    kind: asset.kind,
    tags: asset.tags,
    theme: asset.theme,
    emotion: asset.emotion,
    deviceType: undefined,
    deviceConfidence: asset.deviceConfidence,
    screenVisible: asset.screenVisible,
    compositingReady: asset.compositingReady,
    humanInteractionScore: asset.humanInteractionScore,
    footageClassification: asset.footageClassification,
    approvalStatus: asset.approvalStatus,
    physicalKey: physicalKeyOf(asset.absolutePath),
  };
}

export function assetSignalFromMediaAssetRecord(asset: MediaAssetRecord): AssetSignal {
  return {
    kind: asset.type,
    tags: [...asset.tags, ...asset.themes],
    theme: asset.themes[0],
    emotion: asset.emotion,
    deviceType: asset.deviceType,
    deviceConfidence: asset.deviceConfidence,
    screenVisible: asset.screenVisible,
    compositingReady: asset.compositingReady,
    humanInteractionScore: asset.humanInteractionScore,
    footageClassification: asset.footageClassification,
    approvalStatus: asset.approvalStatus,
    physicalKey: physicalKeyOf(asset.absolutePath),
  };
}
