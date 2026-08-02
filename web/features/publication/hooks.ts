import useSWR from "swr";
import { getMetaPagesOAuthStatus, getPublication, getPublicationMetrics, getPublicationProviderHealth, getPublicationQueue, listPublicationDeadLetters, listPublicationOutbox, listPublicationProviders, listPublicationReconciliations, listPublications } from "./api";

export function usePublications(workspaceId: string) {
  return useSWR(["publications", workspaceId], () => listPublications(workspaceId));
}

export function usePublication(workspaceId: string, publicationId: string) {
  return useSWR(["publication", workspaceId, publicationId], () => getPublication(workspaceId, publicationId));
}

export function usePublicationQueue() {
  return useSWR("publication-queue", getPublicationQueue);
}

export function usePublicationMetrics(workspaceId: string) {
  return useSWR(["publication-metrics", workspaceId], () => getPublicationMetrics(workspaceId));
}

export function usePublicationProviders() {
  return useSWR("publication-providers", listPublicationProviders);
}

export function usePublicationProviderHealth(providerId?: string) {
  return useSWR(providerId ? ["publication-provider-health", providerId] : null, () => getPublicationProviderHealth(providerId!));
}

export function useMetaPagesOAuthStatus(workspaceId: string) {
  return useSWR(["meta-pages-oauth-status", workspaceId], () => getMetaPagesOAuthStatus(workspaceId));
}

export function usePublicationOutbox(workspaceId: string) {
  return useSWR(["publication-outbox", workspaceId], () => listPublicationOutbox(workspaceId));
}

export function usePublicationReconciliations(workspaceId: string) {
  return useSWR(["publication-reconciliations", workspaceId], () => listPublicationReconciliations(workspaceId));
}

export function usePublicationDeadLetters(workspaceId: string) {
  return useSWR(["publication-dead-letters", workspaceId], () => listPublicationDeadLetters(workspaceId));
}
