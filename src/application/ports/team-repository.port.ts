import type { Team, TeamMembership, TenantRole } from "../../domain/identity/identity.model.js";

export type CreateTeamInput = { tenantId: string; workspaceId: string; name: string };

export type TeamRepositoryPort = {
  create(input: CreateTeamInput): Promise<Team>;
  getById(id: string): Promise<Team | undefined>;
  listByWorkspace(input: { tenantId: string; workspaceId: string }): Promise<Team[]>;
  update(id: string, input: { name: string }): Promise<Team>;
  delete(id: string): Promise<void>;
};

export type TeamMembershipRepositoryPort = {
  add(input: { teamId: string; userId: string; role: TenantRole }): Promise<TeamMembership>;
  remove(teamId: string, userId: string): Promise<void>;
  listByTeam(teamId: string): Promise<TeamMembership[]>;
  listByUser(userId: string): Promise<TeamMembership[]>;
};
