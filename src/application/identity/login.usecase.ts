import type { TenantRole } from "../../domain/identity/identity.model.js";
import type { IdentityUseCaseDeps } from "./identity-use-case-deps.js";
import { generateRefreshTokenValue, hashRefreshTokenValue } from "./token-hash.js";

export type LoginUseCaseInput = {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
};

export type LoginUseCaseOutput = {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: { id: string; email: string; name: string; isPlatformAdmin: boolean };
  tenantId: string;
  role: TenantRole;
};

/** Mesma mensagem para "email não existe" e "senha errada" — nunca revela qual dos dois falhou. */
const INVALID_CREDENTIALS = "IDENTITY_INVALID_CREDENTIALS: email ou senha incorretos.";

/**
 * Login — Fase 3. Quando o usuário pertence a mais de um Tenant, o primeiro (por `createdAt`) é o
 * contexto ativo inicial; o Tenant Switcher (Fase 6, `switch-tenant.usecase.ts`) troca depois sem
 * exigir novo login.
 */
export async function login(deps: IdentityUseCaseDeps, input: LoginUseCaseInput): Promise<LoginUseCaseOutput> {
  const user = await deps.userRepository.getByEmail(input.email);
  if (!user || user.status !== "active") {
    await deps.auditLog.record({ eventType: "login_failed", metadata: { email: input.email } });
    throw new Error(INVALID_CREDENTIALS);
  }

  const passwordOk = await deps.passwordHasher.verify(input.password, user.passwordHash);
  if (!passwordOk) {
    await deps.auditLog.record({ eventType: "login_failed", userId: user.id });
    throw new Error(INVALID_CREDENTIALS);
  }

  const memberships = await deps.membershipRepository.listByUser(user.id);
  const activeMembership = memberships[0];
  if (!activeMembership) {
    await deps.auditLog.record({ eventType: "login_failed", userId: user.id, metadata: { reason: "no_tenant_access" } });
    throw new Error("IDENTITY_NO_TENANT_ACCESS: usuário não pertence a nenhum tenant.");
  }

  const session = await deps.sessionRepository.create({
    userId: user.id,
    activeTenantId: activeMembership.tenantId,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
  });

  const rawRefreshToken = generateRefreshTokenValue();
  const now = deps.now?.() ?? new Date();
  const refreshTokenExpiresAt = new Date(now.getTime() + deps.refreshTokenTtlSeconds * 1000).toISOString();
  await deps.refreshTokenRepository.create({
    sessionId: session.id,
    userId: user.id,
    tokenHash: hashRefreshTokenValue(rawRefreshToken),
    expiresAt: refreshTokenExpiresAt,
  });

  const accessToken = deps.jwt.sign(
    {
      userId: user.id,
      tenantId: activeMembership.tenantId,
      role: activeMembership.role,
      sessionId: session.id,
      isPlatformAdmin: user.isPlatformAdmin === true,
    },
    deps.accessTokenTtlSeconds,
  );

  await deps.userRepository.touchLastLogin(user.id);
  await deps.auditLog.record({ eventType: "login_success", userId: user.id, tenantId: activeMembership.tenantId, sessionId: session.id });

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    refreshTokenExpiresAt,
    user: { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.isPlatformAdmin === true },
    tenantId: activeMembership.tenantId,
    role: activeMembership.role,
  };
}
