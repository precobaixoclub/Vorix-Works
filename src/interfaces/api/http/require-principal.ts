import type { FastifyRequest } from "fastify";
import { hasPermission, type AuthPrincipal, type Permission } from "../../../domain/identity/identity.model.js";
import { ForbiddenError, UnauthorizedError } from "./app-error.js";

/**
 * Ponto único de "exigir autenticação" para rotas de negócio — Sprint 05 (Fase 4). Distingue
 * `TOKEN_EXPIRED` (frontend deve tentar `POST /v1/auth/refresh` antes de mandar para `/login`) de
 * `UNAUTHORIZED` genérico (token ausente/inválido — vai direto para `/login`), usando
 * `request.zunoContext.authFailureReason` que o middleware de autenticação já preenche.
 */
export function requirePrincipal(request: FastifyRequest): AuthPrincipal {
  const principal = request.zunoContext.principal;
  if (principal) return principal;

  if (request.zunoContext.authFailureReason === "expired_token") {
    throw new UnauthorizedError("Token expirado.", "TOKEN_EXPIRED");
  }
  throw new UnauthorizedError("Autenticação necessária.", "UNAUTHORIZED");
}

/** Autenticação (`requirePrincipal`) + autorização (RBAC) — devolve 403 quando o papel não tem a permissão, nunca 401. */
export function requirePermission(request: FastifyRequest, permission: Permission): AuthPrincipal {
  const principal = requirePrincipal(request);
  if (!hasPermission(principal.role, permission)) {
    throw new ForbiddenError(`Papel "${principal.role}" não tem a permissão "${permission}".`);
  }
  return principal;
}
