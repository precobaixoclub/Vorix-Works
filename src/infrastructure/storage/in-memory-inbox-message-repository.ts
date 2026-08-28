import type { CreateInboxMessageInput, InboxMessageRepositoryPort } from "../../application/ports/inbox-message-repository.port.js";
import type { InboxMessage, InboxMessageStatus } from "../../domain/inbox/inbox.model.js";

const idGenerator = () => `inboxmsg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryInboxMessageRepository implements InboxMessageRepositoryPort {
  private readonly rows = new Map<string, InboxMessage>();

  async create(input: CreateInboxMessageInput): Promise<InboxMessage> {
    if (input.externalMessageId) {
      const existing = [...this.rows.values()].find(
        (row) => row.connectionId === input.connectionId && row.externalMessageId === input.externalMessageId,
      );
      if (existing) return existing;
    }
    const now = new Date().toISOString();
    const created: InboxMessage = {
      id: idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      connectionId: input.connectionId,
      externalMessageId: input.externalMessageId,
      direction: input.direction,
      type: input.type,
      status: input.status ?? (input.direction === "inbound" ? "delivered" : "queued"),
      body: input.body,
      mediaStorageRef: input.mediaStorageRef,
      mimeType: input.mimeType,
      metadata: input.metadata,
      sentByUserId: input.sentByUserId,
      sentByAi: input.sentByAi ?? false,
      sentByAutomation: input.sentByAutomation ?? false,
      attemptCount: 0,
      createdAt: now,
      sentAt: input.direction === "inbound" ? now : undefined,
    };
    this.rows.set(created.id, created);
    return created;
  }

  async getById(id: string): Promise<InboxMessage | undefined> {
    return this.rows.get(id);
  }

  async listByConversation(input: { tenantId: string; workspaceId: string; conversationId: string; cursor?: string; limit?: number }): Promise<InboxMessage[]> {
    const limit = input.limit ?? 50;
    return [...this.rows.values()]
      .filter((row) => row.tenantId === input.tenantId && row.workspaceId === input.workspaceId && row.conversationId === input.conversationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async updateStatusByExternalId(input: { connectionId: string; externalMessageId: string; status: InboxMessageStatus; occurredAt: string }): Promise<void> {
    const existing = [...this.rows.values()].find(
      (row) => row.connectionId === input.connectionId && row.externalMessageId === input.externalMessageId,
    );
    if (!existing) return;
    if (existing.status === "read" || existing.status === "failed") return;
    this.rows.set(existing.id, {
      ...existing,
      status: input.status,
      deliveredAt: input.status === "delivered" ? input.occurredAt : existing.deliveredAt,
      readAt: input.status === "read" ? input.occurredAt : existing.readAt,
    });
  }

  async markSent(id: string, input: { externalMessageId: string; sentAt: string }): Promise<InboxMessage> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`INBOX_MESSAGE_NOT_FOUND: mensagem "${id}" não existe.`);
    const updated: InboxMessage = { ...existing, status: "sent", externalMessageId: input.externalMessageId, sentAt: input.sentAt };
    this.rows.set(id, updated);
    return updated;
  }

  async markFailed(id: string, input: { lastError: string; failedAt: string }): Promise<InboxMessage> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`INBOX_MESSAGE_NOT_FOUND: mensagem "${id}" não existe.`);
    const updated: InboxMessage = { ...existing, status: "failed", lastError: input.lastError, failedAt: input.failedAt };
    this.rows.set(id, updated);
    return updated;
  }

  async recordAttempt(id: string, input: { lastError?: string; lastAttemptAt: string }): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) return;
    this.rows.set(id, { ...existing, attemptCount: existing.attemptCount + 1, lastError: input.lastError ?? existing.lastError, lastAttemptAt: input.lastAttemptAt });
  }
}
