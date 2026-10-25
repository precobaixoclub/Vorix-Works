export type TenantRole = "owner" | "admin" | "editor" | "viewer";

export type Team = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  /** Bloco "roteamento por equipe" (réplica adaptada do CMDesk) — interruptor mestre do rodízio de
   * atendimento; `false` = sempre usa o principal do nível, nunca gira. */
  roundRobinEnabled: boolean;
  lastAssignedIndexByLevel: Record<string, number>;
  timezone: string;
  createdAt: string;
  updatedAt: string;
};

export type TeamMembership = {
  id: string;
  teamId: string;
  userId: string;
  role: TenantRole;
  /** Nível de atendimento (N1/N2/...) — cada nível tem sua própria roleta independente. */
  attendanceLevel: string;
  /** Fallback fixo do nível quando o rodízio está desligado, ou ninguém do nível participa dele —
   * exatamente um membro por nível deve ter isto `true`. */
  isPrincipalForLevel: boolean;
  participatesInRoundRobin: boolean;
  lastAssignedAt?: string;
  createdAt: string;
};

export type TenantMembership = {
  id: string;
  userId: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  tenantId: string;
  role: TenantRole;
  /** Perfis e permissões (0173). */
  status?: "active" | "disabled";
  isAccountOwner?: boolean;
  permissionGrants?: string[];
  permissionRevokes?: string[];
  /** Quantas exceções sobre o perfil padrão. */
  customizedPermissions?: number;
  createdAt: string;
  updatedAt: string;
};

export type PermissionOrigin = "profile" | "granted" | "revoked" | "none";

/** Acesso completo de um usuário: perfil, exceções, permissões efetivas e equipes. */
export type MemberAccess = {
  userId: string;
  role: TenantRole;
  status: "active" | "disabled";
  isAccountOwner: boolean;
  permissionGrants: string[];
  permissionRevokes: string[];
  effectivePermissions: string[];
  permissions: { permission: string; enabled: boolean; origin: PermissionOrigin }[];
  teams: { teamId: string; role: TenantRole; isManager: boolean }[];
};

export type AccessCatalog = {
  profiles: { role: TenantRole; label: string; permissions: string[] }[];
  categories: { key: string; label: string; description: string; permissions: { permission: string; label: string; description?: string; sensitive?: boolean }[] }[];
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
