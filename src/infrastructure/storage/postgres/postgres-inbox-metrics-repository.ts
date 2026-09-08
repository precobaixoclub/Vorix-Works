import type { Pool } from "pg";
import type { InboxAgentVolume, InboxMetricsFilter, InboxMetricsReport, InboxMetricsRepositoryPort } from "../../../application/ports/inbox-metrics-repository.port.js";

export class PostgresInboxMetricsRepository implements InboxMetricsRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getMetrics(filter: InboxMetricsFilter): Promise<InboxMetricsReport> {
    const { tenantId, workspaceId } = filter;

    const receivedResult = await this.pool.query<{ count: string }>(
      `select count(*) as count from inbox_conversations
       where tenant_id = $1 and workspace_id = $2
         and ($3::timestamptz is null or created_at >= $3)
         and ($4::timestamptz is null or created_at <= $4)`,
      [tenantId, workspaceId, filter.dateFrom ?? null, filter.dateTo ?? null],
    );

    const statusCountsResult = await this.pool.query<{ status: string; count: string }>(
      `select status, count(*) as count from inbox_conversations where tenant_id = $1 and workspace_id = $2 group by status`,
      [tenantId, workspaceId],
    );
    const statusCounts = new Map(statusCountsResult.rows.map((row) => [row.status, Number(row.count)]));
    const openCount = statusCounts.get("open") ?? 0;
    const pendingCount = statusCounts.get("pending") ?? 0;

    const resolvedResult = await this.pool.query<{ count: string }>(
      `select count(*) as count from inbox_conversations
       where tenant_id = $1 and workspace_id = $2 and status = 'resolved'
         and ($3::timestamptz is null or updated_at >= $3)
         and ($4::timestamptz is null or updated_at <= $4)`,
      [tenantId, workspaceId, filter.dateFrom ?? null, filter.dateTo ?? null],
    );

    const handleTimeResult = await this.pool.query<{ avg_seconds: number | null }>(
      `select avg(extract(epoch from (updated_at - created_at))) as avg_seconds from inbox_conversations
       where tenant_id = $1 and workspace_id = $2 and status = 'resolved'
         and ($3::timestamptz is null or updated_at >= $3)
         and ($4::timestamptz is null or updated_at <= $4)`,
      [tenantId, workspaceId, filter.dateFrom ?? null, filter.dateTo ?? null],
    );

    const firstResponseResult = await this.pool.query<{ avg_seconds: number | null }>(
      `with first_inbound as (
         select m.conversation_id, min(m.created_at) as first_inbound_at
         from inbox_messages m
         join inbox_conversations c on c.id = m.conversation_id
         where m.tenant_id = $1 and m.workspace_id = $2 and m.direction = 'inbound'
           and ($3::timestamptz is null or c.created_at >= $3)
           and ($4::timestamptz is null or c.created_at <= $4)
         group by m.conversation_id
       ),
       first_outbound_after as (
         select m.conversation_id, min(m.created_at) as first_outbound_at
         from inbox_messages m
         join first_inbound fi on fi.conversation_id = m.conversation_id
         where m.direction = 'outbound' and m.created_at > fi.first_inbound_at
         group by m.conversation_id
       )
       select avg(extract(epoch from (fo.first_outbound_at - fi.first_inbound_at))) as avg_seconds
       from first_inbound fi
       join first_outbound_after fo on fo.conversation_id = fi.conversation_id`,
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

    return {
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
