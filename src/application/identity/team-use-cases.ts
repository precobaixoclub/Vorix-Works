import type { TeamMembershipRepositoryPort, TeamRepositoryPort } from "../ports/team-repository.port.js";
import type { Team, TeamMembership, TenantRole } from "../../domain/identity/identity.model.js";
import { normalizeAttendanceLevel } from "../../domain/identity/identity.model.js";

export type TeamUseCaseDeps = {
  teamRepository: TeamRepositoryPort;
  teamMembershipRepository: TeamMembershipRepositoryPort;
};

export async function createTeam(deps: TeamUseCaseDeps, input: { tenantId: string; workspaceId: string; name: string }): Promise<Team> {
  return deps.teamRepository.create(input);
}

export async function listTeams(deps: TeamUseCaseDeps, input: { tenantId: string; workspaceId: string }): Promise<Team[]> {
  return deps.teamRepository.listByWorkspace(input);
}

/** Guard de tenant/workspace — nunca 403 (não revela existência cross-tenant), sempre 404. Mesmo
 * padrão usado em toda a Inbox (`mustConversationBelongToTenantAndWorkspace`). */
export async function mustTeamBelongToTenantAndWorkspace(deps: TeamUseCaseDeps, teamId: string, tenantId: string, workspaceId: string): Promise<Team> {
  const team = await deps.teamRepository.getById(teamId);
  if (!team || team.tenantId !== tenantId || team.workspaceId !== workspaceId) {
    throw new Error(`TEAM_NOT_FOUND: equipe "${teamId}" não existe.`);
  }
  return team;
}

export type UpdateTeamInput = { teamId: string; tenantId: string; workspaceId: string; name?: string; roundRobinEnabled?: boolean; timezone?: string };

export async function updateTeam(deps: TeamUseCaseDeps, input: UpdateTeamInput): Promise<Team> {
  await mustTeamBelongToTenantAndWorkspace(deps, input.teamId, input.tenantId, input.workspaceId);
  return deps.teamRepository.update(input.teamId, { name: input.name, roundRobinEnabled: input.roundRobinEnabled, timezone: input.timezone });
}

export async function deleteTeam(deps: TeamUseCaseDeps, input: { teamId: string; tenantId: string; workspaceId: string }): Promise<void> {
  await mustTeamBelongToTenantAndWorkspace(deps, input.teamId, input.tenantId, input.workspaceId);
  await deps.teamRepository.delete(input.teamId);
}

export type AddTeamMemberInput = {
  teamId: string;
  tenantId: string;
  workspaceId: string;
  userId: string;
  role: TenantRole;
  attendanceLevel?: string;
  participatesInRoundRobin?: boolean;
};

/**
 * Bloco "roteamento por equipe" (réplica adaptada do CMDesk) — se este for o PRIMEIRO membro do
 * nível na equipe, vira principal automaticamente (mesmo racional do sistema de referência: um
 * nível nunca fica sem fallback se tiver pelo menos um membro).
 */
export async function addTeamMember(deps: TeamUseCaseDeps, input: AddTeamMemberInput): Promise<TeamMembership> {
  await mustTeamBelongToTenantAndWorkspace(deps, input.teamId, input.tenantId, input.workspaceId);
  const level = normalizeAttendanceLevel(input.attendanceLevel);
  const existingCount = await deps.teamMembershipRepository.countByTeamAndLevel(input.teamId, level);
  return deps.teamMembershipRepository.add({
    teamId: input.teamId,
    userId: input.userId,
    role: input.role,
    attendanceLevel: level,
    participatesInRoundRobin: input.participatesInRoundRobin,
    isPrincipalForLevel: existingCount === 0,
  });
}

export async function removeTeamMember(deps: TeamUseCaseDeps, input: { teamId: string; tenantId: string; workspaceId: string; userId: string }): Promise<void> {
  await mustTeamBelongToTenantAndWorkspace(deps, input.teamId, input.tenantId, input.workspaceId);
  const removed = await deps.teamMembershipRepository.getByTeamAndUser(input.teamId, input.userId);
  await deps.teamMembershipRepository.remove(input.teamId, input.userId);
  // Nível nunca fica sem principal se ainda tiver gente nele — mesmo racional de `addTeamMember`.
  if (removed?.isPrincipalForLevel) await promoteReplacementPrincipal(deps, input.teamId, removed.attendanceLevel);
}

export async function listTeamMembers(deps: TeamUseCaseDeps, input: { teamId: string; tenantId: string; workspaceId: string }): Promise<TeamMembership[]> {
  await mustTeamBelongToTenantAndWorkspace(deps, input.teamId, input.tenantId, input.workspaceId);
  return deps.teamMembershipRepository.listByTeam(input.teamId);
}

export type UpdateTeamMemberInput = {
  teamId: string;
  tenantId: string;
  workspaceId: string;
  userId: string;
  attendanceLevel?: string;
  participatesInRoundRobin?: boolean;
  /** `true` = marca este membro como principal do nível (desmarca qualquer outro do MESMO nível
   * automaticamente). `false`/`undefined` = não mexe na marcação de principal diretamente — mas se
   * o membro estava marcado e está MUDANDO de nível, o nível antigo ganha um substituto
   * automático (ver `promoteReplacementPrincipal`). */
  setPrincipal?: boolean;
};

export async function updateTeamMember(deps: TeamUseCaseDeps, input: UpdateTeamMemberInput): Promise<TeamMembership> {
  await mustTeamBelongToTenantAndWorkspace(deps, input.teamId, input.tenantId, input.workspaceId);
  const current = await deps.teamMembershipRepository.getByTeamAndUser(input.teamId, input.userId);
  if (!current) throw new Error(`TEAM_MEMBER_NOT_FOUND: usuário "${input.userId}" não é membro da equipe "${input.teamId}".`);

  const nextLevel = input.attendanceLevel !== undefined ? normalizeAttendanceLevel(input.attendanceLevel) : current.attendanceLevel;
  const changingLevel = nextLevel !== current.attendanceLevel;
  const losingPrincipal = current.isPrincipalForLevel && (changingLevel || input.setPrincipal === false);

  if (input.setPrincipal === true) {
    // Mesmo nível de destino (nunca o antigo, se estiver mudando junto) — desmarca todos os outros.
    await deps.teamMembershipRepository.clearPrincipalForLevel(input.teamId, nextLevel, input.userId);
  }

  const updated = await deps.teamMembershipRepository.update(input.teamId, input.userId, {
    attendanceLevel: input.attendanceLevel,
    participatesInRoundRobin: input.participatesInRoundRobin,
    isPrincipalForLevel: input.setPrincipal,
  });

  if (losingPrincipal) await promoteReplacementPrincipal(deps, input.teamId, current.attendanceLevel, input.userId);
  // Mudou de nível e o nível NOVO ainda não tinha ninguém — vira principal automaticamente lá
  // também (mesmo racional de `addTeamMember`, primeiro membro do nível é sempre principal).
  if (changingLevel && !updated.isPrincipalForLevel) {
    const countAtNewLevel = await deps.teamMembershipRepository.countByTeamAndLevel(input.teamId, nextLevel);
    if (countAtNewLevel === 1) {
      return deps.teamMembershipRepository.update(input.teamId, input.userId, { isPrincipalForLevel: true });
    }
  }
  return updated;
}

/** Garante que um nível nunca fica sem principal enquanto tiver pelo menos um membro — escolhe
 * qualquer membro restante do nível (o primeiro por ordem de entrada) como substituto. */
async function promoteReplacementPrincipal(deps: TeamUseCaseDeps, teamId: string, level: string, excludeUserId?: string): Promise<void> {
  const members = await deps.teamMembershipRepository.listByTeam(teamId);
  const candidates = members.filter((member) => member.attendanceLevel === level && member.userId !== excludeUserId);
  if (candidates.length === 0) return;
  await deps.teamMembershipRepository.update(teamId, candidates[0].userId, { isPrincipalForLevel: true });
}

export type ResolveNextTeamMemberInput = { teamId: string; level?: string };

/** Bloco "roteamento por equipe" — wrapper fino sobre `TeamRepositoryPort.selectNextMemberForLevel`
 * (a lógica de fato vive no adapter Postgres, que serializa via lock advisory). `undefined` = nível
 * sem nenhum membro na equipe; quem chama decide o fallback (ex.: conversa fica na equipe, sem
 * agente atribuído). */
export async function resolveNextTeamMember(deps: TeamUseCaseDeps, input: ResolveNextTeamMemberInput): Promise<{ userId: string; usedRoundRobin: boolean } | undefined> {
  return deps.teamRepository.selectNextMemberForLevel(input.teamId, normalizeAttendanceLevel(input.level));
}
