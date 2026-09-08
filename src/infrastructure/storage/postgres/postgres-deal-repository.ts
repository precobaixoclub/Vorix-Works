import type { Pool } from "pg";
import type {
  CreateDealInput,
  DealRepositoryPort,
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
};

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
  return conditions;
}

export class PostgresDealRepository implements DealRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateDealInput): Promise<Deal> {
    const result = await this.pool.query<DealRow>(
      `insert into deals (id, tenant_id, workspace_id, pipeline_id, stage_id, contact_id, title, value_cents, currency, owner_user_id, team_id, origin, expected_close_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning *`,
      [
        dealId(), input.tenantId, input.workspaceId, input.pipelineId, input.stageId,
        input.contactId ?? null, input.title, input.valueCents ?? 0, input.currency ?? "BRL",
        input.ownerUserId ?? null, input.teamId ?? null, input.origin ?? null, input.expectedCloseDate ?? null,
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
    if (!existing) throw new Error(`DEAL_NOT_FOUND: negócio "${id}" não existe.`);
    const result = await this.pool.query<DealRow>(
      `update deals set
         contact_id = $2, title = $3, value_cents = $4, currency = $5, owner_user_id = $6,
         team_id = $7, origin = $8, expected_close_date = $9, updated_at = now()
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
    if (!result.rows[0]) throw new Error(`DEAL_NOT_FOUND: negócio "${id}" não existe.`);
    return toDomain(result.rows[0]);
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
