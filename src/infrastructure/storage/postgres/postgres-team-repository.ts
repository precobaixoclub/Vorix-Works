import type { Pool } from "pg";
import type { CreateTeamInput, TeamRepositoryPort, TeamMembershipRepositoryPort } from "../../../application/ports/team-repository.port.js";
import type { Team, TeamMembership } from "../../../domain/identity/identity.model.js";

const idGenerator = () => `team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const membershipIdGenerator = () => `teammember-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type TeamRow = { id: string; tenant_id: string; workspace_id: string; name: string; created_at: Date; updated_at: Date };
type TeamMembershipRow = { id: string; team_id: string; user_id: string; role: string; created_at: Date };

export class PostgresTeamRepository implements TeamRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateTeamInput): Promise<Team> {
    const result = await this.pool.query<TeamRow>(
      "insert into teams (id, tenant_id, workspace_id, name) values ($1, $2, $3, $4) returning *",
      [idGenerator(), input.tenantId, input.workspaceId, input.name],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<Team | undefined> {
    const result = await this.pool.query<TeamRow>("select * from teams where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string }): Promise<Team[]> {
    const result = await this.pool.query<TeamRow>(
      "select * from teams where tenant_id = $1 and workspace_id = $2 order by name asc",
      [input.tenantId, input.workspaceId],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async update(id: string, input: { name: string }): Promise<Team> {
    const result = await this.pool.query<TeamRow>(
      "update teams set name = $2, updated_at = now() where id = $1 returning *",
      [id, input.name],
    );
    if (!result.rows[0]) throw new Error(`TEAM_NOT_FOUND: equipe "${id}" não existe.`);
    return this.toDomain(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from teams where id = $1", [id]);
  }

  private toDomain(row: TeamRow): Team {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      name: row.name,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}

export class PostgresTeamMembershipRepository implements TeamMembershipRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async add(input: { teamId: string; userId: string; role: TeamMembership["role"] }): Promise<TeamMembership> {
    const result = await this.pool.query<TeamMembershipRow>(
      `insert into team_memberships (id, team_id, user_id, role) values ($1, $2, $3, $4)
       on conflict (team_id, user_id) do update set role = excluded.role
       returning *`,
      [membershipIdGenerator(), input.teamId, input.userId, input.role],
    );
    return this.toDomain(result.rows[0]);
  }

  async remove(teamId: string, userId: string): Promise<void> {
    await this.pool.query("delete from team_memberships where team_id = $1 and user_id = $2", [teamId, userId]);
  }

  async listByTeam(teamId: string): Promise<TeamMembership[]> {
    const result = await this.pool.query<TeamMembershipRow>("select * from team_memberships where team_id = $1 order by created_at asc", [teamId]);
    return result.rows.map((row) => this.toDomain(row));
  }

  async listByUser(userId: string): Promise<TeamMembership[]> {
    const result = await this.pool.query<TeamMembershipRow>("select * from team_memberships where user_id = $1", [userId]);
    return result.rows.map((row) => this.toDomain(row));
  }

  private toDomain(row: TeamMembershipRow): TeamMembership {
    return { id: row.id, teamId: row.team_id, userId: row.user_id, role: row.role as TeamMembership["role"], createdAt: row.created_at.toISOString() };
  }
}
