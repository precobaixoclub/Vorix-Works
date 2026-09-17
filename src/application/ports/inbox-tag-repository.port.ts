import type { InboxTag, InboxTagColor } from "../../domain/inbox/inbox.model.js";

/** Bloco "etiquetas" (pedido explícito do usuário: "criar e configurar etiquetas dentro do
 * sistema e nas conversas ser possível adicionar mais do que uma"). Ver `db/migrations/0129_inbox_tags.sql`. */

export type CreateInboxTagInput = { tenantId: string; workspaceId: string; name: string; color?: InboxTagColor };
export type UpdateInboxTagInput = { name?: string; color?: InboxTagColor };

export type InboxTagRepositoryPort = {
  create(input: CreateInboxTagInput): Promise<InboxTag>;
  getById(id: string): Promise<InboxTag | undefined>;
  listByWorkspace(workspaceId: string): Promise<InboxTag[]>;
  update(id: string, input: UpdateInboxTagInput): Promise<InboxTag>;
  /** Exclusão PERMANENTE — cascateia pra `inbox_conversation_tags` (a etiqueta some de toda
   * conversa que a tinha, nunca deixa uma referência solta). */
  delete(id: string): Promise<void>;
  /** Idempotente — adicionar uma etiqueta que a conversa já tem nunca lança nem duplica. */
  attachToConversation(conversationId: string, tagId: string): Promise<void>;
  detachFromConversation(conversationId: string, tagId: string): Promise<void>;
  /** Busca em lote pra denormalizar em `listConversations` (Fase 3, ver `inbox-use-cases.ts`) sem
   * uma chamada por conversa — mesmo racional de `contactName`/`lastMessagePreview`. */
  listTagsByConversationIds(conversationIds: readonly string[]): Promise<Map<string, InboxTag[]>>;
};
