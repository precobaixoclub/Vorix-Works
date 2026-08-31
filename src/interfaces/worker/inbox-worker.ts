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
  publishRealtimeNotification,
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

/**
 * Nack lógico via republish na escada de retry (ver `inbox-rabbitmq-topology.ts`) — nunca usamos
 * `channel.nack(msg, false, true)` puro (isso recolocaria a mensagem no topo da fila principal
 * imediatamente, um busy-loop sem backoff nenhum).
 *
 * `onDeadLetter` (opcional) roda quando a mensagem esgota a escada — ACHADO AO VIVO (spike Fase
 * 2): sem isso, uma mensagem que cai na DLQ fica com `inbox_messages.status = 'queued'` PARA
 * SEMPRE, indistinguível de uma mensagem genuinamente pendente para quem olha a Inbox. É best
 * effort: se `onDeadLetter` falhar, a mensagem já está durável na DLQ do RabbitMQ (não se perde),
 * só logamos e seguimos — nunca deixamos essa falha bloquear o ACK.
 */
async function retryOrDeadLetter(channel: Channel, queue: string, msg: ConsumeMessage, error: unknown, onDeadLetter?: (content: Buffer) => Promise<void>): Promise<void> {
  const attempt = attemptCountOf(msg);
  const kind = classifyGenericError(error);
  if (kind === "permanent" || attempt >= RETRY_TIERS_MS.length) {
    await publishToDeadLetter(channel, queue, msg.content);
    if (onDeadLetter) {
      try {
        await onDeadLetter(msg.content);
      } catch (markError) {
        console.error(`[inbox-worker] falha ao marcar mensagem como failed após DLQ ("${queue}"):`, markError instanceof Error ? markError.message : markError);
      }
    }
    channel.ack(msg);
    return;
  }
  const contentWithAttempt = Buffer.from(msg.content.toString("utf8"));
  await publishToRetryTier(channel, queue, attempt, contentWithAttempt, { persistent: true });
  channel.ack(msg);
}

async function consumeQueue(channel: Channel, queue: string, handle: (content: Buffer) => Promise<void>, onDeadLetter?: (content: Buffer) => Promise<void>): Promise<void> {
  await channel.prefetch(CONSUMER_PREFETCH);
  await channel.consume(queue, (msg) => {
    if (!msg) return;
    handle(msg.content)
      .then(() => channel.ack(msg))
      .catch(async (error) => {
        console.error(`[inbox-worker] erro processando "${queue}":`, error instanceof Error ? error.message : error);
        await retryOrDeadLetter(channel, queue, msg, error, onDeadLetter);
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

  // ACHADO AO VIVO (spike Fase 2): sem isto, uma queda do RabbitMQ (`docker stop rabbitmq`)
  // derrubava o processo em SILÊNCIO — nenhuma linha de log, nada — porque amqplib emite 'error'/
  // 'close' na conexão/canal, e um listener de 'error' ausente faz o Node lançar e crashar o
  // processo sem contexto nenhum. A escolha aqui é DELIBERADA: logar com clareza e sair com
  // código 1 (nunca tentar reconectar manualmente dentro do mesmo processo) — o `restart:
  // unless-stopped` do container em produção já cuida de reiniciar um processo limpo; um restart
  // completo é mais simples e mais confiável do que gerenciar reconexão de canal/consumers no meio
  // do processo. Preferir "morrer com log claro" a "morrer em silêncio" ou "ficar pendurado".
  connection.on("error", (error: Error) => {
    console.error("[inbox-worker] conexão com RabbitMQ caiu:", error.message);
    process.exit(1);
  });
  connection.on("close", () => {
    console.error("[inbox-worker] conexão com RabbitMQ fechada inesperadamente — encerrando para o restart policy do container religar.");
    process.exit(1);
  });

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
    // Todo evento normalizado carrega tenantId/workspaceId — mais barato enriquecer aqui (já
    // temos `connectionRow`) do que cada consumer de fila fazer sua própria consulta.
    const enriched: NormalizedInboxEvent = { ...mapped, tenantId: connectionRow.tenantId, workspaceId: connectionRow.workspaceId } as NormalizedInboxEvent;

    const routingKey = enriched.type;
    channel.publish(INBOX_EVENTS_EXCHANGE, routingKey, Buffer.from(JSON.stringify(enriched)), { persistent: true });
  });

  // 2) Fan-out por assunto — cada fila só processa o seu tipo de evento normalizado. Cada um
  // publica uma notificação leve em `inbox.realtime` (Fase 3) depois de persistir — o SSE da API
  // só usa isso como gatilho pra revalidar, nunca como fonte de verdade (ver publishRealtimeNotification).
  await consumeQueue(channel, INBOX_QUEUES.incoming, async (content) => {
    const event = JSON.parse(content.toString("utf8")) as Extract<NormalizedInboxEvent, { type: "message.inbound" }>;
    const { conversation } = await registerInboundMessage(deps, {
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
    publishRealtimeNotification(channel, { type: "message.created", tenantId: event.tenantId, workspaceId: event.workspaceId, conversationId: conversation.id });
  });

  await consumeQueue(channel, INBOX_QUEUES.status, async (content) => {
    const event = JSON.parse(content.toString("utf8")) as Extract<NormalizedInboxEvent, { type: "message.status" }>;
    await applyMessageStatusChanged(deps, { connectionId: event.connectionId, externalMessageId: event.externalMessageId, status: event.status, occurredAt: event.occurredAt });
    publishRealtimeNotification(channel, { type: "message.updated", tenantId: event.tenantId, workspaceId: event.workspaceId });
  });

  await consumeQueue(channel, INBOX_QUEUES.connection, async (content) => {
    const event = JSON.parse(content.toString("utf8")) as Extract<NormalizedInboxEvent, { type: "connection.state" }>;
    await applyConnectionStateChanged(deps, { connectionId: event.connectionId, status: event.status, phoneNumber: event.phoneNumber });
    publishRealtimeNotification(channel, { type: "connection.status_changed", tenantId: event.tenantId, workspaceId: event.workspaceId, connectionId: event.connectionId, status: event.status });
  });

  // 3) OutboxSenderConsumer — drena o envio outbound enfileirado pela API (`inbox.route.ts`).
  // `onDeadLetter` marca a mensagem como `failed` no Postgres quando a escada de retry se esgota
  // (ou o erro é permanente) — sem isso ela ficava `queued` para sempre, mesmo já morta na DLQ.
  await consumeQueue(
    channel,
    INBOX_QUEUES.outgoing,
    async (content) => {
      const payload = JSON.parse(content.toString("utf8")) as { messageId: string };
      const message = await processOutboundMessage(deps, { messageId: payload.messageId });
      if (message) {
        publishRealtimeNotification(channel, { type: "message.updated", tenantId: message.tenantId, workspaceId: message.workspaceId, conversationId: message.conversationId });
      }
    },
    async (content) => {
      const payload = JSON.parse(content.toString("utf8")) as { messageId: string };
      const message = await deps.messageRepository.getById(payload.messageId);
      if (message && message.status !== "sent" && message.status !== "failed") {
        await deps.messageRepository.markFailed(payload.messageId, { lastError: message.lastError ?? "Excedeu a escada de retry.", failedAt: new Date().toISOString() });
      }
    },
  );

  // Graceful shutdown (Fase 1, requisito de deploy): para de puxar mensagens novas e dá um tempo
  // curto para o processamento em voo terminar (ACK só acontece após persistência) antes de
  // fechar canal/conexão — nenhuma mensagem em processamento é perdida num deploy.
  const shutdown = async () => {
    console.log("[inbox-worker] encerrando — aguardando processamento em voo...");
    // Remove os listeners de 'error'/'close' ANTES de fechar de propósito — sem isso, o
    // `connection.close()" abaixo dispara o handler de "queda inesperada" (achado ao vivo acima)
    // e o processo sairia com código 1 mesmo num shutdown limpo, pedido por SIGTERM/SIGINT.
    connection.removeAllListeners("error");
    connection.removeAllListeners("close");
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
