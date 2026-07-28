import type { CampaignMediaItem, CampaignScreen, CapturedScreen, MediaLibraryItem } from "../../../domain/campaign-intelligence/campaign-intelligence.model.js";

/**
 * Adaptadores estruturais para reusar `buildKnowledgeGraph`/`discoverFeatures` do Company
 * Intelligence sem alterá-los e sem forçar `CampaignScreen`/`CampaignMediaItem` a carregar campos
 * que a seção 6/9 desta sprint não pede (ex.: `CapturedScreen.sourceUrl`, que aqui é só um
 * identificador do arquivo de origem, nunca uma URL real).
 */

export function campaignScreenToCapturedScreen(screen: CampaignScreen): CapturedScreen {
  return {
    id: screen.id,
    sourceUrl: screen.sourceFileId,
    category: screen.category,
    absolutePath: screen.imagePath,
    width: 0,
    height: 0,
    capturedAt: screen.capturedAt,
  };
}

export function campaignMediaItemToMediaLibraryItem(item: CampaignMediaItem, relatedFeatureIds: string[]): MediaLibraryItem {
  return {
    id: item.id,
    category: item.category === "document" || item.category === "audio" ? "image" : item.category,
    description: item.description,
    tags: item.tags,
    origin: item.origin,
    license: item.license,
    absolutePath: item.originalFilePath,
    date: new Date().toISOString(),
    relatedFeatureIds,
  };
}
