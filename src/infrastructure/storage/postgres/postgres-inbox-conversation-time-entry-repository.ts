import type { Pool } from "pg";
import type { ConversationServiceTime, ConversationTimeEntryRepositoryPort } from "../../../application/ports/inbox-conversation-time-entry-repository.port.js";
import type { ConversationTimeEntryPhaseType } from "../../../domain/inbox/inbox.model.js";

const idGenerator = () => `timeentry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Bloco "kanban de atendimento" (réplica adaptada do CMDesk, pedido explícito do usuário) — ver
 * `db/migrations/0125_inbox_kanban.sql`. O lock+transação de `moveConversationPhase` vive INTEIRO
 * aqui (nunca na camada de aplicação) — mesmo padrão de `PostgresTeamRepository.selectNextMemberForLevel`.
 */
export class PostgresConversationTimeEntryRepository implements ConversationTimeEntryRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async moveConversationPhase(input: { tenantId: string; conversationId: string; teamId: string; phaseId: string; phaseType: ConversationTimeEntryPhaseType }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Lock na própria linha da conversa — serializa qualquer tentativa concorrente de mover o
      // MESMO card (drag manual + automação futura, ou dois atendentes ao mesmo tempo). Sem isto,
      // fechar/abrir entradas de tempo de duas chamadas concorrentes poderia intercalar e deixar
      // DUAS entradas abertas — viola o invariante "no máximo uma entrada aberta por
      // (conversationId, teamId)" documentado em `ConversationTimeEntry`.
      await client.query("select id from inbox_conversations where id = $1 for update", [input.conversationId]);

      await client.query(
        `update conversation_time_entries
           set ended_at = now(), duration_seconds = extract(epoch from (now() - started_at))::int
         where conversation_id = $1 and team_id = $2 and ended_at is null`,
        [input.conversationId, input.teamId],
      );
      await client.query(
        `insert into conversation_time_entries (id, tenant_id, conversation_id, team_id, phase_id, phase_type, started_at, created_at)
         values ($1, $2, $3, $4, $5, $6, now(), now())`,
        [idGenerator(), input.tenantId, input.conversationId, input.teamId, input.phaseId, input.phaseType],
      );
      await client.query("update inbox_conversations set current_phase_id = $2, updated_at = now() where id = $1", [input.conversationId, input.phaseId]);

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async closeOpenEntry(input: { conversationId: string; teamId: string }): Promise<void> {
    await this.pool.query(
      `update conversation_time_entries
         set ended_at = now(), duration_seconds = extract(epoch from (now() - started_at))::int
       where conversation_id = $1 and team_id = $2 and ended_at is null`,
      [input.conversationId, input.teamId],
    );
  }

  async openFirstIfMissing(input: { tenantId: string; conversationId: string; teamId: string; phaseId: string; phaseType: ConversationTimeEntryPhaseType }): Promise<void> {
    await this.pool.query(
      `insert into conversation_time_entries (id, tenant_id, conversation_id, team_id, phase_id, phase_type, started_at, created_at)
       select $1, $2, $3, $4, $5, $6, now(), now()
       where not exists (
         select 1 from conversation_time_entries where conversation_id = $3 and team_id = $4
       )`,
      [idGenerator(), input.tenantId, input.conversationId, input.teamId, input.phaseId, input.phaseType],
    );
  }

  async getServiceTimeBulk(input: { tenantId: string; teamId: string; conversationIds: readonly string[] }): Promise<ConversationServiceTime[]> {
    if (input.conversationIds.length === 0) return [];
    // Soma dos fechados RUNNING (nunca a entrada aberta — essa vira `currentPhaseStartedAt` +
    // `isRunning`, incrementada ao vivo só no frontend, ver seção 5.3 do guia do usuário) +
    // metadados da entrada aberta, numa única ida ao banco (2 CTEs, um join por conversa).
    const result = await this.pool.query<{
      conversation_id: string; total_seconds: string | null; open_started_at: Date | null; open_phase_type: string | null;
    }>(
      `with closed as (
         select conversation_id, coalesce(sum(duration_seconds), 0) as total_seconds
         from conversation_time_entries
         where team_id = $1 and conversation_id = any($2::text[]) and ended_at is not null and phase_type = 'RUNNING'
         group by conversation_id
       ),
       open_entry as (
         select distinct on (conversation_id) conversation_id, started_at, phase_type
         from conversation_time_entries
         where team_id = $1 and conversation_id = any($2::text[]) and ended_at is null
         order by conversation_id, started_at desc
       )
       select
         conv.id as conversation_id,
         closed.total_seconds,
         open_entry.started_at as open_started_at,
         open_entry.phase_type as open_phase_type
       from unnest($2::text[]) as conv(id)
       left join closed on closed.conversation_id = conv.id
       left join open_entry on open_entry.conversation_id = conv.id`,
      [input.teamId, input.conversationIds],
    );
    return result.rows.map((row) => ({
      conversationId: row.conversation_id,
      totalSeconds: Number(row.total_seconds ?? 0),
      currentPhaseStartedAt: row.open_started_at?.toISOString(),
      isRunning: Boolean(row.open_started_at) && row.open_phase_type !== "PAUSED",
    }));
  }
}
