import type { ConnectionStateChanged, InboundMessageReceived, MessageReactionReceived, MessageStatusChanged, NormalizedInboxEvent } from "../../../application/inbox/inbox-events.js";
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
  // Bloco "figurinhas" (pedido explícito do usuário, com print: "quando é figurinha esta ficando
  // como mídia recebida") — nomes de campo CONFIRMADOS no proto real do whatsmeow
  // (`waE2E.StickerMessage`, `WAWebProtobufsE2E.proto`): mesmo shape de `imageMessage`
  // (url/directPath/mimetype/fileLength/mediaKey/fileSha256/fileEncSha256), sem `caption` (figurinha
  // nunca tem legenda no WhatsApp) — reaproveita `extractMediaFields` sem duplicar nada.
  stickerMessage: "sticker",
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

  if (raw.type === "Message" && raw.event) return mapInboundMessageOrReaction(instanceName, raw.event);
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

/**
 * Bloco "reações" (pedido explícito do usuário: "ajuste tambem para quando alguem reagir a uma
 * mensagem") — confirmado no proto real do whatsmeow (`proto/waE2E/WAWebProtobufsE2E.proto`,
 * `message ReactionMessage`): `key` (`waCommon.MessageKey`: `remoteJID`/`fromMe`/`ID`/`participant`)
 * identifica a mensagem sendo reagida via `key.ID` (o `externalMessageId` dela), `text` é o emoji
 * (string VAZIA = reação removida, nunca "reagiu com nada"). Nunca uma mensagem nova na conversa —
 * sempre uma atualização de uma mensagem já existente (ver `applyMessageReaction`,
 * `inbox-use-cases.ts`).
 */
function mapReactionMessage(instanceName: string, event: Record<string, unknown>, reactionMessage: Record<string, unknown>): MessageReactionReceived | undefined {
  const info = event.Info as Record<string, unknown> | undefined;
  const sender = info?.Sender as string | undefined;
  const key = reactionMessage.key as Record<string, unknown> | undefined;
  const targetExternalMessageId = key?.ID as string | undefined;
  if (!sender || !targetExternalMessageId) return undefined;

  return {
    type: "message.reaction",
    tenantId: "",
    workspaceId: "",
    connectionId: instanceName,
    targetExternalMessageId,
    emoji: typeof reactionMessage.text === "string" ? reactionMessage.text : "",
    reactorId: normalizeWhatsmeowJid(sender),
    reactorName: info?.PushName as string | undefined,
    occurredAt: parseWuzApiTimestamp(info?.Timestamp),
  };
}

function mapInboundMessageOrReaction(instanceName: string, event: Record<string, unknown>): InboundMessageReceived | MessageReactionReceived | undefined {
  const info = event.Info as Record<string, unknown> | undefined;
  const messageId = info?.ID as string | undefined;
  const sender = info?.Sender as string | undefined;
  if (!messageId || !sender) return undefined;

  const reactionMessage = (event.Message as Record<string, unknown> | undefined)?.reactionMessage as Record<string, unknown> | undefined;
  if (reactionMessage) return mapReactionMessage(instanceName, event, reactionMessage);

  const fromMe = Boolean(info?.IsFromMe);
  // `Chat` é a identidade CANÔNICA da conversa (grupo ou peer) — ver comentário no topo do
  // arquivo. Fallback pra `Sender` só se `Chat` vier ausente (não deveria, é confirmado no
  // envelope, mas nunca deixar o evento inteiro cair por um campo defensivo faltando).
  const chatRaw = (info?.Chat as string | undefined) ?? sender;
  // ACHADO AO VIVO (relatado pelo usuário em produção, 2026-09-15) — `status@broadcast` é o feed de
  // Status/Stories do WhatsApp (atualizações postadas por QUALQUER contato, nunca uma conversa de
  // verdade com uma pessoa/grupo específico). Sem esta guarda, cada Status virava uma mensagem
  // acumulada numa única "conversa" fantasma sem nome, aparecendo pro usuário como um "grupo" cheio
  // de fotos aleatórias de stories — nunca algo que o atendimento deveria ver/gerenciar. Descarta o
  // evento INTEIRO (nunca cria conversa/contato/mensagem nenhuma), mesmo caminho de "evento
  // corrompido/sem campo obrigatório" logo acima.
  if (chatRaw.endsWith("@broadcast")) return undefined;
  // ACHADO AO VIVO (pedido explícito do usuário em produção, 2026-09-15: "quero somente conversas
  // do whatsapp e grupos") — Canal/Newsletter do WhatsApp (`@newsletter`) nunca é uma conversa de
  // atendimento de verdade: é um feed de transmissão (a mídia nem pode ser baixada — WhatsApp não
  // criptografa por destinatário nesse caso, ver `mediaKey` ausente documentado em
  // `downloadInboundMediaAndAttach`), nunca algo que o atendimento responde ou gerencia. Descartado
  // por completo, mesmo caminho de `@broadcast` logo acima — nunca cria conversa/contato/mensagem.
  if (chatRaw.endsWith("@newsletter")) return undefined;
  // `Info.IsGroup` sozinho não cobre todo chat que não é uma pessoa — `@lid` (identidade "Linked
  // ID" do whatsmeow — mensagens 1:1 aparecem assim em vez de `@s.whatsapp.net` nesta versão do
  // WuzAPI) É uma pessoa normal, tratada como DM. Só `@s.whatsapp.net`/`@lid` são "telefone de uma
  // pessoa" — qualquer outro sufixo (`@g.us`, ou algo não previsto) é tratado como não-pessoa
  // (mesmo caminho de armazenamento de grupo: JID preservado como `externalChatId`, nunca vira um
  // `InboxContact`/CRM). Ver docs/conversas-canonical-chat-identity.md.
  const isPersonJid = /@(s\.whatsapp\.net|lid)$/.test(chatRaw);
  const isGroup = Boolean(info?.IsGroup) || !isPersonJid;
  const chatId = isGroup ? normalizeWhatsmeowGroupJid(chatRaw) : normalizeWhatsmeowJid(chatRaw);

  // Bloco "Identity UX" — telefone é o pivô da PESSOA, `chatId` continua o pivô do CHAT (podem
  // divergir: `chatId` fica estável mesmo sem `*Alt`, o telefone só existe quando o provider
  // confirma — ver `src/domain/inbox/whatsapp-identity.ts`).
  //
  // CORREÇÃO DE BUG REAL (achado ao vivo em produção pós-deploy da réplica de identidade,
  // 2026-09-14): em DM (`isGroup=false`), `Chat` e `Sender` são o MESMO peer — mas qual `*Alt`
  // carrega o telefone real do PEER depende de quem é o remetente da MENSAGEM, não de quem é o
  // "Chat": inbound (`fromMe=false`) tem o peer como `Sender`, então o alt do peer vem em
  // `SenderAlt` (`RecipientAlt` aqui seria o alt de NÓS MESMOS — somos o destinatário — nunca do
  // peer); self-echo (`fromMe=true`) tem NÓS MESMOS como `Sender`, então o alt do peer vem em
  // `RecipientAlt` (`SenderAlt` aqui seria o nosso próprio alt). A versão anterior sempre usava
  // `RecipientAlt` incondicionalmente — em payload real confirmado (`Sender: "...@lid"`,
  // `SenderAlt: "55...@s.whatsapp.net"` preenchido, `RecipientAlt: ""` vazio, `IsFromMe: false`),
  // isso nunca resolvia o telefone real: o contato ficava permanentemente preso no pivô degradado
  // (LID puro) mesmo com evidência forte disponível no MESMO evento.
  const chatAltJid = (fromMe ? info?.RecipientAlt : info?.SenderAlt) as string | undefined;
  const chatIdentity = isGroup ? undefined : resolveWhatsAppPersonIdentity(chatRaw, chatAltJid);
  const senderIdentity = resolveWhatsAppPersonIdentity(sender, info?.SenderAlt as string | undefined);

  const message = event.Message as Record<string, unknown> | undefined;
  // ACHADO AO VIVO (relatado pelo usuário em produção, 2026-09-15: "mensagens sem texto... que não
  // carregou") — payload real capturado nos logs do WuzAPI: um evento com `Message` contendo
  // SOMENTE `senderKeyDistributionMessage` (mais `messageContextInfo`, que é metadado, nunca
  // conteúdo) — isto é uma mensagem de PROTOCOLO (distribuição de chave de criptografia do grupo,
  // enviada automaticamente pelo whatsmeow sempre que uma sessão de chave precisa ser
  // estabelecida/renovada), NUNCA algo que uma pessoa escreveu. Sem esta guarda, virava uma
  // "mensagem" tipo `other` sem texto nem mídia nenhuma — exatamente a bolha vazia relatada.
  // Descartado por completo, mesmo caminho de `@broadcast`/`@newsletter` acima.
  const NON_CONTENT_MESSAGE_KEYS = new Set(["messageContextInfo", "senderKeyDistributionMessage"]);
  const messageKeys = message ? Object.keys(message) : [];
  if (messageKeys.length > 0 && messageKeys.every((key) => NON_CONTENT_MESSAGE_KEYS.has(key))) return undefined;
  const kind = message ? messageKeys.find((key) => key in MESSAGE_TYPE_BY_WHATSMEOW_KIND) : undefined;
  const messageType = kind ? MESSAGE_TYPE_BY_WHATSMEOW_KIND[kind] ?? "other" : "other";
  // ACHADO AO VIVO (relatado pelo usuário em produção, 2026-09-15: "mensagens enviadas diretamente
  // pelo whatsapp" não carregavam) — `Message.conversation` só existe pro texto MAIS simples
  // possível (sem nenhum contexto adicional). Qualquer mensagem com contexto — resposta citada,
  // preview de link, modo de mensagem temporária, ou enviada por OUTRO dispositivo vinculado
  // (self-echo do próprio celular, como confirmado no payload real que motivou esta correção) — usa
  // `Message.extendedTextMessage.text` em vez disso. `messageType` já classificava os dois como
  // "text" corretamente (ver `MESSAGE_TYPE_BY_WHATSMEOW_KIND`), mas `body` só lia `conversation` —
  // resultado: a MAIORIA das mensagens de texto reais (confirmado: 33/45 inbound e 13/20 outbound
  // num workspace de produção) ficavam com corpo vazio, aparecendo em branco na Inbox.
  const extendedText = (message?.extendedTextMessage as Record<string, unknown> | undefined)?.text;
  const body = typeof message?.conversation === "string" ? (message.conversation as string) : typeof extendedText === "string" ? extendedText : undefined;
  const mediaObject = kind && message ? (message[kind] as Record<string, unknown> | undefined) : undefined;
  const media = mediaObject ? extractMediaFields(messageType, mediaObject) : undefined;
  const contact = mediaObject ? extractContactFields(messageType, mediaObject) : undefined;

  // Bloco "resposta citada" + "menção em grupo" — `contextInfo` vive dentro do objeto do tipo
  // específico (`extendedTextMessage.contextInfo`, `imageMessage.contextInfo` etc.), confirmado em
  // payload real. Presente na MAIORIA das mensagens reais (mesmo sem responder/mencionar nada —
  // carrega metadado de "modo de mensagem temporária" etc.), então `stanzaID`/`mentionedJID`
  // ausentes é o caso comum, não um erro.
  const contextInfo = mediaObject?.contextInfo as Record<string, unknown> | undefined;
  const quotedExternalMessageId = contextInfo?.stanzaID as string | undefined;
  const quotedSenderId = contextInfo?.participant as string | undefined;
  const quotedRaw = contextInfo?.quotedMessage as Record<string, unknown> | undefined;
  const { body: quotedBody, type: quotedType } = extractFallbackBodyAndType(quotedRaw);
  const mentionedJids = Array.isArray(contextInfo?.mentionedJID) ? (contextInfo!.mentionedJID as unknown[]).filter((jid): jid is string => typeof jid === "string") : undefined;

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
    // aparece como uma coisa só, não texto separado da mídia). Contato usa o nome como fallback de
    // `body` pelo mesmo motivo — qualquer lugar que só sabe ler `body` (preview de lista antigo,
    // notificação) mostra o nome em vez de bolha vazia; o cartão renderizado de verdade usa `contact*`.
    body: body ?? media?.caption ?? contact?.contactName,
    ...media,
    ...contact,
    quotedExternalMessageId,
    quotedSenderId,
    quotedBody,
    quotedType,
    mentionedJids,
    occurredAt: parseWuzApiTimestamp(info?.Timestamp),
  };
}

/** Extração best-effort de corpo/tipo a partir de um objeto de mensagem bruto qualquer — reusa a
 * MESMA lógica do corpo principal (`conversation`/`extendedTextMessage.text`, ou `caption` pro
 * tipo de mídia certo), usada tanto pra mensagem citada (`contextInfo.quotedMessage`, aninhada no
 * MESMO formato de `Message`) quanto poderia ser reusada por qualquer outro aninhamento futuro. */
function extractFallbackBodyAndType(rawMessage: Record<string, unknown> | undefined): { body?: string; type?: InboxMessageType } {
  if (!rawMessage) return {};
  const keys = Object.keys(rawMessage);
  const kind = keys.find((key) => key in MESSAGE_TYPE_BY_WHATSMEOW_KIND);
  const type = kind ? MESSAGE_TYPE_BY_WHATSMEOW_KIND[kind] : undefined;
  const extendedText = (rawMessage.extendedTextMessage as Record<string, unknown> | undefined)?.text;
  const mediaObject = kind ? (rawMessage[kind] as Record<string, unknown> | undefined) : undefined;
  const caption = typeof mediaObject?.caption === "string" ? (mediaObject.caption as string) : undefined;
  const body = typeof rawMessage.conversation === "string" ? (rawMessage.conversation as string) : typeof extendedText === "string" ? extendedText : caption;
  return { body, type };
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
  /** CAUSA RAIZ REAL do bug "toda mídia falha ao baixar" (confirmado lendo o código-fonte real do
   * whatsmeow, `download.go`, `Client.Download()`): a função verifica `len(msg.GetDirectPath()) ==
   * 0` e retorna `ErrNoURLPresent` ("no url present") — o campo `URL` não é sequer consultado pra
   * essa checagem. `directPath` NUNCA foi extraído/enviado ao WuzAPI antes desta correção, então
   * 100% das tentativas de download falhavam com esse erro, mesmo com `mediaKey` presente. */
  mediaDirectPath?: string;
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
  if (messageType !== "image" && messageType !== "video" && messageType !== "audio" && messageType !== "document" && messageType !== "sticker") return undefined;
  return {
    mediaUrl: pickString(media, ["url", "Url", "URL"]),
    mediaDirectPath: pickString(media, ["directPath", "DirectPath"]),
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

type ExtractedContactFields = {
  contactName?: string;
  contactVcard?: string;
  contactPhoneE164?: string;
};

/** Bloco "enviar/receber contato" (pedido explícito do usuário: "quando eu receber ou enviar um
 * contato carregar corretamente"). Nomes de campo CONFIRMADOS no proto real do whatsmeow
 * (`waE2E.ContactMessage`, `WAWebProtobufsE2E.proto`): `displayName` (campo 1), `vcard` (campo 16)
 * — camelCase, mesma convenção já confirmada pros outros tipos de mensagem neste arquivo. Antes
 * desta correção `messageType` já virava "contact" (ver `MESSAGE_TYPE_BY_WHATSMEOW_KIND`), mas
 * nenhum campo era extraído — a mensagem chegava sem nome/telefone/vcard nenhum, sempre uma bolha
 * vazia no frontend. */
function extractContactFields(messageType: InboxMessageType, contact: Record<string, unknown>): ExtractedContactFields | undefined {
  if (messageType !== "contact") return undefined;
  const contactName = pickString(contact, ["displayName", "DisplayName"]);
  const contactVcard = pickString(contact, ["vcard", "Vcard", "VCard"]);
  return { contactName, contactVcard, contactPhoneE164: contactVcard ? extractPhoneFromVcard(contactVcard) : undefined };
}

/** vCard do WhatsApp sempre traz o telefone real (WhatsApp ID) na propriedade `waid` de uma linha
 * `TEL` (ex.: `TEL;type=CELL;waid=5511999999999:+55 11 99999-9999`) — `waid` é o dígitos-puros já
 * na forma que o WhatsApp usa internamente, preferível a tentar reformatar o valor legível depois
 * de `:`. Cai pro valor após `:` da primeira linha `TEL` só se `waid` não estiver presente (contato
 * salvo sem número de WhatsApp confirmado, ex.: só telefone fixo). */
function extractPhoneFromVcard(vcard: string): string | undefined {
  const waidMatch = vcard.match(/waid=(\d+)/);
  if (waidMatch) return `+${waidMatch[1]}`;
  const telLine = vcard.split(/\r?\n/).find((line) => line.toUpperCase().startsWith("TEL"));
  const rawValue = telLine?.split(":").slice(1).join(":").trim();
  const digitsOnly = rawValue?.replace(/[^\d+]/g, "");
  return digitsOnly && digitsOnly.length >= 8 ? (digitsOnly.startsWith("+") ? digitsOnly : `+${digitsOnly}`) : undefined;
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
