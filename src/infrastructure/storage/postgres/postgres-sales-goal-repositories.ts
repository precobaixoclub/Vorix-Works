import type { Pool } from "pg";
import type { SalesAnalyticsRepositoryPort, SalesGoalRepositoryPort } from "../../../application/ports/sales-goal-repository.port.js";
import type { GoalMetric, GoalPeriod, GoalScope, SalesGoal } from "../../../domain/sales/goals.js";
import type { CommercialApprovalRequest } from "../../../domain/sales/sales.model.js";
import type { ApprovalReason } from "../../../domain/sales/pricing.js";
import type { Deal, Proposal, TimelineActorType, TimelineEntityType, TimelineEvent } from "../../../domain/crm/crm.model.js";
import { mapDealRow, type DealRow } from "./postgres-deal-repository.js";
import { mapProposalRow, type ProposalRow } from "./postgres-proposal-repository.js";

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

type GoalRow = {
  id: string; tenant_id: string; workspace_id: string; scope_type: GoalScope; scope_id: string | null; metric: GoalMetric; period_type: GoalPeriod;
  period_start: Date | string; target_value: string; currency: string; created_by_user_id: string | null; updated_by_user_id: string | null; created_at: Date; updated_at: Date;
};
const isoDate = (value: Date | string): string => (typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10));
const toGoal = (row: GoalRow): SalesGoal => ({
  id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, scopeType: row.scope_type, scopeId: row.scope_id ?? undefined, metric: row.metric,
  periodType: row.period_type, periodStart: isoDate(row.period_start), targetValue: Number(row.target_value), currency: row.currency,
  createdByUserId: row.created_by_user_id ?? undefined, updatedByUserId: row.updated_by_user_id ?? undefined, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
});

export class PostgresSalesGoalRepository implements SalesGoalRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async list(input: { tenantId: string; workspaceId: string; periodFrom?: string; periodTo?: string; scopeType?: GoalScope; scopeId?: string; metric?: GoalMetric }): Promise<SalesGoal[]> {
    const params: unknown[] = [input.tenantId, input.workspaceId];
    const where = ["tenant_id = $1", "workspace_id = $2"];
    const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace("?", () => `$${params.length}`)); };
    if (input.periodFrom) add("period_start >= ?::date", input.periodFrom);
    if (input.periodTo) add("period_start < ?::date", input.periodTo);
    if (input.scopeType) add("scope_type = ?", input.scopeType);
    if (input.scopeId) add("scope_id = ?", input.scopeId);
    if (input.metric) add("metric = ?", input.metric);
    const result = await this.pool.query<GoalRow>(`select * from sales_goals where ${where.join(" and ")} order by period_start, scope_type, scope_id, metric`, params);
    return result.rows.map(toGoal);
  }

  async getById(id: string): Promise<SalesGoal | undefined> {
    const result = await this.pool.query<GoalRow>("select * from sales_goals where id = $1", [id]);
    return result.rows[0] ? toGoal(result.rows[0]) : undefined;
  }

  async upsert(input: { tenantId: string; workspaceId: string; scopeType: GoalScope; scopeId?: string; metric: GoalMetric; periodType: GoalPeriod; periodStart: string; targetValue: number; currency?: string; actorUserId?: string }): Promise<{ goal: SalesGoal; previousTarget?: number }> {
    const existing = await this.pool.query<GoalRow>(
      "select * from sales_goals where workspace_id = $1 and scope_type = $2 and coalesce(scope_id, '') = coalesce($3, '') and metric = $4 and period_type = $5 and period_start = $6::date",
      [input.workspaceId, input.scopeType, input.scopeId ?? null, input.metric, input.periodType, input.periodStart],
    );
    if (existing.rows[0]) {
      const updated = await this.pool.query<GoalRow>(
        "update sales_goals set target_value = $2, currency = $3, updated_by_user_id = $4, updated_at = now() where id = $1 returning *",
        [existing.rows[0].id, input.targetValue, input.currency ?? existing.rows[0].currency, input.actorUserId ?? null],
      );
      return { goal: toGoal(updated.rows[0]), previousTarget: Number(existing.rows[0].target_value) };
    }
    const created = await this.pool.query<GoalRow>(
      `insert into sales_goals (id, tenant_id, workspace_id, scope_type, scope_id, metric, period_type, period_start, target_value, currency, created_by_user_id, updated_by_user_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $11) returning *`,
      [newId("goal"), input.tenantId, input.workspaceId, input.scopeType, input.scopeType === "company" ? null : input.scopeId ?? null, input.metric, input.periodType, input.periodStart, input.targetValue, input.currency ?? "BRL", input.actorUserId ?? null],
    );
    return { goal: toGoal(created.rows[0]) };
  }

  async delete(id: string): Promise<void> {
    await this.pool.query("delete from sales_goals where id = $1", [id]);
  }

  async recordChange(input: { goalId: string; tenantId: string; workspaceId: string; changedBy?: string; fromValue?: number; toValue?: number; action: "created" | "updated" | "deleted" }): Promise<void> {
    await this.pool.query(
      "insert into sales_goal_changes (id, goal_id, tenant_id, workspace_id, changed_by, from_value, to_value, action) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [newId("goalchange"), input.goalId, input.tenantId, input.workspaceId, input.changedBy ?? null, input.fromValue ?? null, input.toValue ?? null, input.action],
    );
  }

  async claimAchievement(goalId: string, dealId?: string): Promise<boolean> {
    const result = await this.pool.query("insert into sales_goal_achievements (goal_id, deal_id) values ($1, $2) on conflict do nothing", [goalId, dealId ?? null]);
    return (result.rowCount ?? 0) > 0;
  }
}

type TimelineRow = { id: string; tenant_id: string; workspace_id: string; entity_type: string; entity_id: string; event_type: string; actor_type: string; actor_id: string | null; payload: Record<string, unknown>; occurred_at: Date };

type ApprovalRow = {
  id: string; tenant_id: string; workspace_id: string; deal_id: string; proposal_id: string | null; requested_by_user_id: string; status: CommercialApprovalRequest["status"];
  justification: string | null; terms_fingerprint: string; reasons: ApprovalReason[] | null; snapshot: Record<string, unknown> | null; decided_by_user_id: string | null;
  decided_at: Date | null; decision_reason: string | null; approved_value_cents: string | null; created_at: Date; updated_at: Date;
};

export class PostgresSalesAnalyticsRepository implements SalesAnalyticsRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async listDeals(input: { tenantId: string; workspaceId: string; statuses?: readonly Deal["status"][]; closedFrom?: string; closedTo?: string; createdFrom?: string; createdTo?: string; limit?: number }): Promise<Deal[]> {
    const params: unknown[] = [input.tenantId, input.workspaceId];
    const where = ["tenant_id = $1", "workspace_id = $2"];
    const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace("?", () => `$${params.length}`)); };
    if (input.statuses?.length) add("status = any(?::text[])", [...input.statuses]);
    if (input.closedFrom) add("closed_at >= ?", input.closedFrom);
    if (input.closedTo) add("closed_at < ?", input.closedTo);
    if (input.createdFrom) add("created_at >= ?", input.createdFrom);
    if (input.createdTo) add("created_at < ?", input.createdTo);
    params.push(input.limit ?? 5000);
    const result = await this.pool.query<DealRow>(`select * from deals where ${where.join(" and ")} order by created_at desc limit $${params.length}`, params);
    return result.rows.map(mapDealRow);
  }

  async listDealStageEvents(input: { tenantId: string; workspaceId: string; from: string; to: string; limit?: number }): Promise<TimelineEvent[]> {
    const result = await this.pool.query<TimelineRow>(
      `select * from timeline_events where tenant_id = $1 and workspace_id = $2 and entity_type = 'deal'
         and event_type in ('deal_created', 'deal_stage_changed') and occurred_at >= $3 and occurred_at < $4
       order by occurred_at asc limit $5`,
      [input.tenantId, input.workspaceId, input.from, input.to, input.limit ?? 20000],
    );
    return result.rows.map((row) => ({
      id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, entityType: row.entity_type as TimelineEntityType, entityId: row.entity_id,
      eventType: row.event_type, actorType: row.actor_type as TimelineActorType, actorId: row.actor_id ?? undefined, payload: row.payload ?? {}, occurredAt: row.occurred_at.toISOString(),
    }));
  }

  async listProposals(input: { tenantId: string; workspaceId: string; createdFrom: string; createdTo: string; limit?: number }): Promise<Proposal[]> {
    const result = await this.pool.query<ProposalRow>(
      "select * from proposals where tenant_id = $1 and workspace_id = $2 and created_at >= $3 and created_at < $4 order by created_at limit $5",
      [input.tenantId, input.workspaceId, input.createdFrom, input.createdTo, input.limit ?? 5000],
    );
    return result.rows.map(mapProposalRow);
  }

  async listApprovals(input: { tenantId: string; workspaceId: string; from: string; to: string }): Promise<CommercialApprovalRequest[]> {
    const result = await this.pool.query<ApprovalRow>(
      "select * from commercial_approval_requests where tenant_id = $1 and workspace_id = $2 and created_at >= $3 and created_at < $4 order by created_at",
      [input.tenantId, input.workspaceId, input.from, input.to],
    );
    return result.rows.map((row) => ({
      id: row.id, tenantId: row.tenant_id, workspaceId: row.workspace_id, dealId: row.deal_id, proposalId: row.proposal_id ?? undefined, requestedByUserId: row.requested_by_user_id,
      status: row.status, justification: row.justification ?? undefined, termsFingerprint: row.terms_fingerprint, reasons: row.reasons ?? [], snapshot: row.snapshot ?? {},
      decidedByUserId: row.decided_by_user_id ?? undefined, decidedAt: row.decided_at?.toISOString(), decisionReason: row.decision_reason ?? undefined,
      approvedValueCents: row.approved_value_cents === null ? undefined : Number(row.approved_value_cents), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    }));
  }

  async listDealIdsWithPendingTasks(input: { tenantId: string; workspaceId: string }): Promise<Set<string>> {
    const result = await this.pool.query<{ deal_id: string }>(
      "select distinct deal_id from tasks where tenant_id = $1 and workspace_id = $2 and status = 'pending' and deal_id is not null",
      [input.tenantId, input.workspaceId],
    );
    return new Set(result.rows.map((row) => row.deal_id));
  }
}
