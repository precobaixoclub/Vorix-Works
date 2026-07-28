import type { FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./health.route.js";

/**
 * Grupo de rotas `v1` — esqueleto de versionamento. Registrado sob o prefixo `/v1` (ver `app.ts`),
 * para que uma futura `v2` conviva lado a lado sem quebrar clientes existentes. Nesta sprint só
 * existe o healthcheck; endpoints de negócio (Workspace, Chat, Asset Library etc.) entram aqui nas
 * próximas sprints, cada um em seu próprio arquivo `*.route.ts`.
 */
export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  await registerHealthRoutes(app);
}
