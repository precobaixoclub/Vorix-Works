import type { ExecutionTask } from "../../domain/planning/planning.model.js";

export type CreateExecutionTaskInput = Omit<ExecutionTask, "createdAt">;

export type ExecutionTaskRepositoryPort = {
  createMany(inputs: readonly CreateExecutionTaskInput[]): Promise<ExecutionTask[]>;
  getById(id: string): Promise<ExecutionTask | undefined>;
  listByPlanning(planningId: string): Promise<ExecutionTask[]>;
};
