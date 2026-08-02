import type { PublicationChannel, PublicationProvider } from "../publication/publication.model.js";

export const WEBHOOK_STATUSES = ["received", "verified", "rejected", "normalized", "processed", "failed"] as const;
export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];

export type Webhook = {
  id: string;
  providerId: PublicationProvider;
  tenantId?: string;
  workspaceId?: string;
  status: "active" | "disabled";
  signingAlgorithm: "hmac-sha256";
  createdAt: string;
  updatedAt: string;
};

export type WebhookSignature = {
  algorithm: "hmac-sha256";
  headerName: string;
  signature: string;
  timestamp?: string;
  nonce?: string;
  payloadDigest: string;
};

export type WebhookVerification = {
  id: string;
  webhookEventId: string;
  providerId: PublicationProvider;
  verified: boolean;
  status: "valid" | "invalid_signature" | "timestamp_expired" | "replay_detected" | "provider_unknown" | "payload_invalid";
  safeMessage: string;
  checkedAt: string;
};

export type WebhookEvent = {
  id: string;
  providerId: PublicationProvider;
  tenantId?: string;
  workspaceId?: string;
  status: WebhookStatus;
  signature: WebhookSignature;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
  rawPayloadDigest: string;
  receivedAt: string;
  processedAt?: string;
  rejectionReason?: string;
};

export type WebhookDelivery = {
  id: string;
  webhookEventId: string;
  providerId: PublicationProvider;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastAttemptAt?: string;
  createdAt: string;
};

export type WebhookProcessing = {
  id: string;
  webhookEventId: string;
  providerId: PublicationProvider;
  status: "pending" | "processed" | "failed";
  normalizedEventId?: string;
  safeMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProviderEvent = {
  id: string;
  webhookEventId?: string;
  providerId: PublicationProvider;
  tenantId?: string;
  workspaceId?: string;
  eventType: string;
  externalEventId?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
};

export type NormalizedProviderEventType = "PublicationStatusChanged" | "ReceiptUpdated" | "PublicationDeleted" | "PublicationRejected" | "PublicationRecovered";

export type NormalizedProviderEvent = {
  id: string;
  providerEventId: string;
  providerId: PublicationProvider;
  tenantId: string;
  workspaceId: string;
  publicationId?: string;
  targetId?: string;
  receiptId?: string;
  type: NormalizedProviderEventType;
  status: "pending" | "processed" | "ignored" | "failed";
  channel?: PublicationChannel;
  providerPublicationId?: string;
  providerRequestId?: string;
  idempotencyKey?: string;
  externalStatus?: string;
  url?: string;
  occurredAt: string;
  safeMessage?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  processedAt?: string;
};

export type SynchronizationEvent = {
  id: string;
  tenantId: string;
  workspaceId: string;
  providerId: PublicationProvider;
  normalizedEventId?: string;
  publicationId?: string;
  targetId?: string;
  receiptId?: string;
  status: "started" | "completed" | "failed" | "ignored";
  safeMessage: string;
  metadata: Record<string, unknown>;
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
