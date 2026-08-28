import type { FastifyInstance } from "fastify";
import type { InboxContactRepositoryPort } from "../../../../application/ports/inbox-contact-repository.port.js";
import type { InboxConversationListFilter, InboxConversationRepositoryPort } from "../../../../application/ports/inbox-conversation-repository.port.js";
import type { InboxMessageRepositoryPort } from "../../../../application/ports/inbox-message-repository.port.js";
import type { MessagingConnectionRepositoryPort } from "../../../../application/ports/messaging-connection-repository.port.js";
import type { MessagingProvider } from "../../../../application/ports/messaging-provider.port.js";
import type { OutboundMessageQueuePort } from "../../../../application/ports/outbound-message-queue.port.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import {
  assignConversation,
  createConnection,
  disconnectConnection,
  getConnectionQrCode,
  listConnections,
  listConversationMessages,
  listConversations,
  markConversationRead,
  refreshConnectionStatus,
  sendInboxMessage,
  setAiConversationEnabled,
  takeOverConversation,
  type InboxUseCaseDeps,
} from "../../../../application/inbox/inbox-use-cases.js";
import { AppError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/** Módulo Conversas (Fase 1/3/4) — inbox de WhatsApp via WuzAPI. Rotas montadas sob `/v1/inbox/*`,
 * só registradas quando `InboxFeatureFlags.enabled === true` (ver `routes/v1/index.ts`). */

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const WORKSPACE_BODY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const CREATE_CONNECTION_BODY_SCHEMA = { type: "object", required: ["workspaceId", "displayName"], properties: { workspaceId: { type: "string", minLength: 1 }, displayName: { type: "string", minLength: 1 } } } as const;
const SEND_MESSAGE_BODY_SCHEMA = { type: "object", required: ["workspaceId", "body"], properties: { workspaceId: { type: "string", minLength: 1 }, body: { type: "string", minLength: 1 } } } as const;
const ASSIGN_BODY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 }, assignedUserId: { type: "string" } } } as const;
const AI_ENABLED_BODY_SCHEMA = { type: "object", required: ["workspaceId", "aiEnabled"], properties: { workspaceId: { type: "string", minLength: 1 }, aiEnabled: { type: "boolean" } } } as const;
const CONVERSATIONS_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 }, filter: { type: "string", enum: ["all", "mine", "unassigned", "unread"] } },
} as const;
const MESSAGES_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 }, cursor: { type: "string" }, limit: { type: "number" } },
} as const;

const INBOX_ERROR_STATUS: Record<string, number> = {
  INBOX_WORKSPACE_NOT_FOUND: 404,
  INBOX_CONNECTION_NOT_FOUND: 404,
  INBOX_CONVERSATION_NOT_FOUND: 404,
  INBOX_DISPLAY_NAME_EMPTY: 422,
  INBOX_MESSAGE_BODY_EMPTY: 422,
  INBOX_CONNECTION_NOT_READY: 409,
};

function rethrowInboxError(error: unknown): never {
  if (error instanceof Error) {
    const [code, ...rest] = error.message.split(": ");
    const statusCode = INBOX_ERROR_STATUS[code];
    if (statusCode !== undefined) throw new AppError({ code, message: rest.join(": ") || error.message, statusCode, recoverable: true });
  }
  throw error;
}

export type InboxRoutesDeps = {
  connectionRepository: MessagingConnectionRepositoryPort;
  contactRepository: InboxContactRepositoryPort;
  conversationRepository: InboxConversationRepositoryPort;
  messageRepository: InboxMessageRepositoryPort;
  workspaceRepository: WorkspaceRepositoryPort;
  outboundQueue: OutboundMessageQueuePort;
  provider: MessagingProvider;
};

function toUseCaseDeps(deps: InboxRoutesDeps): InboxUseCaseDeps {
  return deps;
}

export async function registerInboxRoutes(app: FastifyInstance, deps: InboxRoutesDeps): Promise<void> {
  const useCaseDeps = toUseCaseDeps(deps);

  app.get("/inbox/connections", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const connections = await listConnections(useCaseDeps, { tenantId: principal.tenantId, workspaceId });
    return successEnvelope({ connections }, request.id);
  });

  app.post("/inbox/connections", { schema: { body: CREATE_CONNECTION_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "inbox:manage_connections");
    const { workspaceId, displayName } = request.body as { workspaceId: string; displayName: string };
    try {
      const connection = await createConnection(useCaseDeps, { tenantId: principal.tenantId, workspaceId, displayName });
      reply.status(201);
      return successEnvelope(connection, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.get("/inbox/connections/:id/qr", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:manage_connections");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const qr = await getConnectionQrCode(useCaseDeps, { tenantId: principal.tenantId, workspaceId, connectionId: id });
      return successEnvelope(qr, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.post("/inbox/connections/:id/refresh-status", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:manage_connections");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      const connection = await refreshConnectionStatus(useCaseDeps, { tenantId: principal.tenantId, workspaceId, connectionId: id });
      return successEnvelope(connection, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.post("/inbox/connections/:id/disconnect", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:manage_connections");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      const connection = await disconnectConnection(useCaseDeps, { tenantId: principal.tenantId, workspaceId, connectionId: id });
      return successEnvelope(connection, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.get("/inbox/conversations", { schema: { querystring: CONVERSATIONS_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:read");
    const { workspaceId, filter } = request.query as { workspaceId: string; filter?: InboxConversationListFilter };
    const conversations = await listConversations(useCaseDeps, { tenantId: principal.tenantId, workspaceId, filter, assignedUserId: principal.userId });
    return successEnvelope({ conversations }, request.id);
  });

  app.get("/inbox/conversations/:id/messages", { schema: { params: ID_PARAMS_SCHEMA, querystring: MESSAGES_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:read");
    const { id } = request.params as { id: string };
    const { workspaceId, cursor, limit } = request.query as { workspaceId: string; cursor?: string; limit?: number };
    try {
      const messages = await listConversationMessages(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, cursor, limit });
      return successEnvelope({ messages }, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.post("/inbox/conversations/:id/read", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:reply");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      await markConversationRead(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
      return successEnvelope({ read: true }, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.post("/inbox/conversations/:id/assign", { schema: { params: ID_PARAMS_SCHEMA, body: ASSIGN_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:assign");
    const { id } = request.params as { id: string };
    const { workspaceId, assignedUserId } = request.body as { workspaceId: string; assignedUserId?: string };
    try {
      const conversation = await assignConversation(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, assignedUserId });
      return successEnvelope(conversation, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.post("/inbox/conversations/:id/take-over", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:assign");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      const conversation = await takeOverConversation(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, userId: principal.userId });
      return successEnvelope(conversation, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.post("/inbox/conversations/:id/ai", { schema: { params: ID_PARAMS_SCHEMA, body: AI_ENABLED_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:manage_ai");
    const { id } = request.params as { id: string };
    const { workspaceId, aiEnabled } = request.body as { workspaceId: string; aiEnabled: boolean };
    try {
      const conversation = await setAiConversationEnabled(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, aiEnabled });
      return successEnvelope(conversation, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.post("/inbox/conversations/:id/messages", { schema: { params: ID_PARAMS_SCHEMA, body: SEND_MESSAGE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "inbox:reply");
    const { id } = request.params as { id: string };
    const { workspaceId, body } = request.body as { workspaceId: string; body: string };
    try {
      const message = await sendInboxMessage(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, body, sentByUserId: principal.userId });
      reply.status(202);
      return successEnvelope(message, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });
}
