import type {
  FindOrCreateInboxConversationInput,
  InboxConversationListFilter,
  InboxConversationListItem,
  InboxConversationRepositoryPort,
} from "../../application/ports/inbox-conversation-repository.port.js";
import type { InboxContactRepositoryPort } from "../../application/ports/inbox-contact-repository.port.js";
import type { InboxMessageRepositoryPort } from "../../application/ports/inbox-message-repository.port.js";
import type { InboxAiPauseReason, InboxConversation, InboxConversationStatus, InboxMediaStorageRef } from "../../domain/inbox/inbox.model.js";

const idGenerator = () => `inboxconv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryInboxConversationRepository implements InboxConversationRepositoryPort {
  private readonly rows = new Map<string, InboxConversation>();

  /** Ambos opcionais — só usados para denormalizar em `listByWorkspace` (read-model de Fase 3):
   * `contactRepository` para nome/telefone, `messageRepository` para o preview da última mensagem
   * (redesign operacional). Sem eles, a listagem ainda funciona, só sem esses campos. */
  constructor(
    private readonly contactRepository?: InboxContactRepositoryPort,
    private readonly messageRepository?: InboxMessageRepositoryPort,
  ) {}

  async findOrCreate(input: FindOrCreateInboxConversationInput): Promise<InboxConversation> {
    // Idempotente por `(connectionId, externalChatId)` — identidade canônica do chat, nunca mais o
    // remetente de uma mensagem (ver correção do bug de identidade de conversa, migration 0115).
    const existing = [...this.rows.values()].find(
      (row) => row.connectionId === input.connectionId && row.externalChatId === input.externalChatId && !row.mergeStatus,
    );
    if (existing) {
      if (existing.groupName || existing.contactId) return existing;
      // Mesma regra do adapter Postgres: preenche `groupName`/`contactId` só se ainda estavam
      // vazios, nunca sobrescreve o que já tiver.
      const filled = { ...existing, groupName: existing.groupName ?? input.groupName, contactId: existing.contactId ?? input.contactId };
      this.rows.set(existing.id, filled);
      return filled;
    }
    const now = new Date().toISOString();
    const created: InboxConversation = {
      id: idGenerator(),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      chatType: input.chatType,
      externalChatId: input.externalChatId,
      groupName: input.groupName,
      contactId: input.contactId,
      status: "open",
      unreadCount: 0,
      isUrgent: false,
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

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async getByExternalChatId(input: { connectionId: string; externalChatId: string }): Promise<InboxConversation | undefined> {
    // Mesmo racional do adapter Postgres: prefere o registro ATIVO se houver, mas ainda devolve um
    // tombstone se for a única correspondência (o reconciliador precisa enxergá-lo).
    const matches = [...this.rows.values()].filter(
      (row) => row.connectionId === input.connectionId && row.externalChatId === input.externalChatId,
    );
    return matches.find((row) => !row.mergeStatus) ?? matches[0];
  }

  async listByWorkspace(input: {
    tenantId: string;
    workspaceId: string;
    filter?: InboxConversationListFilter;
    assignedUserId?: string;
  }): Promise<InboxConversationListItem[]> {
    let rows = [...this.rows.values()].filter((row) => row.tenantId === input.tenantId && row.workspaceId === input.workspaceId && !row.mergeStatus);
    switch (input.filter) {
      case "mine":
        rows = rows.filter((row) => row.assignedUserId === input.assignedUserId);
        break;
      case "unassigned":
        rows = rows.filter((row) => !row.assignedUserId && row.status !== "resolved" && row.status !== "archived");
        break;
      case "unread":
        rows = rows.filter((row) => row.unreadCount > 0);
        break;
      case "urgent":
        rows = rows.filter((row) => row.isUrgent);
        break;
      case "open":
      case "pending":
      case "resolved":
        rows = rows.filter((row) => row.status === input.filter);
        break;
      default:
        break;
    }
    const sorted = rows.sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));
    const items: InboxConversationListItem[] = [];
    for (const row of sorted) {
      const contact = row.contactId ? await this.contactRepository?.getById(row.contactId) : undefined;
      const [lastMessage] = (await this.messageRepository?.listByConversation({
        tenantId: row.tenantId,
        workspaceId: row.workspaceId,
        conversationId: row.id,
        limit: 1,
      })) ?? [];
      items.push({
        ...row,
        contactName: contact?.name,
        contactPhone: contact?.phoneNormalized,
        contactProfilePictureStorageRef: contact?.profilePictureStorageRef,
        lastMessagePreview: lastMessage
          ? { type: lastMessage.type, body: lastMessage.body, direction: lastMessage.direction, senderDisplayName: lastMessage.senderDisplayName }
          : undefined,
      });
    }
    return items;
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

  async updateGroupMetadata(id: string, input: { groupName?: string; participantCount?: number; metadataUpdatedAt: string }): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) return;
    this.rows.set(id, {
      ...existing,
      groupName: input.groupName ?? existing.groupName,
      groupParticipantCount: input.participantCount ?? existing.groupParticipantCount,
      groupMetadataUpdatedAt: input.metadataUpdatedAt,
      updatedAt: new Date().toISOString(),
    });
  }

  async updateGroupPicture(id: string, input: { storageRef: InboxMediaStorageRef; syncedAt: string }): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) return;
    this.rows.set(id, { ...existing, groupPictureStorageRef: input.storageRef, groupPictureSyncedAt: input.syncedAt, updatedAt: new Date().toISOString() });
  }

  async markRead(id: string): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) return;
    this.rows.set(id, { ...existing, unreadCount: 0, updatedAt: new Date().toISOString() });
  }

  async markUnread(id: string): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing) return;
    this.rows.set(id, { ...existing, unreadCount: Math.max(existing.unreadCount, 1), updatedAt: new Date().toISOString() });
  }

  async setUrgent(id: string, isUrgent: boolean): Promise<InboxConversation> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    const updated = { ...existing, isUrgent, updatedAt: new Date().toISOString() };
    this.rows.set(id, updated);
    return updated;
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

  async setAiEnabled(id: string, aiEnabled: boolean, reason?: InboxAiPauseReason): Promise<InboxConversation> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
    const updated = { ...existing, aiEnabled, aiPausedReason: aiEnabled ? undefined : reason, updatedAt: new Date().toISOString() };
    this.rows.set(id, updated);
    return updated;
  }

  // Sem `await` entre o check e o set — o event loop do Node não intercala outra chamada no meio,
  // então isto já é atômico por construção (mesmo raciocínio da versão Postgres, só que a garantia
  // vem do single-thread do JS em vez de um WHERE de banco).
  async tryTakeOver(id: string, userId: string): Promise<InboxConversation | undefined> {
    const existing = this.rows.get(id);
    if (!existing) return undefined;
    if (existing.assignedUserId && existing.assignedUserId !== userId) return undefined;
    const updated: InboxConversation = { ...existing, assignedUserId: userId, aiEnabled: false, aiPausedReason: "human_takeover", updatedAt: new Date().toISOString() };
    this.rows.set(id, updated);
    return updated;
  }

  async tryTransfer(id: string, input: { fromUserId: string; toUserId: string }): Promise<InboxConversation | undefined> {
    const existing = this.rows.get(id);
    if (!existing || existing.assignedUserId !== input.fromUserId) return undefined;
    const updated = { ...existing, assignedUserId: input.toUserId, updatedAt: new Date().toISOString() };
    this.rows.set(id, updated);
    return updated;
  }

  async tryAcquireAiLock(id: string, at: string, staleBeforeIso: string): Promise<InboxConversation | undefined> {
    const existing = this.rows.get(id);
    if (!existing) return undefined;
    const isFree = !existing.aiProcessingSince || existing.aiProcessingSince < staleBeforeIso;
    if (!isFree) return undefined;
    const updated = { ...existing, aiProcessingSince: at };
    this.rows.set(id, updated);
    return updated;
  }

  async releaseAiLock(id: string, ownedAt: string): Promise<void> {
    const existing = this.rows.get(id);
    if (!existing || existing.aiProcessingSince !== ownedAt) return;
    this.rows.set(id, { ...existing, aiProcessingSince: undefined });
  }
}
