import type { SolutionEntitlement, SolutionEntitlementSource, SolutionKey } from "../../domain/solutions/solution.model.js";

/**
 * Persistência do entitlement por solução (Core). Adapter concreto:
 * `PostgresSolutionEntitlementRepository`. Nenhuma regra de acesso aqui — ela vive em
 * `domain/solutions/solution.model.ts` (`resolveSolutionAccess`).
 */
export type SolutionEntitlementRepositoryPort = {
  listByTenant(tenantId: string): Promise<SolutionEntitlement[]>;
  /** Grava a concessão e a linha de auditoria na mesma transação. */
  set(input: {
    tenantId: string;
    solutionKey: SolutionKey;
    enabled: boolean;
    source: SolutionEntitlementSource;
    reason?: string;
    actorUserId?: string;
  }): Promise<SolutionEntitlement>;
};
