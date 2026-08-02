import type { PublicationProvider } from "../../domain/publication/publication.model.js";
import type { NormalizedProviderEvent, NormalizedProviderEventType, ProviderEvent } from "../../domain/webhook/webhook.model.js";

export class ProviderEventNormalizer {
  constructor(private readonly deps: { idGenerator: () => string }) {}

  normalize(event: ProviderEvent): Omit<NormalizedProviderEvent, "createdAt">[] {
    const payload = event.payload;
    const tenantId = stringField(payload, "tenantId") ?? event.tenantId;
    const workspaceId = stringField(payload, "workspaceId") ?? event.workspaceId;
    if (!tenantId || !workspaceId) return [];
    const type = normalizeType(stringField(payload, "type") ?? event.eventType);
    if (!type) return [];
    return [{
      id: this.deps.idGenerator(),
      providerEventId: event.id,
      providerId: event.providerId,
      tenantId,
      workspaceId,
      publicationId: stringField(payload, "publicationId"),
      targetId: stringField(payload, "targetId"),
      receiptId: stringField(payload, "receiptId"),
      type,
      status: "pending",
      channel: stringField(payload, "channel") as never,
      providerPublicationId: stringField(payload, "providerPublicationId"),
      providerRequestId: stringField(payload, "providerRequestId"),
      idempotencyKey: stringField(payload, "idempotencyKey"),
      externalStatus: stringField(payload, "externalStatus") ?? stringField(payload, "status"),
      url: stringField(payload, "url"),
      occurredAt: stringField(payload, "occurredAt") ?? event.occurredAt,
      safeMessage: stringField(payload, "safeMessage"),
      metadata: sanitizeMetadata(payload),
    }];
  }
}

function normalizeType(type: string | undefined): NormalizedProviderEventType | undefined {
  const normalized = type?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["publication_status_changed", "publicationstatuschanged", "status_changed", "post.published"].includes(normalized)) return "PublicationStatusChanged";
  if (["receipt_updated", "receiptupdated", "post.updated"].includes(normalized)) return "ReceiptUpdated";
  if (["publication_deleted", "publicationdeleted", "post.deleted"].includes(normalized)) return "PublicationDeleted";
  if (["publication_rejected", "publicationrejected", "post.rejected"].includes(normalized)) return "PublicationRejected";
  if (["publication_recovered", "publicationrecovered", "post.recovered"].includes(normalized)) return "PublicationRecovered";
  return undefined;
}

function stringField(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeMetadata(payload: Record<string, unknown>): Record<string, unknown> {
  const blocked = new Set(["accessToken", "access_token", "refreshToken", "refresh_token", "pageAccessToken", "client_secret", "app_secret"]);
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (blocked.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") metadata[key] = value;
  }
  return metadata;
}

export function providerEventTypeFor(providerId: PublicationProvider, payload: Record<string, unknown>): string {
  const type = typeof payload.type === "string" ? payload.type : "provider.event";
  return `${providerId}.${type}`;
}
