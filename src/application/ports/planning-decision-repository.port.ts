import type { PlanningDecision } from "../../domain/planning/planning.model.js";

export type CreatePlanningDecisionInput = Omit<PlanningDecision, "createdAt">;

export type PlanningDecisionRepositoryPort = {
  createMany(inputs: readonly CreatePlanningDecisionInput[]): Promise<PlanningDecision[]>;
  listByPlanning(planningId: string): Promise<PlanningDecision[]>;
};
