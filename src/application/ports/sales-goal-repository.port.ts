import type { GoalMetric, GoalPeriod, GoalScope, SalesGoal } from "../../domain/sales/goals.js";
import type { CommercialApprovalRequest } from "../../domain/sales/sales.model.js";
import type { Deal, Proposal, TimelineEvent } from "../../domain/crm/crm.model.js";

export type SalesGoalRepositoryPort = {
  list(input: { tenantId: string; workspaceId: string; periodFrom?: string; periodTo?: string; scopeType?: GoalScope; scopeId?: string; metric?: GoalMetric }): Promise<SalesGoal[]>;
  getById(id: string): Promise<SalesGoal | undefined>;
  upsert(input: { tenantId: string; workspaceId: string; scopeType: GoalScope; scopeId?: string; metric: GoalMetric; periodType: GoalPeriod; periodStart: string; targetValue: number; currency?: string; actorUserId?: string }): Promise<{ goal: SalesGoal; previousTarget?: number }>;
  delete(id: string): Promise<void>;
  recordChange(input: { goalId: string; tenantId: string; workspaceId: string; changedBy?: string; fromValue?: number; toValue?: number; action: "created" | "updated" | "deleted" }): Promise<void>;
  /** Marca "meta atingida" uma única vez; false se já marcada. */
  claimAchievement(goalId: string, dealId?: string): Promise<boolean>;
};

/** Leituras agregáveis do Sales Engine — o backend agrega (nunca o frontend), sempre por tenant. */
export type SalesAnalyticsRepositoryPort = {
  listDeals(input: { tenantId: string; workspaceId: string; statuses?: readonly Deal["status"][]; closedFrom?: string; closedTo?: string; createdFrom?: string; createdTo?: string; limit?: number }): Promise<Deal[]>;
  listDealStageEvents(input: { tenantId: string; workspaceId: string; from: string; to: string; limit?: number }): Promise<TimelineEvent[]>;
  listProposals(input: { tenantId: string; workspaceId: string; createdFrom: string; createdTo: string; limit?: number }): Promise<Proposal[]>;
  listApprovals(input: { tenantId: string; workspaceId: string; from: string; to: string }): Promise<CommercialApprovalRequest[]>;
  /** Oportunidades abertas com pelo menos uma tarefa pendente (para "sem próxima atividade"). */
  listDealIdsWithPendingTasks(input: { tenantId: string; workspaceId: string }): Promise<Set<string>>;
};
