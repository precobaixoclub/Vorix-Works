import type { FastifyInstance } from "fastify";
import type { JwtPort } from "../../../../application/ports/jwt.port.js";
import type { NotificationRepositoryPort } from "../../../../application/ports/notification-repository.port.js";
import type { NotificationRealtimePublisherPort } from "../../../../application/ports/notification-realtime-publisher.port.js";
import { dismissAllNotifications, dismissNotification, listActiveNotifications, listNotificationHistory, type NotificationUseCaseDeps } from "../../../../application/notification/notification-use-cases.js";
import { notificationEventBus } from "../../../../infrastructure/realtime/notification-event-bus.js";
import { AppError } from "../../http/app-error.js";
import { requirePermission } from "../../http/require-principal.js";
import { successEnvelope } from "../../http/response-envelope.js";

/**
 * Central de notificações in-app ("sino", réplica adaptada do CMDesk, pedido explícito do
 * usuário). Contexto fino: SEMPRE registrada (nunca atrás de um kill switch de módulo, ao
 * contrário de `/v1/inbox/*`) — é usada por qualquer workspace, independente de quais outros
 * módulos estão ligados. Todo destinatário é sempre o PRÓPRIO usuário autenticado
 * (`principal.userId`) — nunca um `userId` vindo do corpo/querystring da requisição, então não há
 * risco de um usuário ler/dispensar notificação de outro mesmo dentro do mesmo tenant.
 */
export type NotificationRoutesDeps = {
  notificationRepository: NotificationRepositoryPort;
  realtimePublisher?: NotificationRealtimePublisherPort;
  jwtPort?: JwtPort;
};

const WORKSPACE_QUERY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const WORKSPACE_BODY_SCHEMA = { type: "object", required: ["workspaceId"], properties: { workspaceId: { type: "string", minLength: 1 } } } as const;
const ID_PARAMS_SCHEMA = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 } } } as const;

const STREAM_TOKEN_TTL_SECONDS = 60;

function shouldDeliverNotification(notification: Record<string, unknown>, scope: { tenantId: string; workspaceId: string; userId: string }): boolean {
  return notification.tenantId === scope.tenantId && notification.workspaceId === scope.workspaceId && notification.userId === scope.userId;
}

export async function registerNotificationRoutes(app: FastifyInstance, deps: NotificationRoutesDeps): Promise<void> {
  const useCaseDeps: NotificationUseCaseDeps = { notificationRepository: deps.notificationRepository, realtimePublisher: deps.realtimePublisher };

  /** Mesmo racional exato de `POST /inbox/stream-token` — `EventSource` não seta `Authorization`,
   * então o credential do SSE do sino chega via querystring, num token próprio de curtíssima
   * duração/escopo único (`purpose: "notification_stream"`). */
  app.post("/notifications/stream-token", async (request) => {
    const principal = requirePermission(request, "workspace:read");
    if (!deps.jwtPort) {
      throw new AppError({ code: "NOTIFICATION_STREAM_TOKEN_UNAVAILABLE", message: "Emissão de token de stream indisponível nesta configuração.", statusCode: 503, recoverable: true });
    }
    const streamToken = deps.jwtPort.sign(
      { userId: principal.userId, tenantId: principal.tenantId, role: principal.role, sessionId: principal.sessionId, isPlatformAdmin: principal.isPlatformAdmin, purpose: "notification_stream" },
      STREAM_TOKEN_TTL_SECONDS,
    );
    return successEnvelope({ streamToken, expiresIn: STREAM_TOKEN_TTL_SECONDS }, request.id);
  });

  /** SSE — nunca a fonte de verdade, só revalida o polling REST do frontend mais rápido (mesmo
   * racional de `GET /inbox/stream`). Sem RabbitMQ (ver `notification-event-bus.ts`): entre
   * réplicas de `zuno-api`, uma notificação criada numa réplica só chega em tempo real a quem
   * estiver conectado NAQUELA réplica — trade-off aceito e documentado, o polling de 60s do
   * frontend garante consistência eventual em qualquer cenário. */
  app.get("/notifications/stream", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request, reply) => {
    const principal = requirePermission(request, "workspace:read");
    const { workspaceId } = request.query as { workspaceId: string };

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");

    const listener = (notification: Record<string, unknown>) => {
      if (!shouldDeliverNotification(notification, { tenantId: principal.tenantId, workspaceId, userId: principal.userId })) return;
      reply.raw.write(`event: notification.new\ndata: ${JSON.stringify(notification)}\n\n`);
    };
    notificationEventBus.on("notification", listener);

    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 20_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      notificationEventBus.off("notification", listener);
    });
  });

  app.get("/notifications", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const notifications = await listActiveNotifications(useCaseDeps, { tenantId: principal.tenantId, workspaceId, userId: principal.userId });
    return successEnvelope({ notifications }, request.id);
  });

  app.get("/notifications/history", { schema: { querystring: WORKSPACE_QUERY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:read");
    const { workspaceId } = request.query as { workspaceId: string };
    const notifications = await listNotificationHistory(useCaseDeps, { tenantId: principal.tenantId, workspaceId, userId: principal.userId });
    return successEnvelope({ notifications }, request.id);
  });

  app.post("/notifications/dismiss-all", { schema: { body: WORKSPACE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:read");
    const { workspaceId } = request.body as { workspaceId: string };
    const result = await dismissAllNotifications(useCaseDeps, { tenantId: principal.tenantId, workspaceId, userId: principal.userId });
    return successEnvelope(result, request.id);
  });

  app.post("/notifications/:id/dismiss", { schema: { params: ID_PARAMS_SCHEMA, body: WORKSPACE_BODY_SCHEMA } }, async (request) => {
    const principal = requirePermission(request, "workspace:read");
    const { id } = request.params as { id: string };
    const { workspaceId } = request.body as { workspaceId: string };
    try {
      const notification = await dismissNotification(useCaseDeps, { tenantId: principal.tenantId, workspaceId, userId: principal.userId, id });
      return successEnvelope(notification, request.id);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("NOTIFICATION_NOT_FOUND")) {
        throw new AppError({ code: "NOTIFICATION_NOT_FOUND", message: error.message, statusCode: 404, recoverable: true });
      }
      throw error;
    }
  });
}
