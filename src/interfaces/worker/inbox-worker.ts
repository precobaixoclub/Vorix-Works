import type { Channel, ConsumeMessage } from "amqplib";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
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
import type { InboxAiResponderPort } from "../../application/ports/inbox-ai-responder.port.js";
import {
  applyConnectionStateChanged,
  applyMessageStatusChanged,
  maybeGenerateAiResponse,
  processOutboundMessage,
  reconcileConnectionsHealth,
  registerInboundMessage,
  type InboxUseCaseDeps,
} from "../../application/inbox/inbox-use-cases.js";
import type { NormalizedInboxEvent } from "../../application/inbox/inbox-events.js";
import { buildAiGateway } from "../../infrastructure/ai-gateway/build-ai-gateway.js";
import { AiGatewayInboxResponder } from "../../infrastructure/ai-gateway/inbox-ai-responder-adapter.js";
import { CreditGatedAiGateway } from "../../application/ai-gateway/credit-gated-ai-gateway.js";
import { CreditAccountingService } from "../../application/ai-providers/credit-accounting.service.js";
import { OperationalCircuitBreaker, OperationalRateLimiter } from "../../application/operations/operational-services.js";
import { PostgresAiProvidersRepository } from "../../infrastructure/storage/postgres/postgres-ai-providers-repository.js";
import { PostgresPlatformBillingRepository } from "../../infrastructure/storage/postgres/postgres-platform-billing-repository.js";
import { createPromInboxMetrics, inboxMetricsRegistry } from "../../infrastructure/observability/prom-inbox-metrics.js";

/**
 * Processo separado do módulo Conversas — `vorix-worker` (Fase 1/2, resiliência reforçada na
 * Fase 6). Consome os eventos do WuzAPI via RabbitMQ e drena a fila de envio outbound; NUNCA
 * compartilha processo com a API HTTP (`zuno-api`) — um pico/crash aqui não derruba requisições
 * HTTP, e vice-versa (ver "Critério principal" no plano: mínima oscilação possível).
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
  /** Fase 5 — config MÍNIMA e independente de `loadApiConfig()`, mesmo raciocínio de
   * `InboxWorkerConfig` como um todo: o worker nunca deveria falhar o boot por causa de config de
   * IA ausente (`enabled=false`, o padrão, é um no-op completo — `deps.aiResponder` fica
   * `undefined` e `maybeGenerateAiResponse` vira um no-op silencioso). */
  ai: { enabled: boolean; anthropicApiKey?: string; anthropicInboxAutoReplyModel: string; billingEnabled: boolean };
  /** Fase 6 — resiliência/observabilidade. Todos com defaults conservadores; nenhum exige setup
   * extra para o worker continuar funcionando exatamente como nas Fases 1-5. */
  resilience: {
    healthCheckIntervalMs: number;
    heartbeatFile: string;
    heartbeatIntervalMs: number;
    metricsPort: number;
    metricsEnabled: boolean;
    outboundRateLimitPerMinute: number;
    wuzapiCircuitFailureThreshold: number;
    wuzapiCircuitCooldownMs: number;
    shutdownDrainTimeoutMs: number;
  };
};

const DEFAULT_ANTHROPIC_INBOX_AUTO_REPLY_MODEL = "claude-haiku-4-5-20251001";

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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
    ai: {
      enabled: process.env.AI_INBOX_AUTO_REPLY_ENABLED?.trim() === "true",
      anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
      anthropicInboxAutoReplyModel: process.env.ANTHROPIC_INBOX_AUTO_REPLY_MODEL?.trim() || DEFAULT_ANTHROPIC_INBOX_AUTO_REPLY_MODEL,
      // Fase 6 — só tem efeito quando o driver é postgres (billing sempre vive em Postgres real,
      // nunca em memória) E `ai.enabled`. Default `true`: uma vez que a IA está ligada em produção
      // (postgres), o crédito É verificado por padrão — quem quer IA sem cobrança (ex.: ambiente
      // interno) desliga explicitamente via env, nunca por omissão.
      billingEnabled: process.env.AI_INBOX_AUTO_REPLY_BILLING_ENABLED?.trim() !== "false",
    },
    resilience: {
      healthCheckIntervalMs: parsePositiveInt(process.env.INBOX_HEALTH_CHECK_INTERVAL_MS, 60_000),
      heartbeatFile: process.env.INBOX_WORKER_HEARTBEAT_FILE?.trim() || join(process.cwd(), ".inbox-worker-heartbeat"),
      heartbeatIntervalMs: parsePositiveInt(process.env.INBOX_WORKER_HEARTBEAT_INTERVAL_MS, 15_000),
      metricsPort: parsePositiveInt(process.env.INBOX_WORKER_METRICS_PORT, 9464),
      metricsEnabled: process.env.INBOX_WORKER_METRICS_ENABLED?.trim() !== "false",
      outboundRateLimitPerMinute: parsePositiveInt(process.env.INBOX_OUTBOUND_RATE_LIMIT_PER_MINUTE, 20),
      wuzapiCircuitFailureThreshold: parsePositiveInt(process.env.INBOX_WUZAPI_CIRCUIT_FAILURE_THRESHOLD, 5),
      wuzapiCircuitCooldownMs: parsePositiveInt(process.env.INBOX_WUZAPI_CIRCUIT_COOLDOWN_MS, 30_000),
      shutdownDrainTimeoutMs: parsePositiveInt(process.env.INBOX_WORKER_SHUTDOWN_DRAIN_TIMEOUT_MS, 10_000),
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
async function retryOrDeadLetter(
  channel: Channel,
  queue: string,
  msg: ConsumeMessage,
  error: unknown,
  metrics: ReturnType<typeof createPromInboxMetrics> | undefined,
  onDeadLetter?: (content: Buffer) => Promise<void>,
): Promise<void> {
  const attempt = attemptCountOf(msg);
  const kind = classifyGenericError(error);
  if (kind === "permanent" || attempt >= RETRY_TIERS_MS.length) {
    await publishToDeadLetter(channel, queue, msg.content);
    metrics?.incDlq();
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
  metrics?.incMessageRetry();
  const contentWithAttempt = Buffer.from(msg.content.toString("utf8"));
  await publishToRetryTier(channel, queue, attempt, contentWithAttempt, { persistent: true });
  channel.ack(msg);
}

/**
 * Fase 6 — contador de handlers em voo, usado pelo shutdown gracioso: `channel.close()` sozinho
 * NUNCA esperava mensagens já entregues terminarem de processar (achado da auditoria da Fase 6) —
 * agora o `shutdown()` espera este contador zerar (com um teto de tempo) antes de fechar o canal.
 */
let inFlightHandlers = 0;

async function consumeQueue(channel: Channel, queue: string, handle: (content: Buffer) => Promise<void>, metrics: ReturnType<typeof createPromInboxMetrics> | undefined, onDeadLetter?: (content: Buffer) => Promise<void>): Promise<void> {
  await channel.prefetch(CONSUMER_PREFETCH);
  await channel.consume(queue, (msg) => {
    if (!msg) return;
    inFlightHandlers += 1;
    handle(msg.content)
      .then(() => channel.ack(msg))
      .catch(async (error) => {
        console.error(`[inbox-worker] erro processando "${queue}":`, error instanceof Error ? error.message : error);
        await retryOrDeadLetter(channel, queue, msg, error, metrics, onDeadLetter);
      })
      .finally(() => {
        inFlightHandlers -= 1;
      });
  });
}

/** Fase 6 — servidor HTTP mínimo (sem Fastify — o worker nunca teve nem precisa de um framework
 * HTTP completo) só para `GET /metrics` (scrape do Prometheus). `metricsEnabled=false` desliga
 * completamente (nenhuma porta aberta) para ambientes que não quserem/podem expor isso. */
function startMetricsServer(port: number): import("node:http").Server {
  const server = createServer((request, response) => {
    if (request.url === "/metrics") {
      inboxMetricsRegistry
        .metrics()
        .then((body) => {
          response.writeHead(200, { "Content-Type": inboxMetricsRegistry.contentType });
          response.end(body);
        })
        .catch((error) => {
          response.writeHead(500);
          response.end(String(error));
        });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(port);
  server.unref();
  return server;
}

/** Fase 6 — heartbeat em arquivo: `scripts/inbox-worker-healthcheck.mjs` (usado como Docker
 * `HEALTHCHECK`) checa a idade deste arquivo para distinguir "processo travado" (event loop preso,
 * conexão zumbi) de "processo existe" — um `docker ps` saudável não garante que o worker ainda
 * está consumindo de verdade. */
function touchHeartbeatFile(path: string): void {
  try {
    writeFileSync(path, new Date().toISOString(), "utf8");
  } catch (error) {
    console.error("[inbox-worker] falha ao gravar heartbeat:", error instanceof Error ? error.message : error);
  }
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

  // Fase 6 — métricas Prometheus (primeira introdução no Vorix, ver `prom-inbox-metrics.ts`).
  const metrics = config.resilience.metricsEnabled ? createPromInboxMetrics() : undefined;
  let metricsServer: import("node:http").Server | undefined;
  if (config.resilience.metricsEnabled) {
    metricsServer = startMetricsServer(config.resilience.metricsPort);
    console.log(`[inbox-worker] métricas Prometheus em http://0.0.0.0:${config.resilience.metricsPort}/metrics`);
  }

  // Fase 6 — circuit breaker/rate limiter reaproveitados de `application/operations` (Postgres-
  // backed via `operationalStateRepository`, já exposto por `buildPlatformRepositories()`) — nunca
  // uma segunda stack só para Inbox. Em driver "memory" (dev/teste sem Postgres) o repositório
  // ainda existe (`InMemoryOperationalStateRepository`), então isto funciona igual, só sem
  // sobreviver a um restart do processo.
  const circuitBreaker = new OperationalCircuitBreaker(repositories.operationalStateRepository, {
    failureThreshold: config.resilience.wuzapiCircuitFailureThreshold,
    cooldownMs: config.resilience.wuzapiCircuitCooldownMs,
  });
  const rateLimiter = new OperationalRateLimiter(repositories.operationalStateRepository, {
    defaultLimit: config.resilience.outboundRateLimitPerMinute,
    windowMs: 60_000,
  });

  // IA de Atendimento (Fase 5/6) — `aiResponder` fica `undefined` (no-op) sem
  // `AI_INBOX_AUTO_REPLY_ENABLED=true`; falta de `ANTHROPIC_API_KEY` com isso habilitado nunca
  // impede o boot (mesmo princípio de `api-config.ts`'s aiGateway) — toda chamada só degrada para
  // `not_configured`, tratado como falha operacional normal por `maybeGenerateAiResponse`.
  let aiResponder: InboxAiResponderPort | undefined;
  if (config.ai.enabled) {
    const { aiGateway } = buildAiGateway({
      aiConfig: {
        enabled: true,
        briefingExtractionEnabled: false,
        anthropicApiKey: config.ai.anthropicApiKey,
        // Nunca usado de verdade: o worker jamais monta um `AiRequest` de `briefing_field_extraction`
        // (só a API/`process-briefing-turn.ts` faz isso) — campo obrigatório do tipo compartilhado,
        // sem efeito prático aqui.
        anthropicBriefingExtractionModel: "unused-in-inbox-worker",
        inboxAutoReplyEnabled: true,
        anthropicInboxAutoReplyModel: config.ai.anthropicInboxAutoReplyModel,
      },
      executionRepository: repositories.aiExecutionRepository,
    });

    // Fase 6 — fecha a limitação deixada explicitamente pela Fase 5: cobra crédito Vorix real por
    // resposta automática, reaproveitando `CreditAccountingService`/`CreditGatedAiGateway` já
    // existentes (nunca um ledger/saldo paralelo). Só disponível quando o driver é Postgres — o
    // billing real SEMPRE vive lá; em memória (dev/teste sem Postgres) a IA roda sem gating de
    // crédito, documentado como limitação (não há billing algum para gatear nesse modo).
    let gatedGateway = aiGateway;
    if (config.ai.billingEnabled && repositories.pool) {
      const creditAccounting = new CreditAccountingService({
        platformBillingRepository: new PostgresPlatformBillingRepository(repositories.pool),
        aiProvidersRepository: new PostgresAiProvidersRepository(repositories.pool),
        idGenerator: (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      });
      gatedGateway = new CreditGatedAiGateway({ inner: aiGateway, creditAccounting, now: () => new Date() });
      console.log("[inbox-worker] billing de IA da Inbox habilitado — resposta automática consome crédito Vorix real (operação \"inbox_auto_reply\").");
    } else if (config.ai.billingEnabled) {
      console.log("[inbox-worker] billing de IA da Inbox pedido, mas PERSISTENCE_DRIVER != postgres — rodando sem gating de crédito (dev/teste).");
    } else {
      console.log("[inbox-worker] AI_INBOX_AUTO_REPLY_BILLING_ENABLED=false — IA da Inbox roda sem consumir crédito Vorix (decisão explícita).");
    }

    aiResponder = new AiGatewayInboxResponder(gatedGateway);
    console.log(`[inbox-worker] IA de atendimento habilitada (modelo "${config.ai.anthropicInboxAutoReplyModel}").`);
  } else {
    console.log("[inbox-worker] AI_INBOX_AUTO_REPLY_ENABLED=false — IA de atendimento desligada, Inbox funciona normalmente sem ela.");
  }

  const deps: InboxUseCaseDeps = {
    connectionRepository: repositories.messagingConnectionRepository,
    contactRepository: repositories.inboxContactRepository,
    conversationRepository: repositories.inboxConversationRepository,
    conversationEventRepository: repositories.inboxConversationEventRepository,
    messageRepository: repositories.inboxMessageRepository,
    workspaceRepository: repositories.workspaceRepository,
    outboundQueue: { publish: async () => {} }, // o worker nunca publica outbound, só drena
    provider,
    aiResponder,
    circuitBreaker,
    rateLimiter,
    metrics,
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
  }, metrics);

  // 2) Fan-out por assunto — cada fila só processa o seu tipo de evento normalizado. Cada um
  // publica uma notificação leve em `inbox.realtime` (Fase 3) depois de persistir — o SSE da API
  // só usa isso como gatilho pra revalidar, nunca como fonte de verdade (ver publishRealtimeNotification).
  await consumeQueue(channel, INBOX_QUEUES.incoming, async (content) => {
    const event = JSON.parse(content.toString("utf8")) as Extract<NormalizedInboxEvent, { type: "message.inbound" }>;
    const { conversation, message, wasCreated } = await registerInboundMessage(deps, {
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

    // `wasCreated` é a MESMA guarda de idempotência que já protege `markLastMessage`/unread —
    // uma reentrega do mesmo evento (mensagem corretamente deduplicada) nunca dispara uma segunda
    // geração de IA. Roda em `.catch()`, nunca `await`-ado dentro do fluxo principal do ACK: uma
    // falha inesperada aqui NUNCA pode fazer este evento (já persistido com sucesso) cair na
    // escada de retry/DLQ do RabbitMQ, o que reprocessaria a mensagem sem necessidade.
    if (wasCreated) {
      maybeGenerateAiResponse(deps, { tenantId: event.tenantId, workspaceId: event.workspaceId, conversationId: conversation.id, triggeringMessageId: message.id })
        .then(() => publishRealtimeNotification(channel, { type: "message.updated", tenantId: event.tenantId, workspaceId: event.workspaceId, conversationId: conversation.id }))
        .catch((error) => {
          console.error("[inbox-worker] falha ao processar resposta automática de IA:", error instanceof Error ? error.message : error);
        });
    }
  }, metrics);

  await consumeQueue(channel, INBOX_QUEUES.status, async (content) => {
    const event = JSON.parse(content.toString("utf8")) as Extract<NormalizedInboxEvent, { type: "message.status" }>;
    await applyMessageStatusChanged(deps, { connectionId: event.connectionId, externalMessageId: event.externalMessageId, status: event.status, occurredAt: event.occurredAt });
    publishRealtimeNotification(channel, { type: "message.updated", tenantId: event.tenantId, workspaceId: event.workspaceId });
  }, metrics);

  await consumeQueue(channel, INBOX_QUEUES.connection, async (content) => {
    const event = JSON.parse(content.toString("utf8")) as Extract<NormalizedInboxEvent, { type: "connection.state" }>;
    await applyConnectionStateChanged(deps, { connectionId: event.connectionId, status: event.status, phoneNumber: event.phoneNumber });
    publishRealtimeNotification(channel, { type: "connection.status_changed", tenantId: event.tenantId, workspaceId: event.workspaceId, connectionId: event.connectionId, status: event.status });
  }, metrics);

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
    metrics,
    async (content) => {
      const payload = JSON.parse(content.toString("utf8")) as { messageId: string };
      const message = await deps.messageRepository.getById(payload.messageId);
      if (message && message.status !== "sent" && message.status !== "failed") {
        await deps.messageRepository.markFailed(payload.messageId, { lastError: message.lastError ?? "Excedeu a escada de retry.", failedAt: new Date().toISOString(), failureCategory: message.failureCategory ?? "transient" });
      }
    },
  );

  // Fase 6 — monitor de saúde periódico (nunca reconecta ativamente, só reconcilia
  // `connectionHealth`/`lastConnectionError` — ver `reconcileConnectionsHealth`) e heartbeat de
  // liveness (arquivo tocado a cada tick — ver `scripts/inbox-worker-healthcheck.mjs`). Guarda
  // `running` evita ticks sobrepostos caso uma rodada demore mais que o intervalo.
  let healthTickRunning = false;
  const healthTimer = setInterval(() => {
    if (healthTickRunning) return;
    healthTickRunning = true;
    reconcileConnectionsHealth(deps)
      .then(({ checked, unhealthy }) => {
        if (unhealthy > 0) console.warn(`[inbox-worker] monitor de saúde: ${unhealthy}/${checked} conexão(ões) com problema.`);
      })
      .catch((error) => console.error("[inbox-worker] monitor de saúde falhou:", error instanceof Error ? error.message : error))
      .finally(() => {
        healthTickRunning = false;
      });
  }, config.resilience.healthCheckIntervalMs);
  healthTimer.unref();

  touchHeartbeatFile(config.resilience.heartbeatFile);
  const heartbeatTimer = setInterval(() => touchHeartbeatFile(config.resilience.heartbeatFile), config.resilience.heartbeatIntervalMs);
  heartbeatTimer.unref();

  // Graceful shutdown (Fase 1/6): para de consumir, espera o que já estava em voo terminar (com
  // um teto de tempo — nunca trava o shutdown para sempre por um handler pendurado), fecha
  // RabbitMQ/pool. Fase 6 corrige um gap real encontrado na auditoria: `channel.close()` sozinho
  // NUNCA esperava handlers em voo de verdade — agora espera `inFlightHandlers` zerar.
  const shutdown = async () => {
    console.log("[inbox-worker] encerrando — aguardando processamento em voo...");
    clearInterval(healthTimer);
    clearInterval(heartbeatTimer);
    // Remove os listeners de 'error'/'close' ANTES de fechar de propósito — sem isso, o
    // `connection.close()" abaixo dispara o handler de "queda inesperada" (achado ao vivo acima)
    // e o processo sairia com código 1 mesmo num shutdown limpo, pedido por SIGTERM/SIGINT.
    connection.removeAllListeners("error");
    connection.removeAllListeners("close");

    const drainDeadline = Date.now() + config.resilience.shutdownDrainTimeoutMs;
    while (inFlightHandlers > 0 && Date.now() < drainDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (inFlightHandlers > 0) {
      console.warn(`[inbox-worker] shutdown: ${inFlightHandlers} handler(es) ainda em voo após ${config.resilience.shutdownDrainTimeoutMs}ms — fechando mesmo assim.`);
    }

    try {
      await channel.close();
      await connection.close();
      if (repositories.pool) await repositories.pool.end();
      if (metricsServer) await new Promise((resolve) => metricsServer!.close(() => resolve(undefined)));
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
