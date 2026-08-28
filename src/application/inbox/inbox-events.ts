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
  occurredAt: string;
};

export type MessageStatusChanged = {
  type: "message.status";
  connectionId: string;
  externalSessionId: string;
  externalMessageId: string;
  status: InboxMessageStatus;
  occurredAt: string;
};

export type ConnectionStateChanged = {
  type: "connection.state";
  connectionId: string;
  externalSessionId: string;
  status: MessagingConnectionStatus;
  phoneNumber?: string;
  occurredAt: string;
};

export type NormalizedInboxEvent = InboundMessageReceived | MessageStatusChanged | ConnectionStateChanged;
