import type { Pool } from "pg";
import type { InboxAgentVolume, InboxMetricsFilter, InboxMetricsReport, InboxMetricsRepositoryPort } from "../../../application/ports/inbox-metrics-repository.port.js";

export class PostgresInboxMetricsRepository implements InboxMetricsRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getMetrics(filter: InboxMetricsFilter): Promise<InboxMetricsReport> {
    const { tenantId, workspaceId } = filter;

    const receivedResult = await this.pool.query<{ count: string }>(
      `select count(*) as count from inbox_attendances
       where tenant_id = $1 and workspace_id = $2 and open_reason <> 'migration'
         and ($3::timestamptz is null or opened_at >= $3)
         and ($4::timestamptz is null or opened_at <= $4)`,
      [tenantId, workspaceId, filter.dateFrom ?? null, filter.dateTo ?? null],
    );

    const statusCountsResult = await this.pool.query<{ status: string; count: string }>(
      `select c.status, count(*) as count from inbox_attendances a join inbox_conversations c on c.id = a.conversation_id and c.tenant_id = a.tenant_id and c.workspace_id = a.workspace_id where a.tenant_id = $1 and a.workspace_id = $2 and a.status = 'open' group by c.status`,
      [tenantId, workspaceId],
    );
    const statusCounts = new Map(statusCountsResult.rows.map((row) => [row.status, Number(row.count)]));
    const openCount = statusCounts.get("open") ?? 0;
    const pendingCount = statusCounts.get("pending") ?? 0;

    const resolvedResult = await this.pool.query<{ count: string }>(
      `select count(*) as count from inbox_attendances
       where tenant_id = $1 and workspace_id = $2 and status = 'closed'
         and ($3::timestamptz is null or closed_at >= $3)
         and ($4::timestamptz is null or closed_at <= $4)`,
      [tenantId, workspaceId, filter.dateFrom ?? null, filter.dateTo ?? null],
    );

    const handleTimeResult = await this.pool.query<{ avg_seconds: number | null }>(
      `select avg(extract(epoch from (closed_at - opened_at))) filter (where open_reason <> 'migration') as avg_seconds from inbox_attendances
       where tenant_id = $1 and workspace_id = $2 and status = 'closed'
         and ($3::timestamptz is null or closed_at >= $3)
         and ($4::timestamptz is null or closed_at <= $4)`,
      [tenantId, workspaceId, filter.dateFrom ?? null, filter.dateTo ?? null],
    );

    const firstResponseResult = await this.pool.query<{ avg_seconds: number | null }>(
      `select avg(extract(epoch from (first_response_at - started_at))) as avg_seconds
       from inbox_attendance_assignments
       where tenant_id = $1 and workspace_id = $2 and source <> 'migration' and first_response_at >= started_at
         and ($3::timestamptz is null or started_at >= $3)
         and ($4::timestamptz is null or started_at <= $4)`,
      [tenantId, workspaceId, filter.dateFrom ?? null, filter.dateTo ?? null],
    );

    const aiVsHumanResult = await this.pool.query<{ sent_by_ai: boolean; count: string }>(
      `select sent_by_ai, count(*) as count from inbox_messages
       where tenant_id = $1 and workspace_id = $2 and direction = 'outbound'
         and ($3::timestamptz is null or created_at >= $3)
         and ($4::timestamptz is null or created_at <= $4)
       group by sent_by_ai`,
      [tenantId, workspaceId, filter.dateFrom ?? null, filter.dateTo ?? null],
    );
    const aiResolvedMessageCount = Number(aiVsHumanResult.rows.find((row) => row.sent_by_ai)?.count ?? 0);
    const humanResolvedMessageCount = Number(aiVsHumanResult.rows.find((row) => !row.sent_by_ai)?.count ?? 0);

    const volumeByAgentResult = await this.pool.query<{ sent_by_user_id: string; count: string }>(
      `select sent_by_user_id, count(*) as count from inbox_messages
       where tenant_id = $1 and workspace_id = $2 and direction = 'outbound' and sent_by_user_id is not null
         and ($3::timestamptz is null or created_at >= $3)
         and ($4::timestamptz is null or created_at <= $4)
       group by sent_by_user_id
       order by count desc
       limit 20`,
      [tenantId, workspaceId, filter.dateFrom ?? null, filter.dateTo ?? null],
    );
    const volumeByAgent: InboxAgentVolume[] = volumeByAgentResult.rows.map((row) => ({ userId: row.sent_by_user_id, messageCount: Number(row.count) }));

    const periodParams = [tenantId, workspaceId, filter.dateFrom ?? null, filter.dateTo ?? null];
    const csatResult = await this.pool.query<{ average: string | null; responses: string; requested: string }>(
      `select avg(csat_score) filter (where csat_status = 'sent' and csat_score between 1 and 5 and csat_answered_at is not null) as average,
              count(*) filter (where csat_status = 'sent' and csat_score between 1 and 5 and csat_answered_at is not null) as responses,
              count(*) filter (where csat_sent_at is not null) as requested
       from inbox_attendances
       where tenant_id = $1 and workspace_id = $2 and closed_at is not null
         and ($3::timestamptz is null or closed_at >= $3)
         and ($4::timestamptz is null or closed_at <= $4)`,
      periodParams,
    );
    const csatByAgentResult = await this.pool.query<{ closed_by: string; average: string; responses: string }>(
      `select closed_by, avg(csat_score) as average, count(*) as responses
       from inbox_attendances
       where tenant_id = $1 and workspace_id = $2 and csat_status = 'sent' and csat_score between 1 and 5 and csat_answered_at is not null and closed_by is not null
         and ($3::timestamptz is null or closed_at >= $3)
         and ($4::timestamptz is null or closed_at <= $4)
       group by closed_by order by responses desc limit 20`,
      periodParams,
    );
    const closingReasonsResult = await this.pool.query<{ reason: string; count: string }>(
      `select coalesce(closure_type_name || ' / ' || closure_subtype_name, closure_type_name, 'Sem motivo') as reason, count(*) as count
       from inbox_attendances
       where tenant_id = $1 and workspace_id = $2 and closed_at is not null
         and ($3::timestamptz is null or closed_at >= $3)
         and ($4::timestamptz is null or closed_at <= $4)
       group by 1 order by count desc limit 30`,
      periodParams,
    );

    return {
      csatAverage: csatResult.rows[0]?.average != null ? Number(csatResult.rows[0].average) : undefined,
      csatResponses: Number(csatResult.rows[0]?.responses ?? 0),
      csatRequested: Number(csatResult.rows[0]?.requested ?? 0),
      csatByAgent: csatByAgentResult.rows.map((row) => ({ userId: row.closed_by, average: Number(row.average), responses: Number(row.responses) })),
      closingReasons: closingReasonsResult.rows.map((row) => ({ reason: row.reason, count: Number(row.count) })),
      receivedCount: Number(receivedResult.rows[0]?.count ?? 0),
      openCount,
      pendingCount,
      resolvedCount: Number(resolvedResult.rows[0]?.count ?? 0),
      backlogCount: openCount + pendingCount,
      avgFirstResponseSeconds: firstResponseResult.rows[0]?.avg_seconds != null ? Number(firstResponseResult.rows[0].avg_seconds) : undefined,
      avgHandleTimeSeconds: handleTimeResult.rows[0]?.avg_seconds != null ? Number(handleTimeResult.rows[0].avg_seconds) : undefined,
      aiResolvedMessageCount,
      humanResolvedMessageCount,
      volumeByAgent,
    };
  }
}
