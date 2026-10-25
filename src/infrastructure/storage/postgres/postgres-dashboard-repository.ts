import type { Pool } from "pg";
import type { AttendanceFactRow, DashboardRepositoryPort, PhaseTimeRow, SlaPolicy, SlaPolicyScope } from "../../../application/ports/dashboard-repository.port.js";
import type { AssignmentFact } from "../../../domain/dashboard/dashboard-metrics.js";

const newId = () => `sla-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const iso = (value: Date | null) => (value ? value.toISOString() : undefined);

type AttendanceRow = {
  id: string; conversation_id: string; connection_id: string; team_id: string | null; status: string;
  opened_at: Date; closed_at: Date | null; closed_by: string | null; first_response_at: Date | null;
  closure_type_name: string | null; closure_subtype_name: string | null; csat_status: string | null; csat_score: number | null;
  reopened_count: number; open_reason: string; last_direction: string | null; phase_type: string | null;
};
type AssignmentRow = { source: string; attendance_id: string; user_id: string; started_at: Date; first_response_at: Date | null; ended_at: Date | null; end_reason: string | null };
type SlaRow = { id: string; tenant_id: string; workspace_id: string; scope_type: string; scope_id: string | null; first_response_seconds: number | null; resolution_seconds: number | null; updated_by: string | null; updated_at: Date };

/** Fatos da Dashboard em poucas idas ao banco, sempre limitados ao workspace e ao período (mais o
 * backlog aberto, que é pequeno por natureza). Índices em 0172/0174. */
export class PostgresDashboardRepository implements DashboardRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async listAttendanceFacts(input: { tenantId: string; workspaceId: string; from: string; to: string; connectionId?: string }): Promise<{ attendances: AttendanceFactRow[]; assignments: AssignmentFact[] }> {
    const attendances = await this.pool.query<AttendanceRow>(
      `select a.id, a.conversation_id, a.connection_id, coalesce(a.team_id, c.current_team_id) as team_id, a.status,
              a.opened_at, a.closed_at, a.closed_by, a.first_response_at, a.closure_type_name, a.closure_subtype_name,
              a.csat_status, a.csat_score, a.reopened_count, a.open_reason, lm.direction as last_direction, ph.phase_type
       from inbox_attendances a
       join inbox_conversations c on c.id = a.conversation_id
       left join lateral (
         select m.direction from inbox_messages m where a.status = 'open' and m.conversation_id = a.conversation_id order by m.created_at desc limit 1
       ) lm on true
       left join team_kanban_phases ph on a.status = 'open' and ph.id = c.current_phase_id
       where a.tenant_id = $1 and a.workspace_id = $2 and ($5::text is null or a.connection_id = $5)
         and (a.status = 'open'
           or (a.opened_at >= $3 and a.opened_at < $4)
           or (a.closed_at >= $3 and a.closed_at < $4)
           or exists (select 1 from inbox_attendance_assignments x where x.attendance_id = a.id and ((x.started_at >= $3 and x.started_at < $4) or (x.ended_at >= $3 and x.ended_at < $4) or (x.first_response_at >= $3 and x.first_response_at < $4))))
       limit 50000`,
      [input.tenantId, input.workspaceId, input.from, input.to, input.connectionId ?? null],
    );
    const ids = attendances.rows.map((row) => row.id);
    const assignments = ids.length
      ? await this.pool.query<AssignmentRow>("select source, attendance_id, user_id, started_at, first_response_at, ended_at, end_reason from inbox_attendance_assignments where attendance_id = any($1::text[])", [ids])
      : { rows: [] as AssignmentRow[] };
    return {
      attendances: attendances.rows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        connectionId: row.connection_id,
        teamId: row.team_id ?? undefined,
        status: row.status === "closed" ? "closed" : "open",
        openedAt: row.opened_at.toISOString(),
        closedAt: iso(row.closed_at),
        closedBy: row.closed_by ?? undefined,
        firstResponseAt: iso(row.first_response_at),
        closureTypeName: row.closure_type_name ?? undefined,
        closureSubtypeName: row.closure_subtype_name ?? undefined,
        csatStatus: row.csat_status ?? undefined,
        csatScore: row.csat_score ?? undefined,
        reopenedCount: Number(row.reopened_count),
        resolutionKnown: row.open_reason !== "migration",
        lastMessageDirection: row.last_direction === "inbound" || row.last_direction === "outbound" ? row.last_direction : undefined,
        waitingPhase: row.phase_type === "PAUSED",
      })),
      assignments: assignments.rows.map((row) => ({
        attendanceId: row.attendance_id,
        timingKnown: row.source !== "migration",
        userId: row.user_id,
        startedAt: row.started_at.toISOString(),
        firstResponseAt: iso(row.first_response_at),
        endedAt: iso(row.ended_at),
        endReason: row.end_reason ?? undefined,
      })),
    };
  }

  async listPhaseTimes(input: { tenantId: string; workspaceId: string; from: string; to: string }): Promise<PhaseTimeRow[]> {
    const result = await this.pool.query<{ phase_name: string | null; seconds: number; team_id: string; conversation_id: string }>(
      `select coalesce(p.name, 'Fase excluída') as phase_name, e.duration_seconds as seconds, e.team_id, e.conversation_id
       from conversation_time_entries e
       join inbox_conversations c on c.id = e.conversation_id
       left join team_kanban_phases p on p.id = e.phase_id
       where c.tenant_id = $1 and c.workspace_id = $2 and e.ended_at >= $3 and e.ended_at < $4 and e.duration_seconds is not null
       limit 50000`,
      [input.tenantId, input.workspaceId, input.from, input.to],
    );
    return result.rows.map((row) => ({ phaseName: row.phase_name ?? "Fase excluída", seconds: Number(row.seconds), teamId: row.team_id, conversationId: row.conversation_id }));
  }

  async listSlaPolicies(workspaceId: string): Promise<SlaPolicy[]> {
    const result = await this.pool.query<SlaRow>("select * from inbox_sla_policies where workspace_id = $1 order by scope_type, scope_id", [workspaceId]);
    return result.rows.map(toPolicy);
  }

  async upsertSlaPolicy(input: Omit<SlaPolicy, "id" | "updatedAt">): Promise<SlaPolicy> {
    const result = await this.pool.query<SlaRow>(
      `insert into inbox_sla_policies (id, tenant_id, workspace_id, scope_type, scope_id, first_response_seconds, resolution_seconds, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (workspace_id, scope_type, coalesce(scope_id, '')) do update set
         first_response_seconds = excluded.first_response_seconds, resolution_seconds = excluded.resolution_seconds,
         updated_by = excluded.updated_by, updated_at = now()
       returning *`,
      [newId(), input.tenantId, input.workspaceId, input.scopeType, input.scopeId ?? null, input.firstResponseSeconds ?? null, input.resolutionSeconds ?? null, input.updatedBy ?? null],
    );
    return toPolicy(result.rows[0]!);
  }

  async deleteSlaPolicy(input: { workspaceId: string; scopeType: SlaPolicyScope; scopeId?: string }): Promise<void> {
    await this.pool.query("delete from inbox_sla_policies where workspace_id = $1 and scope_type = $2 and coalesce(scope_id, '') = coalesce($3, '')", [input.workspaceId, input.scopeType, input.scopeId ?? null]);
  }
}

function toPolicy(row: SlaRow): SlaPolicy {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    scopeType: row.scope_type as SlaPolicyScope,
    scopeId: row.scope_id ?? undefined,
    firstResponseSeconds: row.first_response_seconds ?? undefined,
    resolutionSeconds: row.resolution_seconds ?? undefined,
    updatedBy: row.updated_by ?? undefined,
    updatedAt: row.updated_at.toISOString(),
  };
}
