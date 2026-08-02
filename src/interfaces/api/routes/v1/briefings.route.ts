import type { FastifyInstance } from "fastify";
import { cancelBriefing, getBriefing, type BriefingUseCaseDeps } from "../../../../application/briefing/briefing-use-cases.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { translateBriefingError } from "./briefing-error-translator.js";

/**
 * Rotas de Briefing — Sprint 07 (Fase 13). Deliberadamente MÍNIMAS: leitura e cancelamento, nunca
 * um endpoint que deixe o cliente setar um campo arbitrariamente, marcar como pronto, criar um
 * `PreparedCommand` direto ou confirmar fora do fluxo de Conversation — tudo isso só acontece via
 * `POST /v1/conversations/:id/messages` (`conversations.route.ts`), como mensagens normais.
 */

const WORKSPACE_ID_QUERYSTRING_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 } },
} as const;

const ID_PARAMS_SCHEMA = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", minLength: 1 } },
} as const;

export async function registerBriefingRoutes(app: FastifyInstance, deps: BriefingUseCaseDeps): Promise<void> {
  app.get(
    "/briefings/:id",
    { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_ID_QUERYSTRING_SCHEMA } },
    async (request) => {
      const principal = requirePermission(request, "conversation:read");
      const { id } = request.params as { id: string };
      const { workspaceId } = request.query as { workspaceId: string };

      const briefing = await getBriefing(deps, { tenantId: principal.tenantId, workspaceId, id }).catch(translateBriefingError);
      return successEnvelope(briefing, request.id);
    },
  );

  app.post(
    "/briefings/:id/cancel",
    { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_ID_QUERYSTRING_SCHEMA } },
    async (request) => {
      const principal = requirePermission(request, "conversation:message");
      const { id } = request.params as { id: string };
      const { workspaceId } = request.query as { workspaceId: string };

      const briefing = await cancelBriefing(deps, { tenantId: principal.tenantId, workspaceId, id }).catch(translateBriefingError);
      return successEnvelope(briefing, request.id);
    },
  );
}
