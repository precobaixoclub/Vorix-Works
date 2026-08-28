import type {
  FindOrCreateInboxConversationInput,
  InboxConversationListFilter,
  InboxConversationRepositoryPort,
} from "../../application/ports/inbox-conversation-repository.port.js";
import type { InboxConversation, InboxConversationStatus } from "../../domain/inbox/inbox.model.js";

const idGenerator = () => `inboxconv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryInboxConversationRepository implements InboxConversationRepositoryPort {
  private readonly rows = new Map<string, InboxConversation>();

  async findOrCreate(input: FindOrCreateInboxConversationInput): Promise<InboxConversation> {
    const existing = [...this.rows.values()].find(
      (row) => row.connectionId === input.connectionId && row.contactId === input.contactId,
    );
    if (existing) return existing;
    const now = new Date().toISOString();
    const created: InboxConversation = {
      id: idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      contactId: input.contactId,
      status: "open",
      unreadCount: 0,
      aiEnabled: false,
      automationEnabled: false,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(created.id, created);
    return created;
  }

  async getById(id: string): Promise<InboxConversation | undefined> {
    return this.rows.get(id);
  }

  async listByWorkspace(input: {
    tenantId: string;
    workspaceId: string;
    filter?: InboxConversationListFilter;
    assignedUserId?: string;
  }): Promise<InboxConversation[]> {
    let rows = [...this.rows.values()].filter((row) => row.tenantId === input.tenantId && row.workspaceId === input.workspaceId);
    switch (input.filter) {
      case "mine":
        rows = rows.filter((row) => row.assignedUserId === input.assignedUserId);
        break;
      case "unassigned":
        rows = rows.filter((row) => !row.assignedUserId);
        break;
      case "unread":
        rows = rows.filter((row) => row.unreadCount > 0);
        break;
      default:
        break;
    }
    return rows.sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));
  }

  async markLastMessage(id: string, input: { lastMessageAt: string; incrementUnread: boolean }): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) return;
    this.rows.set(id, {
      ...existing,
      lastMessageAt: input.lastMessageAt,
      unreadCount: input.incrementUnread ? existing.unreadCount + 1 : existing.unreadCount,
      updatedAt: new Date().toISOString(),
    });
  }

  async markRead(id: string): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) return;
    this.rows.set(id, { ...existing, unreadCount: 0, updatedAt: new Date().toISOString() });
  }

  async assign(id: string, assignedUserId: string | undefined): Promise<InboxConversation> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    const updated = { ...existing, assignedUserId, updatedAt: new Date().toISOString() };
    this.rows.set(id, updated);
    return updated;
  }

  async setStatus(id: string, status: InboxConversationStatus): Promise<InboxConversation> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    const updated = { ...existing, status, updatedAt: new Date().toISOString() };
    this.rows.set(id, updated);
    return updated;
  }

  async setAiEnabled(id: string, aiEnabled: boolean): Promise<InboxConversation> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    const updated = { ...existing, aiEnabled, updatedAt: new Date().toISOString() };
    this.rows.set(id, updated);
    return updated;
  }
}
