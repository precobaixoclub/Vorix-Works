import type { ListRuntimeFilter, PersistRuntimeTranslationInput, RuntimeDetails, RuntimeRepositoryPort } from "../../application/ports/runtime-repository.port.js";
import type {
  RuntimeArtifact,
  RuntimeBinding,
  RuntimePlan,
  RuntimeState,
  RuntimeTask,
  RuntimeTaskInputPort,
  RuntimeTaskOutputPort,
  RuntimeValidationIssue,
} from "../../domain/runtime/runtime.model.js";

export class InMemoryRuntimeRepository implements RuntimeRepositoryPort {
  private readonly plans = new Map<string, RuntimePlan>();
  private readonly tasksByPlan = new Map<string, RuntimeTask[]>();
  private readonly outputsByPlan = new Map<string, RuntimeTaskOutputPort[]>();
  private readonly inputsByPlan = new Map<string, RuntimeTaskInputPort[]>();
  private readonly bindingsByPlan = new Map<string, RuntimeBinding[]>();
  private readonly artifactsByPlan = new Map<string, RuntimeArtifact[]>();
  private readonly issuesByPlan = new Map<string, RuntimeValidationIssue[]>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async persist(input: PersistRuntimeTranslationInput): Promise<RuntimePlan> {
    const nowIso = this.now().toISOString();
    const plan: RuntimePlan = { ...input.plan, createdAt: nowIso, updatedAt: nowIso };
    this.plans.set(plan.id, clone(plan));
    this.tasksByPlan.set(plan.id, input.tasks.map((task) => clone({ ...task, createdAt: nowIso })));
    this.outputsByPlan.set(plan.id, input.outputs.map((port) => clone({ ...port, createdAt: nowIso })));
    this.inputsByPlan.set(plan.id, input.inputs.map((port) => clone({ ...port, createdAt: nowIso })));
    this.bindingsByPlan.set(plan.id, input.bindings.map((binding) => clone({ ...binding, createdAt: nowIso })));
    this.artifactsByPlan.set(plan.id, input.artifacts.map((artifact) => clone({ ...artifact, createdAt: nowIso })));
    this.issuesByPlan.set(plan.id, input.issues.map(clone));
    return clone(plan);
  }

  async getById(id: string): Promise<RuntimePlan | undefined> {
    const found = this.plans.get(id);
    return found ? clone(found) : undefined;
  }

  async getByPlanningId(planningId: string): Promise<RuntimePlan | undefined> {
    const found = [...this.plans.values()].find((plan) => plan.sourceContext.planningId === planningId);
    return found ? clone(found) : undefined;
  }

  async getDetails(runtimePlanId: string): Promise<RuntimeDetails> {
    return {
      tasks: (this.tasksByPlan.get(runtimePlanId) ?? []).map(clone),
      inputs: (this.inputsByPlan.get(runtimePlanId) ?? []).map(clone),
      outputs: (this.outputsByPlan.get(runtimePlanId) ?? []).map(clone),
      bindings: (this.bindingsByPlan.get(runtimePlanId) ?? []).map(clone),
      artifacts: (this.artifactsByPlan.get(runtimePlanId) ?? []).map(clone),
      issues: (this.issuesByPlan.get(runtimePlanId) ?? []).map(clone),
    };
  }

  async updateStatus(id: string, status: RuntimeState): Promise<RuntimePlan> {
    const existing = this.plans.get(id);
    if (!existing) throw new Error(`RUNTIME_NOT_FOUND: runtime "${id}" não existe.`);
    const nowIso = this.now().toISOString();
    const updated: RuntimePlan = { ...existing, status, updatedAt: nowIso, supersededAt: status === "superseded" ? nowIso : existing.supersededAt };
    this.plans.set(id, clone(updated));
    return clone(updated);
  }

  async listByWorkspace(filter: ListRuntimeFilter): Promise<RuntimePlan[]> {
    return [...this.plans.values()]
      .filter((plan) => plan.sourceContext.tenantId === filter.tenantId && plan.sourceContext.workspaceId === filter.workspaceId)
      .filter((plan) => !filter.planningId || plan.sourceContext.planningId === filter.planningId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  clear(): void {
    this.plans.clear();
    this.tasksByPlan.clear();
    this.outputsByPlan.clear();
    this.inputsByPlan.clear();
    this.bindingsByPlan.clear();
    this.artifactsByPlan.clear();
    this.issuesByPlan.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
