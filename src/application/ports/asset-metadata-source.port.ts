/**
 * Porta estreita de LEITURA de metadados de Asset para o Context Resolver (Sprint 07, Fase 4) —
 * nunca `AssetLibraryRepositoryPort` completo diretamente no domínio de Briefing. O adapter real
 * (`AssetLibraryAssetMetadataSource`) envolve `AssetLibraryRepositoryPort` + `WorkspaceRepositoryPort`
 * (para resolver `workspace.assetLibraryId`) — nunca bytes de arquivo, só nome/tipo/id, o mesmo
 * limite que a Asset Library já respeita desde a Sprint 02.
 */
export type AssetMetadataMatch = {
  assetId: string;
  name: string;
  kind: string;
};

export type AssetMetadataSourcePort = {
  findByName(params: { workspaceId: string; nameQuery: string }): Promise<AssetMetadataMatch[]>;
};
