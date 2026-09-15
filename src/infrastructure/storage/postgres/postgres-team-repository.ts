import type { Pool } from "pg";
import type {
  AddTeamMemberInput,
  CreateTeamInput,
  TeamRepositoryPort,
  TeamMembershipRepositoryPort,
  UpdateTeamInput,
  UpdateTeamMemberInput,
} from "../../../application/ports/team-repository.port.js";
import type { Team, TeamMembership } from "../../../domain/identity/identity.model.js";
import { DEFAULT_ATTENDANCE_LEVEL, normalizeAttendanceLevel } from "../../../domain/identity/identity.model.js";
import { withIdentityLock } from "./identity-advisory-lock.js";

const idGenerator = () => `team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const membershipIdGenerator = () => `teammember-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type TeamRow = {
  id: string; tenant_id: string; workspace_id: string; name: string;
  round_robin_enabled: boolean; last_assigned_index_by_level: Record<string, number>; timezone: string;
  created_at: Date; updated_at: Date;
};
type TeamMembershipRow = {
  id: string; team_id: string; user_id: string; role: string;
  attendance_level: string; is_principal_for_level: boolean; participates_in_round_robin: boolean;
  last_assigned_at: Date | null; created_at: Date;
};

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

  async update(id: string, input: UpdateTeamInput): Promise<Team> {
    const result = await this.pool.query<TeamRow>(
      `update teams set
         name = coalesce($2, name),
         round_robin_enabled = coalesce($3, round_robin_enabled),
         timezone = coalesce($4, timezone),
         updated_at = now()
       where id = $1
       returning *`,
      [id, input.name ?? null, input.roundRobinEnabled ?? null, input.timezone ?? null],
    );
    if (!result.rows[0]) throw new Error(`TEAM_NOT_FOUND: equipe "${id}" não existe.`);
    return this.toDomain(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from teams where id = $1", [id]);
  }

  async selectNextMemberForLevel(teamId: string, level: string): Promise<{ userId: string; usedRoundRobin: boolean } | undefined> {
    const normalizedLevel = normalizeAttendanceLevel(level);
    return withIdentityLock(this.pool, `team-roundrobin:${teamId}:${normalizedLevel}`, async (client) => {
      const teamResult = await client.query<Pick<TeamRow, "round_robin_enabled" | "last_assigned_index_by_level">>(
        "select round_robin_enabled, last_assigned_index_by_level from teams where id = $1",
        [teamId],
      );
      const team = teamResult.rows[0];
      if (!team) return undefined;

      const membersResult = await client.query<TeamMembershipRow>(
        "select * from team_memberships where team_id = $1 and attendance_level = $2 order by created_at asc",
        [teamId, normalizedLevel],
      );
      const members = membersResult.rows;
      if (members.length === 0) return undefined;

      const principal = members.find((member) => member.is_principal_for_level) ?? members[0];

      if (!team.round_robin_enabled) return { userId: principal.user_id, usedRoundRobin: false };

      const eligible = members.filter((member) => member.participates_in_round_robin);
      if (eligible.length === 0) return { userId: principal.user_id, usedRoundRobin: false };

      const pointerMap = team.last_assigned_index_by_level ?? {};
      const pointer = pointerMap[normalizedLevel] ?? 0;
      const index = pointer % eligible.length;
      const selected = eligible[index];

      const nextPointerMap = { ...pointerMap, [normalizedLevel]: index + 1 };
      await client.query("update teams set last_assigned_index_by_level = $2, updated_at = now() where id = $1", [teamId, JSON.stringify(nextPointerMap)]);
      await client.query("update team_memberships set last_assigned_at = now() where team_id = $1 and user_id = $2", [teamId, selected.user_id]);

      return { userId: selected.user_id, usedRoundRobin: true };
    });
  }

  private toDomain(row: TeamRow): Team {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      name: row.name,
      roundRobinEnabled: row.round_robin_enabled,
      lastAssignedIndexByLevel: row.last_assigned_index_by_level ?? {},
      timezone: row.timezone,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}

export class PostgresTeamMembershipRepository implements TeamMembershipRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async add(input: AddTeamMemberInput): Promise<TeamMembership> {
    const level = normalizeAttendanceLevel(input.attendanceLevel);
    const result = await this.pool.query<TeamMembershipRow>(
      `insert into team_memberships (id, team_id, user_id, role, attendance_level, participates_in_round_robin, is_principal_for_level)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (team_id, user_id) do update set
         role = excluded.role,
         attendance_level = excluded.attendance_level,
         participates_in_round_robin = excluded.participates_in_round_robin
       returning *`,
      [membershipIdGenerator(), input.teamId, input.userId, input.role, level, input.participatesInRoundRobin ?? true, input.isPrincipalForLevel ?? false],
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

  async getByTeamAndUser(teamId: string, userId: string): Promise<TeamMembership | undefined> {
    const result = await this.pool.query<TeamMembershipRow>("select * from team_memberships where team_id = $1 and user_id = $2", [teamId, userId]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async update(teamId: string, userId: string, input: UpdateTeamMemberInput): Promise<TeamMembership> {
    const level = input.attendanceLevel !== undefined ? normalizeAttendanceLevel(input.attendanceLevel) : null;
    const result = await this.pool.query<TeamMembershipRow>(
      `update team_memberships set
         attendance_level = coalesce($3, attendance_level),
         participates_in_round_robin = coalesce($4, participates_in_round_robin),
         is_principal_for_level = coalesce($5, is_principal_for_level)
       where team_id = $1 and user_id = $2
       returning *`,
      [teamId, userId, level, input.participatesInRoundRobin ?? null, input.isPrincipalForLevel ?? null],
    );
    if (!result.rows[0]) throw new Error(`TEAM_MEMBER_NOT_FOUND: usuário "${userId}" não é membro da equipe "${teamId}".`);
    return this.toDomain(result.rows[0]);
  }

  /** Usado só por `team-use-cases.ts` (`clearPrincipalForLevel`) pra manter "exatamente um
   * principal por nível" — nunca chamado fora desse racional. */
  async clearPrincipalForLevel(teamId: string, level: string, exceptUserId?: string): Promise<void> {
    await this.pool.query(
      "update team_memberships set is_principal_for_level = false where team_id = $1 and attendance_level = $2 and user_id is distinct from $3",
      [teamId, normalizeAttendanceLevel(level), exceptUserId ?? null],
    );
  }

  async countByTeamAndLevel(teamId: string, level: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "select count(*)::text as count from team_memberships where team_id = $1 and attendance_level = $2",
      [teamId, normalizeAttendanceLevel(level)],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private toDomain(row: TeamMembershipRow): TeamMembership {
    return {
      id: row.id,
      teamId: row.team_id,
      userId: row.user_id,
      role: row.role as TeamMembership["role"],
      attendanceLevel: row.attendance_level || DEFAULT_ATTENDANCE_LEVEL,
      isPrincipalForLevel: row.is_principal_for_level,
      participatesInRoundRobin: row.participates_in_round_robin,
      lastAssignedAt: row.last_assigned_at?.toISOString(),
      createdAt: row.created_at.toISOString(),
    };
  }
}
