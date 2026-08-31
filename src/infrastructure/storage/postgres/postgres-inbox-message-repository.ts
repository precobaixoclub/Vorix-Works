import type { Pool } from "pg";
import type { CreateInboxMessageInput, InboxMessageRepositoryPort } from "../../../application/ports/inbox-message-repository.port.js";
import type { InboxMediaStorageRef, InboxMessage, InboxMessageStatus } from "../../../domain/inbox/inbox.model.js";

const idGenerator = () => `inboxmsg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  conversation_id: string;
  connection_id: string;
  external_message_id: string | null;
  direction: string;
  type: string;
  status: string;
  body: string | null;
  media_storage_ref: InboxMediaStorageRef | null;
  mime_type: string | null;
  metadata: Record<string, unknown> | null;
  sent_by_user_id: string | null;
  sent_by_ai: boolean;
  sent_by_automation: boolean;
  attempt_count: number;
  last_error: string | null;
  last_attempt_at: Date | null;
  created_at: Date;
  sent_at: Date | null;
  delivered_at: Date | null;
  read_at: Date | null;
  failed_at: Date | null;
  ai_claim_status: string | null;
  ai_claimed_at: Date | null;
  ai_response_message_id: string | null;
  failure_category: string | null;
};

export class PostgresInboxMessageRepository implements InboxMessageRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateInboxMessageInput): Promise<{ message: InboxMessage; wasCreated: boolean }> {
    const id = idGenerator();
    const defaultStatus = input.status ?? (input.direction === "inbound" ? "delivered" : "queued");
    // `on conflict do nothing` + segunda leitura: idempotência contra reentrega de evento —
    // um `externalMessageId` repetido para a mesma `connectionId` nunca duplica a linha (ver
    // `unique (connection_id, external_message_id)` na migration).
    const insertResult = await this.pool.query<Row>(
      `insert into inbox_messages (
         id, tenant_id, workspace_id, conversation_id, connection_id, external_message_id,
         direction, type, status, body, media_storage_ref, mime_type, metadata,
         sent_by_user_id, sent_by_ai, sent_by_automation, sent_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, case when $7 = 'inbound' then now() else null end)
       on conflict (connection_id, external_message_id) do nothing
       returning *`,
      [
        id, input.tenantId, input.workspaceId, input.conversationId, input.connectionId, input.externalMessageId ?? null,
        input.direction, input.type, defaultStatus, input.body ?? null, input.mediaStorageRef ?? null, input.mimeType ?? null, input.metadata ?? null,
        input.sentByUserId ?? null, input.sentByAi ?? false, input.sentByAutomation ?? false,
      ],
    );
    if (insertResult.rows[0]) return { message: this.toDomain(insertResult.rows[0]), wasCreated: true };

    if (!input.externalMessageId) throw new Error("INBOX_MESSAGE_CONFLICT: inserção falhou sem externalMessageId (não deveria acontecer).");
    const existing = await this.pool.query<Row>(
      "select * from inbox_messages where connection_id = $1 and external_message_id = $2",
      [input.connectionId, input.externalMessageId],
    );
    return { message: this.toDomain(existing.rows[0]), wasCreated: false };
  }

  async getById(id: string): Promise<InboxMessage | undefined> {
    const result = await this.pool.query<Row>("select * from inbox_messages where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByConversation(input: { tenantId: string; workspaceId: string; conversationId: string; cursor?: string; limit?: number }): Promise<InboxMessage[]> {
    const limit = input.limit ?? 50;
    const cursorCondition = input.cursor ? "and created_at < (select created_at from inbox_messages where id = $5)" : "";
    const params: unknown[] = [input.tenantId, input.workspaceId, input.conversationId, limit];
    if (input.cursor) params.push(input.cursor);
    const result = await this.pool.query<Row>(
      `select * from inbox_messages
       where tenant_id = $1 and workspace_id = $2 and conversation_id = $3 ${cursorCondition}
       order by created_at desc
       limit $4`,
      params,
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async updateStatusByExternalId(input: { connectionId: string; externalMessageId: string; status: InboxMessageStatus; occurredAt: string }): Promise<void> {
    await this.pool.query(
      `update inbox_messages set
         status = $3,
         delivered_at = case when $3 = 'delivered' then $4::timestamptz else delivered_at end,
         read_at = case when $3 = 'read' then $4::timestamptz else read_at end
       where connection_id = $1 and external_message_id = $2 and status not in ('read', 'failed')`,
      [input.connectionId, input.externalMessageId, input.status, input.occurredAt],
    );
  }

  async markSent(id: string, input: { externalMessageId: string; sentAt: string }): Promise<InboxMessage> {
    const result = await this.pool.query<Row>(
      "update inbox_messages set status = 'sent', external_message_id = $2, sent_at = $3 where id = $1 returning *",
      [id, input.externalMessageId, input.sentAt],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`INBOX_MESSAGE_NOT_FOUND: mensagem "${id}" não existe.`);
    return this.toDomain(row);
  }

  async markFailed(id: string, input: { lastError: string; failedAt: string; failureCategory?: string }): Promise<InboxMessage> {
    const result = await this.pool.query<Row>(
      "update inbox_messages set status = 'failed', last_error = $2, failed_at = $3, failure_category = coalesce($4, failure_category) where id = $1 returning *",
      [id, input.lastError, input.failedAt, input.failureCategory ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`INBOX_MESSAGE_NOT_FOUND: mensagem "${id}" não existe.`);
    return this.toDomain(row);
  }

  async recordAttempt(id: string, input: { lastError?: string; lastAttemptAt: string; failureCategory?: string }): Promise<void> {
    await this.pool.query(
      "update inbox_messages set attempt_count = attempt_count + 1, last_error = coalesce($2, last_error), last_attempt_at = $3, failure_category = coalesce($4, failure_category) where id = $1",
      [id, input.lastError ?? null, input.lastAttemptAt, input.failureCategory ?? null],
    );
  }

  async tryClaimForAiResponse(id: string, claimedAt: string, staleBeforeIso: string): Promise<InboxMessage | undefined> {
    const result = await this.pool.query<Row>(
      `update inbox_messages set ai_claim_status = 'processing', ai_claimed_at = $2
       where id = $1 and direction = 'inbound'
         and (ai_claim_status is null or (ai_claim_status = 'processing' and ai_claimed_at < $3))
       returning *`,
      [id, claimedAt, staleBeforeIso],
    );
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async resolveAiClaim(id: string, input: { status: "answered" | "skipped" | "failed"; responseMessageId?: string }): Promise<void> {
    await this.pool.query(
      "update inbox_messages set ai_claim_status = $2, ai_response_message_id = $3 where id = $1",
      [id, input.status, input.responseMessageId ?? null],
    );
  }

  async listUnansweredInboundByConversation(input: { conversationId: string; staleProcessingBeforeIso: string }): Promise<InboxMessage[]> {
    const result = await this.pool.query<Row>(
      `select * from inbox_messages
       where conversation_id = $1 and direction = 'inbound'
         and (ai_claim_status is null or (ai_claim_status = 'processing' and ai_claimed_at < $2))
       order by created_at asc`,
      [input.conversationId, input.staleProcessingBeforeIso],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: Row): InboxMessage {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      connectionId: row.connection_id,
      externalMessageId: row.external_message_id ?? undefined,
      direction: row.direction as InboxMessage["direction"],
      type: row.type as InboxMessage["type"],
      status: row.status as InboxMessageStatus,
      body: row.body ?? undefined,
      mediaStorageRef: row.media_storage_ref ?? undefined,
      mimeType: row.mime_type ?? undefined,
      metadata: row.metadata ?? undefined,
      sentByUserId: row.sent_by_user_id ?? undefined,
      sentByAi: row.sent_by_ai,
      sentByAutomation: row.sent_by_automation,
      attemptCount: row.attempt_count,
      lastError: row.last_error ?? undefined,
      lastAttemptAt: row.last_attempt_at?.toISOString(),
      createdAt: row.created_at.toISOString(),
      sentAt: row.sent_at?.toISOString(),
      deliveredAt: row.delivered_at?.toISOString(),
      readAt: row.read_at?.toISOString(),
      failedAt: row.failed_at?.toISOString(),
      aiClaimStatus: (row.ai_claim_status as InboxMessage["aiClaimStatus"]) ?? undefined,
      aiClaimedAt: row.ai_claimed_at?.toISOString(),
      aiResponseMessageId: row.ai_response_message_id ?? undefined,
      failureCategory: row.failure_category ?? undefined,
    };
  }
}
