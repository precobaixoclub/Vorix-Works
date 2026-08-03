import pg from "pg";
import type { AuditLogPort } from "../../application/ports/audit-log.port.js";
import type { PlatformBillingRepositoryPort } from "../../application/ports/platform-billing-repository.port.js";
import type { RefreshTokenRepositoryPort } from "../../application/ports/refresh-token-repository.port.js";
import type { SessionRepositoryPort } from "../../application/ports/session-repository.port.js";
import type { TenantMembershipRepositoryPort } from "../../application/ports/tenant-membership-repository.port.js";
import type { UserRepositoryPort } from "../../application/ports/user-repository.port.js";
import { PostgresAuditLogRepository } from "./postgres/postgres-audit-log-repository.js";
import { PostgresPlatformBillingRepository } from "./postgres/postgres-platform-billing-repository.js";
import { PostgresRefreshTokenRepository } from "./postgres/postgres-refresh-token-repository.js";
import { PostgresSessionRepository } from "./postgres/postgres-session-repository.js";
import { PostgresTenantMembershipRepository } from "./postgres/postgres-tenant-membership-repository.js";
import { PostgresUserRepository } from "./postgres/postgres-user-repository.js";

const { Pool } = pg;

export type IdentityRepositories = {
  userRepository: UserRepositoryPort;
  membershipRepository: TenantMembershipRepositoryPort;
  sessionRepository: SessionRepositoryPort;
  refreshTokenRepository: RefreshTokenRepositoryPort;
  auditLog: AuditLogPort;
  /** Sprint 25 — painel admin + cotas/consumo/lucro por tenant. Reusa o mesmo pool de identidade. */
  platformBillingRepository: PlatformBillingRepositoryPort;
  pool: InstanceType<typeof Pool>;
};

/**
 * Identidade (User/Membership/Session/RefreshToken/Auditoria) — Sprint 05. Sempre Postgres real,
 * sem driver "memory" (diferente de `buildPlatformRepositories`, Sprint 03): senha e refresh
 * token são sensíveis demais para um modo "brinquedo" mesmo em desenvolvimento. Para testar sem
 * depender do Postgres real da máquina, use PGlite (`tests/helpers/pglite-test-db.mjs`), que É um
 * Postgres real, só embutido — não é um substituto "menos real", é o mesmo Postgres compilado
 * para WASM.
 */
export function buildIdentityRepositories(options: { databaseUrl: string }): IdentityRepositories {
  const pool = new Pool({ connectionString: options.databaseUrl });
  return {
    userRepository: new PostgresUserRepository(pool),
    membershipRepository: new PostgresTenantMembershipRepository(pool),
    sessionRepository: new PostgresSessionRepository(pool),
    refreshTokenRepository: new PostgresRefreshTokenRepository(pool),
    auditLog: new PostgresAuditLogRepository(pool),
    platformBillingRepository: new PostgresPlatformBillingRepository(pool),
    pool,
  };
}
