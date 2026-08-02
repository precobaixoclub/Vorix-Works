import type { CreateExecutionTaskInput, ExecutionTaskRepositoryPort } from "../../application/ports/execution-task-repository.port.js";
import type { ExecutionTask } from "../../domain/planning/planning.model.js";

export class InMemoryExecutionTaskRepository implements ExecutionTaskRepositoryPort {
  private readonly tasks = new Map<string, ExecutionTask>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async createMany(inputs: readonly CreateExecutionTaskInput[]): Promise<ExecutionTask[]> {
    const createdAt = this.now().toISOString();
    const created = inputs.map((input) => ({ ...input, createdAt }));
    for (const task of created) this.tasks.set(task.id, clone(task));
    return created.map(clone);
  }

  async getById(id: string): Promise<ExecutionTask | undefined> {
    const found = this.tasks.get(id);
    return found ? clone(found) : undefined;
  }

  async listByPlanning(planningId: string): Promise<ExecutionTask[]> {
    return [...this.tasks.values()]
      .filter((task) => task.planningId === planningId)
      .sort((a, b) => a.sequenceHint - b.sequenceHint)
      .map(clone);
  }

  clear(): void {
    this.tasks.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
