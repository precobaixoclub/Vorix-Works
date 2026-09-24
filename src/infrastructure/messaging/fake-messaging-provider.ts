import type { MessagingProvider, MessagingProviderCapabilities, MessagingSendResult, NormalizedConnectionStatus } from "../../application/ports/messaging-provider.port.js";

/**
 * Duplo de teste do `MessagingProvider` — permite testar todo o módulo Conversas (rotas, use
 * cases, worker) sem WhatsApp real nem o container do WuzAPI rodando. Nunca usado em produção
 * (ver `wuzapi-messaging-provider.ts` para o adapter real).
 */
export class FakeMessagingProvider implements MessagingProvider {
  readonly providerId = "fake";
  // Espelha exatamente `WuzApiMessagingProvider.capabilities` — o duplo de teste nunca deve
  // divergir das capacidades do adapter real que substitui.
  readonly capabilities: MessagingProviderCapabilities = {
    supportsQrConnect: true,
    supportsTemplates: false,
    supportedMediaKinds: ["text", "image", "audio", "video", "document"],
    supportsReadReceipts: false,
    supportsTypingIndicator: false,
  };
  readonly sentMessages: Array<{ to: string; body: string; replyTo?: { externalMessageId: string; participantJid?: string; quotedText?: string } }> = [];
  readonly sentReactions: Array<{ to: string; externalMessageId: string; emoji: string; fromMe: boolean; participantJid?: string }> = [];
  readonly revokedMessages: Array<{ to: string; externalMessageId: string }> = [];
  private sequence = 0;

  async connect(): Promise<{ phoneNumber?: string }> {
    return { phoneNumber: "+5511999990000" };
  }

  async disconnect(): Promise<void> {}
  async logout(): Promise<void> {}

  async getConnectionStatus(): Promise<NormalizedConnectionStatus> {
    return { status: "connected", phoneNumber: "+5511999990000" };
  }

  async getQrCode(): Promise<{ qrCode: string; expiresAt: string }> {
    return { qrCode: "fake-qr-code", expiresAt: new Date(Date.now() + 60_000).toISOString() };
  }

  async sendText(input: { to: string; body: string; replyTo?: { externalMessageId: string; participantJid?: string; quotedText?: string } }): Promise<MessagingSendResult> {
    this.sentMessages.push({ to: input.to, body: input.body, replyTo: input.replyTo });
    return { externalMessageId: `fake-${++this.sequence}` };
  }

  async sendImage(): Promise<MessagingSendResult> {
    return { externalMessageId: `fake-${++this.sequence}` };
  }

  async sendAudio(): Promise<MessagingSendResult> {
    return { externalMessageId: `fake-${++this.sequence}` };
  }

  async sendVideo(): Promise<MessagingSendResult> {
    return { externalMessageId: `fake-${++this.sequence}` };
  }

  async sendDocument(): Promise<MessagingSendResult> {
    return { externalMessageId: `fake-${++this.sequence}` };
  }

  async sendContact(): Promise<MessagingSendResult> {
    return { externalMessageId: `fake-${++this.sequence}` };
  }

  async sendReaction(input: { to: string; externalMessageId: string; emoji: string; fromMe: boolean; participantJid?: string }): Promise<void> {
    this.sentReactions.push({ to: input.to, externalMessageId: input.externalMessageId, emoji: input.emoji, fromMe: input.fromMe, participantJid: input.participantJid });
  }

  async revokeMessage(input: { to: string; externalMessageId: string }): Promise<void> {
    this.revokedMessages.push({ to: input.to, externalMessageId: input.externalMessageId });
  }
}
