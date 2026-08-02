import type { TenantMembership, TenantRole, User } from "../../domain/identity/identity.model.js";
import type { IdentityUseCaseDeps } from "./identity-use-case-deps.js";

export type RegisterUserUseCaseInput = {
  email: string;
  password: string;
  name: string;
  tenantId: string;
  role: TenantRole;
};

export type RegisterUserUseCaseOutput = { user: User; membership: TenantMembership };

const MIN_PASSWORD_LENGTH = 8;

/**
 * Cria um `User` + a primeira `TenantMembership` dele. DELIBERADAMENTE sem endpoint HTTP público
 * nesta sprint — o PROMPT 05 pede Login/Logout/Refresh (Fase 3), nunca "cadastro"/"signup"; expor
 * registro público traria escopo de segurança adicional (rate limiting, verificação de email) não
 * pedido. Usado hoje só por `scripts/seed-user.mjs` (bootstrap local) e pelos testes — ver
 * Relatório da Sprint 05, "Ajustes recomendados para a Sprint 06".
 */
export async function registerUser(deps: IdentityUseCaseDeps, input: RegisterUserUseCaseInput): Promise<RegisterUserUseCaseOutput> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`IDENTITY_VALIDATION_ERROR: senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (!input.email.includes("@")) {
    throw new Error("IDENTITY_VALIDATION_ERROR: email inválido.");
  }
  if (!input.name.trim()) {
    throw new Error("IDENTITY_VALIDATION_ERROR: name é obrigatório.");
  }

  const passwordHash = await deps.passwordHasher.hash(input.password);
  const user = await deps.userRepository.create({
    email: input.email.trim().toLowerCase(),
    passwordHash,
    name: input.name.trim(),
  });
  const membership = await deps.membershipRepository.create({ userId: user.id, tenantId: input.tenantId, role: input.role });

  return { user, membership };
}
