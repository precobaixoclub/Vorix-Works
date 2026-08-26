import type { InstagramDmSender } from "./instagram-dm-conversation-repository.port.js";

/** Mensagens do inbox de DM do Instagram — módulo Instagram DM Automation, Fase 5. Ver
 * `db/migrations/0078_instagram_dm_messages.sql`. */

export type InstagramDmMessage = {
  id: string;
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  sender: InstagramDmSender;
  /** `mid` da Meta — usado pra deduplicar reentrega de webhook. */
  messageId?: string;
  messageText?: string;
  rawPayload?: unknown;
  sentAt: string;
  createdAt: string;
};

export type RecordInstagramDmMessageInput = Omit<InstagramDmMessage, "id" | "createdAt">;

export type InstagramDmMessageRepositoryPort = {
  /** Upsert por `(conversationId, messageId)` quando `messageId` está presente — reentrega do
   * mesmo webhook nunca duplica a mensagem. */
  recordMessage(input: RecordInstagramDmMessageInput): Promise<InstagramDmMessage>;
  listByConversation(input: { tenantId: string; workspaceId: string; conversationId: string; limit?: number }): Promise<InstagramDmMessage[]>;
};
