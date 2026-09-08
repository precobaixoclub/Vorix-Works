import { randomBytes, createHash } from "node:crypto";
import type { TenantMemberInviteRepositoryPort } from "../ports/tenant-member-invite-repository.port.js";
import type { TenantMembershipRepositoryPort } from "../ports/tenant-membership-repository.port.js";
import type { UserRepositoryPort } from "../ports/user-repository.port.js";
import type { TenantMemberInvite, TenantMembership, TenantRole } from "../../domain/identity/identity.model.js";

export type InviteUseCaseDeps = {
  tenantMemberInviteRepository: TenantMemberInviteRepositoryPort;
  membershipRepository: TenantMembershipRepositoryPort;
  userRepository: UserRepositoryPort;
  now?: () => Date;
};

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

function generateInviteToken(): string {
  return randomBytes(32).toString("hex");
}

function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Retorna o token BRUTO uma única vez (pra enviar por e-mail) — nunca persistido em claro, mesmo
 * racional de `RefreshToken.tokenHash`. */
export async function inviteMember(deps: InviteUseCaseDeps, input: { tenantId: string; email: string; role: TenantRole; invitedByUserId: string }): Promise<{ invite: TenantMemberInvite; rawToken: string }> {
  const now = (deps.now ?? (() => new Date()))();
  const rawToken = generateInviteToken();
  const invite = await deps.tenantMemberInviteRepository.create({
    tenantId: input.tenantId,
    email: input.email.trim().toLowerCase(),
    role: input.role,
    tokenHash: hashInviteToken(rawToken),
    invitedByUserId: input.invitedByUserId,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
  });
  return { invite, rawToken };
}

export async function listTenantInvites(deps: InviteUseCaseDeps, tenantId: string): Promise<TenantMemberInvite[]> {
  return deps.tenantMemberInviteRepository.listByTenant(tenantId);
}

export async function revokeInvite(deps: InviteUseCaseDeps, inviteId: string): Promise<TenantMemberInvite | undefined> {
  return deps.tenantMemberInviteRepository.updateStatus(inviteId, { expectedStatus: "pending", status: "revoked" });
}

/**
 * Aceitar convite — o chamador já está autenticado (login/signup normal); só liga esta conta a um
 * convite pendente cujo e-mail bate com o do usuário. Nunca cria usuário novo aqui (isso já é
 * responsabilidade do fluxo de login/signup existente) — evita inventar um segundo mecanismo de
 * cadastro paralelo a `signupPublic`.
 */
export async function acceptInvite(deps: InviteUseCaseDeps, input: { rawToken: string; userId: string }): Promise<TenantMembership> {
  const now = (deps.now ?? (() => new Date()))();
  const invite = await deps.tenantMemberInviteRepository.getByTokenHash(hashInviteToken(input.rawToken));
  if (!invite) throw new Error("INVITE_NOT_FOUND: convite inválido ou já usado.");
  if (invite.status !== "pending") throw new Error(`INVITE_NOT_PENDING: convite já está "${invite.status}".`);
  if (new Date(invite.expiresAt).getTime() < now.getTime()) {
    await deps.tenantMemberInviteRepository.updateStatus(invite.id, { expectedStatus: "pending", status: "expired" });
    throw new Error("INVITE_EXPIRED: convite expirado — peça um novo.");
  }
  const user = await deps.userRepository.getById(input.userId);
  if (!user) throw new Error("USER_NOT_FOUND: usuário não existe.");
  if (user.email.trim().toLowerCase() !== invite.email) {
    throw new Error("INVITE_EMAIL_MISMATCH: este convite foi enviado para outro e-mail.");
  }
  const accepted = await deps.tenantMemberInviteRepository.updateStatus(invite.id, {
    expectedStatus: "pending",
    status: "accepted",
    acceptedAt: now.toISOString(),
  });
  if (!accepted) throw new Error("INVITE_NOT_PENDING: convite já foi resolvido por outra requisição.");
  const existingMembership = await deps.membershipRepository.getByUserAndTenant(user.id, invite.tenantId);
  if (existingMembership) return existingMembership;
  return deps.membershipRepository.create({ userId: user.id, tenantId: invite.tenantId, role: invite.role });
}

export async function updateMemberRole(deps: InviteUseCaseDeps, input: { userId: string; tenantId: string; role: TenantRole }): Promise<TenantMembership> {
  const updated = await deps.membershipRepository.updateRole(input.userId, input.tenantId, input.role);
  if (!updated) throw new Error(`MEMBERSHIP_NOT_FOUND: usuário "${input.userId}" não pertence ao tenant "${input.tenantId}".`);
  return updated;
}

export async function removeMember(deps: InviteUseCaseDeps, input: { userId: string; tenantId: string }): Promise<void> {
  await deps.membershipRepository.remove(input.userId, input.tenantId);
}

export async function listTenantMembers(deps: InviteUseCaseDeps, tenantId: string): Promise<TenantMembership[]> {
  return deps.membershipRepository.listByTenant(tenantId);
}
