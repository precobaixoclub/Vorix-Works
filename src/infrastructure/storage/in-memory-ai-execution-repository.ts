import type {
  AiExecution,
  AiExecutionRepositoryPort,
  CreateAiExecutionInput,
  ListAiExecutionsFilter,
} from "../../application/ports/ai-execution-repository.port.js";

export class InMemoryAiExecutionRepository implements AiExecutionRepositoryPort {
  private readonly executions = new Map<string, AiExecution>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreateAiExecutionInput): Promise<AiExecution> {
    const execution: AiExecution = { createdAt: this.now().toISOString(), ...input };
    this.executions.set(execution.id, clone(execution));
    return clone(execution);
  }

  async getById(id: string): Promise<AiExecution | undefined> {
    const found = this.executions.get(id);
    return found ? clone(found) : undefined;
  }

  async listByWorkspace(filter: ListAiExecutionsFilter): Promise<AiExecution[]> {
    return [...this.executions.values()]
      .filter((execution) => execution.tenantId === filter.tenantId && execution.workspaceId === filter.workspaceId)
      .filter((execution) => !filter.operation || execution.operation === filter.operation)
      .filter((execution) => !filter.from || execution.createdAt >= filter.from)
      .filter((execution) => !filter.to || execution.createdAt <= filter.to)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  clear(): void {
    this.executions.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
