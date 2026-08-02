import type { RefreshToken } from "../../domain/identity/identity.model.js";

export type CreateRefreshTokenInput = {
  sessionId: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
};

/**
 * `revokeAllForSession` é o que torna a detecção de replay (Fase 3) eficaz: ao reutilizar um
 * refresh token já rotacionado/revogado, o caso de uso chama isto para invalidar TODA a sessão de
 * uma vez — não só o token reutilizado — porque um token revogado reaparecendo é o sinal mais
 * forte possível de que o refresh token (ou a sessão inteira) vazou.
 */
export type RefreshTokenRepositoryPort = {
  create(input: CreateRefreshTokenInput): Promise<RefreshToken>;
  getByHash(tokenHash: string): Promise<RefreshToken | undefined>;
  markRotated(id: string, replacedByTokenId: string): Promise<void>;
  revoke(id: string): Promise<void>;
  revokeAllForSession(sessionId: string): Promise<void>;
};
