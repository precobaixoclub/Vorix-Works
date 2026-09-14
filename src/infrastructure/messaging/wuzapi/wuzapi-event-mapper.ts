import type { ConnectionStateChanged, InboundMessageReceived, MessageStatusChanged, NormalizedInboxEvent } from "../../../application/inbox/inbox-events.js";
import type { InboxMessageStatus, InboxMessageType } from "../../../domain/inbox/inbox.model.js";
import { resolveWhatsAppPersonIdentity } from "../../../domain/inbox/whatsapp-identity.js";

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
 * CORREÇÃO DO BUG DE IDENTIDADE DE CONVERSA (ver docs/conversas-canonical-chat-identity.md) — até
 * aqui este mapper só lia `Info.Sender` (sempre) como identidade da conversa, e nunca lia
 * `Info.Chat`/`Info.IsGroup`/`Info.IsFromMe` apesar de já estarem documentados no envelope acima
 * (confirmados via código-fonte, não suposição). Isso quebrava dois casos reais: (1) GRUPO — em
 * mensagem de grupo, `Sender` é o PARTICIPANTE que mandou (`...@s.whatsapp.net`), `Chat` é o GRUPO
 * (`...@g.us`); usar `Sender` como identidade da conversa cria uma conversa por participante em vez
 * de uma por grupo. (2) SELF-ECHO — o WuzAPI/whatsmeow também emite um evento `Message` para
 * mensagens que o PRÓPRIO número conectado mandou (via Vorix ou direto do celular pareado), com
 * `IsFromMe: true` e `Sender` = o JID do próprio bot; sem checar `IsFromMe`, esse evento virava uma
 * "mensagem inbound de um contato" cujo contato é o PRÓPRIO número — uma segunda conversa fantasma
 * pro mesmo par. Agora: `chatId` (identidade canônica da conversa) vem de `Chat` quando presente,
 * com fallback pra `Sender` só se `Chat` estiver ausente (nunca deveria acontecer segundo o
 * envelope confirmado, mas defensivo); `senderId`/`senderName` são sempre de `Sender`/`PushName`
 * (quem mandou ESSA mensagem específica); `fromMe`/`isGroup` são repassados como booleans crus.
 *
 * AINDA PENDENTE DE CONFIRMAÇÃO AO VIVO (diagnóstico temporário em `inbox-worker.ts`,
 * `logRawEventShapeForDiagnosis` — ver commit "debug(inbox)"): os nomes acima vêm do código-fonte
 * do `asternic/wuzapi`, mas nunca foram vistos num payload real de GRUPO ou de self-echo (a
 * homologação até agora só validou o formato de mensagem individual/mídia). Tratar como
 * alta-confiança, não como 100% verificado — reavaliar assim que o diagnóstico capturar um evento
 * real de grupo/self-echo.
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

export function mapWuzApiEvent(raw: RawWuzApiEvent): NormalizedInboxEvent | NormalizedInboxEvent[] | undefined {
  const instanceName = raw.instanceName;
  if (!raw.type || !instanceName) return undefined;

  if (raw.type === "Message" && raw.event) return mapInboundMessage(instanceName, raw.event);
  // `MessageIDs` pode conter mais de um id no mesmo evento (WuzAPI batching um receipt pra vários
  // envios recentes) — devolve UM MessageStatusChanged por id, nunca só o primeiro (achado de
  // revisão: a versão anterior só olhava `MessageIDs[0]`, silenciosamente nunca atualizando o
  // status das demais mensagens do mesmo lote).
  if (raw.type === "ReadReceipt" && raw.event) return mapStatusReceipts(instanceName, raw.event, raw.state);
  if (raw.type === "Connected" || raw.type === "Disconnected" || raw.type === "LoggedOut") {
    return mapConnectionState(raw.type, instanceName, raw.event ?? {});
  }
  return undefined;
}

function mapInboundMessage(instanceName: string, event: Record<string, unknown>): InboundMessageReceived | undefined {
  const info = event.Info as Record<string, unknown> | undefined;
  const messageId = info?.ID as string | undefined;
  const sender = info?.Sender as string | undefined;
  if (!messageId || !sender) return undefined;

  const fromMe = Boolean(info?.IsFromMe);
  // `Chat` é a identidade CANÔNICA da conversa (grupo ou peer) — ver comentário no topo do
  // arquivo. Fallback pra `Sender` só se `Chat` vier ausente (não deveria, é confirmado no
  // envelope, mas nunca deixar o evento inteiro cair por um campo defensivo faltando).
  const chatRaw = (info?.Chat as string | undefined) ?? sender;
  // ACHADO AO VIVO (diagnóstico temporário em produção, ver commit "debug(inbox)") — `Info.IsGroup`
  // sozinho NÃO cobre todo chat que não é uma pessoa: um Canal/Newsletter do WhatsApp
  // (`Info.Chat` termina em `@newsletter`) chega com `IsGroup: false`, mas não é uma pessoa e não
  // pode virar um `InboxContact` (um "telefone" fake feito do id do canal). `@lid` (identidade
  // "Linked ID" do whatsmeow — mensagens 1:1 aparecem assim em vez de `@s.whatsapp.net` nesta
  // versão do WuzAPI) É uma pessoa normal, tratada como DM. Só `@s.whatsapp.net`/`@lid` são
  // "telefone de uma pessoa" — qualquer outro sufixo (`@g.us`, `@newsletter`, ou algo não previsto)
  // é tratado como não-pessoa (mesmo caminho de armazenamento de grupo: JID preservado como
  // `externalChatId`, nunca vira um `InboxContact`/CRM). Ver docs/conversas-canonical-chat-identity.md.
  const isPersonJid = /@(s\.whatsapp\.net|lid)$/.test(chatRaw);
  const isGroup = Boolean(info?.IsGroup) || !isPersonJid;
  const chatId = isGroup ? normalizeWhatsmeowGroupJid(chatRaw) : normalizeWhatsmeowJid(chatRaw);

  // Bloco "Identity UX" — telefone é o pivô da PESSOA, `chatId` continua o pivô do CHAT (podem
  // divergir: `chatId` fica estável mesmo sem `*Alt`, o telefone só existe quando o provider
  // confirma — ver `src/domain/inbox/whatsapp-identity.ts`). `RecipientAlt` é o par alternante de
  // `Chat` (achado ao vivo, ver docs/conversas-whatsapp-experience-completion.md); `SenderAlt` o de
  // `Sender`. Em DM, `Chat` e `Sender` normalmente são o mesmo peer — resolvido separadamente aqui
  // sem assumir isso, cada um com seu próprio `*Alt`.
  const chatIdentity = isGroup ? undefined : resolveWhatsAppPersonIdentity(chatRaw, info?.RecipientAlt as string | undefined);
  const senderIdentity = resolveWhatsAppPersonIdentity(sender, info?.SenderAlt as string | undefined);

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
    chatId,
    isGroup,
    // Nome do grupo não vem no evento de mensagem do whatsmeow — resolvido separadamente via
    // metadata de grupo (`syncGroupMetadata`, ver inbox-use-cases.ts), nunca aqui.
    groupName: undefined,
    chatPhoneE164: chatIdentity?.phoneE164,
    chatPn: chatIdentity?.pn,
    chatLid: chatIdentity?.lid,
    fromMe,
    senderId: normalizeWhatsmeowJid(sender),
    senderName: info?.PushName as string | undefined,
    senderPn: senderIdentity.pn,
    senderLid: senderIdentity.lid,
    messageType,
    // Caption de imagem/vídeo vira o `body` da mensagem — mesma UX do WhatsApp (mídia com legenda
    // aparece como uma coisa só, não texto separado da mídia).
    body: body ?? media?.caption,
    ...media,
    occurredAt: parseWuzApiTimestamp(info?.Timestamp),
  };
}

/** ACHADO AO VIVO (diagnóstico temporário em produção) — `Info.Timestamp` chega como STRING
 * ISO-8601/RFC3339 com offset de fuso (ex.: `"2026-09-13T20:03:49-03:00"`, 25 caracteres), nunca
 * como número epoch — a suposição anterior (`typeof === "number"`) nunca era verdadeira nesta
 * versão do WuzAPI, então `occurredAt` sempre caía no fallback (hora de processamento do worker,
 * não a hora real da mensagem no WhatsApp). Mantém o fallback numérico (epoch em segundos) por
 * segurança — não custa nada e cobre uma versão futura/diferente do gateway que volte a emitir
 * número — mas a STRING é o formato real confirmado. */
function parseWuzApiTimestamp(value: unknown): string {
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
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

function mapStatusReceipts(instanceName: string, event: Record<string, unknown>, state: string | undefined): MessageStatusChanged[] | undefined {
  const messageIds = (event.MessageIDs as string[] | undefined)?.filter((id) => typeof id === "string" && id.length > 0);
  const status = state ? STATUS_BY_RECEIPT_STATE[state] : undefined;
  if (!status || !messageIds || messageIds.length === 0) return undefined;

  const occurredAt = new Date().toISOString();
  return messageIds.map((externalMessageId) => ({
    type: "message.status",
    // tenantId/workspaceId são preenchidos pelo worker (já tem `connectionRow` em mãos) — o
    // mapper não tem acesso a repositório, só normaliza o payload.
    tenantId: "",
    workspaceId: "",
    connectionId: instanceName,
    externalSessionId: instanceName,
    externalMessageId,
    status,
    occurredAt,
  }));
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
 * `"<telefone>.<device>:<agent>@s.whatsapp.net"` (própria sessão, ver `wuzapi-messaging-provider.ts`).
 * NUNCA usar para um JID de grupo (`@g.us`) — não é um telefone, ver `normalizeWhatsmeowGroupJid`. */
function normalizeWhatsmeowJid(jid: string): string {
  const phone = jid.split("@")[0]?.split(".")[0]?.split(":")[0];
  return phone ? `+${phone}` : jid;
}

/** JID de GRUPO do whatsmeow (`"<id>@g.us"`) não é um telefone — nunca passar por
 * `normalizeWhatsmeowJid`/`normalizePhoneNumber` (formatação `+<dígitos>` faria um grupo colidir
 * com um contato cujo telefone coincida com o id numérico do grupo, ou simplesmente produzir uma
 * string sem sentido). Mantém o JID como veio (só remove sufixo de device, se algum dia existir),
 * já que `...@g.us` nunca colide com o formato `+<dígitos>` usado pra chats diretos — é a própria
 * distinção que torna `external_chat_id` seguro como chave única por conexão independente do
 * `chat_type`. */
function normalizeWhatsmeowGroupJid(jid: string): string {
  const [id, domain] = jid.split("@");
  const cleanId = id?.split(":")[0];
  return domain ? `${cleanId}@${domain}` : jid;
}
