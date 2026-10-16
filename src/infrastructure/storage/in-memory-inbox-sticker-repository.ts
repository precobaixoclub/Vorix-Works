import type { InboxSavedSticker, InboxStickerRepositoryPort } from "../../application/ports/inbox-sticker-repository.port.js";

export class InMemoryInboxStickerRepository implements InboxStickerRepositoryPort {
  private readonly items = new Map<string, InboxSavedSticker>();

  async save(input: Omit<InboxSavedSticker, "createdAt">): Promise<{ sticker: InboxSavedSticker; created: boolean }> {
    const existing = [...this.items.values()].find((item) => item.workspaceId === input.workspaceId && item.contentHash === input.contentHash);
    if (existing) return { sticker: existing, created: false };
    const sticker = { ...input, createdAt: new Date().toISOString() };
    this.items.set(sticker.id, sticker);
    return { sticker, created: true };
  }

  async getById(id: string): Promise<InboxSavedSticker | undefined> {
    return this.items.get(id);
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; limit: number }): Promise<InboxSavedSticker[]> {
    return [...this.items.values()].filter((item) => item.tenantId === input.tenantId && item.workspaceId === input.workspaceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, input.limit);
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}
