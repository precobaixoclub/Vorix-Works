import type { CreatePlanningDecisionInput, PlanningDecisionRepositoryPort } from "../../application/ports/planning-decision-repository.port.js";
import type { PlanningDecision } from "../../domain/planning/planning.model.js";

export class InMemoryPlanningDecisionRepository implements PlanningDecisionRepositoryPort {
  private readonly decisions = new Map<string, PlanningDecision>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async createMany(inputs: readonly CreatePlanningDecisionInput[]): Promise<PlanningDecision[]> {
    const createdAt = this.now().toISOString();
    const created = inputs.map((input) => ({ ...input, createdAt }));
    for (const decision of created) this.decisions.set(decision.id, clone(decision));
    return created.map(clone);
  }

  async listByPlanning(planningId: string): Promise<PlanningDecision[]> {
    return [...this.decisions.values()].filter((decision) => decision.planningId === planningId).map(clone);
  }

  clear(): void {
    this.decisions.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
