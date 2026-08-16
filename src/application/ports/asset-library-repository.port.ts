import type { AssetKind, AssetLibrary, AssetRecord, AssetStorageRef } from "../../domain/asset-library/asset-library.model.js";

export type CreateAssetLibraryInput = {
  workspaceId: string;
};

export type RegisterAssetInput = {
  libraryId: string;
  kind: AssetKind;
  name: string;
  tags?: string[];
  /** Presente quando o material foi de fato enviado (`ObjectStoragePort` real) — ver
   * `assets.route.ts`. Continua opcional: um registro de metadados sem arquivo é válido. */
  storageRef?: AssetStorageRef;
};

/**
 * Contrato de persistência da Asset Library — Sprint 02 (Fase 4), upload real ligado depois
 * (`registerAsset` agora aceita `storageRef` quando o arquivo passou pelo Object Storage real).
 * Adapters: `InMemoryAssetLibraryRepository` (dev/teste) e `PostgresAssetLibraryRepository` (produção).
 */
export type AssetLibraryRepositoryPort = {
  createLibrary(input: CreateAssetLibraryInput): Promise<AssetLibrary>;
  getLibraryByWorkspace(workspaceId: string): Promise<AssetLibrary | undefined>;

  registerAsset(input: RegisterAssetInput): Promise<AssetRecord>;
  listAssets(libraryId: string, filter?: { kind?: AssetKind }): Promise<AssetRecord[]>;
  getAsset(assetId: string): Promise<AssetRecord | undefined>;
  /** Edita metadados de um material já cadastrado (nome, tipo, tags) — não substitui o arquivo em
   * si, que continua imutável uma vez enviado ao Object Storage. */
  updateAsset(assetId: string, patch: { name?: string; kind?: AssetKind; tags?: string[] }): Promise<AssetRecord>;
  archiveAsset(assetId: string): Promise<AssetRecord>;
  /** Exclusão definitiva (diferente de `archiveAsset`, que é reversível) — usada quando o cliente
   * escolhe "Excluir" em vez de "Arquivar". */
  deleteAsset(assetId: string): Promise<void>;
};
