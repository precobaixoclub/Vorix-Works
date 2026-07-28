import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthPort } from "../../../application/ports/auth.port.js";

/**
 * Middleware de autenticação — PREPARADO, nunca aplicado. Lê o header `Authorization`, chama
 * `AuthPort.verifyToken`, e anexa o resultado a `request.zunoContext.principal` quando autenticado
 * — mas NUNCA bloqueia uma requisição por falta ou invalidez de token nesta sprint (o adapter real
 * hoje, `NoopAuthAdapter`, sempre devolve `authenticated: false`, então isso seria bloquear tudo).
 * Rotas que precisarem exigir autenticação de verdade (a partir da Sprint 04) vão checar
 * `request.zunoContext.principal` explicitamente e devolver `UnauthorizedError` elas mesmas — este
 * middleware só preenche o dado, nunca decide acesso.
 */
export function registerAuthMiddleware(app: FastifyInstance, authPort: AuthPort): void {
  app.addHook("onRequest", async (request: FastifyRequest, _reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

    const result = await authPort.verifyToken(token);
    if (result.authenticated) {
      request.zunoContext.principal = result.principal;
      request.zunoContext.tenantId = result.principal.tenantId ?? null;
    }
  });
}
