import { apiClient } from "@/lib/api-client";
import type { BrandColorSuggestion, BrandIdentityInput, BrandIdentityView } from "./types";

export function getBrandIdentity(workspaceId: string): Promise<BrandIdentityView> {
  return apiClient.get<BrandIdentityView>(`/v1/brand-identity?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function saveBrandIdentity(workspaceId: string, identity: BrandIdentityInput): Promise<BrandIdentityView> {
  return apiClient.put<BrandIdentityView>("/v1/brand-identity", { workspaceId, identity });
}

/** Sugestão de cores a partir de uma logo da biblioteca — nunca grava; o usuário decide. */
export function suggestColorsFromLogo(workspaceId: string, assetId: string): Promise<{ suggestions: BrandColorSuggestion[] }> {
  return apiClient.post<{ suggestions: BrandColorSuggestion[] }>("/v1/brand-identity/suggest-from-logo", { workspaceId, assetId });
}
