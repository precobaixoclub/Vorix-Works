import type { CreateInboxQuickReplyInput, InboxQuickReplyRepositoryPort, UpdateInboxQuickReplyInput } from "../../application/ports/inbox-quick-reply-repository.port.js";
import type { InboxQuickReply } from "../../domain/inbox/inbox.model.js";

export class InMemoryInboxQuickReplyRepository implements InboxQuickReplyRepositoryPort {
  private readonly items = new Map<string, InboxQuickReply>();
  private sequence = 0;

  private assertShortcutFree(workspaceId: string, shortcut: string, exceptId?: string): void {
    const taken = [...this.items.values()].some((item) => item.workspaceId === workspaceId && item.id !== exceptId && item.shortcut.toLowerCase() === shortcut.toLowerCase());
    if (taken) throw new Error("INBOX_QUICK_REPLY_SHORTCUT_TAKEN: já existe uma resposta rápida com este atalho.");
  }

  async create(input: CreateInboxQuickReplyInput): Promise<InboxQuickReply> {
    this.assertShortcutFree(input.workspaceId, input.shortcut);
    const now = new Date().toISOString();
    const item: InboxQuickReply = { id: `inboxqr-${++this.sequence}`, tenantId: input.tenantId, workspaceId: input.workspaceId, shortcut: input.shortcut, body: input.body, ...(input.createdBy ? { createdBy: input.createdBy } : {}), createdAt: now, updatedAt: now };
    this.items.set(item.id, item);
    return item;
  }

  async getById(id: string): Promise<InboxQuickReply | undefined> {
    return this.items.get(id);
  }

  async listByWorkspace(workspaceId: string): Promise<InboxQuickReply[]> {
    return [...this.items.values()].filter((item) => item.workspaceId === workspaceId).sort((a, b) => a.shortcut.toLowerCase().localeCompare(b.shortcut.toLowerCase()));
  }

  async update(id: string, input: UpdateInboxQuickReplyInput): Promise<InboxQuickReply> {
    const current = this.items.get(id);
    if (!current) throw new Error(`INBOX_QUICK_REPLY_NOT_FOUND: resposta rápida "${id}" não existe.`);
    if (input.shortcut) this.assertShortcutFree(current.workspaceId, input.shortcut, id);
    const next = { ...current, ...(input.shortcut ? { shortcut: input.shortcut } : {}), ...(input.body ? { body: input.body } : {}), updatedAt: new Date().toISOString() };
    this.items.set(id, next);
    return next;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}
