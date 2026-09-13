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
  fromPhone: string;
  fromName?: string;
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
