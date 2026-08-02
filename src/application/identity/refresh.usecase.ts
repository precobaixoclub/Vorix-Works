import type { TenantRole } from "../../domain/identity/identity.model.js";
import type { IdentityUseCaseDeps } from "./identity-use-case-deps.js";
import { generateRefreshTokenValue, hashRefreshTokenValue } from "./token-hash.js";

export type RefreshUseCaseInput = { refreshToken: string };

export type RefreshUseCaseOutput = {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tenantId: string;
  role: TenantRole;
};

/**
 * Rotação de refresh token com detecção de replay (Fase 3). Cada uso bem-sucedido gera um token
 * NOVO e revoga o antigo (`markRotated`) — nunca reutiliza o mesmo valor. Se o token apresentado
 * já estiver revogado, é tratado como reuse (alguém usou uma cópia de um token que já foi
 * rotacionado — sinal de vazamento) e a sessão inteira é revogada como resposta de segurança, não
 * só o token em questão.
 */
export async function refresh(deps: IdentityUseCaseDeps, input: RefreshUseCaseInput): Promise<RefreshUseCaseOutput> {
  const tokenHash = hashRefreshTokenValue(input.refreshToken);
  const existing = await deps.refreshTokenRepository.getByHash(tokenHash);
  if (!existing) {
    throw new Error("IDENTITY_INVALID_REFRESH_TOKEN: refresh token inválido.");
  }

  // A sessão é checada ANTES do "token revogado" de propósito: se a sessão já foi encerrada de
  // forma esperada (logout, ou uma revogação de replay anterior), reapresentar um token dela não
  // é um NOVO incidente — é só um cliente que ainda não percebeu que saiu. Só sinalizamos replay
  // quando o token está revogado mas a sessão continua ativa (ver abaixo) — só aí é reuse de
  // verdade, digno de revogar tudo e auditar como incidente de segurança.
  const session = await deps.sessionRepository.getById(existing.sessionId);
  if (!session || session.revokedAt) {
    throw new Error("IDENTITY_SESSION_REVOKED: sessão não existe mais ou foi revogada.");
  }

  if (existing.revokedAt) {
    await deps.refreshTokenRepository.revokeAllForSession(existing.sessionId);
    await deps.sessionRepository.revoke(existing.sessionId);
    await deps.auditLog.record({ eventType: "refresh_replay_detected", userId: existing.userId, sessionId: existing.sessionId });
    throw new Error("IDENTITY_REFRESH_TOKEN_REUSED: token já utilizado — sessão revogada por segurança.");
  }

  const now = deps.now?.() ?? new Date();
  if (new Date(existing.expiresAt).getTime() < now.getTime()) {
    throw new Error("IDENTITY_REFRESH_TOKEN_EXPIRED: refresh token expirado.");
  }

  // Papel/tenant são revalidados a cada refresh (nunca copiados do token antigo) — se um admin
  // mudar o papel do usuário ou remover o acesso ao tenant, o próximo refresh já reflete isso,
  // em vez de esperar o access token expirar por conta própria.
  const membership = await deps.membershipRepository.getByUserAndTenant(existing.userId, session.activeTenantId);
  if (!membership) {
    throw new Error("IDENTITY_NO_TENANT_ACCESS: usuário perdeu acesso ao tenant ativo desta sessão.");
  }

  const rawRefreshToken = generateRefreshTokenValue();
  const refreshTokenExpiresAt = new Date(now.getTime() + deps.refreshTokenTtlSeconds * 1000).toISOString();
  const newToken = await deps.refreshTokenRepository.create({
    sessionId: existing.sessionId,
    userId: existing.userId,
    tokenHash: hashRefreshTokenValue(rawRefreshToken),
    expiresAt: refreshTokenExpiresAt,
  });
  await deps.refreshTokenRepository.markRotated(existing.id, newToken.id);
  await deps.sessionRepository.touch(session.id);

  const accessToken = deps.jwt.sign(
    { userId: existing.userId, tenantId: membership.tenantId, role: membership.role, sessionId: session.id },
    deps.accessTokenTtlSeconds,
  );

  await deps.auditLog.record({ eventType: "refresh_success", userId: existing.userId, tenantId: membership.tenantId, sessionId: session.id });

  return { accessToken, refreshToken: rawRefreshToken, refreshTokenExpiresAt, tenantId: membership.tenantId, role: membership.role };
}
