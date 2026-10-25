import type { AuthPrincipal } from "../../domain/identity/identity.model.js";
import { effectivePermissions } from "../../domain/identity/identity.model.js";
import type { TenantMembershipRepositoryPort } from "../ports/tenant-membership-repository.port.js";

/**
 * Resolve, a cada requisição autenticada, o acesso ATUAL do principal a partir da membership — o
 * JWT continua dizendo quem é e em qual empresa, mas perfil, exceções e status vêm do banco.
 * Assim, trocar o perfil, conceder/remover uma permissão ou desativar alguém vale na próxima
 * requisição (antes, só depois do próximo refresh do token). Cache curto por processo, invalidado
 * explicitamente quando o acesso muda neste mesmo processo.
 */
export class AccessResolver {
  private readonly cache = new Map<string, { expiresAt: number; principal: Pick<AuthPrincipal, "role" | "permissions" | "permissionRevokes" | "isAccountOwner"> | null }>();

  constructor(private readonly membershipRepository: TenantMembershipRepositoryPort, private readonly ttlMs = 0) {}

  /** `undefined` = a pessoa não tem (mais) acesso a esta empresa: removida ou desativada. */
  async resolve(principal: AuthPrincipal): Promise<AuthPrincipal | undefined> {
    const key = `${principal.userId}:${principal.tenantId}`;
    const now = Date.now();
    let entry = this.cache.get(key);
    if (!entry || entry.expiresAt <= now) {
      const membership = await this.membershipRepository.getByUserAndTenant(principal.userId, principal.tenantId);
      entry = {
        expiresAt: now + this.ttlMs,
        principal: membership && membership.status === "active"
          ? { role: membership.role, permissions: effectivePermissions(membership.role, membership.permissionGrants, membership.permissionRevokes), isAccountOwner: membership.isAccountOwner, permissionRevokes: membership.permissionRevokes }
          : null,
      };
      this.cache.set(key, entry);
      if (this.cache.size > 5_000) this.cache.delete(this.cache.keys().next().value as string);
    }
    // Superadmin da plataforma continua entrando em qualquer empresa (suporte), com o papel do token.
    if (!entry.principal) return principal.isPlatformAdmin ? principal : undefined;
    return { ...principal, ...entry.principal };
  }

  invalidate(userId: string, tenantId: string): void {
    this.cache.delete(`${userId}:${tenantId}`);
  }
}
