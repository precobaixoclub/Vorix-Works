import type { Pool } from "pg";
import type { WebhookEventRepositoryPort } from "../../../application/ports/webhook-event-repository.port.js";
import type { PublicationProvider } from "../../../domain/publication/publication.model.js";
import type { NormalizedProviderEvent, ProviderEvent, SynchronizationEvent, WebhookEvent, WebhookMetrics, WebhookSignature, WebhookVerification } from "../../../domain/webhook/webhook.model.js";

type WebhookEventRow = { id: string; provider_id: string; tenant_id: string | null; workspace_id: string | null; status: string; signature: WebhookSignature; headers: Record<string, string>; payload: Record<string, unknown>; raw_payload_digest: string; received_at: Date; processed_at: Date | null; rejection_reason: string | null };
type VerificationRow = { id: string; webhook_event_id: string; provider_id: string; verified: boolean; status: string; safe_message: string; checked_at: Date };
type ProviderEventRow = { id: string; webhook_event_id: string | null; provider_id: string; tenant_id: string | null; workspace_id: string | null; event_type: string; external_event_id: string | null; payload: Record<string, unknown>; occurred_at: Date; created_at: Date };
type NormalizedEventRow = { id: string; provider_event_id: string; provider_id: string; tenant_id: string; workspace_id: string; publication_id: string | null; target_id: string | null; receipt_id: string | null; type: string; status: string; channel: string | null; provider_publication_id: string | null; provider_request_id: string | null; idempotency_key: string | null; external_status: string | null; url: string | null; occurred_at: Date; safe_message: string | null; metadata: Record<string, unknown>; created_at: Date; processed_at: Date | null };
type SyncEventRow = { id: string; tenant_id: string; workspace_id: string; provider_id: string; normalized_event_id: string | null; publication_id: string | null; target_id: string | null; receipt_id: string | null; status: string; safe_message: string; metadata: Record<string, unknown>; created_at: Date };

export class PostgresWebhookEventRepository implements WebhookEventRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async recordWebhookEvent(input: Omit<WebhookEvent, "receivedAt">): Promise<WebhookEvent> {
    const result = await this.pool.query<WebhookEventRow>(
      `insert into webhook_events (id, provider_id, tenant_id, workspace_id, status, signature, headers, payload, raw_payload_digest, processed_at, rejection_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [input.id, input.providerId, input.tenantId ?? null, input.workspaceId ?? null, input.status, JSON.stringify(input.signature), JSON.stringify(input.headers), JSON.stringify(input.payload), input.rawPayloadDigest, input.processedAt ?? null, input.rejectionReason ?? null],
    );
    return toWebhookEvent(result.rows[0]);
  }

  async recordVerification(input: Omit<WebhookVerification, "checkedAt">): Promise<WebhookVerification> {
    const result = await this.pool.query<VerificationRow>(
      "insert into webhook_verifications (id, webhook_event_id, provider_id, verified, status, safe_message) values ($1,$2,$3,$4,$5,$6) returning *",
      [input.id, input.webhookEventId, input.providerId, input.verified, input.status, input.safeMessage],
    );
    return toVerification(result.rows[0]);
  }

  async recordProviderEvent(input: Omit<ProviderEvent, "createdAt">): Promise<ProviderEvent> {
    const result = await this.pool.query<ProviderEventRow>(
      `insert into provider_events (id, webhook_event_id, provider_id, tenant_id, workspace_id, event_type, external_event_id, payload, occurred_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [input.id, input.webhookEventId ?? null, input.providerId, input.tenantId ?? null, input.workspaceId ?? null, input.eventType, input.externalEventId ?? null, JSON.stringify(input.payload), input.occurredAt],
    );
    return toProviderEvent(result.rows[0]);
  }

  async recordNormalizedEvent(input: Omit<NormalizedProviderEvent, "createdAt">): Promise<NormalizedProviderEvent> {
    const result = await this.pool.query<NormalizedEventRow>(
      `insert into normalized_provider_events (id, provider_event_id, provider_id, tenant_id, workspace_id, publication_id, target_id, receipt_id, type, status, channel, provider_publication_id, provider_request_id, idempotency_key, external_status, url, occurred_at, safe_message, metadata, processed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning *`,
      [input.id, input.providerEventId, input.providerId, input.tenantId, input.workspaceId, input.publicationId ?? null, input.targetId ?? null, input.receiptId ?? null, input.type, input.status, input.channel ?? null, input.providerPublicationId ?? null, input.providerRequestId ?? null, input.idempotencyKey ?? null, input.externalStatus ?? null, input.url ?? null, input.occurredAt, input.safeMessage ?? null, JSON.stringify(input.metadata), input.processedAt ?? null],
    );
    return toNormalizedEvent(result.rows[0]);
  }

  async markWebhookProcessed(input: { webhookEventId: string; status: WebhookEvent["status"]; processedAt?: string; rejectionReason?: string }): Promise<WebhookEvent | undefined> {
    const result = await this.pool.query<WebhookEventRow>("update webhook_events set status = $2, processed_at = coalesce($3, now()), rejection_reason = coalesce($4, rejection_reason) where id = $1 returning *", [input.webhookEventId, input.status, input.processedAt ?? null, input.rejectionReason ?? null]);
    return result.rows[0] ? toWebhookEvent(result.rows[0]) : undefined;
  }

  async markNormalizedEventProcessed(input: { normalizedEventId: string; status: NormalizedProviderEvent["status"]; processedAt?: string; safeMessage?: string }): Promise<NormalizedProviderEvent | undefined> {
    const result = await this.pool.query<NormalizedEventRow>("update normalized_provider_events set status = $2, processed_at = coalesce($3, now()), safe_message = coalesce($4, safe_message) where id = $1 returning *", [input.normalizedEventId, input.status, input.processedAt ?? null, input.safeMessage ?? null]);
    return result.rows[0] ? toNormalizedEvent(result.rows[0]) : undefined;
  }

  async recordSynchronizationEvent(input: Omit<SynchronizationEvent, "createdAt">): Promise<SynchronizationEvent> {
    const result = await this.pool.query<SyncEventRow>(
      `insert into synchronization_events (id, tenant_id, workspace_id, provider_id, normalized_event_id, publication_id, target_id, receipt_id, status, safe_message, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [input.id, input.tenantId, input.workspaceId, input.providerId, input.normalizedEventId ?? null, input.publicationId ?? null, input.targetId ?? null, input.receiptId ?? null, input.status, input.safeMessage, JSON.stringify(input.metadata)],
    );
    return toSyncEvent(result.rows[0]);
  }

  async hasNonce(input: { providerId: PublicationProvider; nonce: string }): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>("select exists(select 1 from webhook_nonces where provider_id = $1 and nonce = $2)", [input.providerId, input.nonce]);
    return result.rows[0]?.exists ?? false;
  }

  async rememberNonce(input: { providerId: PublicationProvider; nonce: string; timestamp: string; webhookEventId?: string }): Promise<void> {
    await this.pool.query("insert into webhook_nonces (provider_id, nonce, webhook_event_id, timestamp) values ($1,$2,$3,$4) on conflict do nothing", [input.providerId, input.nonce, input.webhookEventId ?? null, input.timestamp]);
  }

  async listWebhookEvents(filter: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider; status?: WebhookEvent["status"]; limit?: number } = {}): Promise<WebhookEvent[]> {
    const result = await this.pool.query<WebhookEventRow>(
      `select * from webhook_events
       where ($1::text is null or tenant_id = $1) and ($2::text is null or workspace_id = $2) and ($3::text is null or provider_id = $3) and ($4::text is null or status = $4)
       order by received_at desc limit $5`,
      [filter.tenantId ?? null, filter.workspaceId ?? null, filter.providerId ?? null, filter.status ?? null, filter.limit ?? 500],
    );
    return result.rows.map(toWebhookEvent);
  }

  async listProviderEvents(filter: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider; limit?: number } = {}): Promise<ProviderEvent[]> {
    const result = await this.pool.query<ProviderEventRow>("select * from provider_events where ($1::text is null or tenant_id = $1) and ($2::text is null or workspace_id = $2) and ($3::text is null or provider_id = $3) order by created_at desc limit $4", [filter.tenantId ?? null, filter.workspaceId ?? null, filter.providerId ?? null, filter.limit ?? 500]);
    return result.rows.map(toProviderEvent);
  }

  async listNormalizedEvents(filter: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider; status?: NormalizedProviderEvent["status"]; limit?: number } = {}): Promise<NormalizedProviderEvent[]> {
    const result = await this.pool.query<NormalizedEventRow>("select * from normalized_provider_events where ($1::text is null or tenant_id = $1) and ($2::text is null or workspace_id = $2) and ($3::text is null or provider_id = $3) and ($4::text is null or status = $4) order by created_at desc limit $5", [filter.tenantId ?? null, filter.workspaceId ?? null, filter.providerId ?? null, filter.status ?? null, filter.limit ?? 500]);
    return result.rows.map(toNormalizedEvent);
  }

  async listSynchronizationEvents(filter: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider; limit?: number } = {}): Promise<SynchronizationEvent[]> {
    const result = await this.pool.query<SyncEventRow>("select * from synchronization_events where ($1::text is null or tenant_id = $1) and ($2::text is null or workspace_id = $2) and ($3::text is null or provider_id = $3) order by created_at desc limit $4", [filter.tenantId ?? null, filter.workspaceId ?? null, filter.providerId ?? null, filter.limit ?? 500]);
    return result.rows.map(toSyncEvent);
  }

  async metrics(filter: { tenantId?: string; workspaceId?: string; providerId?: PublicationProvider } = {}): Promise<WebhookMetrics> {
    const [webhooks, normalized] = await Promise.all([this.listWebhookEvents(filter), this.listNormalizedEvents(filter)]);
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

function iso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function requiredIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toWebhookEvent(row: WebhookEventRow): WebhookEvent {
  return { id: row.id, providerId: row.provider_id as never, tenantId: row.tenant_id ?? undefined, workspaceId: row.workspace_id ?? undefined, status: row.status as never, signature: row.signature, headers: row.headers, payload: row.payload, rawPayloadDigest: row.raw_payload_digest, receivedAt: requiredIso(row.received_at), processedAt: iso(row.processed_at), rejectionReason: row.rejection_reason ?? undefined };
}
function toVerification(row: VerificationRow): WebhookVerification {
  return { id: row.id, webhookEventId: row.webhook_event_id, providerId: row.provider_id as never, verified: row.verified, status: row.status as never, safeMessage: row.safe_message, checkedAt: requiredIso(row.checked_at) };
}
function toProviderEvent(row: ProviderEventRow): ProviderEvent {
  return { id: row.id, webhookEventId: row.webhook_event_id ?? undefined, providerId: row.provider_id as never, tenantId: row.tenant_id ?? undefined, workspaceId: row.workspace_id ?? undefined, eventType: row.event_type, externalEventId: row.external_event_id ?? undefined, payload: row.payload, occurredAt: requiredIso(row.occurred_at), createdAt: requiredIso(row.created_at) };
}
function toNormalizedEvent(row: NormalizedEventRow): NormalizedProviderEvent {
  return { id: row.id, providerEventId: row.provider_event_id, providerId: row.provider_id as never, tenantId: row.tenant_id, workspaceId: row.workspace_id, publicationId: row.publication_id ?? undefined, targetId: row.target_id ?? undefined, receiptId: row.receipt_id ?? undefined, type: row.type as never, status: row.status as never, channel: row.channel as never ?? undefined, providerPublicationId: row.provider_publication_id ?? undefined, providerRequestId: row.provider_request_id ?? undefined, idempotencyKey: row.idempotency_key ?? undefined, externalStatus: row.external_status ?? undefined, url: row.url ?? undefined, occurredAt: requiredIso(row.occurred_at), safeMessage: row.safe_message ?? undefined, metadata: row.metadata, createdAt: requiredIso(row.created_at), processedAt: iso(row.processed_at) };
}
function toSyncEvent(row: SyncEventRow): SynchronizationEvent {
  return { id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, providerId: row.provider_id as never, normalizedEventId: row.normalized_event_id ?? undefined, publicationId: row.publication_id ?? undefined, targetId: row.target_id ?? undefined, receiptId: row.receipt_id ?? undefined, status: row.status as never, safeMessage: row.safe_message, metadata: row.metadata, createdAt: requiredIso(row.created_at) };
}
