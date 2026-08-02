import type { AssetLibraryRepositoryPort } from "../../application/ports/asset-library-repository.port.js";
import type { AssetMetadataMatch, AssetMetadataSourcePort } from "../../application/ports/asset-metadata-source.port.js";
import type { WorkspaceRepositoryPort } from "../../application/ports/workspace-repository.port.js";

/** Único adapter real de `AssetMetadataSourcePort` — busca por substring no nome, dentro da
 * Asset Library do próprio workspace. `workspace.assetLibraryId` ausente (nenhuma library criada
 * ainda) devolve `[]`, nunca lança — "ausência de fonte não pode quebrar o turno" (Fase 4). */
export class AssetLibraryAssetMetadataSource implements AssetMetadataSourcePort {
  constructor(
    private readonly workspaceRepository: WorkspaceRepositoryPort,
    private readonly assetLibraryRepository: AssetLibraryRepositoryPort,
  ) {}

  async findByName(params: { workspaceId: string; nameQuery: string }): Promise<AssetMetadataMatch[]> {
    const library = await this.assetLibraryRepository.getLibraryByWorkspace(params.workspaceId);
    if (!library) return [];

    const assets = await this.assetLibraryRepository.listAssets(library.id);
    const query = params.nameQuery.trim().toLowerCase();
    if (!query) return [];

    return assets
      .filter((asset) => asset.status === "active" && asset.name.toLowerCase().includes(query))
      .map((asset) => ({ assetId: asset.id, name: asset.name, kind: asset.kind }));
  }
}

export function createAssetLibraryAssetMetadataSource(
  workspaceRepository: WorkspaceRepositoryPort,
  assetLibraryRepository: AssetLibraryRepositoryPort,
): AssetLibraryAssetMetadataSource {
  return new AssetLibraryAssetMetadataSource(workspaceRepository, assetLibraryRepository);
}
