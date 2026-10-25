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
  attendance_id: string | null;
  contact_id: string | null;
  from_phase_id: string | null;
  to_phase_id: string | null;
  closure_type_id: string | null;
  closure_subtype_id: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
};

export class PostgresInboxConversationEventRepository implements InboxConversationEventRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async record(input: RecordInboxConversationEventInput): Promise<InboxConversationEvent> {
    const id = idGenerator();
    // Atendimento e contato resolvidos no próprio insert quando não informados: todo evento
    // (nota, IA, kanban...) fica ligado ao atendimento aberto naquele instante, sem cada chamador
    // precisar buscar isso antes.
    const result = await this.pool.query<Row>(
      `insert into inbox_conversation_events (
         id, tenant_id, workspace_id, conversation_id, type, performed_by, from_user_id, to_user_id, from_status, to_status, metadata,
         attendance_id, contact_id, from_phase_id, to_phase_id, closure_type_id, closure_subtype_id, reason
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         coalesce($12, (select a.id from inbox_attendances a where a.conversation_id = $4 and a.status = 'open' limit 1)),
         (select c.contact_id from inbox_conversations c where c.id = $4),
         $13, $14, $15, $16, $17
       )
       returning *`,
      [
        id, input.tenantId, input.workspaceId, input.conversationId, input.type, input.performedBy,
        input.fromUserId ?? null, input.toUserId ?? null, input.fromStatus ?? null, input.toStatus ?? null, input.metadata ?? null,
        input.attendanceId ?? null, input.fromPhaseId ?? null, input.toPhaseId ?? null, input.closureTypeId ?? null, input.closureSubtypeId ?? null, input.reason ?? null,
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
      attendanceId: row.attendance_id ?? undefined,
      contactId: row.contact_id ?? undefined,
      fromPhaseId: row.from_phase_id ?? undefined,
      toPhaseId: row.to_phase_id ?? undefined,
      closureTypeId: row.closure_type_id ?? undefined,
      closureSubtypeId: row.closure_subtype_id ?? undefined,
      reason: row.reason ?? undefined,
      metadata: row.metadata ?? undefined,
      createdAt: row.created_at.toISOString(),
    };
  }
}
