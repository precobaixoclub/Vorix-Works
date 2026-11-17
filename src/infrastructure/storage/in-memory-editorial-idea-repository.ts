import { randomUUID } from "node:crypto";
import type { EditorialIdeaRepositoryPort } from "../../application/ports/editorial-idea-repository.port.js";
import type { EditorialIdea } from "../../domain/editorial/editorial-idea.model.js";

export class InMemoryEditorialIdeaRepository implements EditorialIdeaRepositoryPort {
  private readonly ideas = new Map<string, EditorialIdea>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async listByWorkspace(workspaceId: string): Promise<EditorialIdea[]> {
    return [...this.ideas.values()].filter((idea) => idea.workspaceId === workspaceId).sort((a, b) => a.externalId.localeCompare(b.externalId));
  }

  async get(workspaceId: string, id: string): Promise<EditorialIdea | undefined> {
    const idea = this.ideas.get(id);
    return idea?.workspaceId === workspaceId ? idea : undefined;
  }

  async importMany(input: Parameters<EditorialIdeaRepositoryPort["importMany"]>[0]): Promise<{ created: number; skipped: number }> {
    const existing = new Set((await this.listByWorkspace(input.workspaceId)).map((idea) => idea.externalId));
    const timestamp = this.now().toISOString();
    let created = 0;
    for (const content of input.ideas) {
      if (existing.has(content.externalId)) continue;
      const id = `edi-${randomUUID()}`;
      this.ideas.set(id, { ...content, id, tenantId: input.tenantId, workspaceId: input.workspaceId, status: "available", statusChangedAt: timestamp, createdAt: timestamp, updatedAt: timestamp });
      existing.add(content.externalId);
      created += 1;
    }
    return { created, skipped: input.ideas.length - created };
  }

  async update(workspaceId: string, id: string, patch: Parameters<EditorialIdeaRepositoryPort["update"]>[2]): Promise<EditorialIdea | undefined> {
    const idea = await this.get(workspaceId, id);
    if (!idea) return undefined;
    const timestamp = this.now().toISOString();
    const next: EditorialIdea = { ...idea, updatedAt: timestamp };
    if (patch.status && patch.status !== idea.status) { next.status = patch.status; next.statusChangedAt = timestamp; }
    if (patch.scheduledDate !== undefined) { if (patch.scheduledDate === null) delete next.scheduledDate; else next.scheduledDate = patch.scheduledDate; }
    if (patch.executionRunId !== undefined) { if (patch.executionRunId === null) delete next.executionRunId; else next.executionRunId = patch.executionRunId; }
    if (patch.creativePrompt !== undefined) { if (patch.creativePrompt === null || patch.creativePrompt === "") delete next.creativePrompt; else next.creativePrompt = patch.creativePrompt; }
    this.ideas.set(id, next);
    return next;
  }
}
