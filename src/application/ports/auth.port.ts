import type { AuthPrincipal } from "../../domain/identity/identity.model.js";

/**
 * Porta de autenticação — desenhada na Sprint 02, preenchida de verdade na Sprint 05
 * (`src/infrastructure/auth/jwt-auth-adapter.ts`, usando `JwtPort` + os repositórios de
 * Identidade). `AuthPrincipal` agora vem do domínio (`identity.model.ts`) — carrega `tenantId`/
 * `role`/`sessionId` reais, reconstruídos a partir de um JWT válido, nunca de uma sessão em
 * memória do servidor.
 *
 * `NoopAuthAdapter` (`src/infrastructure/auth/`) continua existindo como válvula de escape
 * explícita para desenvolvimento/teste (`AUTH_MODE=noop`) — nunca o padrão em produção a partir
 * desta sprint (ver `api-config.ts`).
 */
export type { AuthPrincipal };

export type AuthVerificationResult =
  | { authenticated: true; principal: AuthPrincipal }
  | { authenticated: false; reason: "missing_token" | "invalid_token" | "expired_token" | "not_implemented" };

export type AuthPort = {
  /**
   * Verifica um token de autenticação (ex.: um Bearer token JWT) e devolve o principal por trás
   * dele, ou o motivo da falha. `NoopAuthAdapter` sempre devolve `{ authenticated: false, reason:
   * "not_implemented" }` — o chamador (middleware) precisa saber tratar isso como "sem
   * autenticação ainda", nunca como "acesso negado".
   */
  verifyToken(token: string | undefined): Promise<AuthVerificationResult>;
};
