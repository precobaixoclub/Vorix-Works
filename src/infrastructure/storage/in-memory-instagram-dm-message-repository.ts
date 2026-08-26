import { randomUUID } from "node:crypto";
import type { InstagramDmMessage, InstagramDmMessageRepositoryPort, RecordInstagramDmMessageInput } from "../../application/ports/instagram-dm-message-repository.port.js";

export class InMemoryInstagramDmMessageRepository implements InstagramDmMessageRepositoryPort {
  private readonly messages: InstagramDmMessage[] = [];

  async recordMessage(input: RecordInstagramDmMessageInput): Promise<InstagramDmMessage> {
    if (input.messageId) {
      const existing = this.messages.find((message) => message.conversationId === input.conversationId && message.messageId === input.messageId);
      if (existing) return existing;
    }
    const record: InstagramDmMessage = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.messages.push(record);
    return record;
  }

  async listByConversation(input: { tenantId: string; workspaceId: string; conversationId: string; limit?: number }): Promise<InstagramDmMessage[]> {
    const filtered = this.messages
      .filter((message) => message.tenantId === input.tenantId && message.workspaceId === input.workspaceId && message.conversationId === input.conversationId)
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    return filtered.slice(0, input.limit ?? 50);
  }
}
