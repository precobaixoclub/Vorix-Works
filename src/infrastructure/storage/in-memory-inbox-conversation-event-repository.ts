import type { InboxConversationEventRepositoryPort, RecordInboxConversationEventInput } from "../../application/ports/inbox-conversation-event-repository.port.js";
import type { InboxConversationEvent } from "../../domain/inbox/inbox.model.js";

const idGenerator = () => `inboxevt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryInboxConversationEventRepository implements InboxConversationEventRepositoryPort {
  private readonly rows: InboxConversationEvent[] = [];

  async record(input: RecordInboxConversationEventInput): Promise<InboxConversationEvent> {
    const event: InboxConversationEvent = { id: idGenerator(), createdAt: new Date().toISOString(), ...input };
    this.rows.push(event);
    return event;
  }

  async listByConversation(input: { tenantId: string; workspaceId: string; conversationId: string }): Promise<InboxConversationEvent[]> {
    return this.rows
      .filter((row) => row.tenantId === input.tenantId && row.workspaceId === input.workspaceId && row.conversationId === input.conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
