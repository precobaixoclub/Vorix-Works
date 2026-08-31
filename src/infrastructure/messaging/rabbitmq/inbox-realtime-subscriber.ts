import type { Channel } from "amqplib";
import { EventEmitter } from "node:events";
import { connectInboxRabbitMq, INBOX_REALTIME_EXCHANGE, publishRealtimeNotification } from "./inbox-rabbitmq-topology.js";

/**
 * Ponte entre o RabbitMQ e os clientes SSE conectados a ESTA instância de `zuno-api` — módulo
 * Conversas, Fase 3/4. Liga uma fila exclusiva/auto-delete à exchange fanout `inbox.realtime`
 * (única por instância — nunca compartilhada entre processos, nunca durável) e republica cada
 * notificação recebida como evento local (`EventEmitter`), que a rota SSE (`inbox.route.ts`) só
 * então filtra por `workspaceId` antes de escrever no stream do cliente.
 *
 * Por que fanout + fila exclusiva por instância, em vez de uma fila compartilhada nomeada: com
 * mais de uma réplica de `zuno-api` rodando (horizontal scaling futuro), CADA instância precisa
 * receber TODA notificação (para poder atender qualquer cliente SSE conectado a ela), não dividir
 * o trabalho como uma fila de trabalho comum faria — é exatamente o padrão que fanout resolve.
 *
 * Conexão é LAZY (só no primeiro `.start()`) e best-effort: se o RabbitMQ estiver fora do ar, o
 * SSE simplesmente não recebe notificações — nunca bloqueia nem derruba a API por isso (`start()`
 * despacha a conexão em background e loga o erro, nunca propaga uma exceção pro chamador).
 *
 * Fase 4 (Atendimento): esta MESMA instância também PUBLICA notificações — ações operacionais
 * (assumir/transferir/finalizar/reabrir/pausar IA) acontecem de forma síncrona nas rotas HTTP, não
 * no `vorix-worker`, então a própria API precisa conseguir publicar em `inbox.realtime` sem abrir
 * uma segunda conexão RabbitMQ só pra isso — reaproveita o canal já aberto por `.start()`.
 */
export class InboxRealtimeSubscriber extends EventEmitter {
  private starting: Promise<void> | undefined;
  private channel: Channel | undefined;

  constructor(private readonly rabbitMqUrl: string) {
    super();
    this.setMaxListeners(0);
  }

  start(): void {
    if (this.starting) return;
    this.starting = this.connect().catch((error) => {
      console.error("[inbox-realtime] falha ao conectar ao RabbitMQ:", error instanceof Error ? error.message : error);
      this.starting = undefined;
      this.channel = undefined;
    });
  }

  /** Best-effort: se o canal ainda não estiver pronto (RabbitMQ fora do ar, ou primeiro cliente
   * SSE ainda não conectou), a notificação é simplesmente descartada — nunca bloqueia nem falha a
   * requisição HTTP que chamou isto. Garante que `.start()` foi ao menos tentado. */
  publish(notification: Record<string, unknown>): void {
    this.start();
    if (this.channel) publishRealtimeNotification(this.channel, notification);
  }

  private async connect(): Promise<void> {
    const { channel } = await connectInboxRabbitMq(this.rabbitMqUrl);
    this.channel = channel;
    const { queue } = await channel.assertQueue("", { exclusive: true, autoDelete: true });
    await channel.bindQueue(queue, INBOX_REALTIME_EXCHANGE, "");
    await channel.consume(
      queue,
      (msg) => {
        if (!msg) return;
        try {
          const notification = JSON.parse(msg.content.toString("utf8")) as Record<string, unknown>;
          this.emit("notification", notification);
        } catch {
          // Notificação malformada — não é a fonte de verdade de nada, só descarta.
        }
        channel.ack(msg);
      },
      { noAck: false },
    );
  }
}
