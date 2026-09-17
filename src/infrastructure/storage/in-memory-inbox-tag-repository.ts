import type { CreateInboxTagInput, InboxTagRepositoryPort, UpdateInboxTagInput } from "../../application/ports/inbox-tag-repository.port.js";
import type { InboxTag } from "../../domain/inbox/inbox.model.js";

const idGenerator = () => `inboxtag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Bloco "etiquetas" (pedido explícito do usuário). Equivalente em memória do adapter Postgres —
 * mesmo comportamento, usado por dev sem banco/testes. */
export class InMemoryInboxTagRepository implements InboxTagRepositoryPort {
  private readonly tags = new Map<string, InboxTag>();
  private readonly links = new Set<string>(); // `${conversationId}:${tagId}`

  async create(input: CreateInboxTagInput): Promise<InboxTag> {
    const now = new Date().toISOString();
    const tag: InboxTag = {
      id: idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      name: input.name,
      color: input.color ?? "emerald",
      createdAt: now,
      updatedAt: now,
    };
    this.tags.set(tag.id, tag);
    return tag;
  }

  async getById(id: string): Promise<InboxTag | undefined> {
    return this.tags.get(id);
  }

  async listByWorkspace(workspaceId: string): Promise<InboxTag[]> {
    return [...this.tags.values()].filter((tag) => tag.workspaceId === workspaceId).sort((a, b) => a.name.localeCompare(b.name));
  }

  async update(id: string, input: UpdateInboxTagInput): Promise<InboxTag> {
    const existing = this.tags.get(id);
    if (!existing) throw new Error(`INBOX_TAG_NOT_FOUND: etiqueta "${id}" não existe.`);
    const updated: InboxTag = {
      ...existing,
      name: input.name ?? existing.name,
      color: input.color ?? existing.color,
      updatedAt: new Date().toISOString(),
    };
    this.tags.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.tags.delete(id);
    for (const link of this.links) {
      if (link.endsWith(`:${id}`)) this.links.delete(link);
    }
  }

  async attachToConversation(conversationId: string, tagId: string): Promise<void> {
    this.links.add(`${conversationId}:${tagId}`);
  }

  async detachFromConversation(conversationId: string, tagId: string): Promise<void> {
    this.links.delete(`${conversationId}:${tagId}`);
  }

  async listTagsByConversationIds(conversationIds: readonly string[]): Promise<Map<string, InboxTag[]>> {
    const map = new Map<string, InboxTag[]>();
    for (const conversationId of conversationIds) {
      const tags: InboxTag[] = [];
      for (const link of this.links) {
        const [linkConversationId, tagId] = link.split(":");
        if (linkConversationId !== conversationId) continue;
        const tag = this.tags.get(tagId);
        if (tag) tags.push(tag);
      }
      map.set(conversationId, tags.sort((a, b) => a.name.localeCompare(b.name)));
    }
    return map;
  }
}
