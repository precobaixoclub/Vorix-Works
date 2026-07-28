import type { FastifyInstance } from "fastify";
import { registerHealthRoutes } from "./health.route.js";
import { registerWorkspaceRoutes } from "./workspaces.route.js";

/**
 * Grupo de rotas `v1` — esqueleto de versionamento. Registrado sob o prefixo `/v1` (ver `app.ts`),
 * para que uma futura `v2` conviva lado a lado sem quebrar clientes existentes. `app.zunoContainer`
 * (decorado por `registerDiPlugin` na instância pai) chega aqui por herança de decorators do
 * Fastify — nenhuma rota importa um adapter diretamente, cada uma recebe só os Ports de que
 * precisa (Workspace hoje; Asset Library/Chat entram quando ganharem endpoints próprios).
 */
export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  await registerHealthRoutes(app);
  await registerWorkspaceRoutes(app, { workspaceRepository: app.zunoContainer.workspaceRepository });
}
