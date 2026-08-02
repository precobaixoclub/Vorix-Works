import type { BriefingRepositoryPort, CreateBriefingInput } from "../../application/ports/briefing-repository.port.js";
import type { Briefing, BriefingStatus } from "../../domain/briefing/briefing.model.js";

export type BriefingIdGenerator = () => string;
const defaultIdGenerator: BriefingIdGenerator = () => `briefing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const TERMINAL_STATUSES: readonly BriefingStatus[] = ["completed", "cancelled", "expired"];

export class InMemoryBriefingRepository implements BriefingRepositoryPort {
  private readonly briefings = new Map<string, Briefing>();
  private readonly idGenerator: BriefingIdGenerator;
  private readonly now: () => Date;

  constructor(options: { idGenerator?: BriefingIdGenerator; now?: () => Date } = {}) {
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.now = options.now ?? (() => new Date());
  }

  async create(input: CreateBriefingInput): Promise<Briefing> {
    const nowIso = this.now().toISOString();
    const briefing: Briefing = {
      id: this.idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      type: input.type,
      status: "collecting",
      schemaVersion: input.schemaVersion,
      revision: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.briefings.set(briefing.id, clone(briefing));
    return clone(briefing);
  }

  async getById(id: string): Promise<Briefing | undefined> {
    const found = this.briefings.get(id);
    return found ? clone(found) : undefined;
  }

  async getActiveByConversation(conversationId: string): Promise<Briefing | undefined> {
    const active = [...this.briefings.values()]
      .filter((briefing) => briefing.conversationId === conversationId && !TERMINAL_STATUSES.includes(briefing.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return active[0] ? clone(active[0]) : undefined;
  }

  async updateStatus(id: string, status: BriefingStatus): Promise<Briefing> {
    const existing = this.briefings.get(id);
    if (!existing) throw new Error(`BRIEFING_NOT_FOUND: briefing "${id}" não existe.`);
    const nowIso = this.now().toISOString();
    const updated: Briefing = {
      ...existing,
      status,
      updatedAt: nowIso,
      completedAt: status === "completed" ? nowIso : existing.completedAt,
      cancelledAt: status === "cancelled" ? nowIso : existing.cancelledAt,
    };
    this.briefings.set(id, clone(updated));
    return clone(updated);
  }

  async incrementRevision(id: string): Promise<Briefing> {
    const existing = this.briefings.get(id);
    if (!existing) throw new Error(`BRIEFING_NOT_FOUND: briefing "${id}" não existe.`);
    const updated: Briefing = { ...existing, revision: existing.revision + 1, updatedAt: this.now().toISOString() };
    this.briefings.set(id, clone(updated));
    return clone(updated);
  }

  clear(): void {
    this.briefings.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
