import type { MessagingProvider, MessagingSendResult, NormalizedConnectionStatus } from "../../application/ports/messaging-provider.port.js";

/**
 * Duplo de teste do `MessagingProvider` — permite testar todo o módulo Conversas (rotas, use
 * cases, worker) sem WhatsApp real nem o container do WuzAPI rodando. Nunca usado em produção
 * (ver `wuzapi-messaging-provider.ts` para o adapter real).
 */
export class FakeMessagingProvider implements MessagingProvider {
  readonly providerId = "fake";
  readonly sentMessages: Array<{ to: string; body: string }> = [];
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

  async sendText(input: { to: string; body: string }): Promise<MessagingSendResult> {
    this.sentMessages.push({ to: input.to, body: input.body });
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
}
