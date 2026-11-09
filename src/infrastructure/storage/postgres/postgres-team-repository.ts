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

const idGenerator = () => `team-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const membershipIdGenerator = () => `teammember-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** SQLSTATE `23503` (foreign_key_violation) — código padrão do Postgres, o driver `pg` sempre
 * anexa em `error.code`. Checagem estrutural (nunca `instanceof`, o driver não exporta uma classe
 * de erro própria para isto). */
function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23503";
}

type TeamRow = {
  is_default: boolean;
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

  async getDefaultForWorkspace(input: { tenantId: string; workspaceId: string }): Promise<Team | undefined> {
    const result = await this.pool.query<TeamRow>("select * from teams where tenant_id=$1 and workspace_id=$2 and is_default", [input.tenantId, input.workspaceId]);
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
    const client = await this.pool.connect();
    try {
    await client.query("begin");
    if (input.isDefault) await client.query("select set_workspace_default_team($1)", [id]);
    const result = await client.query<TeamRow>(
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
    await client.query("commit");
    return this.toDomain(result.rows[0]);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Achado de revisão — `inbox_channel_routing_configs.default_team_id` referencia `teams` sem
   * `on delete cascade`/`set null` DE PROPÓSITO (é config ATIVA de um canal, precisa de resolução
   * explícita, nunca deveria sumir silenciosamente) — mas isso faz o Postgres recusar o DELETE com
   * uma violação de FK crua (`23503`). Traduz pra um erro de domínio claro, mesmo padrão do resto
   * do módulo (`TEAM_NOT_FOUND` etc.) — nunca deixa o erro cru do driver vazar pro HTTP.
   * `inbox_conversations.current_team_id` já é `on delete set null` (migration 0124) — nunca
   * bloqueia a exclusão por causa de uma conversa antiga, só limpa a referência.
   */
  async delete(id: string): Promise<void> {
    try {
      await this.pool.query("delete from teams where id = $1", [id]);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new Error("TEAM_LINKED_TO_CHANNEL_ROUTING: esta equipe é a equipe padrão de roteamento de um ou mais canais — escolha outra equipe padrão nesses canais antes de excluir.");
      }
      throw error;
    }
  }

  async selectNextMemberForLevel(teamId: string, level: string): Promise<{ userId: string; usedRoundRobin: boolean } | undefined> {
    const { rows } = await this.pool.query<{ user_id: string; used_round_robin: boolean }>(
      "select * from next_team_member($1,$2)", [teamId, normalizeAttendanceLevel(level)],
    );
    return rows[0] ? { userId: rows[0].user_id, usedRoundRobin: rows[0].used_round_robin } : undefined;
  }

  private toDomain(row: TeamRow): Team {
    return {
      isDefault: row.is_default,
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

  async listByUser(userId: string, tenantId?: string): Promise<TeamMembership[]> {
    const result = await this.pool.query<TeamMembershipRow>("select m.* from team_memberships m join teams t on t.id = m.team_id where m.user_id = $1 and ($2::text is null or t.tenant_id = $2)", [userId, tenantId ?? null]);
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
         is_principal_for_level = coalesce($5, is_principal_for_level),
         role = coalesce($6, role)
       where team_id = $1 and user_id = $2
       returning *`,
      [teamId, userId, level, input.participatesInRoundRobin ?? null, input.isPrincipalForLevel ?? null, input.role ?? null],
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
