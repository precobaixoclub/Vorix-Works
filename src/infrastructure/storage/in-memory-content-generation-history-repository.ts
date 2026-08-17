import type { ContentGenerationHistoryEntry, ContentGenerationHistoryPort } from "../../application/ports/content-generation-history.port.js";

export class InMemoryContentGenerationHistoryRepository implements ContentGenerationHistoryPort {
  private readonly entriesByWorkspace = new Map<string, ContentGenerationHistoryEntry[]>();

  async recordGeneration(entry: ContentGenerationHistoryEntry): Promise<void> {
    const existing = this.entriesByWorkspace.get(entry.workspaceId) ?? [];
    if (existing.some((candidate) => candidate.executionRunId === entry.executionRunId)) return;
    existing.unshift(clone(entry));
    this.entriesByWorkspace.set(entry.workspaceId, existing);
  }

  async getRecentForWorkspace(workspaceId: string, limit = 5): Promise<ContentGenerationHistoryEntry[]> {
    return (this.entriesByWorkspace.get(workspaceId) ?? []).slice(0, Math.max(1, limit)).map(clone);
  }

  clear(): void {
    this.entriesByWorkspace.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
