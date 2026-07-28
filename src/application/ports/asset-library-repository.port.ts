import type { AssetKind, AssetLibrary, AssetRecord } from "../../domain/asset-library/asset-library.model.js";

export type CreateAssetLibraryInput = {
  workspaceId: string;
};

export type RegisterAssetInput = {
  libraryId: string;
  kind: AssetKind;
  name: string;
  tags?: string[];
};

/**
 * Contrato de persistência da Asset Library — Sprint 02 (Fase 4). Só organização de metadados
 * (`registerAsset` só cria o REGISTRO do ativo, nunca recebe ou grava bytes de arquivo — upload
 * real é explicitamente fora de escopo desta sprint). Único adapter hoje: `InMemoryAssetLibraryRepository`.
 */
export type AssetLibraryRepositoryPort = {
  createLibrary(input: CreateAssetLibraryInput): Promise<AssetLibrary>;
  getLibraryByWorkspace(workspaceId: string): Promise<AssetLibrary | undefined>;

  registerAsset(input: RegisterAssetInput): Promise<AssetRecord>;
  listAssets(libraryId: string, filter?: { kind?: AssetKind }): Promise<AssetRecord[]>;
  getAsset(assetId: string): Promise<AssetRecord | undefined>;
  archiveAsset(assetId: string): Promise<AssetRecord>;
};
