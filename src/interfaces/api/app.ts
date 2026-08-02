import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
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
import { registerVersionRoute } from "./routes/version.route.js";
import { registerWebhookReceiverRoutes } from "./routes/webhook-receiver.route.js";
import { successEnvelope } from "./http/response-envelope.js";

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
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "X-Zuno-Signature", "X-Zuno-Timestamp", "X-Zuno-Nonce"],
    // Obrigatório para o cookie HttpOnly do refresh token (Sprint 05) atravessar a origem
    // diferente do frontend (`web/`, porta 3001) — sem isto o navegador nunca envia o cookie.
    credentials: true,
  });

  await app.register(cookie);

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

  await app.register(registerV1Routes, { prefix: "/v1" });

  return app;
}
