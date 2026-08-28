import type { MessagingProvider, MessagingSendResult, NormalizedConnectionStatus } from "../../../application/ports/messaging-provider.port.js";
import { MessagingProviderError } from "../../../application/ports/messaging-provider.port.js";
import type { WuzApiClient } from "./wuzapi-client.js";

/**
 * Adapter real do `MessagingProvider` para o WuzAPI — módulo Conversas (Fase 1). Único lugar do
 * domínio/aplicação que sabe que "o provider" hoje é WuzAPI; um futuro
 * `WhatsAppCloudMessagingProvider` implementaria o mesmo `MessagingProvider` sem tocar em Inbox,
 * contatos, CRM, IA ou automações.
 *
 * `externalSessionId` aqui É o token de sessão do WuzAPI (identificador por sessão, distinto do
 * `WUZAPI_ADMIN_TOKEN` administrativo) — nunca exposto ao frontend, só circula entre
 * `zuno-api`/`vorix-worker` e o container do WuzAPI na rede interna `conversas_internal`.
 */
export class WuzApiMessagingProvider implements MessagingProvider {
  readonly providerId = "wuzapi";

  constructor(private readonly client: WuzApiClient) {}

  async connect(input: { externalSessionId: string }): Promise<void> {
    await this.client.connectSession(input.externalSessionId);
  }

  async disconnect(input: { externalSessionId: string }): Promise<void> {
    await this.client.disconnectSession(input.externalSessionId);
  }

  async getConnectionStatus(input: { externalSessionId: string }): Promise<NormalizedConnectionStatus> {
    const status = await this.client.getSessionStatus(input.externalSessionId);
    return {
      status: status.loggedIn ? (status.connected ? "connected" : "reconnecting") : "logged_out",
      phoneNumber: status.phoneNumber,
    };
  }

  async getQrCode(input: { externalSessionId: string }): Promise<{ qrCode: string; expiresAt: string }> {
    const result = await this.client.getQrCode(input.externalSessionId);
    // WuzAPI/whatsmeow expira o QR em ~20s por convenção do protocolo WhatsApp Web — a UI deve
    // pedir um novo código depois disso, nunca reutilizar um QR expirado.
    return { qrCode: result.qrCode, expiresAt: new Date(Date.now() + 20_000).toISOString() };
  }

  async sendText(input: { externalSessionId: string; to: string; body: string }): Promise<MessagingSendResult> {
    const result = await this.client.sendText(input.externalSessionId, { phone: input.to, body: input.body });
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

  private toSendResult(result: { id: string }): MessagingSendResult {
    if (!result?.id) throw new MessagingProviderError("transient", "WuzAPI não retornou um id de mensagem.");
    return { externalMessageId: result.id };
  }
}
