import { apiClient } from "@/lib/api-client";
import type { ProviderConnectResult, ProviderHealth, ProviderList, PublicationSyncDashboard, WebhookDashboard } from "./types";

export function listProviders(): Promise<ProviderList> {
  return apiClient.get<ProviderList>("/v1/providers");
}

export function getProviderHealth(providerId: string, workspaceId: string): Promise<ProviderHealth> {
  return apiClient.get<ProviderHealth>(`/v1/providers/${encodeURIComponent(providerId)}/health?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function connectProvider(providerId: string, workspaceId: string): Promise<ProviderConnectResult> {
  return apiClient.post<ProviderConnectResult>(`/v1/providers/${encodeURIComponent(providerId)}/connect`, { workspaceId });
}

export function disconnectProvider(providerId: string, workspaceId: string): Promise<{ disconnected: boolean; providerId: string }> {
  return apiClient.post<{ disconnected: boolean; providerId: string }>(`/v1/providers/${encodeURIComponent(providerId)}/disconnect`, { workspaceId });
}

export function getWebhooks(workspaceId: string, providerId?: string): Promise<WebhookDashboard> {
  const params = new URLSearchParams({ workspaceId });
  if (providerId) params.set("providerId", providerId);
  return apiClient.get<WebhookDashboard>(`/v1/webhooks?${params.toString()}`);
}

export function getPublicationSync(workspaceId: string, providerId?: string): Promise<PublicationSyncDashboard> {
  const params = new URLSearchParams({ workspaceId });
  if (providerId) params.set("providerId", providerId);
  return apiClient.get<PublicationSyncDashboard>(`/v1/publication-sync?${params.toString()}`);
}

export function runPublicationSync(workspaceId: string): Promise<{ processed: number; ignored: number; failed: number }> {
  return apiClient.post<{ processed: number; ignored: number; failed: number }>("/v1/publication-sync/run", { workspaceId });
}
