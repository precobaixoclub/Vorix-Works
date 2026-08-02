import type { Pool } from "pg";
import type {
  AppendConversationEventInput,
  ConversationEventRepositoryPort,
} from "../../../application/ports/conversation-event-repository.port.js";
import type { ConversationEvent } from "../../../domain/conversation/conversation.model.js";

export type ConversationEventIdGenerator = () => string;
const defaultIdGenerator: ConversationEventIdGenerator = () => `conv-event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type EventRow = {
  id: string;
  conversation_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
};

export class PostgresConversationEventRepository implements ConversationEventRepositoryPort {
  private readonly pool: Pool;
  private readonly idGenerator: ConversationEventIdGenerator;

  constructor(pool: Pool, options: { idGenerator?: ConversationEventIdGenerator } = {}) {
    this.pool = pool;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  async append(input: AppendConversationEventInput): Promise<ConversationEvent> {
    const id = this.idGenerator();
    const result = await this.pool.query<EventRow>(
      `insert into conversation_events (id, conversation_id, event_type, payload, created_at)
       values ($1, $2, $3, $4, now())
       returning *`,
      [id, input.conversationId, input.type, JSON.stringify(input.payload)],
    );
    return this.toDomain(result.rows[0]);
  }

  async listByConversation(conversationId: string): Promise<ConversationEvent[]> {
    const result = await this.pool.query<EventRow>(
      "select * from conversation_events where conversation_id = $1 order by created_at asc, id asc",
      [conversationId],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: EventRow): ConversationEvent {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      type: row.event_type as ConversationEvent["type"],
      payload: row.payload,
      createdAt: row.created_at.toISOString(),
    };
  }
}
