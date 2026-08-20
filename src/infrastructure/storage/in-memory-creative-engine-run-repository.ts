import type {
  CreateCreativeEngineRunInput,
  CreativeEngineRun,
  CreativeEngineRunRepositoryPort,
  ListCreativeEngineRunsFilter,
} from "../../application/ports/creative-engine-run-repository.port.js";

export class InMemoryCreativeEngineRunRepository implements CreativeEngineRunRepositoryPort {
  private readonly runs = new Map<string, CreativeEngineRun>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreateCreativeEngineRunInput): Promise<CreativeEngineRun> {
    const run: CreativeEngineRun = { createdAt: this.now().toISOString(), ...input };
    this.runs.set(run.id, clone(run));
    return clone(run);
  }

  async getByExecutionRunId(executionRunId: string): Promise<CreativeEngineRun | undefined> {
    const found = [...this.runs.values()].find((run) => run.executionRunId === executionRunId);
    return found ? clone(found) : undefined;
  }

  async listByWorkspace(filter: ListCreativeEngineRunsFilter): Promise<CreativeEngineRun[]> {
    return [...this.runs.values()]
      .filter((run) => run.workspaceId === filter.workspaceId)
      .filter((run) => !filter.engineMode || run.engineMode === filter.engineMode)
      .filter((run) => !filter.from || run.createdAt >= filter.from)
      .filter((run) => !filter.to || run.createdAt <= filter.to)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  clear(): void {
    this.runs.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
