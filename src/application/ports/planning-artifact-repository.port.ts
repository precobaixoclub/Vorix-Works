import type { PlanningArtifact } from "../../domain/planning/planning.model.js";

export type CreatePlanningArtifactInput = Omit<PlanningArtifact, "createdAt">;

export type PlanningArtifactRepositoryPort = {
  createMany(inputs: readonly CreatePlanningArtifactInput[]): Promise<PlanningArtifact[]>;
  listByPlanning(planningId: string): Promise<PlanningArtifact[]>;
};
