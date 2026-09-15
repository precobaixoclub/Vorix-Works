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

import { canonicalizeBrazilianPhone } from "./brazilian-phone-identity.js";

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
  /** E.164 — chave de deduplicação junto com `workspaceId` (ver `unique (workspace_id, phone_normalized)`).
   * Pivô comercial central da PESSOA (ver `src/domain/inbox/whatsapp-identity.ts`) — nunca o LID. */
  phoneNormalized: string;
  profilePictureUrl?: string;
  externalId?: string;
  /** Bloco "Identity UX" — aliases técnicos de WhatsApp, reportados pelo próprio provider
   * (`Info.SenderAlt`/`Info.RecipientAlt`), nunca inferidos por heurística. Só roteamento/
   * diagnóstico — nunca mostrados como identidade principal ao usuário (ver
   * `docs/conversas-whatsapp-experience-completion.md`). `undefined` até o provider reportar. */
  whatsappPn?: string;
  whatsappLid?: string;
  metadata?: Record<string, unknown>;
  /** CRM/Comercial (Fase 4) — `contacts.id` ligado via `ContactIdentity` (migration 0092, coluna
   * `inbox_contacts.contact_id`). `undefined` até alguém vincular este contato do WhatsApp a um
   * Contact do CRM — nunca preenchido automaticamente (ver `docs/crm-omnichannel-architecture-audit.md`). */
  crmContactId?: string;
  /** Bloco "réplica de identidade" — padrão tombstone (ver `db/migrations/0118_inbox_identity_merge.sql`):
   * quando `mergeStatus === "merged"`, este contato foi fundido em `mergedIntoContactId` — o `id`
   * é preservado (nunca apagado, qualquer referência antiga continua resolvendo), mas nunca deve
   * aparecer em listagens/UI. `undefined` = contato ativo normal. */
  mergeStatus?: "merged";
  mergedIntoContactId?: string;
  mergedAt?: string;
  /** Foto de perfil do WhatsApp — pedida explicitamente pelo usuário em produção ("ajustar para
   * carregar as fotos"). Mesmo padrão de privacidade de `InboxMessage.mediaStorageRef`: nunca a URL
   * bruta do WhatsApp (expira, e exporia o CDN do gateway direto ao navegador) — sempre um ref pro
   * `InboxMediaStoragePort`, servido de volta só pelo proxy autenticado (`GET
   * /inbox/avatars/contact/:id`, ver `inbox.route.ts`). `undefined` = ainda não sincronizada (best-
   * effort, pode chegar em instantes) OU a pessoa não tem foto de perfil (estado normal). */
  profilePictureStorageRef?: InboxMediaStorageRef;
  profilePictureSyncedAt?: string;
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

/** Correção do bug estrutural de identidade de conversa (ver
 * docs/conversas-canonical-chat-identity.md) — `"direct"` = 1:1 com um contato; `"group"` = grupo
 * do WhatsApp, onde vários participantes mandam mensagem para a MESMA conversa. */
export const INBOX_CHAT_TYPES = ["direct", "group"] as const;
export type InboxChatType = (typeof INBOX_CHAT_TYPES)[number];

export type InboxConversation = {
  id: string;
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  chatType: InboxChatType;
  /** Identidade CANÔNICA do chat no provider — JID do grupo (`...@g.us`) ou telefone normalizado
   * do peer, NUNCA o remetente de uma mensagem específica. Chave real de deduplicação junto com
   * `connectionId` (ver `unique index inbox_conversations_connection_chat_key`, migration 0115) —
   * substituiu `(connectionId, contactId)`, que fragmentava grupos (um `contactId` por
   * participante) e DMs (self-echo virava um `contactId`/conversa fantasma do próprio número). */
  externalChatId: string;
  /** Só para `chatType: "group"` — nome/assunto do grupo quando o provider fornece. `undefined` =
   * sem nome conhecido (fallback visual no frontend), nunca inventado a partir do primeiro remetente. */
  groupName?: string;
  /** Bloco "Identity UX" — metadata mínima de grupo (ver docs/conversas-whatsapp-experience-completion.md),
   * buscada via `MessagingProvider.getGroupInfo`. `undefined` até a primeira sincronização. */
  groupParticipantCount?: number;
  groupMetadataUpdatedAt?: string;
  /** Foto do grupo — mesmo racional/proxy de `InboxContact.profilePictureStorageRef`. `undefined` =
   * ainda não sincronizada ou o grupo não tem foto definida (estado normal). */
  groupPictureStorageRef?: InboxMediaStorageRef;
  groupPictureSyncedAt?: string;
  /** Só para `chatType: "direct"` — o `InboxContact` (pessoa) do outro lado. `undefined` em
   * conversas de grupo: um grupo não é uma pessoa/Contact do CRM, nunca fundido automaticamente
   * (ver `crm-panel.tsx` — vínculo ao CRM continua manual e só aparece para conversas diretas). */
  contactId?: string;
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
  /** Bloco "réplica de identidade" — mesmo padrão tombstone de `InboxContact.mergeStatus`: quando
   * `mergeStatus === "merged"`, as mensagens desta conversa foram movidas para
   * `mergedIntoConversationId` e este registro nunca deve aparecer em listagens/UI. */
  mergeStatus?: "merged";
  mergedIntoConversationId?: string;
  mergedAt?: string;
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

/** Redesign operacional (mídia) — atributos auxiliares de exibição para mensagens de mídia,
 * guardados dentro de `InboxMessage.metadata` (jsonb já existente — ver migration 0083). Não são
 * colunas dedicadas de propósito: são só dados de apresentação (nunca filtrados/indexados por
 * eles), então não justificam uma migration nova. Convenção puramente TypeScript sobre o jsonb —
 * casts na borda do repositório, mesmo padrão já usado para `metadata` (ver
 * `postgres-inbox-message-repository.ts`). */
export type InboxMediaMetadata = {
  fileName?: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
  thumbnailDataUrl?: string;
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
  /** Correção do bug de identidade de conversa — quem, DENTRO do chat, mandou esta mensagem
   * específica (JID/telefone do participante). Em DM é redundante com o contato da conversa; em
   * GRUPO é a única forma de saber quem dos N participantes mandou cada mensagem (a conversa em si
   * representa o grupo inteiro, não mais um remetente). `undefined` em mensagens outbound enviadas
   * pelo próprio Vorix (o remetente já é conhecido: `sentByUserId`/`sentByAi`/`sentByAutomation`). */
  senderExternalId?: string;
  /** Bloco "Identity UX" — telefone resolvido de quem mandou ESTA mensagem, quando o provider
   * confirmou o alias (ver `whatsapp-identity.ts`). `undefined` quando só o LID é conhecido. */
  senderPhoneE164?: string;
  /** Nome de exibição do remetente (`PushName` do WhatsApp) no momento do envio — snapshot, nunca
   * resolvido de novo depois (o nome de alguém pode mudar; a mensagem antiga mostra o nome de quando
   * foi mandada). Usado pelo frontend para rotular cada bolha dentro de uma conversa de grupo. */
  senderDisplayName?: string;
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
  /** Reconciliação outbound (bug real corrigido após homologação de runtime) — camada DISTINTA de
   * `attemptCount`/`lastError`/`failureCategory` acima (que são do ENVIO AO PROVIDER). Estas três
   * são só sobre "esta mensagem já chegou a ser publicada no broker interno do Vorix?" — nunca
   * misturar as duas camadas (broker vs. provider), ver `docs/conversas-homologacao-runtime-relatorio.md`
   * seção 1-B. `outboundPublishedAt` ausente + `direction: "outbound"` + `status: "queued"` +
   * `createdAt` mais velho que a janela de graça = candidata a reconciliação. */
  outboundPublishedAt?: string;
  publishAttempts: number;
  lastPublishError?: string;
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

/** Normaliza um telefone para E.164 simplificado — usado como chave de deduplicação de
 * `InboxContact`. Tenta a canonicalização brasileira primeiro (bloco "réplica de identidade" —
 * ver `brazilian-phone-identity.ts`: mesmo número real, com ou sem o 9º dígito do celular, sempre
 * vira a mesma chave); cai no comportamento original (só dígitos) pra qualquer entrada que não
 * bata o formato BR — LID/grupo/canal (nunca tratados como telefone, ver `looksLikeNonPhoneJid`)
 * ou números de outros países. */
export function normalizePhoneNumber(raw: string): string {
  const brazilian = canonicalizeBrazilianPhone(raw);
  if (brazilian?.isValidBrazilian) return brazilian.e164;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) throw new Error("INBOX_INVALID_PHONE: telefone vazio ou sem dígitos.");
  return `+${digits}`;
}
