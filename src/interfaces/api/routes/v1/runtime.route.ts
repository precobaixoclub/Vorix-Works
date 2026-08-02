import type { FastifyInstance } from "fastify";
import { getRuntimeBindings, getRuntimeDetail, listRuntime, type RuntimeUseCaseDeps } from "../../../../application/runtime/runtime-use-cases.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { translateRuntimeError } from "./runtime-error-translator.js";

/**
 * Rotas de Runtime — Sprint 10 (Fase 6). SÓ LEITURA (decisão obrigatória 36): listar runtimes,
 * consultar um runtime (com contexto e relatório de validação), consultar seus bindings. Nenhum
 * endpoint de criação — um `RuntimePlan` nasce automaticamente quando um `Planning` fica `"ready"`
 * (`planning-engine.ts`), nunca por chamada direta. Nenhum endpoint de execução existe nem
 * poderia existir: nada neste domínio tem um estado além de "prepared"/"expected".
 */

const WORKSPACE_ID_QUERYSTRING_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 }, planningId: { type: "string", minLength: 1 } },
} as const;

const ID_PARAMS_SCHEMA = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", minLength: 1 } },
} as const;

export async function registerRuntimeRoutes(app: FastifyInstance, deps: RuntimeUseCaseDeps): Promise<void> {
  app.get("/runtime", { schema: { querystring: WORKSPACE_ID_QUERYSTRING_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "runtime:read");
    const { workspaceId, planningId } = request.query as { workspaceId: string; planningId?: string };

    const runtimes = await listRuntime(deps, { tenantId: principal.tenantId, workspaceId, planningId });
    return successEnvelope(runtimes, request.id);
  });

  app.get(
    "/runtime/:id",
    { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_ID_QUERYSTRING_SCHEMA } },
    async (request) => {
      const principal = requirePermission(request, "runtime:read");
      const { id } = request.params as { id: string };
      const { workspaceId } = request.query as { workspaceId: string };

      const result = await getRuntimeDetail(deps, { tenantId: principal.tenantId, workspaceId, id }).catch(translateRuntimeError);
      return successEnvelope(result, request.id);
    },
  );

  app.get(
    "/runtime/:id/bindings",
    { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_ID_QUERYSTRING_SCHEMA } },
    async (request) => {
      const principal = requirePermission(request, "runtime:read");
      const { id } = request.params as { id: string };
      const { workspaceId } = request.query as { workspaceId: string };

      const result = await getRuntimeBindings(deps, { tenantId: principal.tenantId, workspaceId, id }).catch(translateRuntimeError);
      return successEnvelope(result, request.id);
    },
  );
}
