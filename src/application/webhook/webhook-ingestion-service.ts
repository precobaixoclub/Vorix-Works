import type { PublicationProvider, PublicationProviderDescriptor } from "../../domain/publication/publication.model.js";
import type { WebhookEvent, WebhookVerification } from "../../domain/webhook/webhook.model.js";
import type { WebhookEventRepositoryPort } from "../ports/webhook-event-repository.port.js";
import { ProviderEventNormalizer, providerEventTypeFor } from "./provider-event-normalizer.js";
import { PublicationSynchronizationService } from "./publication-synchronization-service.js";
import { WebhookSignatureVerifier } from "./webhook-signature-verifier.js";

export type WebhookIngestionResult =
  | { accepted: true; webhookEvent: WebhookEvent; verification: WebhookVerification; normalized: number; synchronization: { processed: number; ignored: number; failed: number } }
  | { accepted: false; webhookEvent: WebhookEvent; verification: WebhookVerification; reason: string };

export class WebhookIngestionService {
  private readonly verifier: WebhookSignatureVerifier;
  private readonly normalizer: ProviderEventNormalizer;

  constructor(
    private readonly deps: {
      webhookRepository: WebhookEventRepositoryPort;
      synchronizationService: PublicationSynchronizationService;
      providerDescriptors: () => readonly PublicationProviderDescriptor[];
      webhookSecrets: Partial<Record<PublicationProvider, string>>;
      idGenerator: () => string;
    },
  ) {
    this.verifier = new WebhookSignatureVerifier({ repository: deps.webhookRepository });
    this.normalizer = new ProviderEventNormalizer({ idGenerator: deps.idGenerator });
  }

  async ingest(input: { providerId: PublicationProvider; headers: Record<string, string>; payload: Record<string, unknown>; rawPayload: string }): Promise<WebhookIngestionResult> {
    const timestamp = input.headers["x-zuno-timestamp"];
    const nonce = input.headers["x-zuno-nonce"];
    const signature = input.headers["x-zuno-signature"];
    const tenantId = stringField(input.payload, "tenantId");
    const workspaceId = stringField(input.payload, "workspaceId");
    const secret = this.deps.webhookSecrets[input.providerId];
    const providerKnown = this.deps.providerDescriptors().some((descriptor) => descriptor.providerId === input.providerId);
    const decision = providerKnown
      ? await this.verifier.verify({ providerId: input.providerId, rawPayload: input.rawPayload, signature, timestamp, nonce, secret })
      : await this.verifier.verify({ providerId: input.providerId, rawPayload: input.rawPayload, signature, timestamp, nonce, secret: undefined });

    const webhookEvent = await this.deps.webhookRepository.recordWebhookEvent({
      id: this.deps.idGenerator(),
      providerId: input.providerId,
      tenantId,
      workspaceId,
      status: decision.verified ? "verified" : "rejected",
      signature: decision.signature,
      headers: sanitizeHeaders(input.headers),
      payload: sanitizePayload(input.payload),
      rawPayloadDigest: decision.signature.payloadDigest,
      rejectionReason: decision.verified ? undefined : decision.status,
    });
    const verification = await this.deps.webhookRepository.recordVerification({
      id: this.deps.idGenerator(),
      webhookEventId: webhookEvent.id,
      providerId: input.providerId,
      verified: decision.verified,
      status: decision.verified ? "valid" : decision.status,
      safeMessage: decision.verified ? "Webhook verificado." : decision.safeMessage,
    });

    if (!decision.verified) return { accepted: false, webhookEvent, verification, reason: decision.safeMessage };
    await this.deps.webhookRepository.rememberNonce({ providerId: input.providerId, nonce: nonce!, timestamp: timestamp!, webhookEventId: webhookEvent.id });
    const providerEvent = await this.deps.webhookRepository.recordProviderEvent({
      id: this.deps.idGenerator(),
      webhookEventId: webhookEvent.id,
      providerId: input.providerId,
      tenantId,
      workspaceId,
      eventType: providerEventTypeFor(input.providerId, input.payload),
      externalEventId: stringField(input.payload, "externalEventId"),
      payload: sanitizePayload(input.payload),
      occurredAt: stringField(input.payload, "occurredAt") ?? new Date().toISOString(),
    });
    const normalized = this.normalizer.normalize(providerEvent);
    for (const event of normalized) await this.deps.webhookRepository.recordNormalizedEvent(event);
    await this.deps.webhookRepository.markWebhookProcessed({ webhookEventId: webhookEvent.id, status: "normalized" });
    const synchronization = await this.deps.synchronizationService.processPending({ tenantId, workspaceId, limit: normalized.length || 1 });
    await this.deps.webhookRepository.markWebhookProcessed({ webhookEventId: webhookEvent.id, status: "processed" });
    return { accepted: true, webhookEvent, verification, normalized: normalized.length, synchronization };
  }
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const allowed = ["x-zuno-signature", "x-zuno-timestamp", "x-zuno-nonce", "content-type", "user-agent"];
  return Object.fromEntries(Object.entries(headers).filter(([key]) => allowed.includes(key.toLowerCase())));
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set(["accessToken", "access_token", "refreshToken", "refresh_token", "pageAccessToken", "client_secret", "app_secret"]);
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !blocked.has(key)));
}

function stringField(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
