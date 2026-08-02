import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthPort } from "../../../application/ports/auth.port.js";

/**
 * Middleware de autenticação — lê o header `Authorization`, chama `AuthPort.verifyToken`, e
 * anexa o resultado a `request.zunoContext`. Continua nunca bloqueando sozinho (mesmo espírito da
 * Sprint 02): quando a verificação falha, só registra `authFailureReason` — quem decide se a rota
 * exige autenticação, e qual status/código devolver, é o handler da rota (ver `requirePrincipal`
 * em `workspaces.route.ts`/`auth.route.ts`), nunca este middleware.
 */
export function registerAuthMiddleware(app: FastifyInstance, authPort: AuthPort): void {
  app.addHook("onRequest", async (request: FastifyRequest, _reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

    const result = await authPort.verifyToken(token);
    if (result.authenticated) {
      request.zunoContext.principal = result.principal;
      request.zunoContext.tenantId = result.principal.tenantId;
    } else {
      request.zunoContext.authFailureReason = result.reason;
    }
  });
}
