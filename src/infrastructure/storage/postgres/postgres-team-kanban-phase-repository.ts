import type { Pool } from "pg";
import type { CreateKanbanPhaseInput, TeamKanbanPhaseRepositoryPort, UpdateKanbanPhaseInput } from "../../../application/ports/team-kanban-phase-repository.port.js";
import type { KanbanPhaseType, TeamKanbanPhase } from "../../../domain/identity/identity.model.js";

const idGenerator = () => `kanbanphase-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Row = {
  id: string; tenant_id: string; team_id: string; name: string; order_index: number;
  is_default_first: boolean; phase_type: string; nao_contabiliza_operacional: boolean;
  created_at: Date; updated_at: Date;
};

/**
 * Bloco "kanban de atendimento" (réplica adaptada do CMDesk, pedido explícito do usuário). Ver
 * `db/migrations/0125_inbox_kanban.sql` e o port pra racional de cada método.
 */
export class PostgresTeamKanbanPhaseRepository implements TeamKanbanPhaseRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async countByTeam(teamId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>("select count(*)::text as count from team_kanban_phases where team_id = $1", [teamId]);
    return Number(result.rows[0]?.count ?? 0);
  }

  async createMany(phases: readonly (CreateKanbanPhaseInput & { orderIndex: number; isDefaultFirst: boolean })[]): Promise<TeamKanbanPhase[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const created: Row[] = [];
      for (const phase of phases) {
        const result = await client.query<Row>(
          `insert into team_kanban_phases (id, tenant_id, team_id, name, order_index, is_default_first, phase_type)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning *`,
          [idGenerator(), phase.tenantId, phase.teamId, phase.name, phase.orderIndex, phase.isDefaultFirst, phase.phaseType ?? "RUNNING"],
        );
        created.push(result.rows[0]);
      }
      await client.query("COMMIT");
      return created.map((row) => this.toDomain(row));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async create(input: CreateKanbanPhaseInput & { orderIndex: number }): Promise<TeamKanbanPhase> {
    const result = await this.pool.query<Row>(
      `insert into team_kanban_phases (id, tenant_id, team_id, name, order_index, phase_type)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [idGenerator(), input.tenantId, input.teamId, input.name, input.orderIndex, input.phaseType ?? "RUNNING"],
    );
    return this.toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<TeamKanbanPhase | undefined> {
    const result = await this.pool.query<Row>("select * from team_kanban_phases where id = $1", [id]);
    return result.rows[0] ? this.toDomain(result.rows[0]) : undefined;
  }

  async listByTeam(teamId: string): Promise<TeamKanbanPhase[]> {
    const result = await this.pool.query<Row>("select * from team_kanban_phases where team_id = $1 order by order_index asc", [teamId]);
    return result.rows.map((row) => this.toDomain(row));
  }

  async update(id: string, input: UpdateKanbanPhaseInput): Promise<TeamKanbanPhase> {
    const result = await this.pool.query<Row>(
      `update team_kanban_phases set
         name = coalesce($2, name),
         is_default_first = coalesce($3, is_default_first),
         phase_type = coalesce($4, phase_type),
         nao_contabiliza_operacional = coalesce($5, nao_contabiliza_operacional),
         updated_at = now()
       where id = $1
       returning *`,
      [id, input.name ?? null, input.isDefaultFirst ?? null, input.phaseType ?? null, input.naoContabilizaOperacional ?? null],
    );
    if (!result.rows[0]) throw new Error(`KANBAN_PHASE_NOT_FOUND: fase "${id}" não existe.`);
    return this.toDomain(result.rows[0]);
  }

  async clearDefaultFirst(teamId: string, exceptPhaseId?: string): Promise<void> {
    await this.pool.query(
      "update team_kanban_phases set is_default_first = false where team_id = $1 and id is distinct from $2",
      [teamId, exceptPhaseId ?? null],
    );
  }

  async deleteWithFallback(id: string, fallbackPhaseId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Migra os cards da fase excluída pro fallback ANTES de excluir — nunca deixa uma conversa
      // com `current_phase_id` apontando pra uma fase que já não existe (mesmo sem a FK ser
      // `on delete restrict`, é o comportamento certo pro usuário: card nunca "some" do quadro).
      await client.query("update inbox_conversations set current_phase_id = $2, updated_at = now() where current_phase_id = $1", [id, fallbackPhaseId]);
      await client.query("delete from team_kanban_phases where id = $1", [id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Duas passadas (ver seção 4.5 do guia do usuário) — jogar todo mundo pra índices temporários
   * BEM acima do range atual antes de aplicar os finais evita violar a constraint única
   * `(tenant_id, team_id, order_index)` quando duas fases trocam de posição (a fase B tentaria
   * pegar o índice da fase A antes de A ser atualizada, numa passada só).
   */
  async reorder(teamId: string, phaseIdsInOrder: readonly string[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const maxResult = await client.query<{ max: number | null }>("select max(order_index) as max from team_kanban_phases where team_id = $1", [teamId]);
      const tempBase = (maxResult.rows[0]?.max ?? -1) + phaseIdsInOrder.length + 1;
      for (let i = 0; i < phaseIdsInOrder.length; i += 1) {
        await client.query("update team_kanban_phases set order_index = $2, updated_at = now() where id = $1 and team_id = $3", [phaseIdsInOrder[i], tempBase + i, teamId]);
      }
      for (let i = 0; i < phaseIdsInOrder.length; i += 1) {
        await client.query("update team_kanban_phases set order_index = $2, updated_at = now() where id = $1 and team_id = $3", [phaseIdsInOrder[i], i, teamId]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private toDomain(row: Row): TeamKanbanPhase {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      teamId: row.team_id,
      name: row.name,
      orderIndex: row.order_index,
      isDefaultFirst: row.is_default_first,
      phaseType: row.phase_type as KanbanPhaseType,
      naoContabilizaOperacional: row.nao_contabiliza_operacional,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
