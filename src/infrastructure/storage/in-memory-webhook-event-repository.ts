import type { WebhookEventRepositoryPort } from "../../application/ports/webhook-event-repository.port.js";
import type { PublicationProvider } from "../../domain/publication/publication.model.js";
import type { NormalizedProviderEvent, ProviderEvent, SynchronizationEvent, WebhookEvent, WebhookMetrics, WebhookVerification } from "../../domain/webhook/webhook.model.js";

export class InMemoryWebhookEventRepository implements WebhookEventRepositoryPort {
  private readonly webhookEvents = new Map<string, WebhookEvent>();
  private readonly verifications = new Map<string, WebhookVerification>();
  private readonly providerEvents = new Map<string, ProviderEvent>();
  private readonly normalizedEvents = new Map<string, NormalizedProviderEvent>();
  private readonly synchronizationEvents = new Map<string, SynchronizationEvent>();
  private readonly nonces = new Map<string, { timestamp: string; webhookEventId?: string }>();

  async recordWebhookEvent(input: Omit<WebhookEvent, "receivedAt">): Promise<WebhookEvent> {
    const event = { ...input, receivedAt: new Date().toISOString(), payload: clone(input.payload), headers: { ...input.headers } };
    this.webhookEvents.set(event.id, event);
    return event;
  }

  async recordVerification(input: Omit<WebhookVerification, "checkedAt">): Promise<WebhookVerification> {
    const verification = { ...input, checkedAt: new Date().toISOString() };
    this.verifications.set(verification.id, verification);
    return verification;
  }

  async recordProviderEvent(input: Omit<ProviderEvent, "createdAt">): Promise<ProviderEvent> {
    const event = { ...input, payload: clone(input.payload), createdAt: new Date().toISOString() };
    this.providerEvents.set(event.id, event);
    return event;
  }

  async recordNormalizedEvent(input: Omit<NormalizedProviderEvent, "createdAt">): Promise<NormalizedProviderEvent> {
    const event = { ...input, metadata: clone(input.metadata), createdAt: new Date().toISOString() };
    this.normalizedEvents.set(event.id, event);
    return event;
  }

  async markWebhookProcessed(input: { webhookEventId: string; status: WebhookEvent["status"]; processedAt?: string; rejectionReason?: string }): Promise<WebhookEvent | undefined> {
    const event = this.webhookEvents.get(input.webhookEventId);
    if (!event) return undefined;
    const updated = { ...event, status: input.status, processedAt: input.processedAt ?? new Date().toISOString(), rejectionReason: input.rejectionReason ?? event.rejectionReason };
    this.webhookEvents.set(event.id, updated);
    return updated;
  }

  async markNormalizedEventProcessed(input: { normalizedEventId: string; status: NormalizedProviderEvent["status"]; processedAt?: string; safeMessage?: string }): Promise<NormalizedProviderEvent | undefined> {
    const event = this.normalizedEvents.get(input.normalizedEventId);
    if (!event) return undefined;
    const updated = { ...event, status: input.status, processedAt: input.processedAt ?? new Date().toISOString(), safeMessage: input.safeMessage ?? event.safeMessage };
    this.normalizedEvents.set(event.id, updated);
    return updated;
  }

  async recordSynchronizationEvent(input: Omit<SynchronizationEvent, "createdAt">): Promise<SynchronizationEvent> {
    const event = { ...input, metadata: clone(input.metadata), createdAt: new Date().toISOString() };
    this.synchronizationEvents.set(event.id, event);
    return event;
  }

  async hasNonce(input: { providerId: PublicationProvider; nonce: string }): Promise<boolean> {
    return this.nonces.has(nonceKey(input.providerId, input.nonce));
  }

  async rememberNonce(input: { providerId: PublicationProvider; nonce: string; timestamp: string; webhookEventId?: string }): Promise<void> {
    this.nonces.set(nonceKey(input.providerId, input.nonce), { timestamp: input.timestamp, webhookEventId: input.webhookEventId });
  }

  async listWebhookEvents(filter: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider; status?: WebhookEvent["status"]; limit?: number } = {}): Promise<WebhookEvent[]> {
    return limit([...this.webhookEvents.values()].filter((event) => matches(event, filter) && (!filter.status || event.status === filter.status)).sort(desc("receivedAt")), filter.limit);
  }

  async listProviderEvents(filter: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider; limit?: number } = {}): Promise<ProviderEvent[]> {
    return limit([...this.providerEvents.values()].filter((event) => matches(event, filter)).sort(desc("createdAt")), filter.limit);
  }

  async listNormalizedEvents(filter: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider; status?: NormalizedProviderEvent["status"]; limit?: number } = {}): Promise<NormalizedProviderEvent[]> {
    return limit([...this.normalizedEvents.values()].filter((event) => matches(event, filter) && (!filter.status || event.status === filter.status)).sort(desc("createdAt")), filter.limit);
  }

  async listSynchronizationEvents(filter: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider; limit?: number } = {}): Promise<SynchronizationEvent[]> {
    return limit([...this.synchronizationEvents.values()].filter((event) => matches(event, filter)).sort(desc("createdAt")), filter.limit);
  }

  async metrics(filter: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider } = {}): Promise<WebhookMetrics> {
    const webhooks = await this.listWebhookEvents(filter);
    const normalized = await this.listNormalizedEvents(filter);
    return {
      received: webhooks.length,
      invalidSignatures: webhooks.filter((event) => event.rejectionReason === "invalid_signature").length,
      replayRejected: webhooks.filter((event) => event.rejectionReason === "replay_detected").length,
      normalized: normalized.length,
      processed: normalized.filter((event) => event.status === "processed").length,
      failed: normalized.filter((event) => event.status === "failed").length,
    };
  }
}

function nonceKey(providerId: PublicationProvider, nonce: string): string {
  return `${providerId}:${nonce}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function matches(event: { tenantId?: string; workspaceId?: string; providerId: PublicationProvider }, filter: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider }): boolean {
  return (!filter.tenantId || event.tenantId === filter.tenantId) && (!filter.workspaceId || event.workspaceId === filter.workspaceId) && (!filter.providerId || event.providerId === filter.providerId);
}

function limit<T>(items: T[], max = 500): T[] {
  return items.slice(0, max);
}

function desc<T extends Record<string, unknown>>(field: keyof T): (left: T, right: T) => number {
  return (left, right) => String(right[field]).localeCompare(String(left[field]));
}
