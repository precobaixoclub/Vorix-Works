import type { FastifyInstance } from "fastify";
import { getActiveBriefing } from "../../../../application/briefing/briefing-use-cases.js";
import {
  createConversation,
  getConversation,
  getHistory,
  listConversations,
  sendMessage,
  type ConversationUseCaseDeps,
} from "../../../../application/conversation/index.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { translateConversationError } from "./conversation-error-translator.js";

/**
 * Rotas de Conversation — Sprint 06 (Fase 5). Mesmo padrão de `workspaces.route.ts`: nunca tocam
 * os repositórios diretamente, `tenantId` sempre vem de `principal.tenantId` (JWT), nunca do
 * corpo/query da requisição. `workspaceId` é OBRIGATÓRIO em toda rota (corpo na criação, query
 * nas demais) — "sempre isolados por Tenant e Workspace" (PROMPT 06, Fase 5) é levado ao pé da
 * letra: mesmo dentro do mesmo tenant, uma conversa de um Workspace nunca aparece a partir de
 * outro Workspace.
 */

const WORKSPACE_ID_QUERYSTRING_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 } },
} as const;

const CREATE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  additionalProperties: false,
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    title: { type: "string" },
  },
} as const;

const MESSAGE_BODY_SCHEMA = {
  type: "object",
  required: ["content"],
  additionalProperties: false,
  properties: {
    content: { type: "string", minLength: 1 },
  },
} as const;

const ID_PARAMS_SCHEMA = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", minLength: 1 } },
} as const;

export async function registerConversationRoutes(app: FastifyInstance, deps: ConversationUseCaseDeps): Promise<void> {
  app.post("/conversations", { schema: { body: CREATE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "conversation:create");
    const body = request.body as { workspaceId: string; title?: string };

    const conversation = await createConversation(deps, {
      tenantId: principal.tenantId,
      workspaceId: body.workspaceId,
      title: body.title,
    }).catch(translateConversationError);

    reply.status(201);
    return successEnvelope(conversation, request.id);
  });

  app.get("/conversations", { schema: { querystring: WORKSPACE_ID_QUERYSTRING_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "conversation:read");
    const { workspaceId } = request.query as { workspaceId: string };

    const conversations = await listConversations(deps, { tenantId: principal.tenantId, workspaceId });
    return successEnvelope(conversations, request.id);
  });

  app.get(
    "/conversations/:id",
    { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_ID_QUERYSTRING_SCHEMA } },
    async (request) => {
      const principal = requirePermission(request, "conversation:read");
      const { id } = request.params as { id: string };
      const { workspaceId } = request.query as { workspaceId: string };

      const conversation = await getConversation(deps, { tenantId: principal.tenantId, workspaceId, id }).catch(
        translateConversationError,
      );
      return successEnvelope(conversation, request.id);
    },
  );

  app.post(
    "/conversations/:id/messages",
    { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_ID_QUERYSTRING_SCHEMA, body: MESSAGE_BODY_SCHEMA } },
    async (request) => {
      const principal = requirePermission(request, "conversation:message");
      const { id } = request.params as { id: string };
      const { workspaceId } = request.query as { workspaceId: string };
      const { content } = request.body as { content: string };

      const result = await sendMessage(deps, {
        tenantId: principal.tenantId,
        workspaceId,
        conversationId: id,
        content,
      }).catch(translateConversationError);

      return successEnvelope(result, request.id);
    },
  );

  app.get(
    "/conversations/:id/history",
    { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_ID_QUERYSTRING_SCHEMA } },
    async (request) => {
      const principal = requirePermission(request, "conversation:read");
      const { id } = request.params as { id: string };
      const { workspaceId } = request.query as { workspaceId: string };

      const history = await getHistory(deps, { tenantId: principal.tenantId, workspaceId, conversationId: id }).catch(
        translateConversationError,
      );
      return successEnvelope(history, request.id);
    },
  );

  // Sprint 07 (Fase 13) — "ativo" pode legitimamente ser `null` (nenhum Briefing em andamento
  // nesta conversa); isso nunca é um erro 404, só um dado ausente.
  app.get(
    "/conversations/:conversationId/briefings/active",
    { schema: { params: { type: "object", required: ["conversationId"], properties: { conversationId: { type: "string", minLength: 1 } } }, querystring: WORKSPACE_ID_QUERYSTRING_SCHEMA } },
    async (request) => {
      const principal = requirePermission(request, "conversation:read");
      const { conversationId } = request.params as { conversationId: string };
      const { workspaceId } = request.query as { workspaceId: string };

      await getConversation(deps, { tenantId: principal.tenantId, workspaceId, id: conversationId }).catch(translateConversationError);
      const briefing = await getActiveBriefing(deps, { tenantId: principal.tenantId, workspaceId, conversationId });
      return successEnvelope(briefing ?? null, request.id);
    },
  );
}
