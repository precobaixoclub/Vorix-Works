import type { AuthPrincipal, Permission, TeamMembership, TenantMembership, TenantRole } from "../../domain/identity/identity.model.js";
import { effectivePermissions, hasPermission } from "../../domain/identity/identity.model.js";
import {
  assertAccessChangeAllowed,
  assertMemberDeactivationAllowed,
  describeAccess,
  isTeamManagerRole,
  normalizeAccessChange,
  type AccessActor,
} from "../../domain/identity/access-control.js";
import type { AccessAuditLogPort } from "../ports/access-audit-log.port.js";
import type { TenantMembershipRepositoryPort } from "../ports/tenant-membership-repository.port.js";
import type { TeamMembershipRepositoryPort, TeamRepositoryPort } from "../ports/team-repository.port.js";

/**
 * Perfis, direitos de acesso e escopo (0173) — a ÚNICA porta para: (1) saber o que uma pessoa
 * enxerga (`resolveAccessContext` + `scopeFor`), usada por Conversas, Oportunidades, Metas e
 * Dashboards; e (2) alterar a estrutura de acesso de alguém, sempre com as proteções de
 * `access-control.ts` e auditoria estruturada.
 */
export type AccessControlDeps = {
  membershipRepository: TenantMembershipRepositoryPort;
  teamRepository?: TeamRepositoryPort;
  teamMembershipRepository?: TeamMembershipRepositoryPort;
  accessAuditLog?: AccessAuditLogPort;
  /** Chamado depois de qualquer mudança de acesso — invalida o cache do resolvedor por requisição. */
  onAccessChanged?: (userId: string, tenantId: string) => void;
};

/** Quem está pedindo, com permissões efetivas e equipes (participa / gerencia). */
export type AccessContext = {
  tenantId: string;
  userId: string;
  role: TenantRole;
  permissions: readonly Permission[];
  isAccountOwner: boolean;
  memberTeamIds: string[];
  managedTeamIds: string[];
};

export type ScopeDomain = "inbox" | "deal" | "goal" | "report";
/** `own` = só os próprios dados; `team` = equipes das quais participa; `all` = empresa toda. */
export type ScopeLevel = "own" | "team" | "all";

const SCOPE_PERMISSIONS: Record<ScopeDomain, { team: Permission; all: Permission }> = {
  inbox: { team: "inbox:view_team", all: "inbox:view_all" },
  deal: { team: "deal:view_team", all: "deal:view_all" },
  goal: { team: "goal:read_team", all: "goal:read_all" },
  report: { team: "sales_report:read_team", all: "sales_report:read_all" },
};

export function scopeFor(context: Pick<AccessContext, "permissions">, domain: ScopeDomain): ScopeLevel {
  const permissions = SCOPE_PERMISSIONS[domain];
  if (context.permissions.includes(permissions.all)) return "all";
  if (context.permissions.includes(permissions.team)) return "team";
  return "own";
}

export async function resolveAccessContext(deps: Pick<AccessControlDeps, "teamMembershipRepository">, principal: Pick<AuthPrincipal, "tenantId" | "userId" | "role" | "permissions" | "isAccountOwner">): Promise<AccessContext> {
  const memberships = deps.teamMembershipRepository ? await deps.teamMembershipRepository.listByUser(principal.userId, principal.tenantId) : [];
  return {
    tenantId: principal.tenantId,
    userId: principal.userId,
    role: principal.role,
    permissions: principal.permissions ?? effectivePermissions(principal.role),
    isAccountOwner: principal.isAccountOwner === true,
    memberTeamIds: memberships.map((membership) => membership.teamId),
    managedTeamIds: memberships.filter((membership) => isTeamManagerRole(membership.role)).map((membership) => membership.teamId),
  };
}

/** Pode CONFIGURAR algo desta equipe (kanban, meta de equipe)? Escopo global configura qualquer
 * uma; senão só as equipes que a pessoa GERENCIA. Equipe ausente (estrutura da empresa toda) exige
 * escopo global. */
export function canConfigureTeam(context: AccessContext, permission: Permission, domain: ScopeDomain, teamId: string | undefined): boolean {
  if (!context.permissions.includes(permission)) return false;
  if (scopeFor(context, domain) === "all") return true;
  return Boolean(teamId && context.managedTeamIds.includes(teamId));
}

export function assertCanConfigureTeam(context: AccessContext, permission: Permission, domain: ScopeDomain, teamId: string | undefined): void {
  if (!canConfigureTeam(context, permission, domain, teamId)) {
    throw new Error(teamId ? "ACCESS_TEAM_SCOPE_FORBIDDEN: você só pode configurar as equipes que gerencia." : "ACCESS_TEAM_SCOPE_FORBIDDEN: só quem tem acesso global configura a estrutura da empresa toda.");
  }
}

/** Usuários cujos dados entram no escopo `team` (membros das equipes da pessoa, ela inclusa). */
export function readableTeamIds(context: Pick<AccessContext, "role" | "managedTeamIds" | "memberTeamIds">): string[] {
  return context.role === "admin" ? context.managedTeamIds : context.memberTeamIds;
}

export async function teamScopeUserIds(deps: Pick<AccessControlDeps, "teamMembershipRepository">, context: AccessContext, teamIds: readonly string[] = readableTeamIds(context)): Promise<string[]> {
  const users = new Set<string>([context.userId]);
  if (deps.teamMembershipRepository) {
    for (const teamId of teamIds) for (const member of await deps.teamMembershipRepository.listByTeam(teamId)) users.add(member.userId);
  }
  return [...users];
}

// ── Gestão de acesso de um membro ────────────────────────────────────────────────────────────

function actorFrom(context: AccessContext): AccessActor {
  return { userId: context.userId, role: context.role, permissions: context.permissions, isAccountOwner: context.isAccountOwner };
}

async function mustMember(deps: AccessControlDeps, userId: string, tenantId: string): Promise<TenantMembership> {
  const membership = await deps.membershipRepository.getByUserAndTenant(userId, tenantId);
  if (!membership) throw new Error(`MEMBERSHIP_NOT_FOUND: usuário "${userId}" não pertence a esta conta.`);
  return membership;
}

async function activeOwnerCount(deps: AccessControlDeps, tenantId: string): Promise<number> {
  return (await deps.membershipRepository.listByTenant(tenantId)).filter((member) => member.role === "owner" && member.status === "active").length;
}

export type MemberAccessView = {
  userId: string;
  role: TenantRole;
  status: TenantMembership["status"];
  isAccountOwner: boolean;
  permissionGrants: string[];
  permissionRevokes: string[];
  effectivePermissions: Permission[];
  permissions: ReturnType<typeof describeAccess>;
  teams: { teamId: string; role: TenantRole; isManager: boolean }[];
};

export async function getMemberAccess(deps: AccessControlDeps, input: { tenantId: string; userId: string }): Promise<MemberAccessView> {
  const membership = await mustMember(deps, input.userId, input.tenantId);
  const teams = deps.teamMembershipRepository ? await deps.teamMembershipRepository.listByUser(input.userId, input.tenantId) : [];
  const tenantTeamIds = deps.teamRepository ? await tenantTeams(deps, input.tenantId, teams) : new Set(teams.map((team) => team.teamId));
  return {
    userId: membership.userId,
    role: membership.role,
    status: membership.status,
    isAccountOwner: membership.isAccountOwner,
    permissionGrants: membership.permissionGrants,
    permissionRevokes: membership.permissionRevokes,
    effectivePermissions: effectivePermissions(membership.role, membership.permissionGrants, membership.permissionRevokes),
    permissions: describeAccess(membership),
    teams: teams.filter((team) => tenantTeamIds.has(team.teamId)).map((team) => ({ teamId: team.teamId, role: team.role, isManager: isTeamManagerRole(team.role) })),
  };
}

async function tenantTeams(deps: AccessControlDeps, tenantId: string, memberships: readonly TeamMembership[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const membership of memberships) {
    const team = await deps.teamRepository!.getById(membership.teamId);
    if (team?.tenantId === tenantId) ids.add(team.id);
  }
  return ids;
}

/**
 * Altera perfil e exceções de UMA vez (o estado salvo é sempre coerente). Trocar de perfil sem
 * mandar exceções zera as exceções — o novo perfil carrega o próprio padrão. Toda diferença vira
 * uma linha de auditoria (perfil, cada permissão concedida/removida).
 */
export async function updateMemberAccess(
  deps: AccessControlDeps,
  actor: AccessContext,
  input: { userId: string; role: TenantRole; permissionGrants?: readonly string[]; permissionRevokes?: readonly string[] },
): Promise<MemberAccessView> {
  const target = await mustMember(deps, input.userId, actor.tenantId);
  const roleChanged = input.role !== target.role;
  const next = normalizeAccessChange({
    role: input.role,
    grants: input.permissionGrants ?? (roleChanged ? [] : target.permissionGrants),
    revokes: input.permissionRevokes ?? (roleChanged ? [] : target.permissionRevokes),
  });
  assertAccessChangeAllowed({ actor: actorFrom(actor), target, next, activeOwnerCount: await activeOwnerCount(deps, actor.tenantId) });
  await deps.membershipRepository.updateAccess(target.userId, actor.tenantId, { role: next.role, permissionGrants: next.grants, permissionRevokes: next.revokes });

  const audit = (eventType: Parameters<AccessAuditLogPort["record"]>[0]["eventType"], previousValue: unknown, newValue: unknown) =>
    deps.accessAuditLog?.record({ tenantId: actor.tenantId, actorUserId: actor.userId, targetUserId: target.userId, eventType, previousValue, newValue });
  if (roleChanged) await audit("role_changed", { role: target.role }, { role: next.role });
  const before = new Set(effectivePermissions(target.role, target.permissionGrants, target.permissionRevokes));
  const after = new Set(effectivePermissions(next.role, next.grants, next.revokes));
  for (const permission of after) if (!before.has(permission)) await audit("permission_granted", { enabled: false }, { permission, origin: next.grants.includes(permission) ? "exception" : "profile" });
  for (const permission of before) if (!after.has(permission)) await audit("permission_revoked", { permission, enabled: true }, { enabled: false, origin: next.revokes.includes(permission) ? "exception" : "profile" });
  deps.onAccessChanged?.(target.userId, actor.tenantId);
  return getMemberAccess(deps, { tenantId: actor.tenantId, userId: target.userId });
}

export async function setMemberStatus(deps: AccessControlDeps, actor: AccessContext, input: { userId: string; status: TenantMembership["status"] }): Promise<MemberAccessView> {
  const target = await mustMember(deps, input.userId, actor.tenantId);
  if (target.status === input.status) return getMemberAccess(deps, { tenantId: actor.tenantId, userId: target.userId });
  if (input.status === "disabled") assertMemberDeactivationAllowed({ actor: actorFrom(actor), target, activeOwnerCount: await activeOwnerCount(deps, actor.tenantId) });
  else if (!hasPermission(actor, "tenant_member:manage")) throw new Error("ACCESS_FORBIDDEN: você não pode reativar usuários.");
  else if (target.role === "owner" && actor.role !== "owner") throw new Error("ACCESS_FORBIDDEN: só um Administrador pode reativar outro Administrador.");
  await deps.membershipRepository.setStatus(target.userId, actor.tenantId, input.status);
  await deps.accessAuditLog?.record({ tenantId: actor.tenantId, actorUserId: actor.userId, targetUserId: target.userId, eventType: input.status === "disabled" ? "member_disabled" : "member_enabled", previousValue: { status: target.status }, newValue: { status: input.status } });
  deps.onAccessChanged?.(target.userId, actor.tenantId);
  return getMemberAccess(deps, { tenantId: actor.tenantId, userId: target.userId });
}

export async function removeMemberSafely(deps: AccessControlDeps, actor: AccessContext, input: { userId: string }): Promise<void> {
  const target = await mustMember(deps, input.userId, actor.tenantId);
  assertMemberDeactivationAllowed({ actor: actorFrom(actor), target, activeOwnerCount: await activeOwnerCount(deps, actor.tenantId) });
  await deps.membershipRepository.remove(target.userId, actor.tenantId);
  await deps.accessAuditLog?.record({ tenantId: actor.tenantId, actorUserId: actor.userId, targetUserId: target.userId, eventType: "member_removed", previousValue: { role: target.role, status: target.status }, newValue: null });
  deps.onAccessChanged?.(target.userId, actor.tenantId);
}

/** Criar/convidar com um perfil: só Administrador cria Administrador; ninguém cria um perfil cujo
 * padrão tenha permissões que ele mesmo não tem. */
export function assertCanAssignRole(actor: AccessContext, role: TenantRole): void {
  if (role === "owner" && actor.role !== "owner") throw new Error("ACCESS_FORBIDDEN: só um Administrador pode criar outro Administrador.");
  const beyond = effectivePermissions(role).filter((permission) => !actor.permissions.includes(permission));
  if (beyond.length && !actor.permissions.includes("tenant_member:manage_permissions")) {
    throw new Error("ACCESS_ESCALATION_FORBIDDEN: você não pode criar usuários com mais acesso que o seu.");
  }
}

/** Mudanças de equipe de um membro: exigem `team:manage`; dar/tirar o papel de gerente da equipe
 * exige também `tenant_member:manage_permissions` (muda o que a pessoa enxerga); e ninguém mexe
 * nas PRÓPRIAS equipes, salvo quem já tem escopo global (não ganha nada com isso). */
export function assertTeamMembershipChangeAllowed(actor: AccessContext, input: { userId: string; changesManager: boolean }): void {
  if (!actor.permissions.includes("team:manage")) throw new Error("ACCESS_FORBIDDEN: você não pode alterar equipes.");
  if (input.changesManager && !actor.permissions.includes("tenant_member:manage_permissions")) throw new Error("ACCESS_FORBIDDEN: definir gerente de equipe exige a permissão de gerenciar perfis e permissões.");
  const global = scopeFor(actor, "inbox") === "all" && scopeFor(actor, "deal") === "all";
  if (input.userId === actor.userId && !global) throw new Error("ACCESS_SELF_CHANGE_FORBIDDEN: você não pode alterar as próprias equipes.");
}

export async function auditTeamMembershipChange(
  deps: Pick<AccessControlDeps, "accessAuditLog" | "onAccessChanged">,
  actor: AccessContext,
  input: { teamId: string; userId: string; before?: TeamMembership; after?: TeamMembership },
): Promise<void> {
  if (!deps.accessAuditLog) return;
  const base = { tenantId: actor.tenantId, actorUserId: actor.userId, targetUserId: input.userId, teamId: input.teamId };
  const wasManager = input.before ? isTeamManagerRole(input.before.role) : false;
  const isManager = input.after ? isTeamManagerRole(input.after.role) : false;
  if (!input.before && input.after) await deps.accessAuditLog.record({ ...base, eventType: "team_member_added", newValue: { role: input.after.role } });
  if (input.before && !input.after) await deps.accessAuditLog.record({ ...base, eventType: "team_member_removed", previousValue: { role: input.before.role } });
  if (!wasManager && isManager) await deps.accessAuditLog.record({ ...base, eventType: "team_manager_granted", previousValue: input.before ? { role: input.before.role } : null, newValue: { role: input.after!.role } });
  if (wasManager && !isManager) await deps.accessAuditLog.record({ ...base, eventType: "team_manager_revoked", previousValue: { role: input.before!.role }, newValue: input.after ? { role: input.after.role } : null });
  deps.onAccessChanged?.(input.userId, actor.tenantId);
}
