import type { FastifyInstance } from "fastify";
import { buildApiContainer, type ApiContainer } from "../di/container.js";

declare module "fastify" {
  interface FastifyInstance {
    zunoContainer: ApiContainer;
  }
}

/** Decora a instância do Fastify com a raiz de composição, para que qualquer rota acesse dependências via `app.zunoContainer` em vez de importar adapters diretamente. */
export function registerDiPlugin(app: FastifyInstance, container: ApiContainer = buildApiContainer()): void {
  app.decorate("zunoContainer", container);
}
