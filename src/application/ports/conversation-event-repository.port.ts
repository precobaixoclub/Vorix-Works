import type { ConversationEvent, ConversationEventType } from "../../domain/conversation/conversation.model.js";

export type AppendConversationEventInput = {
  conversationId: string;
  type: ConversationEventType;
  payload: Record<string, unknown>;
};

export type ConversationEventRepositoryPort = {
  append(input: AppendConversationEventInput): Promise<ConversationEvent>;
  listByConversation(conversationId: string): Promise<ConversationEvent[]>;
};
