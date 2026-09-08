import type { Pool } from "pg";
import type {
  CommercialMetricsFilter,
  CommercialMetricsRepositoryPort,
  CommercialMetricsReport,
  LossReasonBreakdown,
  OriginRevenue,
  StageAging,
} from "../../../application/ports/commercial-metrics-repository.port.js";

/** Condições comuns a `deals` (`d`) — pipeline/responsável/equipe direto na tabela; origem exige
 * uma subconsulta em `contacts` (deals não guardam origem própria, só o contato guarda). */
function buildDealConditions(filter: CommercialMetricsFilter, params: unknown[]): string[] {
  const conditions: string[] = ["d.tenant_id = $1", "d.workspace_id = $2"];
  if (filter.pipelineId) {
    params.push(filter.pipelineId);
    conditions.push(`d.pipeline_id = $${params.length}`);
  }
  if (filter.ownerUserId) {
    params.push(filter.ownerUserId);
    conditions.push(`d.owner_user_id = $${params.length}`);
  }
  if (filter.teamId) {
    params.push(filter.teamId);
    conditions.push(`d.team_id = $${params.length}`);
  }
  if (filter.origin) {
    params.push(filter.origin);
    conditions.push(`exists (select 1 from contacts c where c.id = d.contact_id and c.origin = $${params.length})`);
  }
  return conditions;
}

export class PostgresCommercialMetricsRepository implements CommercialMetricsRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async getMetrics(filter: CommercialMetricsFilter): Promise<CommercialMetricsReport> {
    const { tenantId, workspaceId, dateFrom, dateTo } = filter;

    const createdParams: unknown[] = [tenantId, workspaceId];
    const createdConditions = buildDealConditions(filter, createdParams);
    createdParams.push(dateFrom ?? null, dateTo ?? null);
    const createdResult = await this.pool.query<{ count: string }>(
      `select count(*) as count from deals d where ${createdConditions.join(" and ")}
       and ($${createdParams.length - 1}::timestamptz is null or d.created_at >= $${createdParams.length - 1})
       and ($${createdParams.length}::timestamptz is null or d.created_at <= $${createdParams.length})`,
      createdParams,
    );

    const openParams: unknown[] = [tenantId, workspaceId];
    const openConditions = buildDealConditions(filter, openParams);
    const openResult = await this.pool.query<{ value: string | null }>(
      `select coalesce(sum(d.value_cents), 0) as value from deals d where ${openConditions.join(" and ")} and d.won_at is null and d.lost_at is null`,
      openParams,
    );

    const wonParams: unknown[] = [tenantId, workspaceId];
    const wonConditions = buildDealConditions(filter, wonParams);
    wonParams.push(dateFrom ?? null, dateTo ?? null);
    const wonResult = await this.pool.query<{ count: string; value: string | null; avg_cycle_days: number | null }>(
      `select count(*) as count, coalesce(sum(d.value_cents), 0) as value,
              avg(extract(epoch from (d.won_at - d.created_at)) / 86400) as avg_cycle_days
       from deals d where ${wonConditions.join(" and ")} and d.won_at is not null
         and ($${wonParams.length - 1}::timestamptz is null or d.won_at >= $${wonParams.length - 1})
         and ($${wonParams.length}::timestamptz is null or d.won_at <= $${wonParams.length})`,
      wonParams,
    );

    const lostParams: unknown[] = [tenantId, workspaceId];
    const lostConditions = buildDealConditions(filter, lostParams);
    lostParams.push(dateFrom ?? null, dateTo ?? null);
    const lostResult = await this.pool.query<{ count: string }>(
      `select count(*) as count from deals d where ${lostConditions.join(" and ")} and d.lost_at is not null
         and ($${lostParams.length - 1}::timestamptz is null or d.lost_at >= $${lostParams.length - 1})
         and ($${lostParams.length}::timestamptz is null or d.lost_at <= $${lostParams.length})`,
      lostParams,
    );

    // Propostas: só tenant/workspace + período (sem pipeline/responsável/equipe/origem — exigiria
    // join com deals/contacts pra cada filtro; fora de escopo desta fase, ver auditoria da Fase 7).
    const proposalsSentResult = await this.pool.query<{ count: string }>(
      `select count(*) as count from proposals where tenant_id = $1 and workspace_id = $2 and sent_at is not null
         and ($3::timestamptz is null or sent_at >= $3) and ($4::timestamptz is null or sent_at <= $4)`,
      [tenantId, workspaceId, dateFrom ?? null, dateTo ?? null],
    );
    const proposalsAcceptedResult = await this.pool.query<{ count: string }>(
      `select count(*) as count from proposals where tenant_id = $1 and workspace_id = $2 and status = 'accepted'
         and ($3::timestamptz is null or responded_at >= $3) and ($4::timestamptz is null or responded_at <= $4)`,
      [tenantId, workspaceId, dateFrom ?? null, dateTo ?? null],
    );

    const noNextActionParams: unknown[] = [tenantId, workspaceId];
    const noNextActionConditions = buildDealConditions(filter, noNextActionParams);
    const noNextActionResult = await this.pool.query<{ count: string }>(
      `select count(*) as count from deals d where ${noNextActionConditions.join(" and ")} and d.won_at is null and d.lost_at is null
         and not exists (select 1 from tasks t where t.deal_id = d.id and t.status = 'pending')`,
      noNextActionParams,
    );

    const stageAgingParams: unknown[] = [tenantId, workspaceId];
    const stageAgingConditions = buildDealConditions(filter, stageAgingParams);
    const stageAgingResult = await this.pool.query<{ stage_id: string; stage_name: string; open_count: string; avg_days: number | null }>(
      `select d.stage_id, s.name as stage_name, count(*) as open_count,
              avg(extract(epoch from (now() - d.last_stage_changed_at)) / 86400) as avg_days
       from deals d
       join pipeline_stages s on s.id = d.stage_id
       where ${stageAgingConditions.join(" and ")} and d.won_at is null and d.lost_at is null
       group by d.stage_id, s.name`,
      stageAgingParams,
    );

    const lossReasonsParams: unknown[] = [tenantId, workspaceId];
    const lossReasonsConditions = buildDealConditions(filter, lossReasonsParams);
    lossReasonsParams.push(dateFrom ?? null, dateTo ?? null);
    const lossReasonsResult = await this.pool.query<{ loss_reason: string | null; count: string }>(
      `select d.loss_reason, count(*) as count from deals d where ${lossReasonsConditions.join(" and ")} and d.lost_at is not null
         and ($${lossReasonsParams.length - 1}::timestamptz is null or d.lost_at >= $${lossReasonsParams.length - 1})
         and ($${lossReasonsParams.length}::timestamptz is null or d.lost_at <= $${lossReasonsParams.length})
       group by d.loss_reason
       order by count desc`,
      lossReasonsParams,
    );

    const revenueByOriginParams: unknown[] = [tenantId, workspaceId];
    const revenueByOriginConditions = buildDealConditions(filter, revenueByOriginParams);
    revenueByOriginParams.push(dateFrom ?? null, dateTo ?? null);
    const revenueByOriginResult = await this.pool.query<{ origin: string | null; count: string; value: string | null }>(
      `select c.origin, count(*) as count, coalesce(sum(d.value_cents), 0) as value
       from deals d
       join contacts c on c.id = d.contact_id
       where ${revenueByOriginConditions.join(" and ")} and d.won_at is not null
         and ($${revenueByOriginParams.length - 1}::timestamptz is null or d.won_at >= $${revenueByOriginParams.length - 1})
         and ($${revenueByOriginParams.length}::timestamptz is null or d.won_at <= $${revenueByOriginParams.length})
       group by c.origin
       order by value desc`,
      revenueByOriginParams,
    );

    const wonCount = Number(wonResult.rows[0]?.count ?? 0);
    const wonValueCents = Number(wonResult.rows[0]?.value ?? 0);
    const lostCount = Number(lostResult.rows[0]?.count ?? 0);
    const proposalsSentCount = Number(proposalsSentResult.rows[0]?.count ?? 0);
    const proposalsAcceptedCount = Number(proposalsAcceptedResult.rows[0]?.count ?? 0);

    const stageAging: StageAging[] = stageAgingResult.rows.map((row) => ({
      stageId: row.stage_id,
      stageName: row.stage_name,
      openCount: Number(row.open_count),
      avgDaysInStage: row.avg_days != null ? Number(row.avg_days) : 0,
    }));
    const lossReasons: LossReasonBreakdown[] = lossReasonsResult.rows.map((row) => ({ reason: row.loss_reason ?? "(sem motivo registrado)", count: Number(row.count) }));
    const revenueByOrigin: OriginRevenue[] = revenueByOriginResult.rows.map((row) => ({ origin: row.origin ?? "(sem origem registrada)", wonCount: Number(row.count), wonValueCents: Number(row.value ?? 0) }));

    return {
      dealsCreatedCount: Number(createdResult.rows[0]?.count ?? 0),
      openPipelineValueCents: Number(openResult.rows[0]?.value ?? 0),
      wonCount,
      wonValueCents,
      lostCount,
      conversionRate: wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : undefined,
      avgTicketCents: wonCount > 0 ? Math.round(wonValueCents / wonCount) : undefined,
      avgCycleDays: wonResult.rows[0]?.avg_cycle_days != null ? Number(wonResult.rows[0].avg_cycle_days) : undefined,
      proposalsSentCount,
      proposalsAcceptedCount,
      proposalAcceptRate: proposalsSentCount > 0 ? proposalsAcceptedCount / proposalsSentCount : undefined,
      dealsWithoutNextActionCount: Number(noNextActionResult.rows[0]?.count ?? 0),
      stageAging,
      lossReasons,
      revenueByOrigin,
    };
  }
}
