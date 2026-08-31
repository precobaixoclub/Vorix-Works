import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthPort } from "../../../application/ports/auth.port.js";

/**
 * Middleware de autenticação — lê o header `Authorization`, chama `AuthPort.verifyToken`, e
 * anexa o resultado a `request.zunoContext`. Continua nunca bloqueando sozinho (mesmo espírito da
 * Sprint 02): quando a verificação falha, só registra `authFailureReason` — quem decide se a rota
 * exige autenticação, e qual status/código devolver, é o handler da rota (ver `requirePrincipal`
 * em `workspaces.route.ts`/`auth.route.ts`), nunca este middleware.
 *
 * Fallback `?access_token=` (querystring) — módulo Conversas, Fase 3: o `EventSource` nativo do
 * browser (usado pela rota SSE `/v1/inbox/stream`) não consegue setar headers customizados, então
 * `Authorization: Bearer` é impossível de usar nesse caso específico. Só ATIVA quando o header
 * está ausente (nunca sobrepõe um header já presente) — mesmo access token de curta duração,
 * mesma verificação, só uma segunda forma de entregar o mesmo credential.
 */
export function registerAuthMiddleware(app: FastifyInstance, authPort: AuthPort): void {
  app.addHook("onRequest", async (request: FastifyRequest, _reply: FastifyReply) => {
    const header = request.headers.authorization;
    const query = request.query as Record<string, unknown> | undefined;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : (typeof query?.access_token === "string" ? query.access_token : undefined);

    const result = await authPort.verifyToken(token);
    if (result.authenticated) {
      request.zunoContext.principal = result.principal;
      request.zunoContext.tenantId = result.principal.tenantId;
    } else {
      request.zunoContext.authFailureReason = result.reason;
    }
  });
}
