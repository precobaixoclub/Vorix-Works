/** Conversas do inbox de DM do Instagram — módulo Instagram DM Automation, Fase 5. Ver
 * `db/migrations/0077_instagram_dm_conversations.sql`. */

export type InstagramDmSender = "user" | "page" | "automation";

export type InstagramDmConversation = {
  id: string;
  tenantId: string;
  workspaceId: string;
  instagramBusinessAccountId: string;
  participantId: string;
  participantUsername?: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  lastMessageFrom: InstagramDmSender;
  unread: boolean;
  automationMuted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpsertInstagramDmConversationInput = Omit<InstagramDmConversation, "id" | "createdAt" | "updatedAt"> & { id?: string };

export type InstagramDmConversationRepositoryPort = {
  /** Upsert por `(workspaceId, instagramBusinessAccountId, participantId)`. */
  upsertConversation(input: UpsertInstagramDmConversationInput): Promise<InstagramDmConversation>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; instagramBusinessAccountId?: string }): Promise<InstagramDmConversation[]>;
  getById(id: string): Promise<InstagramDmConversation | undefined>;
  /** Usado pelo recebimento de webhook pra saber se a conversa já existe (e preservar
   * `automationMuted`, que `upsertConversation` NUNCA deveria resetar a cada mensagem nova). */
  findByParticipant(input: { tenantId: string; workspaceId: string; instagramBusinessAccountId: string; participantId: string }): Promise<InstagramDmConversation | undefined>;
  markRead(id: string): Promise<void>;
  setAutomationMuted(id: string, muted: boolean): Promise<void>;
};
