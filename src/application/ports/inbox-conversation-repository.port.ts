import type { InboxAiPauseReason, InboxConversation, InboxConversationStatus } from "../../domain/inbox/inbox.model.js";

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
  /** "Assumir conversa" desliga a IA só aqui — nunca globalmente. `reason` (Fase 5) é gravado
   * junto quando `aiEnabled` é `false`; ignorado (sempre limpo para `null`) quando `aiEnabled` é
   * `true` — não faz sentido ter um "motivo de pausa" numa conversa com IA ativa. */
  setAiEnabled(id: string, aiEnabled: boolean, reason?: InboxAiPauseReason): Promise<InboxConversation>;

  /**
   * Fase 5/6 — lock lógico (CAS) de geração de IA em andamento para uma conversa, agora um LEASE
   * recuperável (Fase 6): casa quando `ai_processing_since is null` OU quando já passou de
   * `staleBeforeIso` (o dono anterior travou por tempo demais — quase certamente um processo que
   * morreu segurando o lock, nunca reaberto por nenhum reaper, ver Fase 6). Serializa mensagens
   * consecutivas do mesmo contato: só uma geração pode estar "em voo" por conversa a qualquer
   * momento (ver `maybeGenerateAiResponse`, que drena qualquer mensagem nova chegada durante a
   * geração antes de liberar o lock, em vez de disparar respostas paralelas desconexas).
   * `undefined` = outra geração está em andamento E ainda dentro do lease (quem chama não gera
   * uma resposta própria — confia que o dono atual do lock vai drenar as mensagens novas, ou que o
   * lease vai expirar e permitir recuperação). A recuperação é ATÔMICA pela mesma cláusula WHERE
   * de sempre — nunca dois donos válidos simultâneos, mesmo sob concorrência (testado).
   */
  tryAcquireAiLock(id: string, at: string, staleBeforeIso: string): Promise<InboxConversation | undefined>;
  /** Libera o lock só se `ai_processing_since` ainda for exatamente `ownedAt` — evita que um
   * processo libere um lock que já não é mais seu (defesa em profundidade, não deveria acontecer
   * na prática já que só quem detém o lock chama isto). */
  releaseAiLock(id: string, ownedAt: string): Promise<void>;

  /**
   * "Assumir conversa" — ATÔMICO (Fase 4, requisito crítico de concorrência). Compare-and-set:
   * só assume se a conversa ainda não tiver responsável, OU se o responsável já for o próprio
   * `userId` (idempotente — clicar "assumir" de novo não é erro). Desliga `aiEnabled` (com
   * `aiPausedReason: "human_takeover"`) NA MESMA operação — nunca em duas chamadas separadas, que
   * abriria uma janela onde IA e humano poderiam responder ao mesmo tempo; uma geração de IA já em
   * voo no momento do take-over não é abortada aqui — o gate de elegibilidade re-lido logo antes de
   * enviar (Fase 5, `maybeGenerateAiResponse`) é o que garante que ela nunca chega a ser enviada.
   * Retorna `undefined` quando outro atendente já assumiu
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
