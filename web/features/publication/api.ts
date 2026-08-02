import { apiClient } from "@/lib/api-client";
import type { MetaPagesOAuthBegin, MetaPagesOAuthComplete, MetaPagesOAuthStatus, PublicationDeadLetter, PublicationDetail, PublicationMetrics, PublicationPlan, PublicationProviderDescriptor, PublicationProviderHealth, PublicationQueue, PublicationReceipt, PublicationReceiptVerification } from "./types";

export function listPublications(workspaceId: string): Promise<PublicationPlan[]> {
  return apiClient.get<PublicationPlan[]>(`/v1/publications?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function getPublication(workspaceId: string, id: string): Promise<PublicationDetail> {
  return apiClient.get<PublicationDetail>(`/v1/publications/${id}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function createPublication(input: { workspaceId: string; idempotencyKey: string; sourceExecutionRunId?: string; artifactIds?: string[]; artifacts?: Record<string, unknown>[]; channels: string[]; mode?: "dry_run" | "real"; provider?: string; policy?: Record<string, unknown> }): Promise<PublicationPlan> {
  return apiClient.post<PublicationPlan>("/v1/publications", input);
}

export function approvePublication(workspaceId: string, id: string, reason: string): Promise<PublicationDetail> {
  return apiClient.post<PublicationDetail>(`/v1/publications/${id}/approve`, { workspaceId, reason });
}

export function publishPublication(workspaceId: string, id: string, async = false): Promise<PublicationDetail | { enqueued: true }> {
  return apiClient.post<PublicationDetail | { enqueued: true }>(`/v1/publications/${id}/publish`, { workspaceId, async });
}

export function cancelPublication(workspaceId: string, id: string): Promise<PublicationDetail> {
  return apiClient.post<PublicationDetail>(`/v1/publications/${id}/cancel`, { workspaceId });
}

export function retryPublication(workspaceId: string, id: string): Promise<{ enqueued: true }> {
  return apiClient.post<{ enqueued: true }>(`/v1/publications/${id}/retry`, { workspaceId });
}

export function reschedulePublication(workspaceId: string, id: string, scheduledAt: string, timezone: string): Promise<PublicationDetail> {
  return apiClient.post<PublicationDetail>(`/v1/publications/${id}/reschedule`, { workspaceId, scheduledAt, timezone });
}

export function listPublicationReceipts(workspaceId: string, id: string): Promise<PublicationReceipt[]> {
  return apiClient.get<PublicationReceipt[]>(`/v1/publications/${id}/receipts?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function getPublicationQueue(): Promise<PublicationQueue> {
  return apiClient.get<PublicationQueue>("/v1/publications/queue");
}

export function getPublicationMetrics(workspaceId: string): Promise<PublicationMetrics> {
  return apiClient.get<PublicationMetrics>(`/v1/publications/metrics?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function runPublicationWorker(): Promise<{ processed: number }> {
  return apiClient.post<{ processed: number }>("/v1/publications/operate/work");
}

export function listPublicationProviders(): Promise<PublicationProviderDescriptor[]> {
  return apiClient.get<PublicationProviderDescriptor[]>("/v1/publication-providers");
}

export function getPublicationProviderHealth(providerId: string): Promise<PublicationProviderHealth> {
  return apiClient.get<PublicationProviderHealth>(`/v1/publication-providers/${encodeURIComponent(providerId)}/health`);
}

export function getMetaPagesOAuthStatus(workspaceId: string): Promise<MetaPagesOAuthStatus> {
  return apiClient.get<MetaPagesOAuthStatus>(`/v1/publication-providers/meta_pages_sandbox/oauth/status?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function beginMetaPagesOAuth(workspaceId: string): Promise<MetaPagesOAuthBegin> {
  return apiClient.post<MetaPagesOAuthBegin>("/v1/publication-providers/meta_pages_sandbox/oauth/connect", { workspaceId });
}

export function completeMetaPagesOAuth(state: string, code: string): Promise<MetaPagesOAuthComplete> {
  return apiClient.post<MetaPagesOAuthComplete>("/v1/publication-providers/meta_pages_sandbox/oauth/callback", { state, code });
}

export function disconnectMetaPagesOAuth(workspaceId: string, credentialReferenceId: string): Promise<{ disconnected: boolean }> {
  return apiClient.post<{ disconnected: boolean }>("/v1/publication-providers/meta_pages_sandbox/oauth/disconnect", { workspaceId, credentialReferenceId });
}

export function listPublicationOutbox(workspaceId: string): Promise<PublicationDetail["outbox"]> {
  return apiClient.get<PublicationDetail["outbox"]>(`/v1/publications/outbox?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listPublicationReconciliations(workspaceId: string): Promise<PublicationDetail["reconciliations"]> {
  return apiClient.get<PublicationDetail["reconciliations"]>(`/v1/publications/reconciliation?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listPublicationDeadLetters(workspaceId: string): Promise<PublicationDeadLetter[]> {
  return apiClient.get<PublicationDeadLetter[]>(`/v1/publications/dead-letters?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listPublicationReceiptVerifications(workspaceId: string, id: string): Promise<PublicationReceiptVerification[]> {
  return apiClient.get<PublicationReceiptVerification[]>(`/v1/publications/${id}/receipt-verifications?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function reconcilePublication(workspaceId: string, id: string, verifyReceipts = false): Promise<Record<string, unknown>> {
  return apiClient.post<Record<string, unknown>>(`/v1/publications/${id}/reconcile`, { workspaceId, verifyReceipts });
}

export function reprocessPublicationDeadLetter(workspaceId: string, id: string): Promise<{ enqueued: true; deadLetterId: string }> {
  return apiClient.post<{ enqueued: true; deadLetterId: string }>(`/v1/publications/dead-letters/${id}/reprocess`, { workspaceId });
}
