import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { loadApiConfig, type ApiConfig } from "./config/api-config.js";
import { registerErrorHandler } from "./http/error-handler.js";
import { registerRequestContext } from "./middleware/request-context.js";
import { registerAuthMiddleware } from "./middleware/auth.middleware.js";
import { registerIdempotencyMiddleware } from "./middleware/idempotency.middleware.js";
import { registerRateLimitMiddleware } from "./middleware/rate-limit.middleware.js";
import { registerSecurityHeadersMiddleware } from "./middleware/security-headers.middleware.js";
import { registerDiPlugin } from "./plugins/di.plugin.js";
import { buildApiContainer, type ApiContainer } from "./di/container.js";
import { registerV1Routes } from "./routes/v1/index.js";
import { registerPublicationScheduler } from "./scheduler/publication-scheduler.js";
import { registerMetaAdsSyncScheduler } from "./scheduler/meta-ads-sync-scheduler.js";
import { registerTrialExpirationScheduler } from "./scheduler/trial-expiration-scheduler.js";
import { registerCapacityChangeScheduler } from "./scheduler/capacity-change-scheduler.js";
import { registerVersionRoute } from "./routes/version.route.js";
import { registerWebhookReceiverRoutes } from "./routes/webhook-receiver.route.js";
import { registerInstagramDmWebhookRoutes } from "./routes/instagram-dm-webhook.route.js";
import { registerBillingWebhookRoutes } from "./routes/billing-webhook.route.js";
import { successEnvelope } from "./http/response-envelope.js";
import { registerUploadedObjectRoutes } from "./routes/uploads.route.js";

export type BuildAppOptions = {
  config?: ApiConfig;
  container?: Partial<ApiContainer>;
};

/**
 * Monta a aplicação Fastify sem chamar `listen()` — mantém `app.ts` testável isoladamente (ex.:
 * `app.inject({ method: "GET", url: "/health" })` em teste, sem abrir uma porta de verdade) e
 * separado de `server.ts`, que é o único arquivo que efetivamente sobe um processo escutando.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadApiConfig();
  const container = options.container ? { ...buildApiContainer(config), ...options.container } : buildApiContainer(config);

  const app = Fastify({
    logger: { level: config.logLevel },
    genReqId: () => randomUUID(),
  });

  await app.register(cors, {
    origin: config.corsOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "X-Zuno-Signature", "X-Zuno-Timestamp", "X-Zuno-Nonce"],
    // Obrigatório para o cookie HttpOnly do refresh token (Sprint 05) atravessar a origem
    // diferente do frontend (`web/`, porta 3001) — sem isto o navegador nunca envia o cookie.
    credentials: true,
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.objectStorage.maxUploadBytes, files: 1 } });
  if (config.objectStorage.enabled && config.objectStorage.driver === "local" && config.objectStorage.localDir) {
    await registerUploadedObjectRoutes(app, { rootDir: config.objectStorage.localDir });
  }

  registerSecurityHeadersMiddleware(app, { cookieSecure: config.cookieSecure });

  if (container.pool) {
    const pool = container.pool;
    app.addHook("onClose", async () => {
      await pool.end();
    });
  }

  if (container.identity) {
    const identityPool = container.identity.pool;
    app.addHook("onClose", async () => {
      await identityPool.end();
    });
  }

  registerDiPlugin(app, container, config);
  registerRequestContext(app);
  registerAuthMiddleware(app, container.authPort);
  registerRateLimitMiddleware(app, container.operationalRateLimiter);
  registerIdempotencyMiddleware(app);
  registerErrorHandler(app);

  app.get("/health", async (request, _reply) => successEnvelope({ status: "ok" as const }, request.id));
  app.get("/livez", async (request, _reply) => successEnvelope(container.operationalHealthService.liveness(), request.id));
  app.get("/readyz", async (request, reply) => {
    const readiness = await container.operationalHealthService.readiness();
    if (!readiness.ready) reply.status(503);
    return successEnvelope(readiness, request.id);
  });
  await registerVersionRoute(app);
  await registerWebhookReceiverRoutes(app, { ingestionService: container.webhookIngestionService });
  // Instagram DM virou canal de primeira classe do Inbox (pedido explícito do usuário) — o webhook
  // agora chama `registerInboundMessage`, o MESMO caminho do WhatsApp, com os MESMOS repositórios
  // singleton do container (nunca uma segunda pilha de dependências). `accountRouteRepository`
  // continua sendo a ÚNICA peça própria do módulo Instagram DM original ainda em uso — é como o
  // webhook resolve `tenantId`/`workspaceId` a partir do `instagramBusinessAccountId` da Meta.
  await registerInstagramDmWebhookRoutes(app, {
    connectionRepository: container.messagingConnectionRepository,
    contactRepository: container.inboxContactRepository,
    conversationRepository: container.inboxConversationRepository,
    conversationEventRepository: container.inboxConversationEventRepository,
    messageRepository: container.inboxMessageRepository,
    workspaceRepository: container.workspaceRepository,
    outboundQueue: container.inboxOutboundQueue,
    providers: { wuzapi: container.inboxProvider, instagram: container.instagramMessagingProvider },
    channelRoutingRepository: container.identity?.channelRoutingRepository,
    teamRepository: container.identity?.teamRepository,
    teamMembershipRepository: container.identity?.teamMembershipRepository,
    teamKanbanPhaseRepository: container.identity?.teamKanbanPhaseRepository,
    conversationTimeEntryRepository: container.identity?.conversationTimeEntryRepository,
    notificationRepository: container.notificationRepository,
    notificationRealtimePublisher: container.notificationRealtimePublisher,
    realtimeSubscriber: container.inboxRealtimeSubscriber,
    accountRouteRepository: container.instagramDmAccountRouteRepository,
    appSecret: config.publication.metaAppSecret,
    webhookVerifyToken: config.instagramDm.webhookVerifyToken,
  });

  if (container.identity) {
    const identity = container.identity;
    // Trial + Product Analytics — mesma construção de `registerV1Routes` (webhook fica FORA de
    // `/v1`, registrado antes dele, então precisa da própria instância; nunca um segundo tipo de
    // deps, só a mesma forma reconstruída aqui).
    const productAnalyticsDeps = {
      productEventRepository: identity.productEventRepository,
      enabled: config.productAnalytics.enabled,
      onWriteFailed: ({ eventName, error }: { eventName: string; error: unknown }) => {
        app.log.warn({ err: error, eventName }, "product_event_write_failed");
      },
    };
    await registerBillingWebhookRoutes(app, {
      billingProvider: container.billingProvider,
      paymentWebhookEventRepository: identity.paymentWebhookEventRepository,
      subscriptionRepository: identity.subscriptionRepository,
      planVersionRepository: identity.planVersionRepository,
      platformBillingRepository: identity.platformBillingRepository,
      billingEventRepository: identity.billingEventRepository,
      invoiceRepository: identity.invoiceRepository,
      productAnalytics: productAnalyticsDeps,
    });
  }

  await app.register(registerV1Routes, { prefix: "/v1" });

  registerPublicationScheduler(app, container, { enabled: config.publication.schedulerEnabled, intervalMs: config.publication.schedulerIntervalMs });
  registerMetaAdsSyncScheduler(app, container, { enabled: config.metaAds.syncSchedulerEnabled, intervalMs: config.metaAds.syncSchedulerIntervalMs });
  registerTrialExpirationScheduler(app, container, { enabled: config.billing.trialEnabled, intervalMs: config.billing.trialExpirationCheckIntervalMs });
  // Pricing/Capacity Etapa B — aplica reduções de capacidade agendadas pro fim do ciclo. Mesma
  // cadência da varredura de trial (não precisa de env var própria — nunca é urgente ao minuto).
  registerCapacityChangeScheduler(app, container, { intervalMs: config.billing.trialExpirationCheckIntervalMs });

  return app;
}
