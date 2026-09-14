import type { InboxMessageStatus, InboxMessageType, MessagingConnectionStatus } from "../../domain/inbox/inbox.model.js";

/**
 * Eventos internos normalizados do módulo Conversas (Fase 2 — Eventos). Todo evento bruto do
 * gateway (WuzAPI hoje) é convertido para um destes três formatos pelo
 * `WuzApiEventMapper` (`src/infrastructure/messaging/wuzapi/wuzapi-event-mapper.ts`) ANTES de
 * chegar em qualquer consumer — nenhum consumer/use case conhece o payload bruto do provider.
 * Um futuro `WhatsAppCloudEventMapper` produziria exatamente os mesmos três tipos.
 */

export type InboundMessageReceived = {
  type: "message.inbound";
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  externalSessionId: string;
  externalMessageId: string;
  /**
   * Correção do bug de identidade de conversa (ver docs/conversas-canonical-chat-identity.md) —
   * `chatId` é a identidade CANÔNICA do chat (JID do grupo `@g.us`, ou telefone normalizado do
   * peer em DM), sempre distinta do remetente de uma mensagem específica. `senderId`/`senderName`
   * são de quem mandou ESTA mensagem (== o peer em DM; um dos N participantes em grupo).
   * `fromMe` = este evento é um self-echo do WuzAPI (mensagem que o PRÓPRIO número conectado
   * mandou — via Vorix ou diretamente do celular pareado), nunca tratado como mensagem de um
   * contato externo.
   */
  chatId: string;
  isGroup: boolean;
  groupName?: string;
  /**
   * Bloco "Identity UX" (ver docs/conversas-whatsapp-experience-completion.md) — telefone E.164
   * canônico do PEER desta conversa DIRECT, quando resolvível a partir do próprio provider
   * (`Info.Chat`/`Info.RecipientAlt`, via `resolveWhatsAppPersonIdentity`). `undefined` em grupo/
   * canal, ou quando só o LID é conhecido e o provider nunca mandou o `*Alt` correspondente
   * (pivô degradado — ver `src/domain/inbox/whatsapp-identity.ts`).
   */
  chatPhoneE164?: string;
  chatPn?: string;
  chatLid?: string;
  fromMe: boolean;
  senderId: string;
  senderName?: string;
  /** Aliases técnicos de quem mandou ESTA mensagem — relevante mesmo em grupo (cada participante
   * tem seu próprio PN/LID). `undefined` quando não resolvível. */
  senderPn?: string;
  senderLid?: string;
  messageType: InboxMessageType;
  body?: string;
  mediaUrl?: string;
  mimeType?: string;
  /**
   * Redesign operacional (mídia) — campos extraídos do payload bruto do WuzAPI só para tipos de
   * mídia (`image`/`video`/`audio`/`document`), PENDING validação real (ver comentário no topo de
   * `wuzapi-event-mapper.ts`). `mediaKey`/`fileSha256`/`fileEncSha256` são material de
   * descriptografia — usados uma única vez pelo worker para chamar o download do WuzAPI logo após
   * este evento chegar, NUNCA persistidos em `inbox_messages` (ver `registerInboundMessage`).
   */
  caption?: string;
  fileName?: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
  thumbnailBase64?: string;
  mediaKey?: string;
  fileSha256?: string;
  fileEncSha256?: string;
  occurredAt: string;
};

export type MessageStatusChanged = {
  type: "message.status";
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  externalSessionId: string;
  externalMessageId: string;
  status: InboxMessageStatus;
  occurredAt: string;
};

export type ConnectionStateChanged = {
  type: "connection.state";
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  externalSessionId: string;
  status: MessagingConnectionStatus;
  phoneNumber?: string;
  occurredAt: string;
};

export type NormalizedInboxEvent = InboundMessageReceived | MessageStatusChanged | ConnectionStateChanged;
