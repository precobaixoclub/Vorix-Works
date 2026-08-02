import type { CreatePlanningArtifactInput, PlanningArtifactRepositoryPort } from "../../application/ports/planning-artifact-repository.port.js";
import type { PlanningArtifact } from "../../domain/planning/planning.model.js";

export class InMemoryPlanningArtifactRepository implements PlanningArtifactRepositoryPort {
  private readonly artifacts = new Map<string, PlanningArtifact>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async createMany(inputs: readonly CreatePlanningArtifactInput[]): Promise<PlanningArtifact[]> {
    const createdAt = this.now().toISOString();
    const created = inputs.map((input) => ({ ...input, createdAt }));
    for (const artifact of created) this.artifacts.set(artifact.id, clone(artifact));
    return created.map(clone);
  }

  async listByPlanning(planningId: string): Promise<PlanningArtifact[]> {
    return [...this.artifacts.values()].filter((artifact) => artifact.planningId === planningId).map(clone);
  }

  clear(): void {
    this.artifacts.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
