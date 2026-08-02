import useSWR from "swr";
import { getProviderHealth, getPublicationSync, getWebhooks, listProviders } from "./api";

export function useProviders() {
  return useSWR("providers", listProviders);
}

export function useProviderHealth(providerId: string | undefined, workspaceId: string) {
  return useSWR(providerId ? ["provider-health", providerId, workspaceId] : null, () => getProviderHealth(providerId!, workspaceId));
}

export function useWebhooks(workspaceId: string, providerId?: string) {
  return useSWR(["webhooks", workspaceId, providerId], () => getWebhooks(workspaceId, providerId));
}

export function usePublicationSync(workspaceId: string, providerId?: string) {
  return useSWR(["publication-sync", workspaceId, providerId], () => getPublicationSync(workspaceId, providerId));
}
