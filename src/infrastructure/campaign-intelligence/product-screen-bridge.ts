import type { ProductScreenCatalogPort, ProductScreenDeviceTarget, ProductScreenRecord } from "../../application/ports/product-screen-catalog.port.js";
import type { CampaignWorkspace } from "../../domain/campaign-intelligence/campaign-intelligence.model.js";
import { computeFileHash } from "../media-catalog/media-hash.js";
import { normalizeAspectRatio, readRasterDimensions } from "../visual-assets/visual-asset-metadata.js";
import { formatTimestamp } from "../../shared/utils/campaign-intelligence/reuse-engine.js";

/**
 * Ponte Campaign Intelligence → Product Screen Catalog (seção 12, "Product Authenticity"/Reuse
 * Engine). Mesmo padrão do bridge do Company Intelligence: só chama `catalog.upsert()`.
 *
 * `sourceEnvironment: "local_project_asset"` — diferente do Company Intelligence (que usou
 * `"live_site"` para capturas de um site real), aqui é honestamente um arquivo que o usuário
 * enviou, não uma captura ao vivo. O enum de `sourceType` não tem uma variante para "frame
 * extraído de vídeo no timestamp T" ou "página N de um PDF" (`product-screen-catalog.port.ts` é
 * protegido nesta sprint) — mapeado para `"screenshot"` (tecnicamente correto: é uma imagem
 * estática salva), com a proveniência real (timestamp/arquivo de origem) preservada em `notes`.
 */

export type ProductScreenPublishResult = { screenId: string; functionality: string };

function inferDeviceTarget(width: number, height: number): ProductScreenDeviceTarget {
  if (width === 0) return "phone";
  if (width <= 480) return "phone";
  if (width <= 1024) return "tablet";
  if (width <= 1440) return "notebook";
  return "desktop";
}

export async function publishCampaignScreensToProductCatalog(
  workspace: CampaignWorkspace,
  clientId: string,
  catalog: ProductScreenCatalogPort,
): Promise<ProductScreenPublishResult[]> {
  const results: ProductScreenPublishResult[] = [];

  for (const screen of workspace.screens) {
    if (!screen.imagePath) continue;
    const hash = await computeFileHash(screen.imagePath).catch(() => `unhashed-${screen.id}`);
    const dimensions = await readRasterDimensions(screen.imagePath).catch(() => ({ width: 0, height: 0 }));
    const feature = workspace.features.find((candidate) => screen.relatedFeatureIds.includes(candidate.id));
    const functionality = feature?.name ?? screen.category;

    const provenanceNote = screen.sourceType === "video_frame" && screen.sourceTimestampSeconds !== undefined
      ? `Frame extraído do vídeo (arquivo ${screen.sourceFileId}) em ${formatTimestamp(screen.sourceTimestampSeconds)}.`
      : screen.sourceType === "document_page" && screen.sourcePageNumber !== undefined
        ? `Extraído da página ${screen.sourcePageNumber} do documento (arquivo ${screen.sourceFileId}).`
        : `Extraído da imagem enviada (arquivo ${screen.sourceFileId}).`;

    const record: ProductScreenRecord = {
      screenId: `campaign-intel-${screen.id}`,
      clientId,
      product: `Campanha ${workspace.campaignId}`,
      functionality,
      sourcePath: screen.imagePath,
      sourceType: "screenshot",
      deviceTarget: inferDeviceTarget(dimensions.width, dimensions.height),
      orientation: dimensions.height >= dimensions.width ? "portrait" : "landscape",
      resolution: dimensions,
      aspectRatio: dimensions.width > 0 ? normalizeAspectRatio(dimensions.width, dimensions.height) : "unknown",
      capturedAt: screen.capturedAt,
      sourceEnvironment: "local_project_asset",
      approvalStatus: "needs_review",
      tags: ["campaign-intelligence", screen.category, workspace.campaignId],
      hash,
      version: "1",
      notes: [provenanceNote],
      indexedAt: new Date().toISOString(),
    };

    await catalog.upsert(record);
    results.push({ screenId: record.screenId, functionality });
  }

  return results;
}
