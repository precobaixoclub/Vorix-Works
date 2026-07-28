import type { ChatAttachment, ChatMessage, ChatMessageRole, ChatSession, SmartQuestion } from "../../domain/chat/chat.model.js";

export type CreateChatSessionInput = {
  workspaceId: string;
  title?: string;
};

export type AppendChatMessageInput = {
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  attachments?: ChatAttachment[];
  smartQuestion?: SmartQuestion;
};

/**
 * Contrato de persistência do Chat — Sprint 02 (Fase 5). Só armazenamento de sessão/mensagem;
 * nenhuma geração de resposta, nenhuma chamada a Icaro/Arthur. Único adapter hoje:
 * `InMemoryChatRepository`.
 */
export type ChatRepositoryPort = {
  createSession(input: CreateChatSessionInput): Promise<ChatSession>;
  getSession(id: string): Promise<ChatSession | undefined>;
  listSessionsByWorkspace(workspaceId: string): Promise<ChatSession[]>;

  appendMessage(input: AppendChatMessageInput): Promise<ChatMessage>;
  listMessages(sessionId: string): Promise<ChatMessage[]>;
};
