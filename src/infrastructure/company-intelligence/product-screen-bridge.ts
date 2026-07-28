import type {
  ProductScreenCatalogPort,
  ProductScreenDeviceTarget,
  ProductScreenRecord,
} from "../../application/ports/product-screen-catalog.port.js";
import type { CapturedScreen, CompanyKnowledgeBase, Feature } from "../../domain/company-intelligence/company-intelligence.model.js";
import { computeFileHash } from "../media-catalog/media-hash.js";
import { normalizeAspectRatio } from "../visual-assets/visual-asset-metadata.js";

/**
 * Ponte Company Intelligence → Product Screen Catalog (seção 12, "Product Authenticity"). Nunca
 * altera `product-screen-catalog.repository.ts` — só chama `upsert()`, o único caminho legítimo
 * documentado para gravar uma captura nova (o método `scan()` da própria classe é propositalmente
 * seed-only). Cada tela real vira um `ProductScreenRecord` com `sourceEnvironment: "live_site"`,
 * o primeiro uso legítimo desse valor no catálogo: até esta sprint ele nunca correspondia à
 * realidade, porque a "empresa" simulada não tinha nenhum site publicado de fato — ver o
 * relatório final desta sprint para a explicação completa dessa mudança de premissa.
 */

export type ProductScreenPublishResult = { screenId: string; functionality: string };

function inferDeviceTarget(width: number, height: number): ProductScreenDeviceTarget {
  if (width <= 480) return "phone";
  if (width <= 1024) return "tablet";
  if (width <= 1440) return "notebook";
  return "desktop";
}

function findFunctionality(screen: CapturedScreen, features: Feature[]): string {
  const owner = features.find((feature) => feature.relatedScreenIds.includes(screen.id));
  return owner?.name ?? screen.category;
}

export async function publishCapturedScreensToProductCatalog(
  base: CompanyKnowledgeBase,
  clientId: string,
  catalog: ProductScreenCatalogPort,
): Promise<ProductScreenPublishResult[]> {
  const results: ProductScreenPublishResult[] = [];

  for (const screen of base.screens) {
    const hash = await computeFileHash(screen.absolutePath).catch(() => `unhashed-${screen.id}`);
    const functionality = findFunctionality(screen, base.features);

    const record: ProductScreenRecord = {
      screenId: `company-intel-${screen.id}`,
      clientId,
      product: base.profile.companyName,
      functionality,
      sourcePath: screen.absolutePath,
      sourceType: "screenshot",
      deviceTarget: inferDeviceTarget(screen.width, screen.height),
      orientation: screen.height >= screen.width ? "portrait" : "landscape",
      resolution: { width: screen.width, height: screen.height },
      aspectRatio: normalizeAspectRatio(screen.width, screen.height),
      capturedAt: screen.capturedAt,
      sourceEnvironment: "live_site",
      approvalStatus: "needs_review",
      tags: ["company-intelligence", screen.category, base.profile.domain],
      hash,
      version: "1",
      notes: [`Capturado automaticamente de ${screen.sourceUrl} pela Company Intelligence Engine.`],
      indexedAt: new Date().toISOString(),
    };

    await catalog.upsert(record);
    results.push({ screenId: record.screenId, functionality });
  }

  return results;
}
