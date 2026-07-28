import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { loadApiConfig, type ApiConfig } from "./config/api-config.js";
import { registerErrorHandler } from "./http/error-handler.js";
import { registerRequestContext } from "./middleware/request-context.js";
import { registerAuthMiddleware } from "./middleware/auth.middleware.js";
import { registerDiPlugin } from "./plugins/di.plugin.js";
import { buildApiContainer, type ApiContainer } from "./di/container.js";
import { registerV1Routes } from "./routes/v1/index.js";
import { successEnvelope } from "./http/response-envelope.js";

export type BuildAppOptions = {
  config?: ApiConfig;
  container?: ApiContainer;
};

/**
 * Monta a aplicação Fastify sem chamar `listen()` — mantém `app.ts` testável isoladamente (ex.:
 * `app.inject({ method: "GET", url: "/health" })` em teste, sem abrir uma porta de verdade) e
 * separado de `server.ts`, que é o único arquivo que efetivamente sobe um processo escutando.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadApiConfig();
  const container = options.container ?? buildApiContainer();

  const app = Fastify({
    logger: { level: config.logLevel },
    genReqId: () => randomUUID(),
  });

  registerDiPlugin(app, container);
  registerRequestContext(app);
  registerAuthMiddleware(app, container.authPort);
  registerErrorHandler(app);

  app.get("/health", async (request, _reply) => successEnvelope({ status: "ok" as const }, request.id));

  await app.register(registerV1Routes, { prefix: "/v1" });

  return app;
}
