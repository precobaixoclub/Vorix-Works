import type { ConversationMemoryRepositoryPort } from "../../application/ports/conversation-memory-repository.port.js";
import type { ConversationMemory } from "../../domain/conversation/conversation.model.js";

export class InMemoryConversationMemoryRepository implements ConversationMemoryRepositoryPort {
  private readonly memoryByConversation = new Map<string, ConversationMemory>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async get(conversationId: string): Promise<ConversationMemory | undefined> {
    const value = this.memoryByConversation.get(conversationId);
    return value ? structuredClone(value) : undefined;
  }

  async upsert(conversationId: string, facts: Record<string, string>): Promise<ConversationMemory> {
    const memory: ConversationMemory = { conversationId, facts, updatedAt: this.now().toISOString() };
    this.memoryByConversation.set(conversationId, structuredClone(memory));
    return structuredClone(memory);
  }

  clear(): void {
    this.memoryByConversation.clear();
  }
}
