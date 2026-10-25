import type { Pool, PoolClient } from "pg";
import type {
  ChangeAttendanceResponsibleInput,
  CloseInboxAttendanceInput,
  InboxAttendanceRepositoryPort,
  InboxAttendanceWithAssignments,
  OpenInboxAttendanceInput,
} from "../../../application/ports/inbox-attendance-repository.port.js";
import type {
  InboxAssignmentEndReason,
  InboxAssignmentSource,
  InboxAttendance,
  InboxAttendanceAssignment,
  InboxAttendanceCsatStatus,
  InboxAttendanceOpenReason,
  InboxAttendanceStatus,
  InboxDistributionRule,
} from "../../../domain/inbox/attendance.model.js";

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type AttendanceRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  conversation_id: string;
  contact_id: string | null;
  connection_id: string;
  team_id: string | null;
  number: number;
  status: string;
  opened_at: Date;
  opened_by: string;
  open_reason: string;
  distribution_rule: string | null;
  initial_assignee_user_id: string | null;
  first_response_at: Date | null;
  first_response_by: string | null;
  closed_at: Date | null;
  closed_by: string | null;
  closure_type_id: string | null;
  closure_subtype_id: string | null;
  closure_type_name: string | null;
  closure_subtype_name: string | null;
  closure_note: string | null;
  resolution_seconds: number | null;
  csat_status: string | null;
  csat_waived_by: string | null;
  csat_sent_at: Date | null;
  csat_score: number | null;
  csat_answered_at: Date | null;
  reopened_count: number;
  last_reopened_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type AssignmentRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  attendance_id: string;
  conversation_id: string;
  user_id: string;
  team_id: string | null;
  source: string;
  assigned_by: string;
  started_at: Date;
  first_response_at: Date | null;
  first_response_message_id: string | null;
  first_response_seconds: number | null;
  ended_at: Date | null;
  end_reason: string | null;
  transferred_to_user_id: string | null;
  holding_seconds: number | null;
  created_at: Date;
};

const iso = (value: Date | null) => (value ? value.toISOString() : undefined);

/**
 * Ciclo de atendimento (migration 0172). Invariantes garantidas pelo banco, nunca só pela
 * aplicação: no máximo um atendimento aberto por conversa e no máximo um ciclo de
 * responsabilidade ativo por atendimento (índices parciais únicos). Trocas de responsável rodam
 * numa transação com lock na linha do atendimento.
 */
export class PostgresInboxAttendanceRepository implements InboxAttendanceRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async openIfNone(input: OpenInboxAttendanceInput): Promise<{ attendance: InboxAttendance; created: boolean }> {
    // Serialize numbering per workspace instead of retrying a bounded max(number)+1 race.
    return this.inTransaction(async client => {
      const workspace = await client.query("select id from workspaces where id = $1 and tenant_id = $2 for update", [input.workspaceId, input.tenantId]);
      if (!workspace.rows[0]) throw new Error("INBOX_WORKSPACE_NOT_FOUND");
      const existing = await client.query<AttendanceRow>("select * from inbox_attendances where conversation_id = $1 and status = 'open'", [input.conversationId]);
      if (existing.rows[0]) return { attendance: toAttendance(existing.rows[0]), created: false };
      const inserted = await client.query<AttendanceRow>(
        `insert into inbox_attendances (id, tenant_id, workspace_id, conversation_id, contact_id, connection_id, team_id, number, status, opened_at, opened_by, open_reason, distribution_rule)
         select $1, $2, $3, $4, $5, $6, $7, coalesce(max(number), 0) + 1, 'open', $8, $9, $10, $11
         from inbox_attendances where workspace_id = $3 returning *`,
        [newId("attn"), input.tenantId, input.workspaceId, input.conversationId, input.contactId ?? null, input.connectionId, input.teamId ?? null, input.openedAt, input.openedBy, input.openReason, input.distributionRule ?? null],
      );
      return { attendance: toAttendance(inserted.rows[0]!), created: true };
    });
  }

  async getById(id: string): Promise<InboxAttendance | undefined> {
    const result = await this.pool.query<AttendanceRow>("select * from inbox_attendances where id = $1", [id]);
    return result.rows[0] ? toAttendance(result.rows[0]) : undefined;
  }

  async getOpenByConversation(conversationId: string): Promise<InboxAttendance | undefined> {
    const result = await this.pool.query<AttendanceRow>("select * from inbox_attendances where conversation_id = $1 and status = 'open' limit 1", [conversationId]);
    return result.rows[0] ? toAttendance(result.rows[0]) : undefined;
  }

  async getLatestByConversation(conversationId: string): Promise<InboxAttendance | undefined> {
    const result = await this.pool.query<AttendanceRow>("select * from inbox_attendances where conversation_id = $1 order by opened_at desc, number desc limit 1", [conversationId]);
    return result.rows[0] ? toAttendance(result.rows[0]) : undefined;
  }

  async listByConversation(conversationId: string): Promise<InboxAttendanceWithAssignments[]> {
    const [attendances, assignments] = await Promise.all([
      this.pool.query<AttendanceRow>("select * from inbox_attendances where conversation_id = $1 order by opened_at desc, number desc", [conversationId]),
      this.pool.query<AssignmentRow>("select * from inbox_attendance_assignments where conversation_id = $1 order by started_at asc, created_at asc", [conversationId]),
    ]);
    const byAttendance = new Map<string, InboxAttendanceAssignment[]>();
    for (const row of assignments.rows) {
      const list = byAttendance.get(row.attendance_id) ?? [];
      list.push(toAssignment(row));
      byAttendance.set(row.attendance_id, list);
    }
    return attendances.rows.map((row) => ({ ...toAttendance(row), assignments: byAttendance.get(row.id) ?? [] }));
  }

  async close(id: string, input: CloseInboxAttendanceInput): Promise<InboxAttendance | undefined> {
    return this.inTransaction(async (client) => {
      const closed = await client.query<AttendanceRow>(
        `update inbox_attendances set
           status = 'closed', closed_at = $2, closed_by = $3, closure_type_id = $4, closure_subtype_id = $5,
           closure_type_name = $6, closure_subtype_name = $7, closure_note = $8,
           resolution_seconds = greatest(0, extract(epoch from ($2::timestamptz - opened_at)))::int, updated_at = now()
         where id = $1 and status = 'open'
         returning *`,
        [id, input.closedAt, input.closedBy, input.closureTypeId ?? null, input.closureSubtypeId ?? null, input.closureTypeName ?? null, input.closureSubtypeName ?? null, input.closureNote ?? null],
      );
      if (!closed.rows[0]) return undefined;
      await endActiveAssignment(client, { attendanceId: id, at: input.closedAt, endReason: "attendance_closed" });
      return toAttendance(closed.rows[0]);
    });
  }

  async reopen(id: string, at: string): Promise<InboxAttendance | undefined> {
    const result = await this.pool.query<AttendanceRow>(
      `update inbox_attendances set
         status = 'open', closed_at = null, closed_by = null, closure_type_id = null, closure_subtype_id = null,
         closure_type_name = null, closure_subtype_name = null, closure_note = null, resolution_seconds = null,
         reopened_count = reopened_count + 1, last_reopened_at = $2, updated_at = now()
       where id = $1 and status = 'closed'
       returning *`,
      [id, at],
    );
    return result.rows[0] ? toAttendance(result.rows[0]) : undefined;
  }

  async setCsat(id: string, input: { status: InboxAttendanceCsatStatus; waivedBy?: string; sentAt?: string }): Promise<void> {
    await this.pool.query(
      "update inbox_attendances set csat_status = $2, csat_waived_by = $3, csat_sent_at = $4, csat_score = null, csat_answered_at = null, updated_at = now() where id = $1",
      [id, input.status, input.waivedBy ?? null, input.sentAt ?? null],
    );
  }

  async recordCsatAnswer(id: string, input: { score: number; answeredAt: string }): Promise<void> {
    if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) throw new Error("INBOX_CSAT_SCORE_INVALID");
    await this.pool.query("update inbox_attendances set csat_score = $2, csat_answered_at = $3, updated_at = now() where id = $1 and status = 'closed' and csat_status = 'sent' and csat_score is null and csat_sent_at <= $3", [id, input.score, input.answeredAt]);
  }

  async changeResponsible(input: ChangeAttendanceResponsibleInput): Promise<{ changed: boolean; ended?: InboxAttendanceAssignment; started?: InboxAttendanceAssignment }> {
    return this.inTransaction(async (client) => {
      const locked = await client.query<AttendanceRow>("select * from inbox_attendances where id = $1 for update", [input.attendanceId]);
      const attendance = locked.rows[0];
      if (!attendance || attendance.status !== "open") return { changed: false };
      const active = await client.query<AssignmentRow>("select * from inbox_attendance_assignments where attendance_id = $1 and ended_at is null", [input.attendanceId]);
      const current = active.rows[0];
      if ((current?.user_id ?? undefined) === input.toUserId) return { changed: false };

      const ended = current
        ? await endActiveAssignment(client, { attendanceId: input.attendanceId, at: input.at, endReason: input.toUserId ? input.endReason : "unassigned", transferredToUserId: input.toUserId })
        : undefined;
      let started: InboxAttendanceAssignment | undefined;
      if (input.toUserId) {
        const inserted = await client.query<AssignmentRow>(
          `insert into inbox_attendance_assignments (id, tenant_id, workspace_id, attendance_id, conversation_id, user_id, team_id, source, assigned_by, started_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           returning *`,
          [newId("attnasg"), attendance.tenant_id, attendance.workspace_id, attendance.id, attendance.conversation_id, input.toUserId, input.teamId ?? attendance.team_id, input.source, input.assignedBy, input.at],
        );
        started = toAssignment(inserted.rows[0]!);
        if (!attendance.initial_assignee_user_id) {
          await client.query("update inbox_attendances set initial_assignee_user_id = $2, updated_at = now() where id = $1", [attendance.id, input.toUserId]);
        }
      }
      return { changed: true, ended, started };
    });
  }

  async recordFirstResponse(input: { attendanceId: string; userId: string; messageId: string; at: string }): Promise<{ attendance: boolean; assignment: boolean }> {
    const attendance = await this.pool.query(
      "update inbox_attendances set first_response_at = $2, first_response_by = $3, updated_at = now() where id = $1 and status = 'open' and opened_at <= $2 and first_response_at is null returning id",
      [input.attendanceId, input.at, input.userId],
    );
    // Só o ciclo ATIVO e só se for de quem respondeu: um supervisor respondendo no lugar não
    // conta como a primeira resposta do responsável.
    const assignment = await this.pool.query(
      `update inbox_attendance_assignments
         set first_response_at = $3, first_response_message_id = $4,
             first_response_seconds = greatest(0, extract(epoch from ($3::timestamptz - started_at)))::int
       where attendance_id = $1 and user_id = $2 and ended_at is null and first_response_at is null and started_at <= $3
       returning id`,
      [input.attendanceId, input.userId, input.at, input.messageId],
    );
    return { attendance: (attendance.rowCount ?? 0) > 0, assignment: (assignment.rowCount ?? 0) > 0 };
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function endActiveAssignment(
  client: PoolClient,
  input: { attendanceId: string; at: string; endReason: InboxAssignmentEndReason; transferredToUserId?: string },
): Promise<InboxAttendanceAssignment | undefined> {
  const result = await client.query<AssignmentRow>(
    `update inbox_attendance_assignments
       set ended_at = $2, end_reason = $3, transferred_to_user_id = $4,
           holding_seconds = greatest(0, extract(epoch from ($2::timestamptz - started_at)))::int
     where attendance_id = $1 and ended_at is null
     returning *`,
    [input.attendanceId, input.at, input.endReason, input.transferredToUserId ?? null],
  );
  return result.rows[0] ? toAssignment(result.rows[0]) : undefined;
}

function toAttendance(row: AttendanceRow): InboxAttendance {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id ?? undefined,
    connectionId: row.connection_id,
    teamId: row.team_id ?? undefined,
    number: Number(row.number),
    status: row.status as InboxAttendanceStatus,
    openedAt: row.opened_at.toISOString(),
    openedBy: row.opened_by,
    openReason: row.open_reason as InboxAttendanceOpenReason,
    distributionRule: (row.distribution_rule as InboxDistributionRule | null) ?? undefined,
    initialAssigneeUserId: row.initial_assignee_user_id ?? undefined,
    firstResponseAt: iso(row.first_response_at),
    firstResponseBy: row.first_response_by ?? undefined,
    closedAt: iso(row.closed_at),
    closedBy: row.closed_by ?? undefined,
    closureTypeId: row.closure_type_id ?? undefined,
    closureSubtypeId: row.closure_subtype_id ?? undefined,
    closureTypeName: row.closure_type_name ?? undefined,
    closureSubtypeName: row.closure_subtype_name ?? undefined,
    closureNote: row.closure_note ?? undefined,
    resolutionSeconds: row.resolution_seconds ?? undefined,
    csatStatus: (row.csat_status as InboxAttendanceCsatStatus | null) ?? undefined,
    csatWaivedBy: row.csat_waived_by ?? undefined,
    csatSentAt: iso(row.csat_sent_at),
    csatScore: row.csat_score ?? undefined,
    csatAnsweredAt: iso(row.csat_answered_at),
    reopenedCount: Number(row.reopened_count),
    lastReopenedAt: iso(row.last_reopened_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toAssignment(row: AssignmentRow): InboxAttendanceAssignment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    attendanceId: row.attendance_id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    teamId: row.team_id ?? undefined,
    source: row.source as InboxAssignmentSource,
    assignedBy: row.assigned_by,
    startedAt: row.started_at.toISOString(),
    firstResponseAt: iso(row.first_response_at),
    firstResponseMessageId: row.first_response_message_id ?? undefined,
    firstResponseSeconds: row.first_response_seconds ?? undefined,
    endedAt: iso(row.ended_at),
    endReason: (row.end_reason as InboxAssignmentEndReason | null) ?? undefined,
    transferredToUserId: row.transferred_to_user_id ?? undefined,
    holdingSeconds: row.holding_seconds ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}
