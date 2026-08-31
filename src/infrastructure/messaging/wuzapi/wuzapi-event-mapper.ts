import type { ConnectionStateChanged, InboundMessageReceived, MessageStatusChanged, NormalizedInboxEvent } from "../../../application/inbox/inbox-events.js";
import type { InboxMessageStatus, InboxMessageType } from "../../../domain/inbox/inbox.model.js";

/**
 * Camada anti-corrupção — módulo Conversas (Fase 2). Único arquivo que conhece o formato bruto de
 * evento publicado pelo WuzAPI na fila `wuzapi.events.raw`. Converte para os três eventos internos
 * normalizados (`inbox-events.ts`) ANTES de qualquer consumer — nenhum outro arquivo do módulo
 * pode importar/inspecionar este payload bruto.
 *
 * Envelope CONFIRMADO via código-fonte real de `asternic/wuzapi` (`wmiau.go`,
 * `rabbitmq.go:sendToGlobalRabbit` — pesquisa direta no repositório, Fase 2 pré-spike):
 *
 * ```json
 * { "type": "Message" | "ReadReceipt" | "Connected" | "Disconnected" | "LoggedOut",
 *   "event": { "Info": { "ID", "Sender", "Chat", "PushName", "Timestamp", "IsFromMe", "IsGroup" },
 *              "Message": { "conversation": "...", ... } },
 *   "state": "Read" | "ReadSelf" | "Delivered",   // só em "ReadReceipt"
 *   "userID": "<id interno do WuzAPI>",
 *   "instanceName": "<name escolhido em POST /admin/users>" }
 * ```
 *
 * `instanceName` é SEMPRE o `MessagingConnection.id` do Vorix (é o Vorix quem escolhe esse `name`
 * ao provisionar a sessão — ver `wuzapi-messaging-provider.ts:connect`), nunca o token de sessão
 * (que nunca aparece neste payload). Por isso a correlação de evento → conexão é um `getById`
 * direto, sem precisar de índice por token.
 *
 * AINDA NÃO CONFIRMADO (pendência do spike, ver docs/conversas-fase2-spike.md): o nome exato do
 * campo de texto dentro de `Message` para cada tipo de mídia (`imageMessage`, `videoMessage`
 * etc. — só `conversation`/`extendedTextMessage` para texto simples estão bem documentados no
 * proto do whatsmeow) e o valor exato de `PairError`/erro de autenticação irrecuperável (o
 * mapeamento para `requires_repair` abaixo é uma extrapolação razoável de `LoggedOut`, não uma
 * confirmação de um evento `PairError` real).
 */

const MESSAGE_TYPE_BY_WHATSMEOW_KIND: Record<string, InboxMessageType> = {
  conversation: "text",
  extendedTextMessage: "text",
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  locationMessage: "location",
  contactMessage: "contact",
};

const STATUS_BY_RECEIPT_STATE: Record<string, InboxMessageStatus> = {
  Delivered: "delivered",
  Read: "read",
  ReadSelf: "read",
};

export type RawWuzApiEvent = {
  type?: string;
  event?: Record<string, unknown>;
  state?: string;
  userID?: string;
  instanceName?: string;
};

export function mapWuzApiEvent(raw: RawWuzApiEvent): NormalizedInboxEvent | undefined {
  const instanceName = raw.instanceName;
  if (!raw.type || !instanceName) return undefined;

  if (raw.type === "Message" && raw.event) return mapInboundMessage(instanceName, raw.event);
  if (raw.type === "ReadReceipt" && raw.event) return mapStatusReceipt(instanceName, raw.event, raw.state);
  if (raw.type === "Connected" || raw.type === "Disconnected" || raw.type === "LoggedOut") {
    return mapConnectionState(raw.type, instanceName, raw.event ?? {});
  }
  return undefined;
}

function mapInboundMessage(instanceName: string, event: Record<string, unknown>): InboundMessageReceived | undefined {
  const info = event.Info as Record<string, unknown> | undefined;
  const messageId = info?.ID as string | undefined;
  const fromPhone = info?.Sender as string | undefined;
  if (!messageId || !fromPhone) return undefined;

  const message = event.Message as Record<string, unknown> | undefined;
  const kind = message ? Object.keys(message).find((key) => key in MESSAGE_TYPE_BY_WHATSMEOW_KIND) : undefined;
  const messageType = kind ? MESSAGE_TYPE_BY_WHATSMEOW_KIND[kind] ?? "other" : "other";
  const body = typeof message?.conversation === "string" ? (message.conversation as string) : undefined;

  return {
    type: "message.inbound",
    // tenantId/workspaceId são resolvidos pelo worker a partir de `messaging_connections` (busca
    // por `instanceName` == connectionId) — o mapper não tem acesso a repositório, só normaliza.
    tenantId: "",
    workspaceId: "",
    connectionId: instanceName,
    externalSessionId: instanceName,
    externalMessageId: messageId,
    fromPhone: normalizeWhatsmeowJid(fromPhone),
    fromName: info?.PushName as string | undefined,
    messageType,
    body,
    occurredAt: typeof info?.Timestamp === "number" ? new Date((info.Timestamp as number) * 1000).toISOString() : new Date().toISOString(),
  };
}

function mapStatusReceipt(instanceName: string, event: Record<string, unknown>, state: string | undefined): MessageStatusChanged | undefined {
  const messageIds = event.MessageIDs as string[] | undefined;
  const status = state ? STATUS_BY_RECEIPT_STATE[state] : undefined;
  const externalMessageId = messageIds?.[0];
  if (!status || !externalMessageId) return undefined;

  return {
    type: "message.status",
    // tenantId/workspaceId são preenchidos pelo worker (já tem `connectionRow` em mãos) — o
    // mapper não tem acesso a repositório, só normaliza o payload.
    tenantId: "",
    workspaceId: "",
    connectionId: instanceName,
    externalSessionId: instanceName,
    externalMessageId,
    status,
    occurredAt: new Date().toISOString(),
  };
}

function mapConnectionState(type: "Connected" | "Disconnected" | "LoggedOut", instanceName: string, event: Record<string, unknown>): ConnectionStateChanged {
  const statusByType: Record<typeof type, ConnectionStateChanged["status"]> = {
    Connected: "connected",
    Disconnected: "disconnected",
    LoggedOut: "requires_repair",
  };
  return {
    type: "connection.state",
    tenantId: "",
    workspaceId: "",
    connectionId: instanceName,
    externalSessionId: instanceName,
    status: statusByType[type],
    phoneNumber: typeof event.JID === "string" ? normalizeWhatsmeowJid(event.JID) : undefined,
    occurredAt: new Date().toISOString(),
  };
}

/** JIDs do whatsmeow vêm como `"<telefone>@s.whatsapp.net"` (contato) ou
 * `"<telefone>.<device>:<agent>@s.whatsapp.net"` (própria sessão, ver `wuzapi-messaging-provider.ts`). */
function normalizeWhatsmeowJid(jid: string): string {
  const phone = jid.split("@")[0]?.split(".")[0]?.split(":")[0];
  return phone ? `+${phone}` : jid;
}
