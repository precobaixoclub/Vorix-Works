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

/** Correção do bug de identidade de conversa (ver docs/conversas-canonical-chat-identity.md) —
 * `"direct"` = 1:1 com uma pessoa; `"group"` = grupo/canal do WhatsApp, onde vários remetentes
 * mandam mensagem pra MESMA conversa (nunca uma pessoa/Contact do CRM). */
export type InboxChatType = "direct" | "group";

/** Canal da conexão dona da conversa — WhatsApp (WuzAPI) é o único desde sempre; Instagram DM virou
 * canal de primeira classe do Inbox (pedido explícito do usuário: "colocar o icone do whatsapp e
 * do instagram para diferenciar na conversa e um filtro tambem"). */
export type MessagingProviderId = "wuzapi" | "instagram";

/** Bloco "etiquetas" (pedido explícito do usuário: "criar e configurar etiquetas dentro do
 * sistema e nas conversas ser possível adicionar mais do que uma"). Cor vem de um vocabulário
 * fechado (mesmo racional de design do resto do produto, ver `web/CLAUDE.md`) — reaproveitada
 * entre várias etiquetas, nunca um seletor de cor livre. */
export const INBOX_TAG_COLORS = ["emerald", "sky", "violet", "amber", "rose", "slate"] as const;
export type InboxTagColor = (typeof INBOX_TAG_COLORS)[number];

/** Por WORKSPACE (nunca por equipe/canal) — a mesma etiqueta serve qualquer conversa, WhatsApp ou
 * Instagram. Relação com `InboxConversation` é N:N — uma conversa pode ter várias. */
export type InboxTag = {
  id: string;
  workspaceId: string;
  name: string;
  color: InboxTagColor;
  createdAt: string;
  updatedAt: string;
};

export type InboxConversation = {
  id: string;
  connectionId: string;
  /** Denormalizado pela listagem — `undefined` só em ambientes que ainda não atualizaram o backend
   * para preenchê-lo (nunca em uso normal, toda conexão tem um `provider`). */
  connectionProvider?: MessagingProviderId;
  chatType: InboxChatType;
  /** Só em `chatType: "group"` — nome do grupo/canal quando o provider fornece. `undefined` = sem
   * nome conhecido, o frontend cai no fallback visual (nunca inventa um nome). */
  groupName?: string;
  /** Bloco "Identity UX" — quantidade de participantes, resolvida via `syncGroupMetadata`
   * (backend). `undefined` até a primeira sincronização bem-sucedida — nunca inventado. */
  groupParticipantCount?: number;
  /** Só em `chatType: "direct"` — `undefined` em conversas de grupo (nunca fundido com um Contact
   * do CRM, ver `ContactContextPane`/`CrmContextSection`). */
  contactId?: string;
  /** Foto do grupo (pedido explícito do usuário em produção). `undefined` = ainda não sincronizada
   * ou o grupo não tem foto definida — nunca tratado como erro, ver `GroupAvatar`. */
  groupPictureStorageRef?: InboxMediaStorageRef;
  status: InboxConversationStatus;
  assignedUserId?: string;
  /** Bloco "roteamento por equipe" (réplica adaptada do CMDesk) — equipe atualmente responsável
   * pela conversa, um nível acima de `assignedUserId`. `undefined` = canal sem roteamento por
   * equipe configurado, ou conversa anterior a esta funcionalidade. */
  currentTeamId?: string;
  /** Bloco "kanban de atendimento" (réplica adaptada do CMDesk) — fase atual da conversa DENTRO de
   * `currentTeamId` (coluna do quadro). `undefined` = sem equipe, ou equipe sem quadro aberto
   * ainda (ver `ensureConversationPhaseStates`). */
  currentPhaseId?: string;
  lastMessageAt?: string;
  unreadCount: number;
  /** Bloco "urgente" (pedido explícito do usuário em produção) — marcação manual, mostrada como um
   * ícone de fogo na listagem. */
  isUrgent: boolean;
  /** Bloco "kanban de atendimento" — fixar um card no topo do quadro. Distinto de qualquer outro
   * "sticky"/pin de roteamento (conceitos diferentes). */
  isPinned: boolean;
  pinnedAt?: string;
  aiEnabled: boolean;
  aiPausedReason?: InboxAiPauseReason;
  automationEnabled: boolean;
  /** Denormalizado pela listagem (`GET /v1/inbox/conversations`) — nunca vem no `getById()`, que
   * hoje nem existe como rota própria (a Fase 1 não tem "abrir 1 conversa" isolado, só a lista).
   * `undefined` em conversas de grupo (`chatType: "group"`) — não há um único contato. */
  contactName?: string;
  contactPhone?: string;
  /** CRM/Comercial (Fase 4) — `contacts.id` do CRM já vinculado a este contato do WhatsApp
   * (`inbox_contacts.contact_id`), se algum vínculo já foi feito. `undefined` até alguém vincular. */
  crmContactId?: string;
  /** Foto de perfil do contato (pedido explícito do usuário em produção). `undefined` em conversas
   * de grupo, ou ainda não sincronizada, ou a pessoa não tem foto — nunca tratado como erro. */
  contactProfilePictureStorageRef?: InboxMediaStorageRef;
  /** Redesign operacional — resumo da última mensagem, denormalizado pela listagem
   * (`GET /v1/inbox/conversations`) para a lista mostrar um preview real em vez de um texto
   * genérico. `undefined` em conversas sem nenhuma mensagem ainda, ou em ambientes que ainda não
   * atualizaram o backend para preenchê-lo. */
  lastMessagePreview?: { type: InboxMessageType; body?: string; direction: InboxMessageDirection; senderDisplayName?: string };
  /** Bloco "etiquetas" — denormalizado pela listagem. `undefined` = ambiente que ainda não
   * atualizou o backend; `[]` = módulo configurado, sem etiquetas nesta conversa. */
  tags?: InboxTag[];
};

/** Fase 4 — `open`/`pending`/`resolved` filtram por status normalizado (ver
 * `InboxConversationStatus`); os demais continuam os filtros operacionais da Fase 3. */
export type InboxConversationFilter = "all" | "mine" | "unassigned" | "unread" | "urgent" | "open" | "pending" | "resolved";

/** Bloco "roteamento por equipe" (réplica adaptada do CMDesk, pedido explícito do usuário) —
 * versão simplificada do `ChannelRoutingConfig`: só equipe padrão + distribuição fixa vs rodízio
 * entre as equipes vinculadas ao canal. Sem menu hierárquico, sem sticky/pinned por contato+canal
 * (fora de escopo desta rodada). */
export type ChannelDistributionMode = "default" | "round_robin";

export type ChannelRoutingConfig = {
  id: string;
  connectionId: string;
  defaultTeamId: string;
  distributionMode: ChannelDistributionMode;
  createdAt: string;
  updatedAt: string;
};

export type ChannelRoutingSnapshot = { teamIds: string[]; config?: ChannelRoutingConfig };

/** Bloco "kanban de atendimento" (réplica adaptada do CMDesk, pedido explícito do usuário) —
 * colunas do quadro, por equipe. */
export type KanbanPhaseType = "RUNNING" | "PAUSED";

export type TeamKanbanPhase = {
  id: string;
  teamId: string;
  name: string;
  orderIndex: number;
  isDefaultFirst: boolean;
  phaseType: KanbanPhaseType;
  naoContabilizaOperacional: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Tempo de atendimento em lote (badge "rodando" dos cards) — o frontend incrementa
 * `totalSeconds` ao vivo via `setInterval` local ENQUANTO `isRunning`, nunca reconsulta o backend
 * a cada segundo (ver `useLiveServiceSeconds`). */
export type ConversationServiceTime = {
  conversationId: string;
  totalSeconds: number;
  currentPhaseStartedAt?: string;
  isRunning: boolean;
};

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

/** Redesign operacional (mídia real) — espelha `InboxMediaStorageRef` do backend
 * (`src/domain/inbox/inbox.model.ts`). `objectKey` nunca é usado diretamente pelo frontend para
 * montar uma URL — só como sinal de "esta mensagem tem mídia baixada"; o arquivo em si só é
 * acessível via `GET /v1/inbox/media/:id` com um token de curta duração (`getInboxMediaToken`). */
export type InboxMediaStorageRef = { provider: string; bucket?: string; objectKey: string };

/** Metadados auxiliares de exibição (`InboxMediaMetadata` no backend) — presentes só quando a
 * mídia já foi baixada e enriquecida (ver `downloadInboundMediaAndAttach`). */
export type InboxMediaMetadata = { fileName?: string; fileSizeBytes?: number; durationSeconds?: number; thumbnailDataUrl?: string };

/** Bloco "reações" (pedido explícito do usuário: "ajuste tambem para quando alguem reagir a uma
 * mensagem") — espelha `InboxMessageReaction` do backend. Uma entrada por `reactorId` (a última
 * reação dessa pessoa vence — nunca uma lista histórica de todas as reações já dadas). */
export type InboxMessageReaction = { reactorId: string; reactorName?: string; emoji: string };

/** Bloco "resposta citada" (pedido explícito do usuário: "quando alguem responde uma mensagem não
 * esta mostrando o conteudo corretamente") — espelha `InboxQuotedMessage` do backend. Snapshot
 * gravado no momento em que a resposta chegou, nunca resolvido de novo depois — se a mensagem
 * original ainda estiver carregada na timeline atual, o frontend prefere mostrar o conteúdo AO VIVO
 * dela (via `externalMessageId`), caindo neste snapshot só quando ela não está mais visível. */
export type InboxQuotedMessage = { externalMessageId?: string; senderId?: string; body?: string; type?: InboxMessageType };

export type InboxMessage = {
  id: string;
  conversationId: string;
  /** Id da mensagem no WhatsApp (`wamid...`) — usado para casar `quotedMessage.externalMessageId`
   * com uma mensagem já carregada na timeline atual (conteúdo ao vivo em vez do snapshot). */
  externalMessageId?: string;
  direction: InboxMessageDirection;
  type: InboxMessageType;
  status: InboxMessageStatus;
  body?: string;
  /** Presente só quando a mídia já foi baixada e persistida (best-effort/assíncrono — pode
   * demorar um instante depois da mensagem aparecer, ou nunca chegar a existir se o download
   * falhar). `undefined` = mostrar o fallback de ícone+rótulo, nunca um estado de erro definitivo. */
  mediaStorageRef?: InboxMediaStorageRef;
  mimeType?: string;
  metadata?: InboxMediaMetadata;
  sentByUserId?: string;
  sentByAi: boolean;
  sentByAutomation: boolean;
  /** Correção do bug de identidade de conversa — quem, dentro do chat, mandou esta mensagem
   * específica. Em grupo é a única forma de atribuir cada mensagem a um participante (a conversa
   * em si representa o grupo inteiro); em DM é redundante com o contato da conversa. `undefined`
   * em mensagens outbound enviadas pelo Vorix (o remetente já é `sentByUserId`/`sentByAi`/
   * `sentByAutomation`). */
  senderExternalId?: string;
  senderDisplayName?: string;
  /** Bloco "resposta citada" — snapshot da mensagem original, presente só quando esta mensagem é
   * uma resposta a outra. */
  quotedMessage?: InboxQuotedMessage;
  /** Bloco "reações" — sempre presente (lista vazia quando ninguém reagiu ainda). */
  reactions: readonly InboxMessageReaction[];
  createdAt: string;
  sentAt?: string;
};

/** Fase 7 (Resultados) — relatório agregado de atendimento (read-only). */
export type InboxAgentVolume = { userId: string; messageCount: number };

export type InboxMetricsReport = {
  receivedCount: number;
  openCount: number;
  pendingCount: number;
  resolvedCount: number;
  backlogCount: number;
  avgFirstResponseSeconds?: number;
  avgHandleTimeSeconds?: number;
  aiResolvedMessageCount: number;
  humanResolvedMessageCount: number;
  volumeByAgent: readonly InboxAgentVolume[];
};

/** Fase 10 (Pre-Pilot Hardening) — `GET /v1/inbox/status`, SEMPRE disponível (nunca 404, mesmo com
 * o módulo desligado). É assim que o frontend decide se chama qualquer outra rota `/v1/inbox/*`
 * antes de tentar — nunca infere isso a partir de um 404/erro genérico. */
export type InboxModuleStatus = { enabled: boolean };

/** Fase 10 — token de curtíssima duração e escopo único (só abre `GET /v1/inbox/stream`), emitido
 * por `POST /v1/inbox/stream-token`. Nunca o access token normal — ver `auth.middleware.ts`. */
export type InboxStreamToken = { streamToken: string; expiresIn: number };
