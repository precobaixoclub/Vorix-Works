import type { CreatePlanningInput, ListPlanningFilter, PlanningRepositoryPort } from "../../application/ports/planning-repository.port.js";
import type { Planning, PlanningStatus } from "../../domain/planning/planning.model.js";

const TERMINAL_STATUSES: readonly PlanningStatus[] = ["superseded"];

export class InMemoryPlanningRepository implements PlanningRepositoryPort {
  private readonly plannings = new Map<string, Planning>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreatePlanningInput): Promise<Planning> {
    const nowIso = this.now().toISOString();
    const planning: Planning = { ...input, createdAt: nowIso, updatedAt: nowIso };
    this.plannings.set(planning.id, clone(planning));
    return clone(planning);
  }

  async getById(id: string): Promise<Planning | undefined> {
    const found = this.plannings.get(id);
    return found ? clone(found) : undefined;
  }

  async getByPreparedCommand(preparedCommandId: string, preparedCommandRevision: number): Promise<Planning | undefined> {
    const found = [...this.plannings.values()].find((p) => p.preparedCommandId === preparedCommandId && p.preparedCommandRevision === preparedCommandRevision);
    return found ? clone(found) : undefined;
  }

  async getActiveByPreparedCommandId(preparedCommandId: string): Promise<Planning | undefined> {
    const found = [...this.plannings.values()]
      .filter((p) => p.preparedCommandId === preparedCommandId && !TERMINAL_STATUSES.includes(p.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return found ? clone(found) : undefined;
  }

  async updateStatus(id: string, status: PlanningStatus): Promise<Planning> {
    const existing = this.plannings.get(id);
    if (!existing) throw new Error(`PLANNING_NOT_FOUND: planning "${id}" não existe.`);
    const nowIso = this.now().toISOString();
    const updated: Planning = { ...existing, status, updatedAt: nowIso, supersededAt: status === "superseded" ? nowIso : existing.supersededAt };
    this.plannings.set(id, clone(updated));
    return clone(updated);
  }

  async listByWorkspace(filter: ListPlanningFilter): Promise<Planning[]> {
    return [...this.plannings.values()]
      .filter((p) => p.tenantId === filter.tenantId && p.workspaceId === filter.workspaceId)
      .filter((p) => !filter.conversationId || p.conversationId === filter.conversationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(clone);
  }

  clear(): void {
    this.plannings.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
