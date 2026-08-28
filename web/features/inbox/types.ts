/** Módulo Conversas — Fase 1. Inbox de WhatsApp via WuzAPI. Ver `src/domain/inbox/inbox.model.ts`
 * no backend (nomes de campo espelham `InboxConversation`/`InboxMessage`/`MessagingConnection`,
 * sem `tenantId`/`workspaceId` — o backend já escopa por eles, o frontend nunca precisa repetir). */

export type MessagingConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected" | "logged_out" | "requires_repair" | "error";

export type MessagingConnection = {
  id: string;
  displayName: string;
  phoneNumber?: string;
  status: MessagingConnectionStatus;
  connectionHealth: "healthy" | "degraded" | "unknown";
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
};

export type InboxConversationStatus = "open" | "pending" | "resolved" | "archived";

export type InboxConversation = {
  id: string;
  connectionId: string;
  contactId: string;
  status: InboxConversationStatus;
  assignedUserId?: string;
  lastMessageAt?: string;
  unreadCount: number;
  aiEnabled: boolean;
  automationEnabled: boolean;
};

export type InboxConversationFilter = "all" | "mine" | "unassigned" | "unread";

export type InboxMessageDirection = "inbound" | "outbound";
export type InboxMessageType = "text" | "image" | "video" | "audio" | "document" | "location" | "contact" | "other";
export type InboxMessageStatus = "queued" | "sending" | "sent" | "delivered" | "read" | "failed";

export type InboxMessage = {
  id: string;
  conversationId: string;
  direction: InboxMessageDirection;
  type: InboxMessageType;
  status: InboxMessageStatus;
  body?: string;
  sentByUserId?: string;
  sentByAi: boolean;
  sentByAutomation: boolean;
  createdAt: string;
  sentAt?: string;
};
