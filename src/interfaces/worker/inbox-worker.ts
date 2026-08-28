import type { Channel, ConsumeMessage } from "amqplib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PersistenceDriver } from "../../infrastructure/storage/build-platform-repositories.js";
import { sanitizeWuzApiEventForFixture } from "../../infrastructure/messaging/wuzapi/sanitize-fixture.js";
import { buildPlatformRepositories } from "../../infrastructure/storage/build-platform-repositories.js";
import { FakeMessagingProvider } from "../../infrastructure/messaging/fake-messaging-provider.js";
import { WuzApiClient } from "../../infrastructure/messaging/wuzapi/wuzapi-client.js";
import { WuzApiMessagingProvider } from "../../infrastructure/messaging/wuzapi/wuzapi-messaging-provider.js";
import { mapWuzApiEvent, type RawWuzApiEvent } from "../../infrastructure/messaging/wuzapi/wuzapi-event-mapper.js";
import {
  connectInboxRabbitMq,
  INBOX_EVENTS_EXCHANGE,
  INBOX_QUEUES,
  publishToDeadLetter,
  publishToRetryTier,
  RETRY_TIERS_MS,
  WUZAPI_RAW_QUEUE,
} from "../../infrastructure/messaging/rabbitmq/inbox-rabbitmq-topology.js";
import { MessagingProviderError } from "../../application/ports/messaging-provider.port.js";
import type { MessagingProvider } from "../../application/ports/messaging-provider.port.js";
import {
  applyConnectionStateChanged,
  applyMessageStatusChanged,
  processOutboundMessage,
  registerInboundMessage,
  type InboxUseCaseDeps,
} from "../../application/inbox/inbox-use-cases.js";
import type { NormalizedInboxEvent } from "../../application/inbox/inbox-events.js";

/**
 * Processo separado do módulo Conversas — `vorix-worker` (Fase 1/2). Consome os eventos do
 * WuzAPI via RabbitMQ e drena a fila de envio outbound; NUNCA compartilha processo com a API HTTP
 * (`zuno-api`) — um pico/crash aqui não derruba requisições HTTP, e vice-versa (ver "Critério
 * principal" no plano: mínima oscilação possível).
 *
 * Idempotência/ACK: todo consumer só dá ACK depois que a persistência no Postgres foi confirmada.
 * Um crash no meio do processamento causa reentrega (RabbitMQ redelivery), e reentrega é sempre
 * segura por construção (`unique (connection_id, external_message_id)`, `on conflict do nothing`,
 * updates idempotentes por status terminal) — nunca duplica mensagem nem WhatsApp.
 */

const CONSUMER_PREFETCH = 5;

/**
 * Configuração mínima do worker — DELIBERADAMENTE não reaproveita `loadApiConfig()` (que exige
 * `JWT_SECRET`/identidade completa): o worker não lida com autenticação HTTP nenhuma, só
 * persistência e o gateway de mensageria. Acoplar aos requisitos de config da API faria o worker
 * falhar o boot por um motivo (JWT_SECRET ausente) que não tem nada a ver com sua responsabilidade.
 */
type InboxWorkerConfig = {
  persistenceDriver: PersistenceDriver;
  databaseUrl?: string;
  inbox: { enabled: boolean; wuzApiBaseUrl?: string; wuzApiAdminToken?: string; rabbitMqUrl?: string };
};

function loadInboxWorkerConfig(): InboxWorkerConfig {
  const persistenceDriver: PersistenceDriver = process.env.PERSISTENCE_DRIVER?.trim() === "postgres" ? "postgres" : "memory";
  return {
    persistenceDriver,
    databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
    inbox: {
      enabled: process.env.CONVERSATIONS_MODULE_ENABLED?.trim() === "true",
      wuzApiBaseUrl: process.env.INBOX_WUZAPI_BASE_URL?.trim() || undefined,
      wuzApiAdminToken: process.env.INBOX_WUZAPI_ADMIN_TOKEN?.trim() || undefined,
      rabbitMqUrl: process.env.INBOX_RABBITMQ_URL?.trim() || undefined,
    },
  };
}

/**
 * Captura de fixtures do spike de verificação (Fase 2) — SOMENTE quando `INBOX_SPIKE_FIXTURES_DIR`
 * está setado (nunca em produção: variável ausente = sem custo, sem I/O de disco extra). Grava o
 * payload bruto do WuzAPI e o evento normalizado correspondente, ambos sanitizados
 * (`sanitizeWuzApiEventForFixture`), lado a lado — é assim que `wuzapi-event-mapper.ts` é
 * corrigido depois com a FORMA real em vez da suposição da documentação pública.
 */
function captureSpikeFixture(dir: string | undefined, label: string, raw: unknown, mapped: unknown): void {
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = { capturedAt: new Date().toISOString(), raw: sanitizeWuzApiEventForFixture(raw), mapped: sanitizeWuzApiEventForFixture(mapped) };
    writeFileSync(join(dir, `${label}-${stamp}.json`), JSON.stringify(payload, null, 2), "utf8");
  } catch (error) {
    console.error("[inbox-worker] falha ao gravar fixture do spike:", error instanceof Error ? error.message : error);
  }
}

function attemptCountOf(msg: ConsumeMessage): number {
  const raw = msg.properties.headers?.["x-attempt"];
  return typeof raw === "number" ? raw : 0;
}

function classifyGenericError(error: unknown): "transient" | "permanent" {
  return error instanceof MessagingProviderError && (error.kind === "permanent" || error.kind === "auth" || error.kind === "session_logged_out")
    ? "permanent"
    : "transient";
}

/** Nack lógico via republish na escada de retry (ver `inbox-rabbitmq-topology.ts`) — nunca usamos
 * `channel.nack(msg, false, true)` puro (isso recolocaria a mensagem no topo da fila principal
 * imediatamente, um busy-loop sem backoff nenhum). */
async function retryOrDeadLetter(channel: Channel, queue: string, msg: ConsumeMessage, error: unknown): Promise<void> {
  const attempt = attemptCountOf(msg);
  const kind = classifyGenericError(error);
  if (kind === "permanent" || attempt >= RETRY_TIERS_MS.length) {
    await publishToDeadLetter(channel, queue, msg.content);
    channel.ack(msg);
    return;
  }
  const contentWithAttempt = Buffer.from(msg.content.toString("utf8"));
  await publishToRetryTier(channel, queue, attempt, contentWithAttempt, { persistent: true });
  channel.ack(msg);
}

async function consumeQueue(channel: Channel, queue: string, handle: (content: Buffer) => Promise<void>): Promise<void> {
  await channel.prefetch(CONSUMER_PREFETCH);
  await channel.consume(queue, (msg) => {
    if (!msg) return;
    handle(msg.content)
      .then(() => channel.ack(msg))
      .catch(async (error) => {
        console.error(`[inbox-worker] erro processando "${queue}":`, error instanceof Error ? error.message : error);
        await retryOrDeadLetter(channel, queue, msg, error);
      });
  });
}

async function main(): Promise<void> {
  const config = loadInboxWorkerConfig();
  const spikeFixturesDir = process.env.INBOX_SPIKE_FIXTURES_DIR?.trim() || undefined;
  if (spikeFixturesDir) {
    console.log(`[inbox-worker] SPIKE: capturando fixtures sanitizadas em "${spikeFixturesDir}" — nunca deixar ligado em produção.`);
  }
  if (!config.inbox.enabled) {
    console.log("[inbox-worker] CONVERSATIONS_MODULE_ENABLED=false — worker encerrando sem iniciar consumers.");
    return;
  }
  if (!config.inbox.rabbitMqUrl) {
    throw new Error("inbox-worker: INBOX_RABBITMQ_URL é obrigatório para rodar o worker (ver .env.conversas.example).");
  }

  const repositories = buildPlatformRepositories({ driver: config.persistenceDriver, databaseUrl: config.databaseUrl });
  const provider: MessagingProvider = config.inbox.wuzApiBaseUrl && config.inbox.wuzApiAdminToken
    ? new WuzApiMessagingProvider(new WuzApiClient({ baseUrl: config.inbox.wuzApiBaseUrl, adminToken: config.inbox.wuzApiAdminToken }))
    : new FakeMessagingProvider();

  const deps: InboxUseCaseDeps = {
    connectionRepository: repositories.messagingConnectionRepository,
    contactRepository: repositories.inboxContactRepository,
    conversationRepository: repositories.inboxConversationRepository,
    messageRepository: repositories.inboxMessageRepository,
    workspaceRepository: repositories.workspaceRepository,
    outboundQueue: { publish: async () => {} }, // o worker nunca publica outbound, só drena
    provider,
  };

  const { connection, channel } = await connectInboxRabbitMq(config.inbox.rabbitMqUrl);
  console.log("[inbox-worker] conectado ao RabbitMQ, iniciando consumers.");

  // 1) RawEventConsumer — único ponto que lê o payload bruto do WuzAPI (fila plana nativa dele) e
  // o converte via `mapWuzApiEvent` (anti-corrupção) antes de republicar na exchange própria do
  // Vorix. Nenhum outro consumer conhece o formato bruto.
  await consumeQueue(channel, WUZAPI_RAW_QUEUE, async (content) => {
    const raw = JSON.parse(content.toString("utf8")) as RawWuzApiEvent;
    const mapped = mapWuzApiEvent(raw);
    captureSpikeFixture(spikeFixturesDir, mapped ? `recognized-${mapped.type}` : "unrecognized", raw, mapped);
    if (!mapped) {
      console.warn("[inbox-worker] evento WuzAPI não reconhecido, descartado:", raw.type);
      return;
    }
    // `mapped.connectionId` já É o id real da conexão (o mapper usa `instanceName`, que o Vorix
    // sempre define como o próprio `MessagingConnection.id` ao provisionar — ver
    // `wuzapi-messaging-provider.ts:connect`) — nunca precisa de índice por token aqui.
    const connectionRow = await deps.connectionRepository.getById(mapped.connectionId);
    if (!connectionRow) {
      console.warn(`[inbox-worker] evento para conexão desconhecida "${mapped.connectionId}", descartado.`);
      return;
    }
    const enriched: NormalizedInboxEvent =
      mapped.type === "message.inbound" ? { ...mapped, tenantId: connectionRow.tenantId, workspaceId: connectionRow.workspaceId } : mapped;

    const routingKey = enriched.type;
    channel.publish(INBOX_EVENTS_EXCHANGE, routingKey, Buffer.from(JSON.stringify(enriched)), { persistent: true });
  });

  // 2) Fan-out por assunto — cada fila só processa o seu tipo de evento normalizado.
  await consumeQueue(channel, INBOX_QUEUES.incoming, async (content) => {
    const event = JSON.parse(content.toString("utf8")) as Extract<NormalizedInboxEvent, { type: "message.inbound" }>;
    await registerInboundMessage(deps, {
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      connectionId: event.connectionId,
      fromPhone: event.fromPhone,
      fromName: event.fromName,
      externalMessageId: event.externalMessageId,
      type: event.messageType,
      body: event.body,
      occurredAt: event.occurredAt,
    });
  });

  await consumeQueue(channel, INBOX_QUEUES.status, async (content) => {
    const event = JSON.parse(content.toString("utf8")) as Extract<NormalizedInboxEvent, { type: "message.status" }>;
    await applyMessageStatusChanged(deps, { connectionId: event.connectionId, externalMessageId: event.externalMessageId, status: event.status, occurredAt: event.occurredAt });
  });

  await consumeQueue(channel, INBOX_QUEUES.connection, async (content) => {
    const event = JSON.parse(content.toString("utf8")) as Extract<NormalizedInboxEvent, { type: "connection.state" }>;
    await applyConnectionStateChanged(deps, { connectionId: event.connectionId, status: event.status, phoneNumber: event.phoneNumber });
  });

  // 3) OutboxSenderConsumer — drena o envio outbound enfileirado pela API (`inbox.route.ts`).
  await consumeQueue(channel, INBOX_QUEUES.outgoing, async (content) => {
    const payload = JSON.parse(content.toString("utf8")) as { messageId: string };
    await processOutboundMessage(deps, { messageId: payload.messageId });
  });

  // Graceful shutdown (Fase 1, requisito de deploy): para de puxar mensagens novas e dá um tempo
  // curto para o processamento em voo terminar (ACK só acontece após persistência) antes de
  // fechar canal/conexão — nenhuma mensagem em processamento é perdida num deploy.
  const shutdown = async () => {
    console.log("[inbox-worker] encerrando — aguardando processamento em voo...");
    try {
      await channel.close();
      await connection.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error("[inbox-worker] falha fatal no boot:", error);
  process.exitCode = 1;
});
