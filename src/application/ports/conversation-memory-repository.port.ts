import type { ConversationMemory } from "../../domain/conversation/conversation.model.js";

export type ConversationMemoryRepositoryPort = {
  get(conversationId: string): Promise<ConversationMemory | undefined>;
  upsert(conversationId: string, facts: Record<string, string>): Promise<ConversationMemory>;
};
