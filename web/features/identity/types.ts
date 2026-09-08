export type TenantRole = "owner" | "admin" | "editor" | "viewer";

export type Team = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type TeamMembership = {
  id: string;
  teamId: string;
  userId: string;
  role: TenantRole;
  createdAt: string;
};

export type TenantMembership = {
  id: string;
  userId: string;
  tenantId: string;
  role: TenantRole;
  createdAt: string;
  updatedAt: string;
};

export type TenantMemberInviteStatus = "pending" | "accepted" | "revoked" | "expired";

export type TenantMemberInvite = {
  id: string;
  tenantId: string;
  email: string;
  role: TenantRole;
  status: TenantMemberInviteStatus;
  invitedByUserId: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  /** Só vem preenchido na resposta do POST de criação — nunca persistido em claro. */
  rawToken?: string;
};
