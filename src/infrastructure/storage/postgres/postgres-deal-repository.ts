import { ownedScopeSql } from "./postgres-owned-scope.js";
import type { Pool } from "pg";
import type {
  CreateDealInput,
  ContactOpenDealsFilter,
  ContactOpenDealsSummary,
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
  archived_at: Date | null;
  archive_manual_hold: boolean;
  first_closed_at: Date | null;
  reopened_at: Date | null;
  reopened_by_user_id: string | null;
  reopen_count: number;
  closure_source: string | null;
  loss_reason_id: string | null;
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
    archivedAt: row.archived_at?.toISOString(),
    archiveManualHold: row.archive_manual_hold,
    firstClosedAt: row.first_closed_at?.toISOString(),
    reopenedAt: row.reopened_at?.toISOString(),
    reopenedByUserId: row.reopened_by_user_id ?? undefined,
    reopenCount: row.reopen_count,
    closureSource: row.closure_source ?? undefined,
    lossReasonId: row.loss_reason_id ?? undefined,
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
  switch (filter.boardView) {
    case "operational": conditions.push("archived_at is null", "status <> 'cancelled'"); break;
    case "open": conditions.push("status = 'open'"); break;
    case "won": conditions.push("status = 'won'"); break;
    case "lost": conditions.push("status = 'lost'"); break;
    case "closed": conditions.push("status in ('won', 'lost')"); break;
    case "archived": conditions.push("archived_at is not null"); break;
  }
  const scope = ownedScopeSql(filter, params);
  if (scope) conditions.push(scope);
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
       where id = $1 and ($6::text is null or status = $6)
         and ($7::timestamptz is null or date_trunc('milliseconds', updated_at) = $7::timestamptz)
       returning *`,
      [id, input.stageId, input.lossReason ?? null, input.wonAt ?? null, input.lostAt ?? null, input.expectedStatus ?? null, input.expectedUpdatedAt ?? null],
    );
    if (!result.rows[0]) throw new Error("DEAL_CONFLICT: a oportunidade foi alterada. Atualize e tente novamente.");
    return toDomain(result.rows[0]);
  }

  async setValue(id: string, valueCents: number): Promise<Deal> {
    const result = await this.pool.query<DealRow>("update deals set value_cents = $2, updated_at = now() where id = $1 returning *", [id, valueCents]);
    if (!result.rows[0]) throw new Error(`DEAL_NOT_FOUND: oportunidade "${id}" não existe.`);
    return toDomain(result.rows[0]);
  }

  async setClosure(id: string, input: DealClosureInput): Promise<Deal> {
    const result = await this.pool.query<DealRow>(
      `with changed as (update deals set status = $2, forecast_category = $3, closed_at = $4, closed_by_user_id = $5, credited_owner_user_id = $6,
         credited_team_id = $7, won_reason = $8, loss_reason = $9, close_comment = $10, competitor_id = $11, won_proposal_id = $12,
         final_value_cents = $13, final_cost_cents = $14, final_gross_profit_cents = $15, final_margin_bp = $16,
         final_mrr_cents = $17, final_arr_cents = $18, final_tcv_cents = $19, final_snapshot = $20, updated_at = now(),
         stage_id = coalesce($21, stage_id),
         last_stage_changed_at = case when $21::text is not null and stage_id <> $21 then now() else last_stage_changed_at end,
         won_at = case when $2 = 'won' then $4::timestamptz else null end,
         lost_at = case when $2 = 'lost' then $4::timestamptz else null end,
         first_closed_at = coalesce(first_closed_at, $4::timestamptz),
         reopened_at = case when status <> 'open' and $2 = 'open' then now() else reopened_at end,
         reopened_by_user_id = case when status <> 'open' and $2 = 'open' then $24 else reopened_by_user_id end,
         reopen_count = reopen_count + case when status <> 'open' and $2 = 'open' then 1 else 0 end,
         closure_source = $22, loss_reason_id = $25,
         archived_at = case when status <> $2 then null else archived_at end,
         archive_manual_hold = case when status <> $2 then false else archive_manual_hold end
       where id = $1 and ($23::text is null or status = $23)
         and ($28::timestamptz is null or date_trunc('milliseconds', updated_at) = $28::timestamptz) returning *),
       events as (
         insert into timeline_events (id, tenant_id, workspace_id, entity_type, entity_id, event_type, actor_type, actor_id, payload)
         select $27 || '-' || e.ordinality, d.tenant_id, d.workspace_id, 'deal', d.id,
           e.value->>'eventType', e.value->>'actorType', e.value->>'actorId',
           coalesce(e.value->'payload', '{}'::jsonb) || jsonb_build_object('closedAt', d.closed_at, 'firstClosedAt', d.first_closed_at, 'reopenCount', d.reopen_count)
         from changed d cross join jsonb_array_elements($26::jsonb) with ordinality as e(value, ordinality)
       ) select * from changed`,
      [
        id, input.status, input.forecastCategory, input.closedAt, input.closedByUserId, input.creditedOwnerUserId, input.creditedTeamId,
        input.wonReason, input.lossReason, input.closeComment, input.competitorId, input.wonProposalId, input.finalValueCents,
        input.finalCostCents, input.finalGrossProfitCents, input.finalMarginBp, input.finalMrrCents, input.finalArrCents,
        input.finalTcvCents, input.finalSnapshot ? JSON.stringify(input.finalSnapshot) : null,
        input.stageId ?? null, input.closureSource ?? null, input.expectedStatus ?? null, input.reopenedByUserId ?? null,
        input.lossReasonId ?? null,
        JSON.stringify(input.auditEvents ?? []), `timeline-${crypto.randomUUID()}`, input.expectedUpdatedAt ?? null,
      ],
    );
    if (!result.rows[0]) throw new Error("DEAL_CONFLICT: a oportunidade foi alterada por outra ação. Atualize e tente novamente.");
    return toDomain(result.rows[0]);
  }

  async setArchived(input: { id: string; tenantId: string; workspaceId: string; archived: boolean; actorUserId: string }): Promise<Deal> {
    const result = await this.pool.query<DealRow>(
      `with changed as (
        update deals set archived_at = case when $4 then now() else null end, archive_manual_hold = not $4, updated_at = now()
        where id = $1 and tenant_id = $2 and workspace_id = $3 and status in ('won', 'lost')
          and (($4 and archived_at is null) or (not $4 and archived_at is not null))
        returning *
      ), event as (
        insert into timeline_events (id, tenant_id, workspace_id, entity_type, entity_id, event_type, actor_type, actor_id, payload)
        select $6, tenant_id, workspace_id, 'deal', id, case when $4 then 'deal_archived' else 'deal_unarchived' end, 'user', $5,
          jsonb_build_object('source', 'manual', 'status', status, 'stageId', stage_id, 'archivedAt', archived_at) from changed
      ) select * from changed`,
      [input.id, input.tenantId, input.workspaceId, input.archived, input.actorUserId, `timeline-${crypto.randomUUID()}`],
    );
    if (!result.rows[0]) {
      const existing = await this.getById(input.id);
      if (existing?.tenantId === input.tenantId && existing.workspaceId === input.workspaceId && (existing.status === "won" || existing.status === "lost") && Boolean(existing.archivedAt) === input.archived) return existing;
      throw new Error("DEAL_CLOSED: somente oportunidades ganhas ou perdidas podem ser arquivadas.");
    }
    return toDomain(result.rows[0]);
  }

  /** Archive and its audit event commit together. Concurrent workers update each row once. */
  async archiveDueClosedDeals(scope?: { tenantId: string; workspaceId: string }): Promise<number> {
    const result = await this.pool.query<{ id: string }>(
      `with changed as (
        update deals d set archived_at = now(), updated_at = now()
        from commercial_settings s where s.workspace_id = d.workspace_id and s.tenant_id = d.tenant_id
        and d.status in ('won', 'lost') and d.archived_at is null and not d.archive_manual_hold
        and s.closed_deal_archive_days is not null
        and d.closed_at + s.closed_deal_archive_days * interval '1 day' <= now()
        and ($1::text is null or (d.tenant_id = $1 and d.workspace_id = $2))
        returning d.*
      ), event as (
        insert into timeline_events (id, tenant_id, workspace_id, entity_type, entity_id, event_type, actor_type, payload)
        select $3 || '-' || id, tenant_id, workspace_id, 'deal', id, 'deal_archived', 'system',
          jsonb_build_object('source', 'retention', 'status', status, 'stageId', stage_id, 'closedAt', closed_at, 'archivedAt', archived_at)
        from changed
      ) select id from changed`,
      [scope?.tenantId ?? null, scope?.workspaceId ?? null, `timeline-${crypto.randomUUID()}`],
    );
    return result.rows.length;
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

  async summarizeOpenByContact(filter: ContactOpenDealsFilter): Promise<ContactOpenDealsSummary[]> {
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    const conditions = buildFilterConditions({ ...filter, status: "open" }, params);
    conditions.push("contact_id is not null", "won_at is null", "lost_at is null");
    const result = await this.pool.query<{ contact_id: string; currency: string; count: string; value_cents_sum: string }>(
      `select contact_id, currency, count(*) as count, coalesce(sum(value_cents), 0) as value_cents_sum
       from deals where ${conditions.join(" and ")}
       group by contact_id, currency order by contact_id, currency`,
      params,
    );
    return result.rows.map((row) => ({ contactId: row.contact_id, currency: row.currency, count: Number(row.count), valueCentsSum: Number(row.value_cents_sum) }));
  }

  async summaryByPipeline(filter: Omit<ListDealsFilter, "cursor" | "limit" | "stageId"> & { pipelineId: string }): Promise<DealStageSummary[]> {
    const params: unknown[] = [filter.tenantId, filter.workspaceId];
    const conditions = buildFilterConditions(filter, params);
    const result = await this.pool.query<{ stage_id: string; count: string; value_cents_sum: string | null }>(
      `select stage_id, count(*) as count, coalesce(sum(case when status = 'won' then coalesce(final_value_cents, value_cents) else value_cents end), 0) as value_cents_sum
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
