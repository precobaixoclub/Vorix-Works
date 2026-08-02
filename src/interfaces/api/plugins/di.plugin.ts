import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "../config/api-config.js";
import { buildApiContainer, type ApiContainer } from "../di/container.js";

declare module "fastify" {
  interface FastifyInstance {
    zunoContainer: ApiContainer;
    zunoConfig: ApiConfig;
  }
}

/** Decora a instância do Fastify com a raiz de composição e a config carregada, para que qualquer
 * rota acesse dependências via `app.zunoContainer`/`app.zunoConfig` em vez de importar adapters
 * ou reler `process.env` diretamente. `config` é opcional só para não quebrar chamadas antigas em
 * teste que não precisam dela (rotas que a exigem, como `/v1/auth`, falham claramente se ausente). */
export function registerDiPlugin(app: FastifyInstance, container: ApiContainer = buildApiContainer(), config?: ApiConfig): void {
  app.decorate("zunoContainer", container);
  if (config) app.decorate("zunoConfig", config);
}
