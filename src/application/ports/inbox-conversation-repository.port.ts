import type { InboxConversation, InboxConversationStatus } from "../../domain/inbox/inbox.model.js";

/** Módulo Conversas (Fase 1). Ver `db/migrations/0082_inbox_conversations.sql`. */

export type FindOrCreateInboxConversationInput = {
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  contactId: string;
};

export type InboxConversationListFilter = "all" | "mine" | "unassigned" | "unread";

export type InboxConversationRepositoryPort = {
  /** Idempotente por `(connectionId, contactId)` — nunca cria uma segunda conversa pro mesmo par. */
  findOrCreate(input: FindOrCreateInboxConversationInput): Promise<InboxConversation>;
  getById(id: string): Promise<InboxConversation | undefined>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; filter?: InboxConversationListFilter; assignedUserId?: string }): Promise<InboxConversation[]>;
  markLastMessage(id: string, input: { lastMessageAt: string; incrementUnread: boolean }): Promise<void>;
  markRead(id: string): Promise<void>;
  assign(id: string, assignedUserId: string | undefined): Promise<InboxConversation>;
  setStatus(id: string, status: InboxConversationStatus): Promise<InboxConversation>;
  /** "Assumir conversa" desliga a IA só aqui — nunca globalmente (ver Fase 5). */
  setAiEnabled(id: string, aiEnabled: boolean): Promise<InboxConversation>;
};
