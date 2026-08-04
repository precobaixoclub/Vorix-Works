import pg from "pg";
import type { AuditLogPort } from "../../application/ports/audit-log.port.js";
import type { AiProvidersRepositoryPort } from "../../application/ports/ai-providers-repository.port.js";
import type { PlatformAiSettingsRepositoryPort } from "../../application/ports/platform-ai-settings-repository.port.js";
import type { PlatformBillingRepositoryPort } from "../../application/ports/platform-billing-repository.port.js";
import type { RefreshTokenRepositoryPort } from "../../application/ports/refresh-token-repository.port.js";
import type { SessionRepositoryPort } from "../../application/ports/session-repository.port.js";
import type { TenantMembershipRepositoryPort } from "../../application/ports/tenant-membership-repository.port.js";
import type { UserRepositoryPort } from "../../application/ports/user-repository.port.js";
import { PostgresAiProvidersRepository } from "./postgres/postgres-ai-providers-repository.js";
import { PostgresAuditLogRepository } from "./postgres/postgres-audit-log-repository.js";
import { PostgresPlatformAiSettingsRepository } from "./postgres/postgres-platform-ai-settings-repository.js";
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
  /** Sprint 25/Fase 3 — configuração global do AI Gateway gerida pelo painel admin. */
  platformAiSettingsRepository: PlatformAiSettingsRepositoryPort;
  /** Sprint 26 — cadastro de Provedores de IA, catálogo de operações e ledger financeiro. */
  aiProvidersRepository: AiProvidersRepositoryPort;
  pool: InstanceType<typeof Pool>;
};

export function buildIdentityRepositories(options: { databaseUrl: string; secretsMasterKey: string }): IdentityRepositories {
  const pool = new Pool({ connectionString: options.databaseUrl });
  return {
    userRepository: new PostgresUserRepository(pool),
    membershipRepository: new PostgresTenantMembershipRepository(pool),
    sessionRepository: new PostgresSessionRepository(pool),
    refreshTokenRepository: new PostgresRefreshTokenRepository(pool),
    auditLog: new PostgresAuditLogRepository(pool),
    platformBillingRepository: new PostgresPlatformBillingRepository(pool),
    platformAiSettingsRepository: new PostgresPlatformAiSettingsRepository(pool, options.secretsMasterKey),
    aiProvidersRepository: new PostgresAiProvidersRepository(pool),
    pool,
  };
}
