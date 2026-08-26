import type { InstagramDmConversation, InstagramDmConversationRepositoryPort, UpsertInstagramDmConversationInput } from "../../application/ports/instagram-dm-conversation-repository.port.js";

function buildId(workspaceId: string, instagramBusinessAccountId: string, participantId: string): string {
  return `idc-${workspaceId}-${instagramBusinessAccountId}-${participantId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class InMemoryInstagramDmConversationRepository implements InstagramDmConversationRepositoryPort {
  private readonly conversations = new Map<string, InstagramDmConversation>();

  async upsertConversation(input: UpsertInstagramDmConversationInput): Promise<InstagramDmConversation> {
    const id = input.id ?? buildId(input.workspaceId, input.instagramBusinessAccountId, input.participantId);
    const now = new Date().toISOString();
    const existing = this.conversations.get(id);
    const record: InstagramDmConversation = {
      ...input,
      id,
      participantUsername: input.participantUsername ?? existing?.participantUsername,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.conversations.set(id, record);
    return record;
  }

  async listByWorkspace(input: { tenantId: string; workspaceId: string; instagramBusinessAccountId?: string }): Promise<InstagramDmConversation[]> {
    return [...this.conversations.values()]
      .filter((conversation) => conversation.tenantId === input.tenantId && conversation.workspaceId === input.workspaceId)
      .filter((conversation) => !input.instagramBusinessAccountId || conversation.instagramBusinessAccountId === input.instagramBusinessAccountId)
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));
  }

  async getById(id: string): Promise<InstagramDmConversation | undefined> {
    return this.conversations.get(id);
  }

  async findByParticipant(input: { tenantId: string; workspaceId: string; instagramBusinessAccountId: string; participantId: string }): Promise<InstagramDmConversation | undefined> {
    return this.conversations.get(buildId(input.workspaceId, input.instagramBusinessAccountId, input.participantId));
  }

  async markRead(id: string): Promise<void> {
    const existing = this.conversations.get(id);
    if (!existing) return;
    this.conversations.set(id, { ...existing, unread: false, updatedAt: new Date().toISOString() });
  }

  async setAutomationMuted(id: string, muted: boolean): Promise<void> {
    const existing = this.conversations.get(id);
    if (!existing) return;
    this.conversations.set(id, { ...existing, automationMuted: muted, updatedAt: new Date().toISOString() });
  }
}
