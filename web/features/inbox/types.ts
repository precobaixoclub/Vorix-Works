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
  /** Denormalizado pela listagem (`GET /v1/inbox/conversations`) — nunca vem no `getById()`, que
   * hoje nem existe como rota própria (a Fase 1 não tem "abrir 1 conversa" isolado, só a lista). */
  contactName?: string;
  contactPhone: string;
};

/** Fase 4 — `open`/`pending`/`resolved` filtram por status normalizado (ver
 * `InboxConversationStatus`); os demais continuam os filtros operacionais da Fase 3. */
export type InboxConversationFilter = "all" | "mine" | "unassigned" | "unread" | "open" | "pending" | "resolved";

/** Fase 4 — evento discreto de atendimento (nunca uma mensagem enviada ao WhatsApp). Timeline do
 * frontend intercala isso com `InboxMessage` por `createdAt`, renderizando como um "pill" central
 * distinto das bolhas de mensagem. Espelha `InboxConversationEvent` no backend. */
export type InboxConversationEventType = "assigned" | "unassigned" | "took_over" | "transferred" | "status_changed" | "ai_paused" | "ai_resumed";

export type InboxConversationEvent = {
  id: string;
  conversationId: string;
  type: InboxConversationEventType;
  performedBy: string;
  fromUserId?: string;
  toUserId?: string;
  fromStatus?: InboxConversationStatus;
  toStatus?: InboxConversationStatus;
  createdAt: string;
};

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
