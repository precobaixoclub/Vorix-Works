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
 *
 * PENDING (redesign operacional de Conversas — mídia real) — `extractMediaFields` abaixo extrai
 * `url`/`mimetype`/`caption`/`fileName`/`seconds`/`fileLength`/`mediaKey`/`fileSha256`/
 * `fileEncSha256`/`jpegThumbnail` do objeto de mídia (`imageMessage`/`videoMessage`/
 * `audioMessage`/`documentMessage`) usando os nomes de campo públicos do proto do whatsmeow
 * (`waE2E.*Message`, camelCase). NUNCA testado contra um payload real (homologação com QR jamais
 * executada — ver `docs/conversas-fase2-spike.md`). Defensivamente tenta também a variante
 * PascalCase de cada campo (`Url`, `Mimetype`, `FileSHA256`...), já que o resto do WuzAPI mistura
 * casing entre rotas (ver `wuzapi-client.ts`) — mas a fonte da verdade só pode ser confirmada com
 * uma sessão real pareada.
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
  const mediaObject = kind && message ? (message[kind] as Record<string, unknown> | undefined) : undefined;
  const media = mediaObject ? extractMediaFields(messageType, mediaObject) : undefined;

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
    // Caption de imagem/vídeo vira o `body` da mensagem — mesma UX do WhatsApp (mídia com legenda
    // aparece como uma coisa só, não texto separado da mídia).
    body: body ?? media?.caption,
    ...media,
    occurredAt: typeof info?.Timestamp === "number" ? new Date((info.Timestamp as number) * 1000).toISOString() : new Date().toISOString(),
  };
}

type ExtractedMediaFields = {
  mediaUrl?: string;
  mimeType?: string;
  caption?: string;
  fileName?: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
  thumbnailBase64?: string;
  mediaKey?: string;
  fileSha256?: string;
  fileEncSha256?: string;
};

/** Lê um campo tentando várias grafias (o resto do WuzAPI mistura casing entre rotas — ver
 * comentário de `wuzapi-client.ts` — não dá para assumir uma única convenção sem validação real). */
function pick(object: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (object[key] !== undefined) return object[key];
  }
  return undefined;
}

function pickString(object: Record<string, unknown>, keys: string[]): string | undefined {
  const value = pick(object, keys);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pickNumber(object: Record<string, unknown>, keys: string[]): number | undefined {
  const value = pick(object, keys);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return undefined;
}

function extractMediaFields(messageType: InboxMessageType, media: Record<string, unknown>): ExtractedMediaFields | undefined {
  if (messageType !== "image" && messageType !== "video" && messageType !== "audio" && messageType !== "document") return undefined;
  return {
    mediaUrl: pickString(media, ["url", "Url", "URL", "directPath", "DirectPath"]),
    mimeType: pickString(media, ["mimetype", "Mimetype", "mimeType"]),
    caption: pickString(media, ["caption", "Caption"]),
    fileName: pickString(media, ["fileName", "FileName"]),
    fileSizeBytes: pickNumber(media, ["fileLength", "FileLength"]),
    durationSeconds: pickNumber(media, ["seconds", "Seconds"]),
    thumbnailBase64: pickString(media, ["jpegThumbnail", "JPEGThumbnail", "jpegThumbnailBase64"]),
    mediaKey: pickString(media, ["mediaKey", "MediaKey"]),
    fileSha256: pickString(media, ["fileSha256", "FileSHA256", "fileSHA256"]),
    fileEncSha256: pickString(media, ["fileEncSha256", "FileEncSHA256", "fileEncSHA256"]),
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
