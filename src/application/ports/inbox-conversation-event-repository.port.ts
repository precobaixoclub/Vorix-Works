import type { InboxConversationEvent, InboxConversationEventType, InboxConversationStatus } from "../../domain/inbox/inbox.model.js";

/** Módulo Conversas (Fase 4 — Atendimento). Ver `db/migrations/0084_inbox_conversation_events.sql`. */

export type RecordInboxConversationEventInput = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  type: InboxConversationEventType;
  performedBy: string;
  fromUserId?: string;
  toUserId?: string;
  fromStatus?: InboxConversationStatus;
  toStatus?: InboxConversationStatus;
};

export type InboxConversationEventRepositoryPort = {
  record(input: RecordInboxConversationEventInput): Promise<InboxConversationEvent>;
  /** Ordem cronológica ascendente — a Inbox intercala isso com as mensagens pra montar a timeline. */
  listByConversation(input: { tenantId: string; workspaceId: string; conversationId: string }): Promise<InboxConversationEvent[]>;
};
