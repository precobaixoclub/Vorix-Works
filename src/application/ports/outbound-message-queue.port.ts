/**
 * Fila de envio outbound — módulo Conversas (Fase 1/2). A rota HTTP de envio (`inbox.route.ts`)
 * persiste a mensagem como `queued` e publica aqui; NUNCA espera a confirmação do WhatsApp antes
 * de responder ao frontend (ver "Envio assíncrono" no plano). Quem drena esta fila é o
 * `OutboxSenderConsumer` do `vorix-worker`.
 */
export type OutboundMessageQueuePort = {
  publish(input: { messageId: string; tenantId: string; workspaceId: string; connectionId: string }): Promise<void>;
};
