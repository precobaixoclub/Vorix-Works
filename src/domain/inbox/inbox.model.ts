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
  /** Saúde reportada pelo monitor periódico (Fase 6), independente do último evento de fila.
   * `gateway_unavailable` é distinto de `degraded`: o próprio container WuzAPI está inalcançável
   * (falha de rede/timeout ao chamar `getConnectionStatus`), nunca inferido de um erro de sessão
   * específica — "container WuzAPI saudável não significa sessão WhatsApp saudável", e o inverso
   * também vale (sessão pode estar com problema mesmo com o gateway respondendo normalmente). */
  connectionHealth: "healthy" | "degraded" | "unknown" | "gateway_unavailable";
  reconnectCount: number;
  createdAt: string;
  updatedAt: string;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
  lastEventAt?: string;
  lastHeartbeatAt?: string;
  /** Fase 6 — categoria segura do último erro observado pelo monitor de saúde (nunca o corpo bruto
   * da resposta do gateway) — ex.: `"gateway_unreachable"`, `"session_logged_out"`. `undefined`
   * quando a última checagem foi bem-sucedida. */
  lastConnectionError?: string;
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

/** Fase 5 — motivo pelo qual `aiEnabled` está `false`, só informativo (nunca texto livre):
 * `human_takeover` = desligada automaticamente por "assumir conversa"; `manual` = um atendente com
 * `inbox:manage_ai` pausou explicitamente. `undefined` quando `aiEnabled` é `true`. */
export const INBOX_AI_PAUSE_REASONS = ["human_takeover", "manual"] as const;
export type InboxAiPauseReason = (typeof INBOX_AI_PAUSE_REASONS)[number];

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
   * conversa (nunca globalmente) — ver Fase 5. O gate real de elegibilidade da IA (Fase 5,
   * `isConversationEligibleForAi` em `inbox-use-cases.ts`) também exige `!assignedUserId`
   * diretamente — nunca confia só em `aiEnabled`, porque atribuição DIRETA (`assign()`, Fase 4)
   * não mexe em `aiEnabled` e ainda assim um humano responsável nunca pode competir com a IA. */
  aiEnabled: boolean;
  aiPausedReason?: InboxAiPauseReason;
  /** Fase 5 — lock lógico (CAS) de geração de IA em andamento para esta conversa; serializa
   * mensagens consecutivas do mesmo contato (ver `maybeGenerateAiResponse`). `undefined` quando
   * nenhuma geração está em voo. */
  aiProcessingSince?: string;
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
  /** Fase 6 — categoria segura da última falha (mesmo vocabulário de `MessagingProviderErrorKind`
   * — `transient`/`rate_limit`/`auth`/`session_logged_out`/`permanent` — mais `circuit_open` e
   * `rate_limited_local`, específicas do worker). Nunca o texto bruto do erro (isso é `lastError`).
   * Existe para permitir diagnosticar/reprocessar manualmente mensagens na DLQ sem precisar
   * reabrir logs. */
  failureCategory?: string;
  createdAt: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  failedAt?: string;
  /** Fase 5 — claim atômico (CAS) de "quem tem o direito de gerar/enviar uma resposta de IA para
   * esta mensagem inbound". Só é significativo em `direction: "inbound"`. `undefined` = ainda não
   * reivindicada (elegível para uma futura geração). Existe especificamente para impedir duas
   * respostas de IA para a mesma mensagem sob concorrência real (duas invocações do worker, ou
   * redelivery do RabbitMQ chegando bem próximo de uma reentrega já em processamento) — a defesa
   * PRINCIPAL contra duplicidade já é `wasCreated` em `registerInboundMessage` (evento duplicado
   * nunca chega a re-disparar a IA); isto cobre o caso mais raro de disputa dentro do mesmo
   * processamento inicial. */
  aiClaimStatus?: InboxAiClaimStatus;
  aiClaimedAt?: string;
  /** Preenchido só quando `aiClaimStatus === "answered"` — aponta para a `InboxMessage` outbound
   * que a IA efetivamente enviou em resposta a esta mensagem inbound. */
  aiResponseMessageId?: string;
};

/** Fase 5 — estado do claim de resposta automática de uma mensagem INBOUND (nunca aplicável a
 * outbound). `processing` = uma geração está em voo; `answered` = a IA respondeu com sucesso;
 * `skipped` = elegibilidade mudou antes do envio (ex.: humano assumiu durante a geração) ou a IA
 * não estava habilitada quando o claim foi tentado; `failed` = o AI Gateway falhou (timeout,
 * provider indisponível, saída inválida...) — nestes dois últimos casos a mensagem permanece
 * disponível para atendimento manual, nunca é re-tentada automaticamente. */
export const INBOX_AI_CLAIM_STATUSES = ["processing", "answered", "skipped", "failed"] as const;
export type InboxAiClaimStatus = (typeof INBOX_AI_CLAIM_STATUSES)[number];

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
  // Fase 5 — únicos tipos de evento com ator automático (`performedBy: "ai"`, sentinela fixa,
  // nunca um userId real — desvio deliberado da invariante "sempre um userId real" da Fase 4,
  // que nunca tinha um ator automático). `metadata` carrega os detalhes operacionais (nunca
  // prompt/resposta bruta — ver `InboxConversationEvent.metadata`).
  "ai_response_sent",
  "ai_response_failed",
  "ai_response_cancelled",
  // Fase 6 — a IA não gerou resposta por falta de crédito Vorix (nunca desliga a IA nem a Inbox
  // por isso; a conversa continua disponível para um humano responder normalmente).
  "ai_response_skipped_insufficient_credits",
] as const;
export type InboxConversationEventType = (typeof INBOX_CONVERSATION_EVENT_TYPES)[number];

/** Sentinela fixa de `performedBy` para os 3 eventos de IA da Fase 5 — nunca um userId real. */
export const INBOX_AI_ACTOR = "ai";

export type InboxConversationEvent = {
  id: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  type: InboxConversationEventType;
  /** Quem fez a ação — um userId real para todo evento da Fase 4, ou a sentinela `INBOX_AI_ACTOR`
   * ("ai") para os 3 eventos de IA da Fase 5. */
  performedBy: string;
  fromUserId?: string;
  toUserId?: string;
  fromStatus?: InboxConversationStatus;
  toStatus?: InboxConversationStatus;
  /**
   * Fase 5 — detalhes operacionais dos eventos `ai_response_*`, nunca prompt/resposta bruta:
   * `inboundMessageIds: string[]`, `outboundMessageId?: string`, `provider?: string`,
   * `model?: string`, `latencyMs?: number`, `tokens?: {inputTokens,outputTokens,totalTokens}`,
   * `estimatedCost?: number`, `aiTraceId?: string` (correlaciona com `ai_executions.trace_id`),
   * `errorCategory?: string` (categoria segura do AI Gateway, nunca o erro bruto do provider),
   * `reason?: string` (ex.: "human_took_over_during_generation" em `ai_response_cancelled`).
   */
  metadata?: Record<string, unknown>;
  createdAt: string;
};

/** Normaliza um telefone para E.164 simplificado (dígitos apenas, com `+` opcional na entrada) —
 * usado como chave de deduplicação de `InboxContact`. Não valida DDI/DDD; só remove formatação. */
export function normalizePhoneNumber(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) throw new Error("INBOX_INVALID_PHONE: telefone vazio ou sem dígitos.");
  return `+${digits}`;
}
