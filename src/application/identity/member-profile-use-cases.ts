import type { InviteUseCaseDeps } from "./invite-use-cases.js";

export async function updateMemberProfile(deps: InviteUseCaseDeps, input: { tenantId: string; userId: string; actorUserId?: string; name: string; email: string; avatarUrl?: string | null }) {
  const membership = await deps.membershipRepository.getByUserAndTenant(input.userId, input.tenantId);
  if (!membership) throw new Error("MEMBERSHIP_NOT_FOUND: usuário não pertence a esta conta.");
  // Administrar um tenant não autoriza alterar a identidade usada em outras contas.
  const memberships = await deps.membershipRepository.listByUser(input.userId);
  if (input.actorUserId !== input.userId && memberships.some((item) => item.tenantId !== input.tenantId)) throw new Error("IDENTITY_VALIDATION_ERROR: este usuário participa de outras contas; os dados de acesso devem ser alterados pelo próprio usuário.");
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("IDENTITY_VALIDATION_ERROR: informe nome e e-mail válidos.");
  const user = await deps.userRepository.updateProfile(input.userId, { name, email, avatarUrl: input.avatarUrl });
  if (!user) throw new Error("USER_NOT_FOUND: usuário não encontrado.");
  return { ...membership, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
}
