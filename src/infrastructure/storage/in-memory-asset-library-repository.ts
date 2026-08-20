import type { AssetMetadataPatch, AssetLibraryRepositoryPort, CreateAssetLibraryInput, RegisterAssetInput } from "../../application/ports/asset-library-repository.port.js";
import type { AssetKind, AssetLibrary, AssetRecord } from "../../domain/asset-library/asset-library.model.js";

export type AssetLibraryIdGenerator = (prefix: string) => string;

const defaultIdGenerator: AssetLibraryIdGenerator = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryAssetLibraryRepository implements AssetLibraryRepositoryPort {
  private readonly libraries = new Map<string, AssetLibrary>();
  private readonly librariesByWorkspace = new Map<string, string>();
  private readonly assets = new Map<string, AssetRecord>();
  private readonly idGenerator: AssetLibraryIdGenerator;
  private readonly now: () => Date;

  constructor(options: { idGenerator?: AssetLibraryIdGenerator; now?: () => Date } = {}) {
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.now = options.now ?? (() => new Date());
  }

  async createLibrary(input: CreateAssetLibraryInput): Promise<AssetLibrary> {
    const existingId = this.librariesByWorkspace.get(input.workspaceId);
    if (existingId) {
      throw new Error(`ASSET_LIBRARY_ALREADY_EXISTS: workspace "${input.workspaceId}" já tem uma Asset Library ("${existingId}").`);
    }
    const timestamp = this.now().toISOString();
    const library: AssetLibrary = {
      id: this.idGenerator("asset-library"),
      workspaceId: input.workspaceId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.libraries.set(library.id, clone(library));
    this.librariesByWorkspace.set(input.workspaceId, library.id);
    return clone(library);
  }

  async getLibraryByWorkspace(workspaceId: string): Promise<AssetLibrary | undefined> {
    const id = this.librariesByWorkspace.get(workspaceId);
    return id ? clone(this.libraries.get(id)) : undefined;
  }

  async registerAsset(input: RegisterAssetInput): Promise<AssetRecord> {
    if (!this.libraries.has(input.libraryId)) {
      throw new Error(`ASSET_LIBRARY_NOT_FOUND: library "${input.libraryId}" não existe.`);
    }
    const timestamp = this.now().toISOString();
    const asset: AssetRecord = {
      id: this.idGenerator("asset"),
      libraryId: input.libraryId,
      kind: input.kind,
      name: input.name,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      tags: input.tags ?? [],
      storageRef: input.storageRef,
      materialType: input.materialType,
      aiInstructions: input.aiInstructions,
      usageRule: input.usageRule,
      usagePriority: input.usagePriority,
    };
    this.assets.set(asset.id, clone(asset));
    return clone(asset);
  }

  async listAssets(libraryId: string, filter?: { kind?: AssetKind }): Promise<AssetRecord[]> {
    return Array.from(this.assets.values())
      .filter((asset) => asset.libraryId === libraryId)
      .filter((asset) => (filter?.kind ? asset.kind === filter.kind : true))
      .map(clone);
  }

  async getAsset(assetId: string): Promise<AssetRecord | undefined> {
    return clone(this.assets.get(assetId));
  }

  async updateAsset(assetId: string, patch: AssetMetadataPatch): Promise<AssetRecord> {
    const existing = this.assets.get(assetId);
    if (!existing) {
      throw new Error(`ASSET_NOT_FOUND: asset "${assetId}" não existe.`);
    }
    const timestamp = this.now().toISOString();
    const updated: AssetRecord = {
      ...existing,
      name: patch.name ?? existing.name,
      kind: patch.kind ?? existing.kind,
      tags: patch.tags ?? existing.tags,
      materialType: patch.materialType ?? existing.materialType,
      aiInstructions: patch.aiInstructions ?? existing.aiInstructions,
      usageRule: patch.usageRule ?? existing.usageRule,
      usagePriority: patch.usagePriority ?? existing.usagePriority,
      updatedAt: timestamp,
    };
    this.assets.set(assetId, clone(updated));
    return clone(updated);
  }

  async archiveAsset(assetId: string): Promise<AssetRecord> {
    const existing = this.assets.get(assetId);
    if (!existing) {
      throw new Error(`ASSET_NOT_FOUND: asset "${assetId}" não existe.`);
    }
    const timestamp = this.now().toISOString();
    const archived: AssetRecord = { ...existing, status: "archived", archivedAt: timestamp, updatedAt: timestamp };
    this.assets.set(assetId, clone(archived));
    return clone(archived);
  }

  async deleteAsset(assetId: string): Promise<void> {
    this.assets.delete(assetId);
  }

  clear(): void {
    this.libraries.clear();
    this.librariesByWorkspace.clear();
    this.assets.clear();
  }
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}
