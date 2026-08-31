import type { Pool } from "pg";
import type { InboxConversationEventRepositoryPort, RecordInboxConversationEventInput } from "../../../application/ports/inbox-conversation-event-repository.port.js";
import type { InboxConversationEvent, InboxConversationEventType, InboxConversationStatus } from "../../../domain/inbox/inbox.model.js";

const idGenerator = () => `inboxevt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  conversation_id: string;
  type: string;
  performed_by: string;
  from_user_id: string | null;
  to_user_id: string | null;
  from_status: string | null;
  to_status: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
};

export class PostgresInboxConversationEventRepository implements InboxConversationEventRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async record(input: RecordInboxConversationEventInput): Promise<InboxConversationEvent> {
    const id = idGenerator();
    const result = await this.pool.query<Row>(
      `insert into inbox_conversation_events (
         id, tenant_id, workspace_id, conversation_id, type, performed_by, from_user_id, to_user_id, from_status, to_status, metadata
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning *`,
      [
        id, input.tenantId, input.workspaceId, input.conversationId, input.type, input.performedBy,
        input.fromUserId ?? null, input.toUserId ?? null, input.fromStatus ?? null, input.toStatus ?? null, input.metadata ?? null,
      ],
    );
    return this.toDomain(result.rows[0]);
  }

  async listByConversation(input: { tenantId: string; workspaceId: string; conversationId: string }): Promise<InboxConversationEvent[]> {
    const result = await this.pool.query<Row>(
      "select * from inbox_conversation_events where tenant_id = $1 and workspace_id = $2 and conversation_id = $3 order by created_at asc",
      [input.tenantId, input.workspaceId, input.conversationId],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: Row): InboxConversationEvent {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      type: row.type as InboxConversationEventType,
      performedBy: row.performed_by,
      fromUserId: row.from_user_id ?? undefined,
      toUserId: row.to_user_id ?? undefined,
      fromStatus: (row.from_status as InboxConversationStatus | null) ?? undefined,
      toStatus: (row.to_status as InboxConversationStatus | null) ?? undefined,
      metadata: row.metadata ?? undefined,
      createdAt: row.created_at.toISOString(),
    };
  }
}
