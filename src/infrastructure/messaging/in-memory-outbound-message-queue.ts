import type { OutboundMessageQueuePort } from "../../application/ports/outbound-message-queue.port.js";

/** Usado com `PERSISTENCE_DRIVER=memory` (dev/teste) — sem RabbitMQ, só acumula em memória para
 * inspeção em testes. Nunca usado em produção (ver `rabbitmq-outbound-message-queue.ts`). */
export class InMemoryOutboundMessageQueue implements OutboundMessageQueuePort {
  readonly published: Array<{ messageId: string; tenantId: string; workspaceId: string; connectionId: string }> = [];

  async publish(input: { messageId: string; tenantId: string; workspaceId: string; connectionId: string }): Promise<void> {
    this.published.push(input);
  }
}
