import type { ConnectionStateChanged, InboundMessageReceived, MessageStatusChanged, NormalizedInboxEvent } from "../../../application/inbox/inbox-events.js";
import type { InboxMessageStatus, InboxMessageType } from "../../../domain/inbox/inbox.model.js";

/**
 * Camada anti-corrupção — módulo Conversas (Fase 2). Único arquivo que conhece o formato bruto de
 * evento publicado pelo WuzAPI (`RABBITMQ_QUEUE`, fila `wuzapi.events.raw`). Converte para os três
 * eventos internos normalizados (`inbox-events.ts`) ANTES de qualquer consumer — nenhum outro
 * arquivo do módulo pode importar/inspecionar este payload bruto.
 *
 * IMPORTANTE: o formato exato do payload (nomes de campo do whatsmeow/WuzAPI, ex.: `event`,
 * `Info.ID`, `Info.Sender`) precisa ser confirmado contra uma instância real na Fase 2 (spike) —
 * este mapper assume o formato documentado publicamente do projeto `asternic/wuzapi` e falha de
 * forma explícita (retorna `undefined`, nunca lança) para qualquer payload que não reconheça, para
 * que o `RawEventConsumer` possa rotear o desconhecido para a DLQ em vez de derrubar o worker.
 */

const MESSAGE_TYPE_BY_WUZAPI_KIND: Record<string, InboxMessageType> = {
  conversation: "text",
  extendedTextMessage: "text",
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  locationMessage: "location",
  contactMessage: "contact",
};

const STATUS_BY_WUZAPI_RECEIPT: Record<string, InboxMessageStatus> = {
  delivery: "delivered",
  read: "read",
  played: "read",
};

export type RawWuzApiEvent = {
  event?: string;
  sessionId?: string;
  instanceToken?: string;
  data?: Record<string, unknown>;
};

export function mapWuzApiEvent(raw: RawWuzApiEvent): NormalizedInboxEvent | undefined {
  const externalSessionId = raw.sessionId ?? raw.instanceToken;
  if (!raw.event || !externalSessionId || !raw.data) return undefined;

  if (raw.event === "Message") {
    return mapInboundMessage(externalSessionId, raw.data);
  }
  if (raw.event === "ReadReceipt" || raw.event === "Receipt") {
    return mapStatusReceipt(externalSessionId, raw.data);
  }
  if (raw.event === "Connected" || raw.event === "Disconnected" || raw.event === "LoggedOut" || raw.event === "PairError") {
    return mapConnectionState(raw.event, externalSessionId, raw.data);
  }
  return undefined;
}

function mapInboundMessage(externalSessionId: string, data: Record<string, unknown>): InboundMessageReceived | undefined {
  const info = data.Info as Record<string, unknown> | undefined;
  const messageId = info?.ID as string | undefined;
  const fromPhone = info?.Sender as string | undefined;
  if (!messageId || !fromPhone) return undefined;

  const messageBody = data.Message as Record<string, unknown> | undefined;
  const kind = messageBody ? Object.keys(messageBody).find((key) => key in MESSAGE_TYPE_BY_WUZAPI_KIND || key === "conversation") : undefined;
  const messageType = kind ? MESSAGE_TYPE_BY_WUZAPI_KIND[kind] ?? "other" : "other";
  const body = typeof messageBody?.conversation === "string" ? (messageBody.conversation as string) : undefined;

  return {
    type: "message.inbound",
    // tenantId/workspaceId são resolvidos pelo consumer a partir de `messaging_connections`
    // (busca por `externalSessionId`) — o mapper não tem acesso a repositório, só normaliza o payload.
    tenantId: "",
    workspaceId: "",
    connectionId: "",
    externalSessionId,
    externalMessageId: messageId,
    fromPhone,
    fromName: info?.PushName as string | undefined,
    messageType,
    body,
    occurredAt: typeof info?.Timestamp === "number" ? new Date((info.Timestamp as number) * 1000).toISOString() : new Date().toISOString(),
  };
}

function mapStatusReceipt(externalSessionId: string, data: Record<string, unknown>): MessageStatusChanged | undefined {
  const messageIds = data.MessageIDs as string[] | undefined;
  const receiptType = (data.Type as string | undefined) ?? "delivery";
  const status = STATUS_BY_WUZAPI_RECEIPT[receiptType];
  const externalMessageId = messageIds?.[0];
  if (!status || !externalMessageId) return undefined;

  return {
    type: "message.status",
    connectionId: "",
    externalSessionId,
    externalMessageId,
    status,
    occurredAt: new Date().toISOString(),
  };
}

function mapConnectionState(event: string, externalSessionId: string, data: Record<string, unknown>): ConnectionStateChanged {
  const statusByEvent: Record<string, ConnectionStateChanged["status"]> = {
    Connected: "connected",
    Disconnected: "disconnected",
    LoggedOut: "logged_out",
    PairError: "requires_repair",
  };
  return {
    type: "connection.state",
    connectionId: "",
    externalSessionId,
    status: statusByEvent[event] ?? "error",
    phoneNumber: data.JID as string | undefined,
    occurredAt: new Date().toISOString(),
  };
}
