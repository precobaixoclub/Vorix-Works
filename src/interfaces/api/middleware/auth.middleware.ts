import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthPort } from "../../../application/ports/auth.port.js";
import type { AuthPrincipal } from "../../../domain/identity/identity.model.js";

/** Único caminho que ainda aceita autenticação por querystring — nunca mais `access_token`
 * genérico (ver Fase 10, Pre-Pilot Hardening do módulo Conversas). O `EventSource` nativo do
 * browser não seta headers customizados, então a rota de SSE da Inbox precisa de uma forma
 * alternativa de entregar o credential; a resposta agora é um token PRÓPRIO, de curtíssima duração
 * e escopo único (`purpose: "inbox_stream"`, emitido por `POST /v1/inbox/stream-token`), nunca o
 * access token normal de sessão. */
const INBOX_STREAM_ROUTE_PREFIX = "/v1/inbox/stream";

function isInboxStreamRoute(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return path === INBOX_STREAM_ROUTE_PREFIX || path.startsWith(`${INBOX_STREAM_ROUTE_PREFIX}?`);
}

/** Redesign operacional (mídia real) — mesmo racional do stream: `<img>`/`<audio>`/`<video>` não
 * enviam header `Authorization`, então `GET /v1/inbox/media/:id` também aceita credential via
 * querystring (`media_token`, `purpose: "inbox_media"`, emitido por `POST /v1/inbox/media-token`). */
const INBOX_MEDIA_ROUTE_PREFIX = "/v1/inbox/media/";

function inboxMediaRouteMessageId(url: string): string | undefined {
  const path = url.split("?")[0] ?? url;
  if (!path.startsWith(INBOX_MEDIA_ROUTE_PREFIX)) return undefined;
  return decodeURIComponent(path.slice(INBOX_MEDIA_ROUTE_PREFIX.length)) || undefined;
}

/** Fotos de grupo/contato (pedido explícito do usuário em produção) — mesmo racional de
 * `INBOX_MEDIA_ROUTE_PREFIX`: `<img>` não manda `Authorization`, então `GET
 * /v1/inbox/avatars/:kind/:id` também aceita credential via querystring (`avatar_token`, `purpose:
 * "inbox_avatar"`, emitido por `POST /v1/inbox/avatar-token`). */
const INBOX_AVATAR_ROUTE_PREFIX = "/v1/inbox/avatars/";

function inboxAvatarRouteTarget(url: string): { kind: "contact" | "conversation"; id: string } | undefined {
  const path = url.split("?")[0] ?? url;
  if (!path.startsWith(INBOX_AVATAR_ROUTE_PREFIX)) return undefined;
  const rest = path.slice(INBOX_AVATAR_ROUTE_PREFIX.length);
  const [kindRaw, idRaw] = rest.split("/");
  if ((kindRaw !== "contact" && kindRaw !== "conversation") || !idRaw) return undefined;
  const id = decodeURIComponent(idRaw);
  return id ? { kind: kindRaw, id } : undefined;
}

/**
 * Decide se um principal já verificado (assinatura/expiração OK) pode de fato autenticar ESTA
 * requisição, dado de onde o token veio. Extraído como função pura e exportado especificamente
 * para ser testado de forma direta (mesmo racional de `shouldDeliverInboxNotification` em
 * `inbox.route.ts`) — a decisão de authz aqui é pequena e crítica o bastante pra merecer teste
 * isolado, sem precisar montar uma app Fastify completa.
 *
 * Regras (as DUAS precisam valer):
 * 1. Um principal com `purpose === "inbox_stream"` só autentica a rota de stream, e só quando o
 *    token chegou pela querystring (`stream_token`) — nunca via header `Authorization`, mesmo que
 *    alguém tente reusá-lo lá.
 * 1b. Um principal com `purpose === "inbox_media"` só autentica `GET /v1/inbox/media/:id`, só via
 *     querystring (`media_token`), E só para o `:id` exato gravado no próprio token
 *     (`principal.messageId`) — um token minted para a mídia da mensagem A nunca autentica a
 *     mensagem B, mesmo dentro da janela de validade.
 * 1c. Um principal com `purpose === "inbox_avatar"` só autentica `GET
 *     /v1/inbox/avatars/:kind/:id`, só via querystring (`avatar_token`), E só para o `kind`+`id`
 *     exatos gravados no próprio token — mesmo racional de `inbox_media`, escopado a UM
 *     contato/conversa específico.
 * 2. Um principal SEM `purpose` (access token normal) só autentica quando chegou pelo header — a
 *    querystring nunca mais aceita o access token normal, em rota nenhuma.
 */
export function isPrincipalAuthorizedForRequest(
  principal: AuthPrincipal,
  context: {
    isStreamRoute: boolean;
    mediaRouteMessageId?: string;
    avatarRouteTarget?: { kind: "contact" | "conversation"; id: string };
    tokenSource: "header" | "query";
  },
): boolean {
  if (principal.purpose === "inbox_stream") return context.isStreamRoute && context.tokenSource === "query";
  if (principal.purpose === "inbox_media") {
    return context.tokenSource === "query" && context.mediaRouteMessageId !== undefined && principal.messageId === context.mediaRouteMessageId;
  }
  if (principal.purpose === "inbox_avatar") {
    return (
      context.tokenSource === "query" &&
      context.avatarRouteTarget !== undefined &&
      principal.avatarKind === context.avatarRouteTarget.kind &&
      principal.avatarTargetId === context.avatarRouteTarget.id
    );
  }
  return context.tokenSource === "header";
}

/**
 * Middleware de autenticação — lê o header `Authorization` (ou, só na rota de stream da Inbox, o
 * parâmetro `stream_token` da querystring), chama `AuthPort.verifyToken`, e anexa o resultado a
 * `request.zunoContext`. Continua nunca bloqueando sozinho (mesmo espírito da Sprint 02): quando a
 * verificação falha, só registra `authFailureReason` — quem decide se a rota exige autenticação, e
 * qual status/código devolver, é o handler da rota (`requirePrincipal`), nunca este middleware.
 */
export function registerAuthMiddleware(app: FastifyInstance, authPort: AuthPort): void {
  app.addHook("onRequest", async (request: FastifyRequest, _reply: FastifyReply) => {
    const header = request.headers.authorization;
    const headerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

    const isStreamRoute = isInboxStreamRoute(request.url);
    const mediaRouteMessageId = inboxMediaRouteMessageId(request.url);
    const avatarRouteTarget = inboxAvatarRouteTarget(request.url);
    const query = request.query as Record<string, unknown> | undefined;
    const streamQueryToken = isStreamRoute && typeof query?.stream_token === "string" ? query.stream_token : undefined;
    const mediaQueryToken = mediaRouteMessageId !== undefined && typeof query?.media_token === "string" ? query.media_token : undefined;
    const avatarQueryToken = avatarRouteTarget !== undefined && typeof query?.avatar_token === "string" ? query.avatar_token : undefined;

    const token = headerToken ?? streamQueryToken ?? mediaQueryToken ?? avatarQueryToken;
    const tokenSource: "header" | "query" = headerToken ? "header" : "query";

    const result = await authPort.verifyToken(token);
    if (!result.authenticated) {
      request.zunoContext.authFailureReason = result.reason;
      return;
    }

    // A restrição de escopo (header vs. querystring) só faz sentido quando um token de verdade foi
    // extraído — com `token === undefined`, não há "fonte" nenhuma pra restringir (ex.: dublês de
    // teste de `AuthPort` que autenticam sem token nenhum; um `JwtAuthAdapter` real já teria
    // recusado com "missing_token" antes de chegar aqui, então isto nunca acontece em produção).
    if (token !== undefined && !isPrincipalAuthorizedForRequest(result.principal, { isStreamRoute, mediaRouteMessageId, avatarRouteTarget, tokenSource })) {
      // Mesmo motivo de falha que "token inválido" pro chamador — nunca vazamos QUAL regra
      // específica de escopo barrou (ex.: "purpose errado"), só que a autenticação não vale aqui.
      request.zunoContext.authFailureReason = "invalid_token";
      return;
    }

    request.zunoContext.principal = result.principal;
    request.zunoContext.tenantId = result.principal.tenantId;
  });
}
