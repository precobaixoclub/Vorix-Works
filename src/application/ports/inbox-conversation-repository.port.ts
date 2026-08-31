import type { InboxConversation, InboxConversationStatus } from "../../domain/inbox/inbox.model.js";

/** Módulo Conversas (Fase 1/4). Ver `db/migrations/0082_inbox_conversations.sql`. */

export type FindOrCreateInboxConversationInput = {
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  contactId: string;
};

/**
 * `open`/`pending`/`resolved` (Fase 4) mapeiam direto pro status normalizado da conversa — ver
 * comentário em `INBOX_CONVERSATION_STATUSES` (`resolved` = "Finalizada"/CLOSED na UI).
 */
export type InboxConversationListFilter = "all" | "mine" | "unassigned" | "unread" | "open" | "pending" | "resolved";

/** Read-model só de listagem (Fase 3) — denormaliza nome/telefone do contato pra Inbox não
 * precisar de uma segunda chamada por conversa. Nunca usado fora de `listByWorkspace`; toda
 * escrita continua contra `InboxConversation` puro. */
export type InboxConversationListItem = InboxConversation & { contactName?: string; contactPhone: string };

export type InboxConversationRepositoryPort = {
  /** Idempotente por `(connectionId, contactId)` — nunca cria uma segunda conversa pro mesmo par. */
  findOrCreate(input: FindOrCreateInboxConversationInput): Promise<InboxConversation>;
  getById(id: string): Promise<InboxConversation | undefined>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; filter?: InboxConversationListFilter; assignedUserId?: string }): Promise<InboxConversationListItem[]>;
  markLastMessage(id: string, input: { lastMessageAt: string; incrementUnread: boolean }): Promise<void>;
  markRead(id: string): Promise<void>;
  /** Atribuição DIRETA (por um supervisor, ou remoção com `undefined`) — nunca usada pelo fluxo
   * "assumir conversa" (ver `tryTakeOver`, que é atômico/compare-and-set). Não tem proteção de
   * concorrência própria: é uma ação autoritativa, não uma disputa entre atendentes. */
  assign(id: string, assignedUserId: string | undefined): Promise<InboxConversation>;
  setStatus(id: string, status: InboxConversationStatus): Promise<InboxConversation>;
  /** "Assumir conversa" desliga a IA só aqui — nunca globalmente (ver Fase 5). */
  setAiEnabled(id: string, aiEnabled: boolean): Promise<InboxConversation>;

  /**
   * "Assumir conversa" — ATÔMICO (Fase 4, requisito crítico de concorrência). Compare-and-set:
   * só assume se a conversa ainda não tiver responsável, OU se o responsável já for o próprio
   * `userId` (idempotente — clicar "assumir" de novo não é erro). Desliga `aiEnabled` NA MESMA
   * operação — nunca em duas chamadas separadas, que abriria uma janela onde IA e humano
   * poderiam responder ao mesmo tempo. Retorna `undefined` quando outro atendente já assumiu
   * entre o carregamento da tela e o clique (conflito real, não bug) — quem chama traduz isso
   * pra 409, nunca sobrescreve silenciosamente.
   */
  tryTakeOver(id: string, userId: string): Promise<InboxConversation | undefined>;

  /**
   * Transferência — ATÔMICA, mesmo raciocínio de `tryTakeOver`: só transfere se o responsável
   * atual for exatamente `fromUserId`. `undefined` = conflito (a conversa já não é mais do
   * `fromUserId` — foi reatribuída ou finalizada por outra ação entre a leitura e o clique).
   */
  tryTransfer(id: string, input: { fromUserId: string; toUserId: string }): Promise<InboxConversation | undefined>;
};
