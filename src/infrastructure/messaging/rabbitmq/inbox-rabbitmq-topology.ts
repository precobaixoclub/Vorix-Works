import type { Channel, ChannelModel } from "amqplib";
import amqplib from "amqplib";

/**
 * Topologia RabbitMQ do módulo Conversas — Fase 2 (Eventos). Único arquivo que declara
 * exchanges/filas; `vorix-worker` e a API chamam `ensureInboxTopology` antes de publicar/consumir,
 * nunca declaram fila "no local de uso" (evita topologia divergente entre processos).
 *
 * Desenho (ver plano técnico, "Topologia RabbitMQ"):
 *  - `wuzapi.events.raw`: fila plana onde o WuzAPI publica TODOS os eventos (limitação nativa dele
 *    — uma única `RABBITMQ_QUEUE`). Consumida pelo `RawEventConsumer`.
 *  - `inbox.events` (topic exchange, própria do Vorix): o `RawEventConsumer` republica aqui já
 *    normalizado, com routing key `message.inbound` | `message.status` | `connection.state`.
 *  - Filas por assunto (`inbox.incoming.queue`, `inbox.status.queue`, `inbox.connection.queue`),
 *    ligadas à exchange acima, mais `inbox.outgoing.queue` (populada direto pela API, sem passar
 *    pela exchange — não é um evento do WuzAPI, é uma intenção de envio do Vorix).
 *  - `inbox.realtime` (fanout): cada instância de `zuno-api` liga uma fila exclusiva/auto-delete
 *    para repassar a clientes SSE locais — evita precisar de Redis só para pub/sub cross-processo.
 *  - Backoff sem plugin extra: escada clássica TTL+DLX. Cada fila principal tem 4 filas de retry
 *    (5s/15s/60s/300s) que devolvem à fila principal via `x-dead-letter-exchange` ao expirar, e uma
 *    DLQ final para quando a escada se esgota.
 */

export const RETRY_TIERS_MS = [5_000, 15_000, 60_000, 300_000] as const;

export const INBOX_EVENTS_EXCHANGE = "inbox.events";
export const INBOX_REALTIME_EXCHANGE = "inbox.realtime";
export const WUZAPI_RAW_QUEUE = "wuzapi.events.raw";

export const INBOX_QUEUES = {
  incoming: "inbox.incoming.queue",
  status: "inbox.status.queue",
  connection: "inbox.connection.queue",
  outgoing: "inbox.outgoing.queue",
} as const;

export type InboxQueueName = (typeof INBOX_QUEUES)[keyof typeof INBOX_QUEUES];

function dlqName(queue: string): string {
  return `${queue}.dlq`;
}

function retryQueueName(queue: string, tierMs: number): string {
  return `${queue}.retry-${tierMs}ms`;
}

async function declareQueueWithRetryLadder(channel: Channel, queue: string): Promise<void> {
  const dlq = dlqName(queue);
  await channel.assertQueue(dlq, { durable: true });

  // Fila principal: mensagens que esgotam sem ACK e sem republish explícito para retry caem aqui
  // por padrão de segurança (nunca perdidas silenciosamente).
  await channel.assertQueue(queue, { durable: true, arguments: { "x-dead-letter-exchange": "", "x-dead-letter-routing-key": dlq } });

  // Escada de retry: cada tier tem TTL fixo e, ao expirar, volta para a fila principal (DLX vazio +
  // routing key = nome da fila principal, já que exchange "" roteia por nome de fila).
  for (const tierMs of RETRY_TIERS_MS) {
    await channel.assertQueue(retryQueueName(queue, tierMs), {
      durable: true,
      arguments: { "x-message-ttl": tierMs, "x-dead-letter-exchange": "", "x-dead-letter-routing-key": queue },
    });
  }
}

export async function ensureInboxTopology(channel: Channel): Promise<void> {
  await channel.assertQueue(WUZAPI_RAW_QUEUE, { durable: true });
  await channel.assertExchange(INBOX_EVENTS_EXCHANGE, "topic", { durable: true });
  await channel.assertExchange(INBOX_REALTIME_EXCHANGE, "fanout", { durable: false });

  await declareQueueWithRetryLadder(channel, INBOX_QUEUES.incoming);
  await declareQueueWithRetryLadder(channel, INBOX_QUEUES.status);
  await declareQueueWithRetryLadder(channel, INBOX_QUEUES.connection);
  await declareQueueWithRetryLadder(channel, INBOX_QUEUES.outgoing);

  await channel.bindQueue(INBOX_QUEUES.incoming, INBOX_EVENTS_EXCHANGE, "message.inbound");
  await channel.bindQueue(INBOX_QUEUES.status, INBOX_EVENTS_EXCHANGE, "message.status");
  await channel.bindQueue(INBOX_QUEUES.connection, INBOX_EVENTS_EXCHANGE, "connection.state");
}

/**
 * Publica numa fila de retry pelo índice do tier (`attemptCount` da mensagem) — índice fora da
 * faixa cai direto na DLQ (escada esgotada). SEMPRE grava `x-attempt` incrementado no header —
 * quando a fila de retry devolve a mensagem à fila principal (TTL expirado + DLX), é esse header
 * que permite ao consumer saber em qual degrau da escada está, escalando 5s→15s→60s→300s em vez
 * de reiniciar do zero a cada rodada.
 */
export async function publishToRetryTier(channel: Channel, queue: string, attemptCount: number, content: Buffer, options?: { persistent?: boolean }): Promise<void> {
  const tierMs = RETRY_TIERS_MS[attemptCount];
  const headers = { "x-attempt": attemptCount + 1 };
  if (tierMs === undefined) {
    channel.sendToQueue(dlqName(queue), content, { persistent: true, headers });
    return;
  }
  channel.sendToQueue(retryQueueName(queue, tierMs), content, { persistent: options?.persistent ?? true, headers });
}

export async function publishToDeadLetter(channel: Channel, queue: string, content: Buffer): Promise<void> {
  channel.sendToQueue(dlqName(queue), content, { persistent: true });
}

export async function connectInboxRabbitMq(url: string): Promise<{ connection: ChannelModel; channel: Channel }> {
  const connection = await amqplib.connect(url);
  const channel = await connection.createChannel();
  await ensureInboxTopology(channel);
  return { connection, channel };
}
