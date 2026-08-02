import type { AuditLogPort } from "../ports/audit-log.port.js";
import type { JwtPort } from "../ports/jwt.port.js";
import type { PasswordHasherPort } from "../ports/password-hasher.port.js";
import type { RefreshTokenRepositoryPort } from "../ports/refresh-token-repository.port.js";
import type { SessionRepositoryPort } from "../ports/session-repository.port.js";
import type { TenantMembershipRepositoryPort } from "../ports/tenant-membership-repository.port.js";
import type { UserRepositoryPort } from "../ports/user-repository.port.js";

export type IdentityUseCaseDeps = {
  userRepository: UserRepositoryPort;
  membershipRepository: TenantMembershipRepositoryPort;
  sessionRepository: SessionRepositoryPort;
  refreshTokenRepository: RefreshTokenRepositoryPort;
  auditLog: AuditLogPort;
  passwordHasher: PasswordHasherPort;
  jwt: JwtPort;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  /** Injetável para testes determinísticos (expiração de refresh token). */
  now?: () => Date;
};
