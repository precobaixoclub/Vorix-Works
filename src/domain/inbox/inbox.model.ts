/**
 * Domínio do módulo Conversas (inbox multicanal — WhatsApp via WuzAPI na Fase 1). Bounded context
 * PRÓPRIO, deliberadamente sem nenhum import de `src/domain/conversation` (chat interno do Arthur
 * — fluxo de briefing/intents com o assistente) nem de `src/domain/chat` (deprecado). "Conversa
 * com um contato externo por um canal" não é a mesma coisa que "conversa do usuário com o
 * assistente" — por isso o nome interno é `inbox`, nunca `conversation`. O nome exposto ao usuário
 * continua "Conversas" (sidebar/UI).
 *
 * Nenhum tipo aqui conhece WuzAPI/whatsmeow — isso é papel do `MessagingProvider` port
 * (`application/ports/messaging-provider.port.ts`) e do adapter em
 * `src/infrastructure/messaging/wuzapi/`.
 */

export const MESSAGING_PROVIDERS = ["wuzapi"] as const;
export type MessagingProviderId = (typeof MESSAGING_PROVIDERS)[number];

export const MESSAGING_CONNECTION_STATUSES = [
  "connecting",
  "connected",
  "reconnecting",
  "disconnected",
  "logged_out",
  "requires_repair",
  "error",
] as const;
export type MessagingConnectionStatus = (typeof MESSAGING_CONNECTION_STATUSES)[number];

/** Estados que nunca devem disparar reconexão automática — sessão revogada ou erro irrecuperável
 * de autenticação. A UI mostra "WhatsApp precisa ser conectado novamente" nestes casos. */
export const MESSAGING_CONNECTION_TERMINAL_STATUSES: readonly MessagingConnectionStatus[] = ["logged_out", "requires_repair"];

export type MessagingConnection = {
  id: string;
  tenantId: string;
  workspaceId: string;
  provider: MessagingProviderId;
  displayName: string;
  phoneNumber?: string;
  /** Identificador de sessão no gateway (ex.: nome da instância no WuzAPI) — nunca um token/segredo. */
  externalSessionId?: string;
  status: MessagingConnectionStatus;
  /** Saúde reportada pelo monitor periódico (Fase 6), independente do último evento de fila. */
  connectionHealth: "healthy" | "degraded" | "unknown";
  reconnectCount: number;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
  lastEventAt?: string;
  lastHeartbeatAt?: string;
};

export type InboxContact = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name?: string;
  /** E.164 — chave de deduplicação junto com `workspaceId` (ver `unique (workspace_id, phone_normalized)`). */
  phoneNormalized: string;
  profilePictureUrl?: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

/**
 * Fase 4 (Atendimento): mapeia direto para OPEN/PENDING/CLOSED pedidos — `"resolved"` É o CLOSED
 * (nome mantido do schema da Fase 1 para não exigir migration de enum; "finalizada" na UI).
 * `"archived"` continua reservado, fora do fluxo principal de atendimento (nunca setado por
 * nenhum caso de uso desta fase).
 */
export const INBOX_CONVERSATION_STATUSES = ["open", "pending", "resolved", "archived"] as const;
export type InboxConversationStatus = (typeof INBOX_CONVERSATION_STATUSES)[number];

export type InboxConversation = {
  id: string;
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  contactId: string;
  status: InboxConversationStatus;
  assignedUserId?: string;
  departmentId?: string;
  lastMessageAt?: string;
  unreadCount: number;
  /** IA responde automaticamente enquanto `true`; "assumir conversa" desliga isto só NESTA
   * conversa (nunca globalmente) — ver Fase 5. */
  aiEnabled: boolean;
  automationEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export const INBOX_MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type InboxMessageDirection = (typeof INBOX_MESSAGE_DIRECTIONS)[number];

export const INBOX_MESSAGE_TYPES = ["text", "image", "video", "audio", "document", "location", "contact", "other"] as const;
export type InboxMessageType = (typeof INBOX_MESSAGE_TYPES)[number];

export const INBOX_MESSAGE_STATUSES = ["queued", "sending", "sent", "delivered", "read", "failed"] as const;
export type InboxMessageStatus = (typeof INBOX_MESSAGE_STATUSES)[number];

/** Mesmo formato de `StorageRef` já usado por Asset Library/Chat — mídia recebida é baixada uma
 * vez e reenviada ao object storage do Vorix; nunca guardar a URL/token bruto do gateway aqui. */
export type InboxMediaStorageRef = {
  provider: string;
  bucket?: string;
  objectKey: string;
  metadata?: Record<string, unknown>;
};

export type InboxMessage = {
  id: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  connectionId: string;
  /** Id da mensagem no gateway — chave de idempotência junto com `connectionId` (ver
   * `unique (connection_id, external_message_id)`). Ausente enquanto a mensagem outbound está só
   * `queued` (ainda não foi enviada ao provider). */
  externalMessageId?: string;
  direction: InboxMessageDirection;
  type: InboxMessageType;
  status: InboxMessageStatus;
  body?: string;
  mediaStorageRef?: InboxMediaStorageRef;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  sentByUserId?: string;
  sentByAi: boolean;
  sentByAutomation: boolean;
  /** Tentativas de envio (retry ladder do worker) — gravado na própria linha, não só nos headers
   * do RabbitMQ, para ser consultável pela UI/observabilidade. Ver Fase 2. */
  attemptCount: number;
  lastError?: string;
  lastAttemptAt?: string;
  createdAt: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  failedAt?: string;
};

/**
 * Evento operacional de uma conversa — Fase 4 (Atendimento). Dupla função: (1) auditoria (quem
 * atribuiu/transferiu/pausou IA/mudou status, quando), (2) alimenta a timeline da Inbox com
 * eventos discretos ("Cleverton assumiu o atendimento") — NUNCA vira mensagem real enviada ao
 * WhatsApp, é só um registro interno do Vorix.
 */
export const INBOX_CONVERSATION_EVENT_TYPES = [
  "assigned",
  "unassigned",
  "took_over",
  "transferred",
  "status_changed",
  "ai_paused",
  "ai_resumed",
] as const;
export type InboxConversationEventType = (typeof INBOX_CONVERSATION_EVENT_TYPES)[number];

export type InboxConversationEvent = {
  id: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  type: InboxConversationEventType;
  /** Quem fez a ação — sempre um userId real, nunca "system", mesmo para efeitos colaterais
   * (ex.: IA pausada automaticamente ao assumir) — a Fase 4 não tem nenhum ator automático. */
  performedBy: string;
  fromUserId?: string;
  toUserId?: string;
  fromStatus?: InboxConversationStatus;
  toStatus?: InboxConversationStatus;
  createdAt: string;
};

/** Normaliza um telefone para E.164 simplificado (dígitos apenas, com `+` opcional na entrada) —
 * usado como chave de deduplicação de `InboxContact`. Não valida DDI/DDD; só remove formatação. */
export function normalizePhoneNumber(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) throw new Error("INBOX_INVALID_PHONE: telefone vazio ou sem dígitos.");
  return `+${digits}`;
}
