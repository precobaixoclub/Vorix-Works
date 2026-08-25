import { apiClient } from "@/lib/api-client";
import type { Asset, AssetKind, AssetMaterialType, AssetUsagePriority } from "./types";

export type UploadedAssetFile = { objectKey: string; url: string; contentType: string; sizeBytes: number };

/** Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT" — campos
 * semânticos aditivos, compartilhados entre `registerAsset`/`updateAsset`. */
export type AssetSemanticFields = {
  materialType?: AssetMaterialType;
  aiInstructions?: string;
  usageRule?: string;
  usagePriority?: AssetUsagePriority;
};

export function uploadAssetFile(workspaceId: string, file: File, options?: { requireTransparency?: boolean }): Promise<UploadedAssetFile> {
  const formData = new FormData();
  formData.append("file", file);
  const query = new URLSearchParams({ workspaceId });
  if (options?.requireTransparency) query.set("requireTransparency", "true");
  return apiClient.upload<UploadedAssetFile>(`/v1/assets/upload?${query.toString()}`, formData);
}

export function listAssets(workspaceId: string, filter?: { kind?: AssetKind; search?: string }): Promise<Asset[]> {
  const search = new URLSearchParams({ workspaceId });
  if (filter?.kind) search.set("kind", filter.kind);
  if (filter?.search) search.set("search", filter.search);
  return apiClient.get<Asset[]>(`/v1/assets?${search.toString()}`);
}

export function registerAsset(
  workspaceId: string,
  input: AssetSemanticFields & { kind: AssetKind; name: string; tags?: string[]; upload?: UploadedAssetFile },
): Promise<Asset> {
  return apiClient.post<Asset>("/v1/assets", {
    workspaceId,
    kind: input.kind,
    name: input.name,
    tags: input.tags,
    materialType: input.materialType,
    aiInstructions: input.aiInstructions,
    usageRule: input.usageRule,
    usagePriority: input.usagePriority,
    storageRef: input.upload
      ? { provider: "object_storage", objectKey: input.upload.objectKey, metadata: { url: input.upload.url, contentType: input.upload.contentType } }
      : undefined,
  });
}

export function updateAsset(assetId: string, patch: AssetSemanticFields & { name?: string; kind?: AssetKind; tags?: string[] }): Promise<Asset> {
  return apiClient.post<Asset>(`/v1/assets/${encodeURIComponent(assetId)}/update`, patch);
}

export function archiveAsset(_workspaceId: string, assetId: string): Promise<Asset> {
  return apiClient.post<Asset>(`/v1/assets/${encodeURIComponent(assetId)}/archive`);
}

export function deleteAsset(_workspaceId: string, assetId: string): Promise<{ id: string; deleted: boolean }> {
  return apiClient.post<{ id: string; deleted: boolean }>(`/v1/assets/${encodeURIComponent(assetId)}/delete`);
}
