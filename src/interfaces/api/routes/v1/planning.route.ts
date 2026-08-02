import type { FastifyInstance } from "fastify";
import { getPlanningWithGraph, listPlanning, listPlanningTasks, type PlanningUseCaseDeps } from "../../../../application/planning/planning-use-cases.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { translatePlanningError } from "./planning-error-translator.js";

/**
 * Rotas de Planning — Sprint 09 (Fase 7). SÓ LEITURA (decisão obrigatória): listar planos,
 * consultar um plano (com o grafo já projetado), consultar as tarefas de um plano. Nenhum
 * endpoint de criação — um `Planning` nasce automaticamente ao confirmar um Briefing
 * (`briefing-use-cases.ts`), nunca por chamada direta. Nenhum endpoint de execução existe nem
 * poderia existir: nada neste domínio tem um estado além de "planned"/"expected".
 */

const WORKSPACE_ID_QUERYSTRING_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 }, conversationId: { type: "string", minLength: 1 } },
} as const;

const ID_PARAMS_SCHEMA = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", minLength: 1 } },
} as const;

export async function registerPlanningRoutes(app: FastifyInstance, deps: PlanningUseCaseDeps): Promise<void> {
  app.get("/planning", { schema: { querystring: WORKSPACE_ID_QUERYSTRING_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "planning:read");
    const { workspaceId, conversationId } = request.query as { workspaceId: string; conversationId?: string };

    const plans = await listPlanning(deps, { tenantId: principal.tenantId, workspaceId, conversationId });
    return successEnvelope(plans, request.id);
  });

  app.get(
    "/planning/:id",
    { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_ID_QUERYSTRING_SCHEMA } },
    async (request) => {
      const principal = requirePermission(request, "planning:read");
      const { id } = request.params as { id: string };
      const { workspaceId } = request.query as { workspaceId: string };

      const result = await getPlanningWithGraph(deps, { tenantId: principal.tenantId, workspaceId, id }).catch(translatePlanningError);
      return successEnvelope(result, request.id);
    },
  );

  app.get(
    "/planning/:id/tasks",
    { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_ID_QUERYSTRING_SCHEMA } },
    async (request) => {
      const principal = requirePermission(request, "planning:read");
      const { id } = request.params as { id: string };
      const { workspaceId } = request.query as { workspaceId: string };

      const result = await listPlanningTasks(deps, { tenantId: principal.tenantId, workspaceId, id }).catch(translatePlanningError);
      return successEnvelope(result, request.id);
    },
  );
}
