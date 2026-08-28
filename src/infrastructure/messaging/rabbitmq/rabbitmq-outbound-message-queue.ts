import type { Channel } from "amqplib";
import type { OutboundMessageQueuePort } from "../../../application/ports/outbound-message-queue.port.js";
import { connectInboxRabbitMq, INBOX_QUEUES } from "./inbox-rabbitmq-topology.js";

/**
 * Conecta ao RabbitMQ de forma LAZY (só no primeiro `publish`), nunca no construtor — o container
 * da API (`buildApiContainer`) é síncrono e não pode bloquear o boot esperando uma conexão de
 * broker externo. Se o RabbitMQ estiver fora do ar, a conexão falha no `publish` e o erro sobe
 * para a rota, que já responde com erro ao cliente em vez de travar o processo (ver "Circuit
 * breaker" no plano — endurecimento adicional fica para a Fase 6).
 */
export class RabbitMqOutboundMessageQueue implements OutboundMessageQueuePort {
  private channelPromise: Promise<Channel> | undefined;

  constructor(private readonly url: string) {}

  private async getChannel(): Promise<Channel> {
    if (!this.channelPromise) {
      this.channelPromise = connectInboxRabbitMq(this.url).then(({ channel }) => channel);
      this.channelPromise.catch(() => {
        this.channelPromise = undefined;
      });
    }
    return this.channelPromise;
  }

  async publish(input: { messageId: string; tenantId: string; workspaceId: string; connectionId: string }): Promise<void> {
    const channel = await this.getChannel();
    channel.sendToQueue(INBOX_QUEUES.outgoing, Buffer.from(JSON.stringify(input)), { persistent: true });
  }
}
