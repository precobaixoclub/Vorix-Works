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

/** Fase 5 — motivo pelo qual `aiEnabled` está `false`; `undefined` quando `aiEnabled` é `true`. */
export type InboxAiPauseReason = "human_takeover" | "manual";

export type InboxConversation = {
  id: string;
  connectionId: string;
  contactId: string;
  status: InboxConversationStatus;
  assignedUserId?: string;
  lastMessageAt?: string;
  unreadCount: number;
  aiEnabled: boolean;
  aiPausedReason?: InboxAiPauseReason;
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
export type InboxConversationEventType =
  | "assigned"
  | "unassigned"
  | "took_over"
  | "transferred"
  | "status_changed"
  | "ai_paused"
  | "ai_resumed"
  // Fase 5 — únicos tipos com `performedBy: "ai"` (sentinela fixa, nunca um userId real).
  | "ai_response_sent"
  | "ai_response_failed"
  | "ai_response_cancelled";

export type InboxConversationEvent = {
  id: string;
  conversationId: string;
  type: InboxConversationEventType;
  performedBy: string;
  fromUserId?: string;
  toUserId?: string;
  fromStatus?: InboxConversationStatus;
  toStatus?: InboxConversationStatus;
  /** Fase 5 — só os eventos `ai_response_*`; nunca prompt/resposta bruta (ver backend). */
  metadata?: Record<string, unknown>;
  createdAt: string;
};

/** Fase 5 — membro do tenant/workspace atual, usado pelo seletor de transferência
 * (`GET /v1/inbox/members`). Nunca inclui membros de outro tenant. */
export type InboxTenantMember = { userId: string; email: string; name: string; role: string };

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
