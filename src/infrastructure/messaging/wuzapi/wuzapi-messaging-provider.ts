import type { MessagingProvider, MessagingProviderCapabilities, MessagingSendResult, NormalizedConnectionStatus } from "../../../application/ports/messaging-provider.port.js";
import { MessagingProviderError } from "../../../application/ports/messaging-provider.port.js";
import type { WuzApiClient } from "./wuzapi-client.js";

/**
 * Adapter real do `MessagingProvider` para o WuzAPI — módulo Conversas (Fase 1/2). Único lugar do
 * domínio/aplicação que sabe que "o provider" hoje é WuzAPI; um futuro
 * `WhatsAppCloudMessagingProvider` implementaria o mesmo `MessagingProvider` sem tocar em Inbox,
 * contatos, CRM, IA ou automações.
 *
 * `externalSessionId` aqui É o token de sessão do WuzAPI (identificador por sessão, usado no
 * header `token` — customizado, confirmado ao vivo, distinto do `Authorization` usado pelas
 * chamadas admin — ver `wuzapi-client.ts`) — nunca exposto ao frontend, só circula entre
 * `zuno-api`/`vorix-worker` e o container do WuzAPI na rede interna `conversas_internal`. O token
 * NUNCA aparece no payload de evento publicado no RabbitMQ (confirmado via código-fonte do WuzAPI,
 * `rabbitmq.go:sendToGlobalRabbit`) — só `instanceName` (o `name` escolhido em `connect()`, que o
 * Vorix sempre define como o próprio `MessagingConnection.id`) e `userID` (id interno do WuzAPI,
 * não usado aqui). É por isso que a correlação de evento inbound usa `instanceName`, não o token.
 */
export class WuzApiMessagingProvider implements MessagingProvider {
  readonly providerId = "wuzapi";
  // WhatsApp via WuzAPI: sessão pareada por QR, todo tipo de mídia deste port, sem templates de
  // WhatsApp Business (não exposto por este client) nem recibo de leitura/indicador de digitação
  // (o WuzAPI não expõe isso na API usada aqui).
  readonly capabilities: MessagingProviderCapabilities = {
    supportsQrConnect: true,
    supportsTemplates: false,
    supportedMediaKinds: ["text", "image", "audio", "video", "document"],
    supportsReadReceipts: false,
    supportsTypingIndicator: false,
  };

  constructor(private readonly client: WuzApiClient) {}

  async connect(input: { externalSessionId: string; instanceName: string }): Promise<{ phoneNumber?: string }> {
    await this.client.createAdminUser({ name: input.instanceName, token: input.externalSessionId });
    const result = await this.client.connectSession(input.externalSessionId);
    return { phoneNumber: extractPhoneFromJid(result.jid) };
  }

  async disconnect(input: { externalSessionId: string }): Promise<void> {
    await this.client.disconnectSession(input.externalSessionId);
  }

  async logout(input: { externalSessionId: string }): Promise<void> {
    await this.client.logoutSession(input.externalSessionId);
  }

  async getConnectionStatus(input: { externalSessionId: string }): Promise<NormalizedConnectionStatus> {
    // Confirmado ao vivo (spike Fase 2): `/session/status` já devolve `jid` (vazio antes de
    // parear) — ao contrário do que a documentação pública sugeria. Campos são lowercase
    // (`connected`/`loggedIn`), não PascalCase.
    const status = await this.client.getSessionStatus(input.externalSessionId);
    return { status: status.loggedIn ? (status.connected ? "connected" : "reconnecting") : "logged_out", phoneNumber: extractPhoneFromJid(status.jid) };
  }

  async getQrCode(input: { externalSessionId: string }): Promise<{ qrCode: string; expiresAt: string }> {
    const result = await this.client.getQrCode(input.externalSessionId);
    // WuzAPI/whatsmeow expira o QR em ~20s por convenção do protocolo WhatsApp Web — a UI deve
    // pedir um novo código depois disso, nunca reutilizar um QR expirado.
    return { qrCode: result.QRCode, expiresAt: new Date(Date.now() + 20_000).toISOString() };
  }

  async sendText(input: { externalSessionId: string; to: string; body: string; replyTo?: { externalMessageId: string; participantJid?: string; quotedText?: string } }): Promise<MessagingSendResult> {
    const result = await this.client.sendText(input.externalSessionId, {
      phone: input.to,
      body: input.body,
      replyTo: input.replyTo ? { stanzaId: input.replyTo.externalMessageId, participant: input.replyTo.participantJid, quotedText: input.replyTo.quotedText } : undefined,
    });
    return this.toSendResult(result);
  }

  async sendImage(input: { externalSessionId: string; to: string; mediaUrl: string; caption?: string }): Promise<MessagingSendResult> {
    const result = await this.client.sendImage(input.externalSessionId, { phone: input.to, mediaUrl: input.mediaUrl, caption: input.caption });
    return this.toSendResult(result);
  }

  async sendAudio(input: { externalSessionId: string; to: string; mediaUrl: string }): Promise<MessagingSendResult> {
    const result = await this.client.sendAudio(input.externalSessionId, { phone: input.to, mediaUrl: input.mediaUrl });
    return this.toSendResult(result);
  }

  async sendVideo(input: { externalSessionId: string; to: string; mediaUrl: string; caption?: string }): Promise<MessagingSendResult> {
    const result = await this.client.sendVideo(input.externalSessionId, { phone: input.to, mediaUrl: input.mediaUrl, caption: input.caption });
    return this.toSendResult(result);
  }

  async sendDocument(input: { externalSessionId: string; to: string; mediaUrl: string; fileName: string }): Promise<MessagingSendResult> {
    const result = await this.client.sendDocument(input.externalSessionId, { phone: input.to, mediaUrl: input.mediaUrl, fileName: input.fileName });
    return this.toSendResult(result);
  }

  async sendContact(input: { externalSessionId: string; to: string; name: string; vcard: string }): Promise<MessagingSendResult> {
    const result = await this.client.sendContact(input.externalSessionId, { phone: input.to, name: input.name, vcard: input.vcard });
    return this.toSendResult(result);
  }

  async downloadMedia(input: {
    externalSessionId: string;
    type: "image" | "audio" | "video" | "document";
    ref: { url: string; directPath?: string; mediaKey?: string; mimeType?: string; fileSha256?: string; fileSizeBytes?: number; fileEncSha256?: string };
  }): Promise<{ body: Buffer; mimeType?: string } | undefined> {
    return this.client.downloadMedia(input.externalSessionId, input.type, input.ref);
  }

  async getGroupInfo(input: { externalSessionId: string; groupJid: string }): Promise<{ name?: string; participantCount?: number } | undefined> {
    try {
      const info = await this.client.getGroupInfo(input.externalSessionId, input.groupJid);
      return { name: info.Name, participantCount: info.ParticipantCount ?? info.Participants?.length };
    } catch (error) {
      // Best-effort — `syncGroupMetadata` (use case) já trata `undefined` como "sem metadata
      // ainda", nunca propaga erro pro chamador (não pode derrubar o processamento de mensagem).
      // AINDA loga (achado real: o silêncio total aqui foi o que escondeu por dias um bug de
      // cliente — GET com body, `fetch()` lança TypeError síncrono — sem nenhum rastro em lugar
      // nenhum, nem nos logs do WuzAPI, porque a requisição nunca saía do processo). Nunca deixar
      // um best-effort ficar mudo de novo.
      console.warn("[wuzapi] getGroupInfo falhou (best-effort, nunca bloqueia o processamento):", error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  async getProfilePicture(input: { externalSessionId: string; jid: string }): Promise<{ body: Buffer; mimeType: string } | undefined> {
    try {
      return await this.client.downloadAvatar(input.externalSessionId, input.jid);
    } catch (error) {
      // Best-effort, mesmo racional de getGroupInfo — nunca derruba o processamento por causa de
      // uma foto de perfil que falhou ao baixar.
      console.warn("[wuzapi] getProfilePicture falhou (best-effort, nunca bloqueia o processamento):", error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  async sendReaction(input: { externalSessionId: string; to: string; externalMessageId: string; emoji: string; fromMe: boolean; participantJid?: string }): Promise<void> {
    await this.client.sendReaction(input.externalSessionId, {
      phone: input.to,
      externalMessageId: input.externalMessageId,
      emoji: input.emoji,
      fromMe: input.fromMe,
      participantJid: input.participantJid,
    });
  }

  async revokeMessage(input: { externalSessionId: string; to: string; externalMessageId: string }): Promise<void> {
    await this.client.deleteMessage(input.externalSessionId, { phone: input.to, externalMessageId: input.externalMessageId });
  }

  private toSendResult(result: { Id: string }): MessagingSendResult {
    if (!result?.Id) throw new MessagingProviderError("transient", "WuzAPI não retornou um id de mensagem.");
    return { externalMessageId: result.Id };
  }
}

/** JID confirmado no formato `"<telefone>.<device>:<agent>@s.whatsapp.net"` (exemplo real da
 * documentação: `"5491155554444.0:52@s.whatsapp.net"`) — telefone é tudo antes do primeiro `.`. */
function extractPhoneFromJid(jid: string | undefined): string | undefined {
  if (!jid) return undefined;
  const phone = jid.split(".")[0]?.split("@")[0];
  return phone ? `+${phone}` : undefined;
}
