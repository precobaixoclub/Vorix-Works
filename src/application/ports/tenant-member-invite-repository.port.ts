import type { TenantMemberInvite, TenantMemberInviteStatus, TenantRole } from "../../domain/identity/identity.model.js";

export type CreateTenantMemberInviteInput = {
  tenantId: string;
  email: string;
  role: TenantRole;
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: string;
};

export type TenantMemberInviteRepositoryPort = {
  create(input: CreateTenantMemberInviteInput): Promise<TenantMemberInvite>;
  getByTokenHash(tokenHash: string): Promise<TenantMemberInvite | undefined>;
  listByTenant(tenantId: string): Promise<TenantMemberInvite[]>;
  /** CAS — só transiciona se o status atual bater com `expectedStatus` (nunca aceitar um convite
   * já revogado/expirado, nunca revogar um já aceito). */
  updateStatus(id: string, input: { expectedStatus: TenantMemberInviteStatus; status: TenantMemberInviteStatus; acceptedAt?: string }): Promise<TenantMemberInvite | undefined>;
};
