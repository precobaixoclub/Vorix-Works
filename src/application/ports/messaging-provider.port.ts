/**
 * Abstração de gateway de mensageria — módulo Conversas (Fase 1). Este é o ÚNICO ponto por onde o
 * domínio/aplicação de `inbox` fala com um canal externo (WhatsApp via WuzAPI na primeira versão).
 * Nenhum tipo específico do WuzAPI (payload de webhook, formato de token, nome de campo) pode
 * atravessar esta fronteira — a normalização acontece no adapter
 * (`src/infrastructure/messaging/wuzapi/wuzapi-event-mapper.ts`), nunca aqui.
 *
 * Trocar de gateway no futuro (WhatsApp Cloud API, outro provider) significa escrever um novo
 * adapter que implementa este mesmo port — Inbox, contatos, CRM, IA e automações nunca precisam
 * mudar.
 */

export type NormalizedConnectionStatus = {
  externalSessionId?: string;
  status: "connecting" | "connected" | "reconnecting" | "disconnected" | "logged_out" | "requires_repair" | "error";
  phoneNumber?: string;
};

export type MessagingSendResult = {
  externalMessageId: string;
};

export type MessagingProviderErrorKind = "transient" | "rate_limit" | "auth" | "session_logged_out" | "permanent";

/** Erro classificado — o worker decide retry/backoff/DLQ a partir de `kind`, nunca inspecionando
 * mensagem de erro livre. Todo adapter (`WuzApiMessagingProvider`, `FakeMessagingProvider`, um
 * futuro `WhatsAppCloudMessagingProvider`) deve lançar isto em vez de um `Error` genérico. */
export class MessagingProviderError extends Error {
  readonly kind: MessagingProviderErrorKind;

  constructor(kind: MessagingProviderErrorKind, message: string) {
    super(message);
    this.name = "MessagingProviderError";
    this.kind = kind;
  }
}

export type MessagingProvider = {
  readonly providerId: string;

  /**
   * Provisiona (se necessário) e inicia a sessão no gateway para esta conexão. Idempotente.
   * `instanceName` é um identificador ESTÁVEL escolhido pelo Vorix (o `MessagingConnection.id`) —
   * o adapter real (WuzAPI) usa isto para poder correlacionar eventos de volta a esta conexão sem
   * expor o token de sessão em nenhum payload de evento. Pode devolver o telefone pareado quando o
   * gateway já souber (nem todo provider sabe nesse momento — por isso é opcional).
   */
  connect(input: { externalSessionId: string; instanceName: string }): Promise<{ phoneNumber?: string }>;
  disconnect(input: { externalSessionId: string }): Promise<void>;
  /** Revoga a sessão de verdade (distinto de `disconnect` — o usuário precisaria parear de novo). */
  logout(input: { externalSessionId: string }): Promise<void>;
  getConnectionStatus(input: { externalSessionId: string }): Promise<NormalizedConnectionStatus>;
  getQrCode(input: { externalSessionId: string }): Promise<{ qrCode: string; expiresAt: string }>;

  sendText(input: { externalSessionId: string; to: string; body: string }): Promise<MessagingSendResult>;
  sendImage(input: { externalSessionId: string; to: string; mediaUrl: string; caption?: string }): Promise<MessagingSendResult>;
  sendAudio(input: { externalSessionId: string; to: string; mediaUrl: string }): Promise<MessagingSendResult>;
  sendVideo(input: { externalSessionId: string; to: string; mediaUrl: string; caption?: string }): Promise<MessagingSendResult>;
  sendDocument(input: { externalSessionId: string; to: string; mediaUrl: string; fileName: string }): Promise<MessagingSendResult>;
};
