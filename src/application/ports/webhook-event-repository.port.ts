import type { NormalizedProviderEvent, ProviderEvent, SynchronizationEvent, WebhookEvent, WebhookMetrics, WebhookVerification } from "../../domain/webhook/webhook.model.js";
import type { PublicationProvider } from "../../domain/publication/publication.model.js";

export type WebhookEventRepositoryPort = {
  recordWebhookEvent(input: Omit<WebhookEvent, "receivedAt">): Promise<WebhookEvent>;
  recordVerification(input: Omit<WebhookVerification, "checkedAt">): Promise<WebhookVerification>;
  recordProviderEvent(input: Omit<ProviderEvent, "createdAt">): Promise<ProviderEvent>;
  recordNormalizedEvent(input: Omit<NormalizedProviderEvent, "createdAt">): Promise<NormalizedProviderEvent>;
  markWebhookProcessed(input: { webhookEventId: string; status: WebhookEvent["status"]; processedAt?: string; rejectionReason?: string }): Promise<WebhookEvent | undefined>;
  markNormalizedEventProcessed(input: { normalizedEventId: string; status: NormalizedProviderEvent["status"]; processedAt?: string; safeMessage?: string }): Promise<NormalizedProviderEvent | undefined>;
  recordSynchronizationEvent(input: Omit<SynchronizationEvent, "createdAt">): Promise<SynchronizationEvent>;
  hasNonce(input: { providerId: PublicationProvider; nonce: string }): Promise<boolean>;
  rememberNonce(input: { providerId: PublicationProvider; nonce: string; timestamp: string; webhookEventId?: string }): Promise<void>;
  listWebhookEvents(filter?: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider; status?: WebhookEvent["status"]; limit?: number }): Promise<WebhookEvent[]>;
  listProviderEvents(filter?: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider; limit?: number }): Promise<ProviderEvent[]>;
  listNormalizedEvents(filter?: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider; status?: NormalizedProviderEvent["status"]; limit?: number }): Promise<NormalizedProviderEvent[]>;
  listSynchronizationEvents(filter?: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider; limit?: number }): Promise<SynchronizationEvent[]>;
  metrics(filter?: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider }): Promise<WebhookMetrics>;
};
