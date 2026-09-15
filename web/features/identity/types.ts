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
