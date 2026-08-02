import type { TenantRole } from "../../domain/identity/identity.model.js";
import type { IdentityUseCaseDeps } from "./identity-use-case-deps.js";

export type SwitchTenantUseCaseInput = { userId: string; sessionId: string; targetTenantId: string };
export type SwitchTenantUseCaseOutput = { accessToken: string; tenantId: string; role: TenantRole };

/**
 * Workspace/Tenant Switcher (Fase 6). Só troca o contexto se o usuário tiver `TenantMembership`
 * no tenant de destino — nunca aceita um `targetTenantId` arbitrário. Atualiza
 * `UserSession.activeTenantId` (fonte de verdade persistida) e devolve um access token NOVO já
 * refletindo o novo tenant/papel, para que o frontend nunca precise esperar o token antigo
 * expirar para operar no contexto certo — "nunca misturar contexto" (PROMPT 05, Fase 6).
 */
export async function switchTenant(deps: IdentityUseCaseDeps, input: SwitchTenantUseCaseInput): Promise<SwitchTenantUseCaseOutput> {
  const membership = await deps.membershipRepository.getByUserAndTenant(input.userId, input.targetTenantId);
  if (!membership) {
    throw new Error(`IDENTITY_NO_TENANT_ACCESS: usuário não pertence ao tenant "${input.targetTenantId}".`);
  }

  await deps.sessionRepository.updateActiveTenant(input.sessionId, input.targetTenantId);

  const accessToken = deps.jwt.sign(
    { userId: input.userId, tenantId: membership.tenantId, role: membership.role, sessionId: input.sessionId },
    deps.accessTokenTtlSeconds,
  );

  await deps.auditLog.record({
    eventType: "tenant_switch",
    userId: input.userId,
    tenantId: membership.tenantId,
    sessionId: input.sessionId,
  });

  return { accessToken, tenantId: membership.tenantId, role: membership.role };
}
