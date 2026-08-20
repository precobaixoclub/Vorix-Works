import { apiClient } from "@/lib/api-client";
import type { BrandProfile, BrandProfilePatch } from "./types";

export function getBrandProfile(workspaceId: string): Promise<BrandProfile | null> {
  return apiClient.get<BrandProfile | null>(`/v1/brand-profile?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function updateBrandProfile(workspaceId: string, patch: BrandProfilePatch): Promise<BrandProfile | null> {
  return apiClient.post<BrandProfile | null>("/v1/brand-profile", { workspaceId, ...patch });
}
