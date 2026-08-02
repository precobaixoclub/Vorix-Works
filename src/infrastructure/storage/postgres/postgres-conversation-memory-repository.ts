import type { Pool } from "pg";
import type { ConversationMemoryRepositoryPort } from "../../../application/ports/conversation-memory-repository.port.js";
import type { ConversationMemory } from "../../../domain/conversation/conversation.model.js";

type MemoryRow = { conversation_id: string; facts: Record<string, string>; updated_at: Date };

export class PostgresConversationMemoryRepository implements ConversationMemoryRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async get(conversationId: string): Promise<ConversationMemory | undefined> {
    const result = await this.pool.query<MemoryRow>("select * from conversation_memory where conversation_id = $1", [conversationId]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async upsert(conversationId: string, facts: Record<string, string>): Promise<ConversationMemory> {
    const result = await this.pool.query<MemoryRow>(
      `insert into conversation_memory (conversation_id, facts, updated_at)
       values ($1, $2, now())
       on conflict (conversation_id) do update set facts = excluded.facts, updated_at = now()
       returning *`,
      [conversationId, JSON.stringify(facts)],
    );
    return this.toDomain(result.rows[0]);
  }

  private toDomain(row: MemoryRow): ConversationMemory {
    return { conversationId: row.conversation_id, facts: row.facts, updatedAt: row.updated_at.toISOString() };
  }
}
