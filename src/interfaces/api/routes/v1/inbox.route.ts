import type { FastifyInstance } from "fastify";
import type { InboxContactRepositoryPort } from "../../../../application/ports/inbox-contact-repository.port.js";
import type { InboxConversationEventRepositoryPort } from "../../../../application/ports/inbox-conversation-event-repository.port.js";
import type { InboxConversationListFilter, InboxConversationRepositoryPort } from "../../../../application/ports/inbox-conversation-repository.port.js";
import type { InboxMessageRepositoryPort } from "../../../../application/ports/inbox-message-repository.port.js";
import type { MessagingConnectionRepositoryPort } from "../../../../application/ports/messaging-connection-repository.port.js";
import type { MessagingProvider } from "../../../../application/ports/messaging-provider.port.js";
import type { OutboundMessageQueuePort } from "../../../../application/ports/outbound-message-queue.port.js";
import type { TenantMembershipRepositoryPort } from "../../../../application/ports/tenant-membership-repository.port.js";
import type { UserRepositoryPort } from "../../../../application/ports/user-repository.port.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import type { InboxRealtimeSubscriber } from "../../../../infrastructure/messaging/rabbitmq/inbox-realtime-subscriber.js";
import {
  assignConversation,
  closeConversation,
  createConnection,
  disconnectConnection,
  getConnectionQrCode,
  listConnections,
  listConversationEvents,
  listConversationMessages,
  listConversations,
  markConversationRead,
  refreshConnectionStatus,
  reopenConversation,
  sendInboxMessage,
  setAiConversationEnabled,
  takeOverConversation,
  transferConversation,
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
const TRANSFER_BODY_SCHEMA = { type: "object", required: ["workspaceId", "toUserId"], properties: { workspaceId: { type: "string", minLength: 1 }, toUserId: { type: "string", minLength: 1 } } } as const;
const AI_ENABLED_BODY_SCHEMA = { type: "object", required: ["workspaceId", "aiEnabled"], properties: { workspaceId: { type: "string", minLength: 1 }, aiEnabled: { type: "boolean" } } } as const;
const CONVERSATIONS_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 }, filter: { type: "string", enum: ["all", "mine", "unassigned", "unread", "open", "pending", "resolved"] } },
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
  // Fase 4 (Atendimento) — concorrência e transições de estado.
  INBOX_CONVERSATION_ALREADY_ASSIGNED: 409,
  INBOX_CONVERSATION_TRANSFER_CONFLICT: 409,
  INBOX_CONVERSATION_NOT_ASSIGNED: 422,
  INBOX_TARGET_USER_NOT_IN_TENANT: 404,
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
  conversationEventRepository: InboxConversationEventRepositoryPort;
  messageRepository: InboxMessageRepositoryPort;
  workspaceRepository: WorkspaceRepositoryPort;
  outboundQueue: OutboundMessageQueuePort;
  provider: MessagingProvider;
  /** `undefined` quando `INBOX_RABBITMQ_URL` não está configurado (dev/teste sem broker) — nesse
   * caso a rota SSE ainda funciona (conecta, manda heartbeat), só nunca recebe notificação
   * nenhuma; o polling de fallback do frontend continua garantindo consistência eventual. */
  realtimeSubscriber?: InboxRealtimeSubscriber;
  /** Fase 4 — valida que `assignedUserId`/`toUserId` pertence ao MESMO tenant antes de aceitar
   * atribuição/transferência (nunca confiar num id de usuário vindo do corpo da requisição sem
   * checar). `undefined` só em setups sem identidade real (ex.: `AUTH_MODE=noop`/testes) — nesse
   * caso a validação é pulada, nunca bloqueia o fluxo. */
  membershipRepository?: TenantMembershipRepositoryPort;
  /** Fase 5 — só usado por `GET /inbox/members` (seletor de transferência no frontend, substitui o
   * campo manual de userId). `undefined` no mesmo cenário de `membershipRepository` — a rota
   * responde uma lista vazia em vez de falhar. */
  userRepository?: UserRepositoryPort;
};

function toUseCaseDeps(deps: InboxRoutesDeps): InboxUseCaseDeps {
  return deps;
}

/** Fase 4 — best-effort: publica no SSE depois que a ação já foi persistida com sucesso; nunca faz
 * a requisição HTTP esperar por isso nem falhar por causa disso. */
function publishConversationUpdated(deps: InboxRoutesDeps, input: { tenantId: string; workspaceId: string; conversationId: string }): void {
  deps.realtimeSubscriber?.publish({ type: "conversation.updated", tenantId: input.tenantId, workspaceId: input.workspaceId, conversationId: input.conversationId });
}

async function assertUserBelongsToTenant(deps: InboxRoutesDeps, userId: string, tenantId: string): Promise<void> {
  if (!deps.membershipRepository) return;
  const membership = await deps.membershipRepository.getByUserAndTenant(userId, tenantId);
  if (!membership) throw new AppError({ code: "INBOX_TARGET_USER_NOT_IN_TENANT", message: `Usuário "${userId}" não pertence a esta conta.`, statusCode: 404, recoverable: true });
}

export async function registerInboxRoutes(app: FastifyInstance, deps: InboxRoutesDeps): Promise<void> {
  const useCaseDeps = toUseCaseDeps(deps);

  /**
   * SSE (Fase 3/4) — atualização em tempo real da Inbox. Alimentada tanto pelo `vorix-worker`
   * (mensagens/status/conexão) quanto por ESTAS rotas diretamente (ações operacionais da Fase 4:
   * atribuir/assumir/transferir/finalizar/reabrir/pausar IA), via `InboxRealtimeSubscriber`. Nunca
   * é a fonte de verdade — só um gatilho pra revalidar mais rápido; o frontend mantém um polling de
   * fallback bem mais espaçado. `EventSource` do browser não seta headers customizados, por isso o
   * token de acesso aqui pode vir por `?access_token=` (ver `auth.middleware.ts`), nunca só por
   * `Authorization`.
   */
  app.get("/inbox/stream", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "inbox:read");
    const { workspaceId } = request.query as { workspaceId: string };

    deps.realtimeSubscriber?.start();
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");

    const listener = (notification: Record<string, unknown>) => {
      if (notification.tenantId !== principal.tenantId || notification.workspaceId !== workspaceId) return;
      const eventType = typeof notification.type === "string" ? notification.type : "message";
      reply.raw.write(`event: ${eventType}\ndata: ${JSON.stringify(notification)}\n\n`);
    };
    deps.realtimeSubscriber?.on("notification", listener);

    // Heartbeat — mantém proxies (Traefik) e o próprio EventSource do browser de considerar a
    // conexão morta em silêncio; comentário SSE (`:`), nunca interpretado como evento de dado.
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 20_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      deps.realtimeSubscriber?.off("notification", listener);
    });
  });

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

  /**
   * Fase 5 — lista de membros do MESMO tenant (nunca outro), para o seletor de transferência no
   * frontend (substitui o campo manual de userId da Fase 4). Mesma permissão de `/assign` e
   * `/transfer` (`inbox:assign`) — só quem pode atribuir/transferir precisa ver esta lista.
   * `tenantId` vem SEMPRE do principal, nunca de query string — não há como um cliente pedir a
   * lista de outro tenant. Sem `membershipRepository`/`userRepository` configurados (ex.:
   * `AUTH_MODE=noop`), responde uma lista vazia em vez de falhar.
   */
  app.get("/inbox/members", async (request) => {
    const principal = requirePermission(request, "inbox:assign");
    if (!deps.membershipRepository || !deps.userRepository) {
      return successEnvelope({ members: [] }, request.id);
    }
    const memberships = await deps.membershipRepository.listByTenant(principal.tenantId);
    const members = await Promise.all(
      memberships.map(async (membership) => {
        const user = await deps.userRepository!.getById(membership.userId);
        return { userId: membership.userId, email: user?.email ?? "(desconhecido)", name: user?.name ?? "(desconhecido)", role: membership.role };
      }),
    );
    return successEnvelope({ members }, request.id);
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

  /** Fase 4 — timeline de eventos operacionais ("Fulano assumiu o atendimento", "IA pausada"...),
   * consultada separadamente das mensagens; o frontend intercala as duas por `createdAt`. */
  app.get("/inbox/conversations/:id/events", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const events = await listConversationEvents(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
      return successEnvelope({ events }, request.id);
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
      publishConversationUpdated(deps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
      return successEnvelope({ read: true }, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  /** Atribuição DIRETA (supervisor definindo/removendo responsável) — nunca usada pelo fluxo
   * "assumir" (ver `/take-over`, que é atômico/CAS). */
  app.post("/inbox/conversations/:id/assign", { schema: { params: ID_PARAMS_SCHEMA, body: ASSIGN_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:assign");
    const { id } = request.params as { id: string };
    const { workspaceId, assignedUserId } = request.body as { workspaceId: string; assignedUserId?: string };
    try {
      if (assignedUserId) await assertUserBelongsToTenant(deps, assignedUserId, principal.tenantId);
      const conversation = await assignConversation(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, assignedUserId, performedBy: principal.userId });
      publishConversationUpdated(deps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
      return successEnvelope(conversation, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  /** "Assumir conversa" — atômico (compare-and-set), ver `takeOverConversation`. 409 quando outro
   * atendente já assumiu entre o carregamento da tela e o clique (concorrência real, não bug). */
  app.post("/inbox/conversations/:id/take-over", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:assign");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      const conversation = await takeOverConversation(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, userId: principal.userId });
      publishConversationUpdated(deps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
      return successEnvelope(conversation, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  /** Transferência — atômica (CAS no responsável atual), ver `transferConversation`. 409 quando a
   * conversa já não está mais com o responsável esperado. */
  app.post("/inbox/conversations/:id/transfer", { schema: { params: ID_PARAMS_SCHEMA, body: TRANSFER_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:assign");
    const { id } = request.params as { id: string };
    const { workspaceId, toUserId } = request.body as { workspaceId: string; toUserId: string };
    try {
      await assertUserBelongsToTenant(deps, toUserId, principal.tenantId);
      const conversation = await transferConversation(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, toUserId, performedBy: principal.userId });
      publishConversationUpdated(deps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
      return successEnvelope(conversation, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.post("/inbox/conversations/:id/close", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:assign");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      const conversation = await closeConversation(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, performedBy: principal.userId });
      publishConversationUpdated(deps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
      return successEnvelope(conversation, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.post("/inbox/conversations/:id/reopen", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:assign");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      const conversation = await reopenConversation(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, performedBy: principal.userId });
      publishConversationUpdated(deps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
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
      const conversation = await setAiConversationEnabled(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, aiEnabled, performedBy: principal.userId });
      publishConversationUpdated(deps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
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
