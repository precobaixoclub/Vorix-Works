import type { Pool } from "pg";
import type {
  CreateDealInput,
  DealRepositoryPort,
  DealClosureInput,
  ListDealsFilter,
  MoveDealStageInput,
  UpdateDealInput,
} from "../../../application/ports/deal-repository.port.js";
import type { Deal, DealStageSummary } from "../../../domain/crm/crm.model.js";

const dealId = () => `deal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type DealRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  title: string;
  value_cents: string;
  currency: string;
  owner_user_id: string | null;
  team_id: string | null;
  origin: string | null;
  loss_reason: string | null;
  won_at: Date | null;
  lost_at: Date | null;
  expected_close_date: Date | null;
  created_at: Date;
  updated_at: Date;
  last_stage_changed_at: Date;
  status: Deal["status"];
  value_mode: Deal["valueMode"];
  probability: number | null;
  forecast_category: Deal["forecastCategory"];
  price_book_id: string | null;
  discount_cents: string;
  contract_months: number | null;
  custom_fields: Record<string, unknown> | null;
  closed_at: Date | null;
  closed_by_user_id: string | null;
  credited_owner_user_id: string | null;
  credited_team_id: string | null;
  won_reason: string | null;
  close_comment: string | null;
  competitor_id: string | null;
  won_proposal_id: string | null;
  final_value_cents: string | null;
  final_cost_cents: string | null;
  final_gross_profit_cents: string | null;
  final_margin_bp: number | null;
  final_mrr_cents: string | null;
  final_arr_cents: string | null;
  final_tcv_cents: string | null;
  final_snapshot: Record<string, unknown> | null;
};

const optionalNumber = (value: string | number | null): number | undefined => (value === null ? undefined : Number(value));

export type { DealRow };
export function mapDealRow(row: DealRow): Deal {
  return toDomain(row);
}

function toDomain(row: DealRow): Deal {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    pipelineId: row.pipeline_id,
    stageId: row.stage_id,
    contactId: row.contact_id ?? undefined,
    title: row.title,
    valueCents: Number(row.value_cents),
    currency: row.currency,
    ownerUserId: row.owner_user_id ?? undefined,
    teamId: row.team_id ?? undefined,
    origin: row.origin ?? undefined,
    lossReason: row.loss_reason ?? undefined,
    wonAt: row.won_at?.toISOString(),
    lostAt: row.lost_at?.toISOString(),
    expectedCloseDate: row.expected_close_date ? row.expected_close_date.toISOString().slice(0, 10) : undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastStageChangedAt: row.last_stage_changed_at.toISOString(),
    status: row.status,
    valueMode: row.value_mode,
    probability: row.probability ?? undefined,
    forecastCategory: row.forecast_category,
    priceBookId: row.price_book_id ?? undefined,
    discountCents: Number(row.discount_cents),
    contractMonths: row.contract_months ?? undefined,
    customFields: row.custom_fields ?? {},
    closedAt: row.closed_at?.toISOString(),
    closedByUserId: row.closed_by_user_id ?? undefined,
    creditedOwnerUserId: row.credited_owner_user_id ?? undefined,
    creditedTeamId: row.credited_team_id ?? undefined,
    wonReason: row.won_reason ?? undefined,
    closeComment: row.close_comment ?? undefined,
    competitorId: row.competitor_id ?? undefined,
    wonProposalId: row.won_proposal_id ?? undefined,
    finalValueCents: optionalNumber(row.final_value_cents),
    finalCostCents: optionalNumber(row.final_cost_cents),
    finalGrossProfitCents: optionalNumber(row.final_gross_profit_cents),
    finalMarginBp: row.final_margin_bp ?? undefined,
    finalMrrCents: optionalNumber(row.final_mrr_cents),
    finalArrCents: optionalNumber(row.final_arr_cents),
    finalTcvCents: optionalNumber(row.final_tcv_cents),
    finalSnapshot: row.final_snapshot ?? undefined,
  };
}

function buildFilterConditions(filter: ListDealsFilter, params: unknown[]): string[] {
  const conditions: string[] = ["tenant_id = $1", "workspace_id = $2"];
  if (filter.pipelineId) {
    params.push(filter.pipelineId);
    conditions.push(`pipeline_id = $${params.length}`);
  }
  if (filter.stageId) {
    params.push(filter.stageId);
    conditions.push(`stage_id = $${params.length}`);
  }
  if (filter.contactId) {
    params.push(filter.contactId);
    conditions.push(`contact_id = $${params.length}`);
  }
  if (filter.ownerUserId) {
    params.push(filter.ownerUserId);
    conditions.push(`owner_user_id = $${params.length}`);
  }
  if (filter.teamId) {
    params.push(filter.teamId);
    conditions.push(`team_id = $${params.length}`);
  }
  if (filter.origin) {
    params.push(filter.origin);
    conditions.push(`origin = $${params.length}`);
  }
  if (filter.search) {
    params.push(`%${filter.search}%`);
    conditions.push(`title ilike $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.ownerUserIdsIn || filter.teamIdsIn) {
    const scoped: string[] = [];
    if (filter.ownerUserIdsIn?.length) {
      params.push([...filter.ownerUserIdsIn]);
      scoped.push(`owner_user_id = any($${params.length}::text[])`);
    }
    if (filter.teamIdsIn?.length) {
      params.push([...filter.teamIdsIn]);
      scoped.push(`team_id = any($${params.length}::text[])`);
    }
    conditions.push(scoped.length ? `(${scoped.join(" or ")})` : "false");
  }
  return conditions;
}

export class PostgresDealRepository implements DealRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateDealInput): Promise<Deal> {
    const result = await this.pool.query<DealRow>(
      `insert into deals (id, tenant_id, workspace_id, pipeline_id, stage_id, contact_id, title, value_cents, currency, owner_user_id, team_id, origin, expected_close_date,
         value_mode, probability, forecast_category, price_book_id, discount_cents, contract_months, custom_fields)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       returning *`,
      [
        dealId(), input.tenantId, input.workspaceId, input.pipelineId, input.stageId,
        input.contactId ?? null, input.title, input.valueCents ?? 0, input.currency ?? "BRL",
        input.ownerUserId ?? null, input.teamId ?? null, input.origin ?? null, input.expectedCloseDate ?? null,
        input.valueMode ?? "manual", input.probability ?? null, input.forecastCategory ?? "pipeline", input.priceBookId ?? null,
        input.discountCents ?? 0, input.contractMonths ?? null, JSON.stringify(input.customFields ?? {}),
      ],
    );
    return toDomain(result.rows[0]);
  }

  async getById(id: string): Promise<Deal | undefined> {
    const result = await this.pool.query<DealRow>("select * from deals where id = $1", [id]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async listByWorkspace(filter: ListDealsFilter): Promise<Deal[]> {
    const limit = filter.limit ?? 200;
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    const conditions = buildFilterConditions(filter, params);
    if (filter.cursor) {
      params.push(filter.cursor);
      conditions.push(`created_at < (select created_at from deals where id = $${params.length})`);
    }
    params.push(limit);
    const result = await this.pool.query<DealRow>(
      `select * from deals where ${conditions.join(" and ")} order by created_at desc limit $${params.length}`,
      params,
    );
    return result.rows.map(toDomain);
  }

  async update(id: string, input: UpdateDealInput): Promise<Deal> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`DEAL_NOT_FOUND: oportunidade "${id}" não existe.`);
    const result = await this.pool.query<DealRow>(
      `update deals set
         contact_id = $2, title = $3, value_cents = $4, currency = $5, owner_user_id = $6,
         team_id = $7, origin = $8, expected_close_date = $9, value_mode = $10, probability = $11, forecast_category = $12,
         price_book_id = $13, discount_cents = $14, contract_months = $15, custom_fields = $16, updated_at = now()
       where id = $1
       returning *`,
      [
        id,
        input.contactId !== undefined ? input.contactId : existing.contactId ?? null,
        input.title ?? existing.title,
        input.valueCents ?? existing.valueCents,
        input.currency ?? existing.currency,
        input.ownerUserId !== undefined ? input.ownerUserId : existing.ownerUserId ?? null,
        input.teamId !== undefined ? input.teamId : existing.teamId ?? null,
        input.origin !== undefined ? input.origin : existing.origin ?? null,
        input.expectedCloseDate !== undefined ? input.expectedCloseDate : existing.expectedCloseDate ?? null,
        input.valueMode ?? existing.valueMode,
        input.probability !== undefined ? input.probability : existing.probability ?? null,
        input.forecastCategory ?? existing.forecastCategory,
        input.priceBookId !== undefined ? input.priceBookId : existing.priceBookId ?? null,
        input.discountCents ?? existing.discountCents,
        input.contractMonths !== undefined ? input.contractMonths : existing.contractMonths ?? null,
        JSON.stringify(input.customFields ?? existing.customFields),
      ],
    );
    return toDomain(result.rows[0]);
  }

  async moveStage(id: string, input: MoveDealStageInput): Promise<Deal> {
    const result = await this.pool.query<DealRow>(
      `update deals set
         stage_id = $2, loss_reason = $3, won_at = $4, lost_at = $5,
         last_stage_changed_at = now(), updated_at = now()
       where id = $1
       returning *`,
      [id, input.stageId, input.lossReason ?? null, input.wonAt ?? null, input.lostAt ?? null],
    );
    if (!result.rows[0]) throw new Error(`DEAL_NOT_FOUND: oportunidade "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }

  async setValue(id: string, valueCents: number): Promise<Deal> {
    const result = await this.pool.query<DealRow>("update deals set value_cents = $2, updated_at = now() where id = $1 returning *", [id, valueCents]);
    if (!result.rows[0]) throw new Error(`DEAL_NOT_FOUND: oportunidade "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }

  async setClosure(id: string, input: DealClosureInput): Promise<Deal> {
    const result = await this.pool.query<DealRow>(
      `update deals set status = $2, forecast_category = $3, closed_at = $4, closed_by_user_id = $5, credited_owner_user_id = $6,
         credited_team_id = $7, won_reason = $8, loss_reason = $9, close_comment = $10, competitor_id = $11, won_proposal_id = $12,
         final_value_cents = $13, final_cost_cents = $14, final_gross_profit_cents = $15, final_margin_bp = $16,
         final_mrr_cents = $17, final_arr_cents = $18, final_tcv_cents = $19, final_snapshot = $20, updated_at = now()
       where id = $1 returning *`,
      [
        id, input.status, input.forecastCategory, input.closedAt, input.closedByUserId, input.creditedOwnerUserId, input.creditedTeamId,
        input.wonReason, input.lossReason, input.closeComment, input.competitorId, input.wonProposalId, input.finalValueCents,
        input.finalCostCents, input.finalGrossProfitCents, input.finalMarginBp, input.finalMrrCents, input.finalArrCents,
        input.finalTcvCents, input.finalSnapshot ? JSON.stringify(input.finalSnapshot) : null,
      ],
    );
    if (!result.rows[0]) throw new Error(`DEAL_NOT_FOUND: oportunidade "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }

  async findOpenSimilar(input: { tenantId: string; workspaceId: string; contactId?: string; pipelineId: string; title: string; limit?: number }): Promise<Deal[]> {
    const result = await this.pool.query<DealRow>(
      `select * from deals
       where tenant_id = $1 and workspace_id = $2 and status = 'open'
         and (($3::text is not null and contact_id = $3 and pipeline_id = $4) or lower(title) = lower($5))
       order by updated_at desc limit $6`,
      [input.tenantId, input.workspaceId, input.contactId ?? null, input.pipelineId, input.title.trim(), input.limit ?? 5],
    );
    return result.rows.map(toDomain);
  }

  async summaryByPipeline(filter: Omit<ListDealsFilter, "cursor" | "limit" | "stageId"> & { pipelineId: string }): Promise<DealStageSummary[]> {
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    const conditions = buildFilterConditions(filter, params);
    const result = await this.pool.query<{ stage_id: string; count: string; value_cents_sum: string | null }>(
      `select stage_id, count(*) as count, coalesce(sum(value_cents), 0) as value_cents_sum
       from deals where ${conditions.join(" and ")}
       group by stage_id`,
      params,
    );
    return result.rows.map((row) => ({
      stageId: row.stage_id,
      count: Number(row.count),
      valueCentsSum: Number(row.value_cents_sum ?? 0),
    }));
  }
}
