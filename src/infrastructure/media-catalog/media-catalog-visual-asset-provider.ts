import type {
  VisualAssetKind,
  VisualAssetMetadata,
  VisualAssetProviderPort,
  VisualAssetSearchQuery,
  VisualAssetSearchResult,
} from "../../application/ports/visual-asset-provider.port.js";
import type { MediaAssetRecord, MediaAssetType, MediaCatalogPort } from "../../application/ports/media-catalog.port.js";

/**
 * MEDIA INTELLIGENCE ENGINE (seção 13) — este é o ÚNICO ponto de integração com o
 * `VisualAssetResolver`: implementa a porta genérica `VisualAssetProviderPort` já existente, para
 * que o resolver consulte o catálogo exatamente como consulta `LocalVisualAssetLibrary`/
 * `ManifestFreeVisualAssetProvider` — sem recriar catálogo próprio no resolver, sem o resolver
 * conhecer nada sobre `MediaCatalogPort`, e sem qualquer alteração ao algoritmo de scoring do
 * resolver. Basta adicionar uma instância desta classe ao array `providers` que já existe.
 */
export class MediaCatalogVisualAssetProvider implements VisualAssetProviderPort {
  readonly providerId = "media-catalog";

  constructor(private readonly catalog: MediaCatalogPort) {}

  async search(query: VisualAssetSearchQuery): Promise<VisualAssetSearchResult> {
    const result = await this.catalog.search({
      text: query.theme,
      type: mapDesiredKindToMediaType(query.desiredKind),
      themes: query.requiredTags,
      emotion: query.emotion,
      requiresHuman: query.humanRequirement ? true : undefined,
      targetAspectRatio: query.targetAspectRatio,
      excludeAssetIds: query.forbidAssetIds,
      shotPlanTags: query.requiredTags,
      limit: 20,
    });

    const assets = result.matches
      .map((match) => match.asset)
      .filter((asset) => asset.available && asset.approvalStatus !== "rejected" && asset.approvalStatus !== "license_blocked")
      .map(mediaAssetToVisualAssetMetadata)
      .filter((asset): asset is VisualAssetMetadata => asset !== undefined);

    return { assets, warnings: result.warnings };
  }
}

/** Só mapeia quando o `desiredKind` corresponde a exatamente um `MediaAssetType` inequívoco — para tipos ambíguos (graphic/illustration) deixa o filtro de tipo aberto, preferindo mostrar candidatos demais a excluir candidatos válidos por engano. */
function mapDesiredKindToMediaType(desiredKind: VisualAssetKind): MediaAssetType | undefined {
  switch (desiredKind) {
    case "photo": return "photo";
    case "video": return "video";
    case "b_roll": return "b_roll";
    case "cinemagraph": return "cinemagraph";
    case "mockup": return "mockup";
    default: return undefined;
  }
}

function mapMediaTypeToVisualKind(type: MediaAssetType): VisualAssetKind | undefined {
  switch (type) {
    case "photo": return "photo";
    case "video": return "video";
    case "b_roll": return "b_roll";
    case "cinemagraph": return "cinemagraph";
    case "mockup": return "mockup";
    case "screenshot": return "graphic";
    case "logo": return "graphic";
    case "overlay": return "graphic";
    case "graphic": return "graphic";
    default: return undefined;
  }
}

/** Ingestão que captura material do PRÓPRIO cliente (site, app, materiais enviados) nunca passa por licenciamento de terceiros — "licença desconhecida" não se aplica a conteúdo que o cliente já possui. Mesma lista de `OFFICIAL_INGESTION_SOURCES` (authenticity-classification.ts), repetida aqui para não criar dependência circular entre a porta de mídia e a política de autenticidade. */
const CLIENT_OWNED_INGESTION_SOURCES: MediaAssetRecord["ingestionSource"][] = ["company_intelligence", "campaign_intelligence", "product_screen_catalog"];

function mediaAssetToVisualAssetMetadata(asset: MediaAssetRecord): VisualAssetMetadata | undefined {
  const kind = mapMediaTypeToVisualKind(asset.type);
  if (!kind) return undefined;
  if (!asset.width || !asset.height) return undefined;

  const isClientOwned = asset.ingestionSource !== undefined && CLIENT_OWNED_INGESTION_SOURCES.includes(asset.ingestionSource);
  const defaultLicense = isClientOwned
    ? { name: "Material próprio do cliente (ingestão oficial via Company/Campaign Intelligence) — não requer licenciamento de terceiros.", allowsCommercialUse: true, requiresAttribution: false }
    : { name: "Licença desconhecida — bloqueada para publicação externa", allowsCommercialUse: false, requiresAttribution: true };

  return {
    id: asset.assetId,
    provider: "media-catalog",
    origin: asset.origin === "developer_assisted" ? "developer_assisted" : asset.origin === "external_provider" ? "free_provider" : "local_library",
    absolutePath: asset.absolutePath,
    relativePath: asset.relativePath,
    author: asset.author,
    sourceUrl: asset.sourceUrl,
    license: asset.license ?? defaultLicense,
    tags: [...new Set([...asset.tags, ...asset.themes, ...asset.actions, ...asset.people])],
    theme: asset.themes[0],
    emotion: asset.emotion,
    width: asset.width,
    height: asset.height,
    aspectRatio: asset.aspectRatio ?? "9:16",
    kind,
    durationSeconds: asset.durationSeconds,
    footageClassification: asset.footageClassification,
    legibleProductScreen: asset.legibleProductScreen,
    screenVisible: asset.screenVisible,
    compositingReady: asset.compositingReady,
    humanInteractionScore: asset.humanInteractionScore,
    productIntegrationScore: asset.productIntegrationScore,
    visualValidationStage: asset.visualValidationStage,
    deviceConfidence: asset.deviceConfidence,
    screenConfidence: asset.screenConfidence,
    humanPresenceScore: asset.humanPresenceScore,
    persistenceRatio: asset.persistenceRatio,
    occlusionRisk: asset.occlusionRisk,
    approvalStatus: asset.approvalStatus,
    // OFFICIAL ASSET PRIORITY & AUTHENTICITY POLICY — antes desta sprint estes 6 campos existiam
    // em `MediaAssetRecord` (Local Official Asset Qualification) mas eram silenciosamente
    // descartados aqui, então o resolver nunca via a proveniência/capacidades de um asset
    // oficial local (causa raiz confirmada na auditoria da seção 1). Agora repassados sem
    // nenhuma lógica nova.
    capabilities: asset.capabilities,
    ingestionSource: asset.ingestionSource,
    sourceFile: asset.sourceFile,
    sourceTimestampSeconds: asset.sourceTimestampSeconds,
    validationDate: asset.validationDate,
    validatorVersion: asset.validatorVersion,
    authenticityClassOverride: asset.authenticityClassOverride,
  };
}
