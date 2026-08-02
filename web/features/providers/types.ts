import type { Credential } from "@/features/governance/types";
import type { PublicationProviderDescriptor } from "@/features/publication/types";

export type ProviderHealth = {
  providerId: string;
  enabled: boolean;
  ok: boolean;
  safeMessage?: string;
  credentials: readonly Credential[];
  webhookMetrics: WebhookMetrics;
  telemetry?: Record<string, unknown>;
  rateLimit?: Record<string, unknown>;
};

export type WebhookEvent = {
  id: string;
  providerId: string;
  tenantId?: string;
  workspaceId?: string;
  status: string;
  rawPayloadDigest: string;
  receivedAt: string;
  processedAt?: string;
  rejectionReason?: string;
};

export type ProviderEvent = {
  id: string;
  webhookEventId?: string;
  providerId: string;
  tenantId?: string;
  workspaceId?: string;
  eventType: string;
  externalEventId?: string;
  occurredAt: string;
  createdAt: string;
};

export type NormalizedProviderEvent = {
  id: string;
  providerEventId: string;
  providerId: string;
  tenantId: string;
  workspaceId: string;
  publicationId?: string;
  targetId?: string;
  type: string;
  status: string;
  externalStatus?: string;
  occurredAt: string;
  safeMessage?: string;
  createdAt: string;
  processedAt?: string;
};

export type SynchronizationEvent = {
  id: string;
  tenantId: string;
  workspaceId: string;
  providerId: string;
  normalizedEventId?: string;
  publicationId?: string;
  targetId?: string;
  status: string;
  safeMessage: string;
  createdAt: string;
};

export type WebhookMetrics = {
  received: number;
  invalidSignatures: number;
  replayRejected: number;
  normalized: number;
  processed: number;
  failed: number;
};

export type WebhookDashboard = {
  events: readonly WebhookEvent[];
  providerEvents: readonly ProviderEvent[];
  normalized: readonly NormalizedProviderEvent[];
  metrics: WebhookMetrics;
};

export type PublicationSyncDashboard = {
  events: readonly SynchronizationEvent[];
  pending: readonly NormalizedProviderEvent[];
};

export type ProviderConnectResult =
  | { authorizationUrl: string; state: string; expiresAt: string }
  | { connected: boolean; providerId: string; credentialReferenceId: string; credential: Credential };

export type ProviderList = readonly PublicationProviderDescriptor[];
