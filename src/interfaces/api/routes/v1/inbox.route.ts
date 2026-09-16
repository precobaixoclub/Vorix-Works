import type { FastifyInstance } from "fastify";
import type { JwtPort } from "../../../../application/ports/jwt.port.js";
import type { InboxContactRepositoryPort } from "../../../../application/ports/inbox-contact-repository.port.js";
import type { InboxConversationEventRepositoryPort } from "../../../../application/ports/inbox-conversation-event-repository.port.js";
import type { InboxConversationListFilter, InboxConversationRepositoryPort } from "../../../../application/ports/inbox-conversation-repository.port.js";
import type { InboxMediaStoragePort } from "../../../../application/ports/inbox-media-storage.port.js";
import type { InboxMessageRepositoryPort } from "../../../../application/ports/inbox-message-repository.port.js";
import type { MessagingConnectionRepositoryPort } from "../../../../application/ports/messaging-connection-repository.port.js";
import type { MessagingProvider } from "../../../../application/ports/messaging-provider.port.js";
import type { MessagingProviderId } from "../../../../domain/inbox/inbox.model.js";
import type { OutboundMessageQueuePort } from "../../../../application/ports/outbound-message-queue.port.js";
import type { TenantMembershipRepositoryPort } from "../../../../application/ports/tenant-membership-repository.port.js";
import type { UserRepositoryPort } from "../../../../application/ports/user-repository.port.js";
import type { WorkspaceRepositoryPort } from "../../../../application/ports/workspace-repository.port.js";
import type { InboxRealtimeSubscriber } from "../../../../infrastructure/messaging/rabbitmq/inbox-realtime-subscriber.js";
import type { ProductAnalyticsUseCaseDeps } from "../../../../application/product-analytics/product-analytics-use-cases.js";
import {
  assignConversation,
  closeConversation,
  createKanbanPhase,
  deleteConversation,
  deleteInboxMessage,
  deleteKanbanPhase,
  createConnection,
  disconnectConnection,
  ensureConversationPhaseStates,
  getChannelRouting,
  getConnectionQrCode,
  getConversationsServiceTime,
  listConnections,
  listConversationEvents,
  listConversationMessages,
  listConversations,
  listKanbanPhases,
  markConversationRead,
  markConversationUnread,
  moveConversationPhase,
  reactToInboxMessage,
  refreshConnectionStatus,
  reopenConversation,
  reorderKanbanPhases,
  sendInboxMediaMessage,
  sendInboxMessage,
  setAiConversationEnabled,
  setConversationPinned,
  setConversationTeam,
  setConversationUrgent,
  takeOverConversation,
  transferConversation,
  updateChannelRouting,
  updateKanbanPhase,
  type InboxUseCaseDeps,
} from "../../../../application/inbox/inbox-use-cases.js";
import type { ChannelRoutingRepositoryPort } from "../../../../application/ports/channel-routing-repository.port.js";
import type { TeamRepositoryPort, TeamMembershipRepositoryPort } from "../../../../application/ports/team-repository.port.js";
import type { TeamKanbanPhaseRepositoryPort } from "../../../../application/ports/team-kanban-phase-repository.port.js";
import type { ConversationTimeEntryRepositoryPort } from "../../../../application/ports/inbox-conversation-time-entry-repository.port.js";
import type { NotificationRepositoryPort } from "../../../../application/ports/notification-repository.port.js";
import type { NotificationRealtimePublisherPort } from "../../../../application/ports/notification-realtime-publisher.port.js";
import { AppError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/** Módulo Conversas (Fase 1/3/4) — inbox de WhatsApp via WuzAPI. Rotas montadas sob `/v1/inbox/*`,
 * só registradas quando `InboxFeatureFlags.enabled === true` (ver `routes/v1/index.ts`). */

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;
const WORKSPACE_BODY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const CREATE_CONNECTION_BODY_SCHEMA = { type: "object", required: ["workspaceId", "displayName"], properties: { workspaceId: { type: "string", minLength: 1 }, displayName: { type: "string", minLength: 1 } } } as const;
const SEND_MESSAGE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "body"],
  properties: { workspaceId: { type: "string", minLength: 1 }, body: { type: "string", minLength: 1 }, replyToMessageId: { type: "string", minLength: 1 } },
} as const;
const REACT_MESSAGE_BODY_SCHEMA = { type: "object", required: ["workspaceId", "emoji"], properties: { workspaceId: { type: "string", minLength: 1 }, emoji: { type: "string" } } } as const;
const MESSAGE_PARAMS_SCHEMA = { type: "object", required: ["id", "messageId"], properties: { id: { type: "string", minLength: 1 }, messageId: { type: "string", minLength: 1 } } } as const;
const ASSIGN_BODY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 }, assignedUserId: { type: "string" } } } as const;
const SET_TEAM_BODY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 }, teamId: { type: "string" } } } as const;
const TRANSFER_BODY_SCHEMA = { type: "object", required: ["workspaceId", "toUserId"], properties: { workspaceId: { type: "string", minLength: 1 }, toUserId: { type: "string", minLength: 1 } } } as const;
const AI_ENABLED_BODY_SCHEMA = { type: "object", required: ["workspaceId", "aiEnabled"], properties: { workspaceId: { type: "string", minLength: 1 }, aiEnabled: { type: "boolean" } } } as const;
const URGENT_BODY_SCHEMA = { type: "object", required: ["workspaceId", "isUrgent"], properties: { workspaceId: { type: "string", minLength: 1 }, isUrgent: { type: "boolean" } } } as const;
/** Bloco "roteamento por equipe" (réplica adaptada do CMDesk) — `teamIds` é sempre a lista
 * COMPLETA de equipes vinculadas (substituição total, nunca incremental). */
const CHANNEL_ROUTING_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "teamIds", "defaultTeamId", "distributionMode"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    teamIds: { type: "array", items: { type: "string", minLength: 1 } },
    defaultTeamId: { type: "string", minLength: 1 },
    distributionMode: { type: "string", enum: ["default", "round_robin"] },
  },
} as const;
// Bloco "kanban de atendimento" (réplica adaptada do CMDesk, pedido explícito do usuário).
const TEAM_ID_PARAMS_SCHEMA = { type: "object", required: ["teamId"], properties: { teamId: { type: "string", minLength: 1 } } } as const;
const TEAM_PHASE_PARAMS_SCHEMA = { type: "object", required: ["teamId", "phaseId"], properties: { teamId: { type: "string", minLength: 1 }, phaseId: { type: "string", minLength: 1 } } } as const;
const TEAM_CONVERSATION_PARAMS_SCHEMA = {
  type: "object",
  required: ["teamId", "conversationId"],
  properties: { teamId: { type: "string", minLength: 1 }, conversationId: { type: "string", minLength: 1 } },
} as const;
const CREATE_KANBAN_PHASE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "name"],
  properties: { workspaceId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1, maxLength: 100 }, phaseType: { type: "string", enum: ["RUNNING", "PAUSED"] } },
} as const;
const UPDATE_KANBAN_PHASE_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1, maxLength: 100 },
    isDefaultFirst: { type: "boolean" },
    phaseType: { type: "string", enum: ["RUNNING", "PAUSED"] },
    naoContabilizaOperacional: { type: "boolean" },
  },
} as const;
const REORDER_KANBAN_PHASES_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "phaseIds"],
  properties: { workspaceId: { type: "string", minLength: 1 }, phaseIds: { type: "array", items: { type: "string", minLength: 1 } } },
} as const;
const MOVE_CONVERSATION_PHASE_BODY_SCHEMA = { type: "object", required: ["workspaceId", "phaseId"], properties: { workspaceId: { type: "string", minLength: 1 }, phaseId: { type: "string", minLength: 1 } } } as const;
const PIN_CONVERSATION_BODY_SCHEMA = { type: "object", required: ["workspaceId", "pinned"], properties: { workspaceId: { type: "string", minLength: 1 }, pinned: { type: "boolean" } } } as const;
const KANBAN_CONVERSATION_IDS_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "conversationIds"],
  properties: { workspaceId: { type: "string", minLength: 1 }, conversationIds: { type: "string", minLength: 1 } },
} as const;
const CONVERSATIONS_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 }, filter: { type: "string", enum: ["all", "mine", "unassigned", "unread", "urgent", "open", "pending", "resolved"] } },
} as const;
const MESSAGES_QUERY_SCHEMA = {
  type: "object",
  required: ["workspaceId"],
  properties: { workspaceId: { type: "string", minLength: 1 }, cursor: { type: "string" }, limit: { type: "number" } },
} as const;
const MEDIA_TOKEN_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "messageId"],
  properties: { workspaceId: { type: "string", minLength: 1 }, messageId: { type: "string", minLength: 1 } },
} as const;
const AVATAR_TOKEN_BODY_SCHEMA = {
  type: "object",
  required: ["workspaceId", "kind", "targetId"],
  properties: {
    workspaceId: { type: "string", minLength: 1 },
    kind: { type: "string", enum: ["contact", "conversation"] },
    targetId: { type: "string", minLength: 1 },
  },
} as const;
const AVATAR_PARAMS_SCHEMA = {
  type: "object",
  required: ["kind", "id"],
  properties: { kind: { type: "string", enum: ["contact", "conversation"] }, id: { type: "string", minLength: 1 } },
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
  // Bloco "roteamento por equipe".
  INBOX_TEAM_ROUTING_NOT_CONFIGURED: 503,
  INBOX_DEFAULT_TEAM_NOT_LINKED: 422,
  // Bloco "kanban de atendimento".
  INBOX_KANBAN_NOT_CONFIGURED: 503,
  TEAM_NOT_FOUND: 404,
  KANBAN_PHASE_NOT_FOUND: 404,
  KANBAN_LAST_PHASE: 422,
  KANBAN_REORDER_MISMATCH: 422,
  KANBAN_CONVERSATION_NOT_IN_TEAM: 422,
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
  providers: { wuzapi: MessagingProvider } & Partial<Record<Exclude<MessagingProviderId, "wuzapi">, MessagingProvider>>;
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
  /** Trial + Product Analytics — integração MÍNIMA (`first_channel_connected`,
   * `first_conversation_received`, `first_conversation_replied`). */
  productAnalytics?: ProductAnalyticsUseCaseDeps;
  /** Fase 10 (Pre-Pilot Hardening) — emite o token de curta duração de `POST /inbox/stream-token`.
   * `undefined` só em setups sem identidade real (`AUTH_MODE=noop`/testes sem JWT) — nesse caso a
   * rota responde 503 em vez de tentar assinar algo sem chave. */
  jwtPort?: JwtPort;
  /** Redesign operacional (mídia real) — `undefined` só em setups sem `jwtPort`/storage
   * configurado; `GET /inbox/media/:messageId`/`POST /inbox/media-token` respondem 503 nesse
   * caso, nunca tentam servir algo sem as duas peças presentes. */
  inboxMediaStorage?: InboxMediaStoragePort;
  /** Bloco "Media Outbound" — mesmo limite de tamanho já usado pelo upload de mídia de publicação
   * (`MEDIA_UPLOAD_MAX_BYTES`, ver `publication-media.route.ts`) — nunca um limite próprio
   * duplicado; um valor de configuração, um lugar só. */
  maxUploadBytes: number;
  /** Bloco "roteamento por equipe" (réplica adaptada do CMDesk, pedido explícito do usuário) —
   * `undefined` = módulo de equipes não configurado neste processo; rotas de roteamento respondem
   * lista vazia / erro claro em vez de tentar operar sem repositório. */
  channelRoutingRepository?: ChannelRoutingRepositoryPort;
  teamRepository?: TeamRepositoryPort;
  teamMembershipRepository?: TeamMembershipRepositoryPort;
  /** Bloco "kanban de atendimento" (réplica adaptada do CMDesk, pedido explícito do usuário) —
   * `undefined` = módulo de kanban não configurado neste processo. */
  teamKanbanPhaseRepository?: TeamKanbanPhaseRepositoryPort;
  conversationTimeEntryRepository?: ConversationTimeEntryRepositoryPort;
  /** Central de notificações in-app (réplica adaptada do CMDesk, pedido explícito do usuário) —
   * `undefined` = notificação desligada neste processo. */
  notificationRepository?: NotificationRepositoryPort;
  notificationRealtimePublisher?: NotificationRealtimePublisherPort;
};

function toUseCaseDeps(deps: InboxRoutesDeps): InboxUseCaseDeps {
  return deps;
}

/**
 * Fase 7 — isolamento do SSE: extraído como função pura e exportada especificamente para ser
 * testada de forma direta e exaustiva (testar isto via uma conexão SSE real de verdade end-to-end
 * é frágil/lento; a lógica de decisão em si é só este predicado, e é ELE que precisa estar
 * comprovadamente correto). Um browser do workspace A NUNCA pode receber notificação — nem
 * metadata, nem contador, nem id — de outro tenant/workspace; isto é a ÚNICA barreira entre "todo
 * assinante recebe todo evento" (o fanout do RabbitMQ, Fase 3, é deliberadamente global) e
 * "cada assinante só vê o que é seu".
 */
export function shouldDeliverInboxNotification(notification: Record<string, unknown>, scope: { tenantId: string; workspaceId: string }): boolean {
  return notification.tenantId === scope.tenantId && notification.workspaceId === scope.workspaceId;
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

/** Fase 10 (Pre-Pilot Hardening) — 60s é o teto de tempo entre "mintar o token" e "o EventSource
 * abrir a conexão"; não precisa sobreviver além disso, e reconexões (`useInboxRealtime` no
 * frontend) sempre mintam um token novo, nunca reusam um velho. */
const STREAM_TOKEN_TTL_SECONDS = 60;
/** Redesign operacional (mídia real) — mesmo teto de 60s do `stream-token`: só precisa sobreviver
 * entre "mintar o token" e "o `<img>`/`<audio>`/`<video>` disparar o `GET`", nunca mais que isso. */
const MEDIA_TOKEN_TTL_SECONDS = 60;
/** Fotos de grupo/contato — mesmo teto de 60s dos outros tokens de curta duração acima. */
const AVATAR_TOKEN_TTL_SECONDS = 60;

export async function registerInboxRoutes(app: FastifyInstance, deps: InboxRoutesDeps): Promise<void> {
  const useCaseDeps = toUseCaseDeps(deps);

  /**
   * Fase 10 (Pre-Pilot Hardening) — emite o token de curtíssima duração e escopo único que
   * `GET /inbox/stream` passa a exigir via querystring. Autenticado normalmente (header
   * `Authorization`, como qualquer outra rota) — é ISSO que torna seguro: o access token de sessão
   * nunca aparece numa URL, só este token derivado, que não serve para mais nada além de abrir o
   * SSE, por no máximo `STREAM_TOKEN_TTL_SECONDS`.
   */
  app.post("/inbox/stream-token", async (request) => {
    const principal = requirePermission(request, "inbox:read");
    if (!deps.jwtPort) {
      throw new AppError({ code: "INBOX_STREAM_TOKEN_UNAVAILABLE", message: "Emissão de token de stream indisponível nesta configuração.", statusCode: 503, recoverable: true });
    }
    const streamToken = deps.jwtPort.sign(
      { userId: principal.userId, tenantId: principal.tenantId, role: principal.role, sessionId: principal.sessionId, isPlatformAdmin: principal.isPlatformAdmin, purpose: "inbox_stream" },
      STREAM_TOKEN_TTL_SECONDS,
    );
    return successEnvelope({ streamToken, expiresIn: STREAM_TOKEN_TTL_SECONDS }, request.id);
  });

  /**
   * Redesign operacional (mídia real) — mesmo racional do `stream-token`: `<img>`/`<audio>`/
   * `<video>` não enviam header `Authorization`, então o proxy de mídia (`GET /inbox/media/:id`
   * abaixo) precisa de credential via querystring. Escopado a UMA mensagem específica
   * (`messageId` no claim) — nunca autentica a mídia de outra mensagem, mesmo dentro da janela de
   * validade (ver `isPrincipalAuthorizedForRequest`, `auth.middleware.ts`).
   */
  app.post("/inbox/media-token", { schema: { body: MEDIA_TOKEN_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:read");
    const { workspaceId, messageId } = request.body as { workspaceId: string; messageId: string };
    if (!deps.jwtPort) {
      throw new AppError({ code: "INBOX_MEDIA_TOKEN_UNAVAILABLE", message: "Emissão de token de mídia indisponível nesta configuração.", statusCode: 503, recoverable: true });
    }
    // Nunca vaza existência entre tenants — mensagem inexistente E mensagem de outro
    // tenant/workspace respondem exatamente o mesmo 404.
    const message = await deps.messageRepository.getById(messageId);
    if (!message || message.tenantId !== principal.tenantId || message.workspaceId !== workspaceId) {
      throw new AppError({ code: "INBOX_MESSAGE_NOT_FOUND", message: `Mensagem "${messageId}" não existe.`, statusCode: 404, recoverable: true });
    }
    const mediaToken = deps.jwtPort.sign(
      { userId: principal.userId, tenantId: principal.tenantId, role: principal.role, sessionId: principal.sessionId, isPlatformAdmin: principal.isPlatformAdmin, purpose: "inbox_media", messageId },
      MEDIA_TOKEN_TTL_SECONDS,
    );
    return successEnvelope({ mediaToken, expiresIn: MEDIA_TOKEN_TTL_SECONDS }, request.id);
  });

  /**
   * Proxy autenticado de mídia de conversas — nunca expõe a URL/token do WuzAPI nem uma URL
   * assinada de storage diretamente ao navegador; os bytes sempre passam por aqui. Credential via
   * `?media_token=` (ver rota acima) OU o header `Authorization` normal (uso direto/testes) — o
   * middleware já garante que um `media_token` só autentica o `:id` exato gravado nele.
   */
  app.get("/inbox/media/:id", { schema: { params: ID_PARAMS_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "inbox:read");
    const { id } = request.params as { id: string };
    if (!deps.inboxMediaStorage) {
      throw new AppError({ code: "INBOX_MEDIA_STORAGE_UNAVAILABLE", message: "Mídia de conversas não configurada neste ambiente.", statusCode: 503, recoverable: true });
    }
    const message = await deps.messageRepository.getById(id);
    if (!message || message.tenantId !== principal.tenantId || !message.mediaStorageRef) {
      throw new AppError({ code: "INBOX_MEDIA_NOT_FOUND", message: "Mídia não encontrada.", statusCode: 404, recoverable: true });
    }
    const stored = await deps.inboxMediaStorage.get(message.mediaStorageRef.objectKey);
    if (!stored) {
      throw new AppError({ code: "INBOX_MEDIA_NOT_FOUND", message: "Mídia não encontrada.", statusCode: 404, recoverable: true });
    }
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    reply.header("Accept-Ranges", "bytes");
    reply.type(message.mimeType ?? stored.contentType);
    const fileName = (message.metadata as { fileName?: string } | undefined)?.fileName;
    // `inline` pra tipos que o browser sabe renderizar direto (imagem/áudio/vídeo — nunca forçar
    // download); `attachment` só pra documento, com o nome real do arquivo quando conhecido (seção
    // 20/27 do pedido original — nunca só "Documento recebido").
    reply.header("Content-Disposition", message.type === "document" ? `attachment; filename="${sanitizeContentDispositionFileName(fileName ?? "documento")}"` : "inline");

    // Suporte a HTTP Range (seções 18/19/27 do pedido original) — essencial pra seek de áudio/
    // vídeo no player nativo do browser; sem isso, `<audio>`/`<video>` não sabem pular pra um ponto
    // do arquivo sem rebaixar tudo de novo. Range em memória (nunca stream do disco/storage aqui —
    // aceitável pro tamanho de mídia de WhatsApp, limitado por `maxUploadBytes`).
    const range = parseRangeHeader(request.headers.range, stored.body.length);
    if (range) {
      reply.status(206);
      reply.header("Content-Range", `bytes ${range.start}-${range.end}/${stored.body.length}`);
      reply.header("Content-Length", String(range.end - range.start + 1));
      return reply.send(stored.body.subarray(range.start, range.end + 1));
    }
    reply.header("Content-Length", String(stored.body.length));
    return reply.send(stored.body);
  });

  /**
   * Fotos de grupo/contato (pedido explícito do usuário em produção, "ajustar para carregar as
   * fotos dos grupos e conversas") — mesmo racional do `media-token` acima. Escopado a UM
   * contato/conversa específico (`avatarKind`+`avatarTargetId` no claim).
   */
  app.post("/inbox/avatar-token", { schema: { body: AVATAR_TOKEN_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:read");
    const { workspaceId, kind, targetId } = request.body as { workspaceId: string; kind: "contact" | "conversation"; targetId: string };
    if (!deps.jwtPort) {
      throw new AppError({ code: "INBOX_AVATAR_TOKEN_UNAVAILABLE", message: "Emissão de token de foto indisponível nesta configuração.", statusCode: 503, recoverable: true });
    }
    // Nunca vaza existência entre tenants — alvo inexistente E alvo de outro tenant/workspace
    // respondem exatamente o mesmo 404, mesmo racional de `media-token`.
    const exists =
      kind === "contact"
        ? await deps.contactRepository.getById(targetId)
        : await deps.conversationRepository.getById(targetId);
    if (!exists || exists.tenantId !== principal.tenantId || exists.workspaceId !== workspaceId) {
      throw new AppError({ code: "INBOX_AVATAR_TARGET_NOT_FOUND", message: `${kind === "contact" ? "Contato" : "Conversa"} "${targetId}" não existe.`, statusCode: 404, recoverable: true });
    }
    const avatarToken = deps.jwtPort.sign(
      { userId: principal.userId, tenantId: principal.tenantId, role: principal.role, sessionId: principal.sessionId, isPlatformAdmin: principal.isPlatformAdmin, purpose: "inbox_avatar", avatarKind: kind, avatarTargetId: targetId },
      AVATAR_TOKEN_TTL_SECONDS,
    );
    return successEnvelope({ avatarToken, expiresIn: AVATAR_TOKEN_TTL_SECONDS }, request.id);
  });

  /**
   * Proxy autenticado de foto de perfil/grupo — mesmo racional do proxy de mídia: nunca expõe a
   * URL do WuzAPI/WhatsApp diretamente ao navegador. Credential via `?avatar_token=` (rota acima)
   * OU o header `Authorization` normal — o middleware já garante que um `avatar_token` só autentica
   * o `kind`+`id` exatos gravados nele.
   */
  app.get("/inbox/avatars/:kind/:id", { schema: { params: AVATAR_PARAMS_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "inbox:read");
    const { kind, id } = request.params as { kind: "contact" | "conversation"; id: string };
    if (!deps.inboxMediaStorage) {
      throw new AppError({ code: "INBOX_MEDIA_STORAGE_UNAVAILABLE", message: "Mídia de conversas não configurada neste ambiente.", statusCode: 503, recoverable: true });
    }
    const storageRef =
      kind === "contact"
        ? await (async () => {
            const contact = await deps.contactRepository.getById(id);
            return contact && contact.tenantId === principal.tenantId ? contact.profilePictureStorageRef : undefined;
          })()
        : await (async () => {
            const conversation = await deps.conversationRepository.getById(id);
            return conversation && conversation.tenantId === principal.tenantId ? conversation.groupPictureStorageRef : undefined;
          })();
    if (!storageRef) {
      throw new AppError({ code: "INBOX_AVATAR_NOT_FOUND", message: "Foto não encontrada.", statusCode: 404, recoverable: true });
    }
    const stored = await deps.inboxMediaStorage.get(storageRef.objectKey);
    if (!stored) {
      throw new AppError({ code: "INBOX_AVATAR_NOT_FOUND", message: "Foto não encontrada.", statusCode: 404, recoverable: true });
    }
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    reply.type(stored.contentType);
    reply.header("Content-Length", String(stored.body.length));
    return reply.send(stored.body);
  });

  /**
   * SSE (Fase 3/4) — atualização em tempo real da Inbox. Alimentada tanto pelo `vorix-worker`
   * (mensagens/status/conexão) quanto por ESTAS rotas diretamente (ações operacionais da Fase 4:
   * atribuir/assumir/transferir/finalizar/reabrir/pausar IA), via `InboxRealtimeSubscriber`. Nunca
   * é a fonte de verdade — só um gatilho pra revalidar mais rápido; o frontend mantém um polling de
   * fallback bem mais espaçado. `EventSource` do browser não seta headers customizados, por isso o
   * credential aqui chega via `?stream_token=` (Fase 10 — token próprio de curta duração/escopo
   * único, ver `POST /inbox/stream-token` acima e `auth.middleware.ts`), nunca o access token
   * normal de sessão.
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
      if (!shouldDeliverInboxNotification(notification, { tenantId: principal.tenantId, workspaceId })) return;
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
    // Fase 6 (Omnichannel) — o frontend usa isto para decidir se mostra o fluxo de QR/pareamento
    // (só faz sentido pra um canal com `supportsQrConnect`), sem precisar hardcoded conhecer que
    // "o" provider hoje é WuzAPI. Instagram virou canal de primeira classe (pedido explícito do
    // usuário), mas `POST /inbox/connections` (abaixo) só cria conexões WuzAPI — conexões
    // Instagram nascem sozinhas via OAuth de publicação + primeiro webhook, nunca por este fluxo
    // de criação manual — por isso esta resposta segue descrevendo especificamente o WuzAPI.
    return successEnvelope({ connections, providerId: deps.providers.wuzapi.providerId, providerCapabilities: deps.providers.wuzapi.capabilities }, request.id);
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

  /** Bloco "roteamento por equipe" (réplica adaptada do CMDesk, pedido explícito do usuário) —
   * equipes vinculadas ao canal + config de distribuição (padrão fixo vs. rodízio entre elas). */
  app.get("/inbox/connections/:id/routing", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:manage_connections");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const routing = await getChannelRouting(useCaseDeps, { tenantId: principal.tenantId, workspaceId, connectionId: id });
      return successEnvelope(routing, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.put("/inbox/connections/:id/routing", { schema: { params: ID_PARAMS_SCHEMA, body: CHANNEL_ROUTING_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:manage_connections");
    const { id } = request.params as { id: string };
    const { workspaceId, teamIds, defaultTeamId, distributionMode } = request.body as {
      workspaceId: string; teamIds: string[]; defaultTeamId: string; distributionMode: "default" | "round_robin";
    };
    try {
      const routing = await updateChannelRouting(useCaseDeps, { tenantId: principal.tenantId, workspaceId, connectionId: id, teamIds, defaultTeamId, distributionMode });
      return successEnvelope(routing, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  // ==========================================================================================
  // Bloco "kanban de atendimento" (réplica adaptada do CMDesk, pedido explícito do usuário) —
  // quadro estilo Trello POR EQUIPE. Listar fases/mover card/fixar são liberados pra qualquer
  // membro autenticado com `inbox:reply` (uso operacional do dia a dia, mesmo degrau de "responder
  // conversa"); criar/editar/excluir/reordenar fase (configurar as COLUNAS do quadro) usa
  // `inbox:assign` (mesmo degrau de supervisor já usado por take-over/transferência).
  // ==========================================================================================

  app.get("/inbox/teams/:teamId/kanban-phases", { schema: { params: TEAM_ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:reply");
    const { teamId } = request.params as { teamId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      const phases = await listKanbanPhases(useCaseDeps, { teamId, tenantId: principal.tenantId, workspaceId });
      return successEnvelope({ phases }, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.post("/inbox/teams/:teamId/kanban-phases", { schema: { params: TEAM_ID_PARAMS_SCHEMA, body: CREATE_KANBAN_PHASE_BODY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "inbox:assign");
    const { teamId } = request.params as { teamId: string };
    const { workspaceId, name, phaseType } = request.body as { workspaceId: string; name: string; phaseType?: "RUNNING" | "PAUSED" };
    try {
      const phase = await createKanbanPhase(useCaseDeps, { teamId, tenantId: principal.tenantId, workspaceId, name, phaseType });
      reply.status(201);
      return successEnvelope(phase, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.patch("/inbox/teams/:teamId/kanban-phases/:phaseId", { schema: { params: TEAM_PHASE_PARAMS_SCHEMA, body: UPDATE_KANBAN_PHASE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:assign");
    const { teamId, phaseId } = request.params as { teamId: string; phaseId: string };
    const { workspaceId, name, isDefaultFirst, phaseType, naoContabilizaOperacional } = request.body as {
      workspaceId: string; name?: string; isDefaultFirst?: boolean; phaseType?: "RUNNING" | "PAUSED"; naoContabilizaOperacional?: boolean;
    };
    try {
      const phase = await updateKanbanPhase(useCaseDeps, { teamId, phaseId, tenantId: principal.tenantId, workspaceId, name, isDefaultFirst, phaseType, naoContabilizaOperacional });
      return successEnvelope(phase, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.delete("/inbox/teams/:teamId/kanban-phases/:phaseId", { schema: { params: TEAM_PHASE_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:assign");
    const { teamId, phaseId } = request.params as { teamId: string; phaseId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      await deleteKanbanPhase(useCaseDeps, { teamId, phaseId, tenantId: principal.tenantId, workspaceId });
      return successEnvelope({ deleted: true }, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.post("/inbox/teams/:teamId/kanban-phases/reorder", { schema: { params: TEAM_ID_PARAMS_SCHEMA, body: REORDER_KANBAN_PHASES_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:assign");
    const { teamId } = request.params as { teamId: string };
    const { workspaceId, phaseIds } = request.body as { workspaceId: string; phaseIds: string[] };
    try {
      const phases = await reorderKanbanPhases(useCaseDeps, { teamId, tenantId: principal.tenantId, workspaceId, phaseIds });
      return successEnvelope({ phases }, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  /** Board carregando conversas sem `currentPhaseId` ainda (conversa nova, ou primeira vez que o
   * quadro desta equipe é aberto) — cria o estado na fase padrão, idempotente (seção 4.3 do guia
   * do usuário). O frontend chama isto ANTES de renderizar o board. */
  app.post("/inbox/teams/:teamId/conversations/ensure-phase-states", { schema: { params: TEAM_ID_PARAMS_SCHEMA, body: { type: "object", required: ["workspaceId", "conversationIds"], properties: { workspaceId: { type: "string", minLength: 1 }, conversationIds: { type: "array", items: { type: "string", minLength: 1 } } } } } }, async (request) => {
    const principal = requirePermission(request, "inbox:reply");
    const { teamId } = request.params as { teamId: string };
    const { workspaceId, conversationIds } = request.body as { workspaceId: string; conversationIds: string[] };
    try {
      await ensureConversationPhaseStates(useCaseDeps, { teamId, tenantId: principal.tenantId, workspaceId, conversationIds });
      return successEnvelope({ ensured: true }, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.get("/inbox/teams/:teamId/conversations/service-time", { schema: { params: TEAM_ID_PARAMS_SCHEMA, querystring: KANBAN_CONVERSATION_IDS_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:reply");
    const { teamId } = request.params as { teamId: string };
    const { workspaceId, conversationIds } = request.query as { workspaceId: string; conversationIds: string };
    try {
      const serviceTime = await getConversationsServiceTime(useCaseDeps, { teamId, tenantId: principal.tenantId, workspaceId, conversationIds: conversationIds.split(",").filter(Boolean) });
      return successEnvelope({ serviceTime }, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.patch("/inbox/teams/:teamId/conversations/:conversationId/phase", { schema: { params: TEAM_CONVERSATION_PARAMS_SCHEMA, body: MOVE_CONVERSATION_PHASE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:reply");
    const { teamId, conversationId } = request.params as { teamId: string; conversationId: string };
    const { workspaceId, phaseId } = request.body as { workspaceId: string; phaseId: string };
    try {
      const conversation = await moveConversationPhase(useCaseDeps, { teamId, conversationId, tenantId: principal.tenantId, workspaceId, phaseId, performedBy: principal.userId });
      publishConversationUpdated(deps, { tenantId: principal.tenantId, workspaceId, conversationId });
      return successEnvelope(conversation, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  app.patch("/inbox/teams/:teamId/conversations/:conversationId/pin", { schema: { params: TEAM_CONVERSATION_PARAMS_SCHEMA, body: PIN_CONVERSATION_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:reply");
    const { conversationId } = request.params as { teamId: string; conversationId: string };
    const { workspaceId, pinned } = request.body as { workspaceId: string; pinned: boolean };
    try {
      const conversation = await setConversationPinned(useCaseDeps, { conversationId, tenantId: principal.tenantId, workspaceId, pinned });
      publishConversationUpdated(deps, { tenantId: principal.tenantId, workspaceId, conversationId });
      return successEnvelope(conversation, request.id);
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

  /** Bloco "ler/não lida" (pedido explícito do usuário em produção) — força de volta pra "não
   * lida" sem esperar mensagem nova, direto na listagem (ver `ConversationListItem`, frontend). */
  app.post("/inbox/conversations/:id/unread", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:reply");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      await markConversationUnread(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
      publishConversationUpdated(deps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
      return successEnvelope({ read: false }, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  /** Bloco "urgente" (pedido explícito do usuário em produção) — marcação manual, liga/desliga. */
  app.post("/inbox/conversations/:id/urgent", { schema: { params: ID_PARAMS_SCHEMA, body: URGENT_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:reply");
    const { id } = request.params as { id: string };
    const { workspaceId, isUrgent } = request.body as { workspaceId: string; isUrgent: boolean };
    try {
      const conversation = await setConversationUrgent(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, isUrgent });
      publishConversationUpdated(deps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
      return successEnvelope(conversation, request.id);
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

  /** Atribuição manual de equipe (achado de suporte: "por que as conversas não carregam no
   * Kanban" — sem isto, `currentTeamId` só era setado pelo roteamento automático de canal em
   * conversas NOVAS; sem essa configuração, ou pra qualquer conversa já existente, não havia
   * nenhum jeito de colocar uma conversa numa equipe). `teamId` ausente/vazio tira a conversa de
   * qualquer equipe (some do quadro Kanban de novo). */
  app.post("/inbox/conversations/:id/team", { schema: { params: ID_PARAMS_SCHEMA, body: SET_TEAM_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:assign");
    const { id } = request.params as { id: string };
    const { workspaceId, teamId } = request.body as { workspaceId: string; teamId?: string };
    try {
      const conversation = await setConversationTeam(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, teamId: teamId || undefined, performedBy: principal.userId });
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

  /** Exclusão PERMANENTE — nunca a mesma coisa que "fechar"/"arquivar" (`close`/`reopen` acima,
   * reversíveis). Degrau administrativo (`inbox:delete_conversations`, só owner/admin) porque
   * mensagens/eventos cascateiam junto e não há como desfazer. */
  app.delete("/inbox/conversations/:id", { schema: { params: ID_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:delete_conversations");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      await deleteConversation(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
      publishConversationUpdated(deps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
      return successEnvelope({ deleted: true }, request.id);
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
    const { workspaceId, body, replyToMessageId } = request.body as { workspaceId: string; body: string; replyToMessageId?: string };
    try {
      const message = await sendInboxMessage(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, body, sentByUserId: principal.userId, replyToMessageId });
      reply.status(202);
      return successEnvelope(message, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  /** Bloco "excluir mensagem" (pedido explícito do usuário em produção) — permanente, ver
   * `deleteInboxMessage`. Mesmo degrau de permissão de responder (nunca `inbox:delete_conversations`
   * — excluir UMA mensagem é uma ação operacional do dia a dia, não administrativa como excluir a
   * conversa inteira). */
  app.delete("/inbox/conversations/:id/messages/:messageId", { schema: { params: MESSAGE_PARAMS_SCHEMA, querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:reply");
    const { id, messageId } = request.params as { id: string; messageId: string };
    const { workspaceId } = request.query as { workspaceId: string };
    try {
      await deleteInboxMessage(useCaseDeps, { tenantId: principal.tenantId, workspaceId, conversationId: id, messageId });
      publishConversationUpdated(deps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
      return successEnvelope({ deleted: true }, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  /** Bloco "reagir a uma mensagem" (pedido explícito do usuário em produção) — o atendente
   * reagindo de dentro do Vorix, ver `reactToInboxMessage`. `emoji: ""` remove a reação já
   * mandada. */
  app.post("/inbox/conversations/:id/messages/:messageId/react", { schema: { params: MESSAGE_PARAMS_SCHEMA, body: REACT_MESSAGE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "inbox:reply");
    const { id, messageId } = request.params as { id: string; messageId: string };
    const { workspaceId, emoji } = request.body as { workspaceId: string; emoji: string };
    try {
      // Nome real do atendente no badge de reação (tooltip) — `undefined` quando o repositório não
      // está configurado neste ambiente (ex.: `AUTH_MODE=noop`), mesmo fallback de `/inbox/members`.
      const reactorUser = deps.userRepository ? await deps.userRepository.getById(principal.userId) : undefined;
      const message = await reactToInboxMessage(useCaseDeps, {
        tenantId: principal.tenantId, workspaceId, conversationId: id, messageId, emoji,
        reactorId: principal.userId, reactorName: reactorUser?.name,
      });
      publishConversationUpdated(deps, { tenantId: principal.tenantId, workspaceId, conversationId: id });
      return successEnvelope(message, request.id);
    } catch (error) {
      rethrowInboxError(error);
    }
  });

  // Bloco "Media Outbound" (ver docs/conversas-whatsapp-experience-completion.md) — imagem/áudio/
  // vídeo/documento pelo composer. Multipart (mesmo padrão de `publication-media.route.ts`) —
  // `workspaceId`/`caption` chegam como campos de formulário ao lado do arquivo, nunca querystring
  // (evita vazar em logs de acesso, mesmo racional do upload de publicação).
  app.post("/inbox/conversations/:id/media", { schema: { params: ID_PARAMS_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "inbox:reply");
    const { id } = request.params as { id: string };
    if (!deps.inboxMediaStorage) {
      throw new AppError({ code: "INBOX_MEDIA_STORAGE_UNAVAILABLE", message: "Envio de mídia não configurado neste ambiente.", statusCode: 503, recoverable: true });
    }
    try {
      const file = await request.file({ limits: { fileSize: deps.maxUploadBytes } });
      if (!file) throw new Error("INBOX_MEDIA_UPLOAD_FILE_MISSING: envie o arquivo no campo multipart.");
      const workspaceId = (file.fields.workspaceId as { value?: string } | undefined)?.value;
      if (!workspaceId) throw new Error("INBOX_MEDIA_UPLOAD_WORKSPACE_MISSING: campo workspaceId é obrigatório.");
      const caption = (file.fields.caption as { value?: string } | undefined)?.value?.trim() || undefined;
      const fileName = (file.fields.fileName as { value?: string } | undefined)?.value || file.filename;

      const type = classifyOutboundMediaMime(file.mimetype);
      if (!type) {
        throw new Error(`INBOX_MEDIA_UPLOAD_TYPE_UNSUPPORTED: tipo "${file.mimetype}" não é aceito.`);
      }

      const buffer = await file.toBuffer().catch((cause: unknown) => {
        if (cause instanceof Error && cause.message.includes("File size limit")) {
          throw new Error(`INBOX_MEDIA_UPLOAD_TOO_LARGE: arquivo maior que o limite de ${Math.floor(deps.maxUploadBytes / 1_000_000)}MB.`);
        }
        throw cause;
      });
      if (file.file.truncated) {
        throw new Error(`INBOX_MEDIA_UPLOAD_TOO_LARGE: arquivo maior que o limite de ${Math.floor(deps.maxUploadBytes / 1_000_000)}MB.`);
      }

      const message = await sendInboxMediaMessage(useCaseDeps, {
        tenantId: principal.tenantId, workspaceId, conversationId: id, sentByUserId: principal.userId,
        type, body: buffer, mimeType: file.mimetype, fileName, caption,
      });
      reply.status(202);
      return successEnvelope(message, request.id);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("INBOX_MEDIA_UPLOAD_")) {
        const [code, ...rest] = error.message.split(": ");
        throw new AppError({ code, message: rest.join(": ") || error.message, statusCode: 422, recoverable: true });
      }
      rethrowInboxError(error);
    }
  });
}

/** Classifica o mimetype do upload em um `InboxMessage["type"]` de mídia, ou `undefined` se não
 * suportado. Imagem/áudio/vídeo restritos a um allowlist seguro (mesmo racional de
 * `publication-media.route.ts`); documento aceita um allowlist mais amplo de tipos de escritório
 * comuns — nunca um executável/script (`.exe`/`.sh`/etc — fora do allowlist, rejeitado). */
function classifyOutboundMediaMime(mimeType: string): "image" | "audio" | "video" | "document" | undefined {
  const IMAGE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const AUDIO = new Set(["audio/ogg", "audio/mpeg", "audio/mp4", "audio/webm", "audio/aac", "audio/wav", "audio/x-wav", "audio/opus"]);
  const VIDEO = new Set(["video/mp4", "video/quicktime", "video/webm"]);
  const DOCUMENT = new Set([
    "application/pdf", "text/plain", "application/zip",
    "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ]);
  if (IMAGE.has(mimeType)) return "image";
  if (AUDIO.has(mimeType)) return "audio";
  if (VIDEO.has(mimeType)) return "video";
  if (DOCUMENT.has(mimeType)) return "document";
  return undefined;
}

/** `Range: bytes=start-end` (RFC 7233, forma simples de UM range — nunca multipart/byteranges,
 * que nenhum player de mídia usado aqui pede) — `undefined` = sem range pedido, ou range inválido
 * (nesse caso o chamador cai pro corpo inteiro, nunca lança). */
export function parseRangeHeader(rangeHeader: string | undefined, totalLength: number): { start: number; end: number } | undefined {
  if (!rangeHeader) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return undefined;
  const [, startRaw, endRaw] = match;
  let start = startRaw ? Number(startRaw) : undefined;
  let end = endRaw ? Number(endRaw) : undefined;
  if (start === undefined && end === undefined) return undefined;
  if (start === undefined) {
    // `bytes=-500` = últimos 500 bytes.
    start = Math.max(totalLength - (end ?? 0), 0);
    end = totalLength - 1;
  } else if (end === undefined) {
    end = totalLength - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= totalLength || start > end) return undefined;
  return { start, end };
}

/** Nunca usa o `fileName` do usuário direto num header HTTP — remove aspas/controle que
 * quebrariam o parsing de `Content-Disposition` do browser (nunca path traversal aqui, isto é só
 * um header de exibição, o `objectKey` no storage já é gerado pelo servidor). */
export function sanitizeContentDispositionFileName(fileName: string): string {
  return fileName.replace(/["\r\n]/g, "").slice(0, 200) || "documento";
}
