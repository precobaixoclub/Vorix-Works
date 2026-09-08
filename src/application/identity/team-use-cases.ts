import type { TeamMembershipRepositoryPort, TeamRepositoryPort } from "../ports/team-repository.port.js";
import type { Team, TeamMembership, TenantRole } from "../../domain/identity/identity.model.js";

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

export async function updateTeam(deps: TeamUseCaseDeps, input: { teamId: string; tenantId: string; workspaceId: string; name: string }): Promise<Team> {
  await mustTeamBelongToTenantAndWorkspace(deps, input.teamId, input.tenantId, input.workspaceId);
  return deps.teamRepository.update(input.teamId, { name: input.name });
}

export async function deleteTeam(deps: TeamUseCaseDeps, input: { teamId: string; tenantId: string; workspaceId: string }): Promise<void> {
  await mustTeamBelongToTenantAndWorkspace(deps, input.teamId, input.tenantId, input.workspaceId);
  await deps.teamRepository.delete(input.teamId);
}

export async function addTeamMember(deps: TeamUseCaseDeps, input: { teamId: string; tenantId: string; workspaceId: string; userId: string; role: TenantRole }): Promise<TeamMembership> {
  await mustTeamBelongToTenantAndWorkspace(deps, input.teamId, input.tenantId, input.workspaceId);
  return deps.teamMembershipRepository.add({ teamId: input.teamId, userId: input.userId, role: input.role });
}

export async function removeTeamMember(deps: TeamUseCaseDeps, input: { teamId: string; tenantId: string; workspaceId: string; userId: string }): Promise<void> {
  await mustTeamBelongToTenantAndWorkspace(deps, input.teamId, input.tenantId, input.workspaceId);
  await deps.teamMembershipRepository.remove(input.teamId, input.userId);
}

export async function listTeamMembers(deps: TeamUseCaseDeps, input: { teamId: string; tenantId: string; workspaceId: string }): Promise<TeamMembership[]> {
  await mustTeamBelongToTenantAndWorkspace(deps, input.teamId, input.tenantId, input.workspaceId);
  return deps.teamMembershipRepository.listByTeam(input.teamId);
}
