import type { InboxQuickReply } from "../../domain/inbox/inbox.model.js";

/** Respostas rápidas da Inbox. Ver `db/migrations/0150_inbox_quick_replies_and_notes.sql`. */

export type CreateInboxQuickReplyInput = { tenantId: string; workspaceId: string; shortcut: string; body: string; createdBy?: string };
export type UpdateInboxQuickReplyInput = { shortcut?: string; body?: string };

export type InboxQuickReplyRepositoryPort = {
  /** Lança `INBOX_QUICK_REPLY_SHORTCUT_TAKEN` quando o atalho já existe no workspace (sem diferenciar maiúsculas). */
  create(input: CreateInboxQuickReplyInput): Promise<InboxQuickReply>;
  getById(id: string): Promise<InboxQuickReply | undefined>;
  listByWorkspace(workspaceId: string): Promise<InboxQuickReply[]>;
  update(id: string, input: UpdateInboxQuickReplyInput): Promise<InboxQuickReply>;
  delete(id: string): Promise<void>;
};
