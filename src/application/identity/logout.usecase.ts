import type { IdentityUseCaseDeps } from "./identity-use-case-deps.js";

export type LogoutUseCaseInput = { sessionId: string };

/** Revoga a sessão E todos os refresh tokens dela — o access token já emitido continua
 * tecnicamente válido até expirar (é stateless), mas nenhum refresh subsequente vai funcionar. */
export async function logout(deps: IdentityUseCaseDeps, input: LogoutUseCaseInput): Promise<void> {
  const session = await deps.sessionRepository.getById(input.sessionId);
  await deps.refreshTokenRepository.revokeAllForSession(input.sessionId);
  await deps.sessionRepository.revoke(input.sessionId);
  await deps.auditLog.record({
    eventType: "logout",
    userId: session?.userId,
    tenantId: session?.activeTenantId,
    sessionId: input.sessionId,
  });
}
