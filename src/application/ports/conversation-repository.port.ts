import type { Conversation, ConversationState } from "../../domain/conversation/conversation.model.js";

export type CreateConversationInput = {
  tenantId: string;
  workspaceId: string;
  title?: string;
};

export type ConversationRepositoryPort = {
  create(input: CreateConversationInput): Promise<Conversation>;
  getById(id: string): Promise<Conversation | undefined>;
  listByWorkspace(tenantId: string, workspaceId: string): Promise<Conversation[]>;
  updateState(id: string, state: ConversationState): Promise<Conversation>;
};
