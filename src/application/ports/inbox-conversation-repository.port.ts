import type { InboxAiPauseReason, InboxChatType, InboxConversation, InboxConversationStatus, InboxMediaStorageRef, InboxMessageDirection, InboxMessageType } from "../../domain/inbox/inbox.model.js";

/** Módulo Conversas (Fase 1/4). Ver `db/migrations/0082_inbox_conversations.sql` e
 * `db/migrations/0115_inbox_canonical_chat_identity.sql` (identidade canônica de chat). */

export type FindOrCreateInboxConversationInput = {
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  chatType: InboxChatType;
  /** Identidade canônica do chat (JID de grupo ou telefone normalizado do peer) — ver
   * `InboxConversation.externalChatId`. Chave real de idempotência junto com `connectionId`. */
  externalChatId: string;
  groupName?: string;
  /** Só para `chatType: "direct"` — `undefined` em conversas de grupo (nunca um `contactId` de
   * "grupo", ver `InboxConversation.contactId`). */
  contactId?: string;
};

/**
 * `open`/`pending`/`resolved` (Fase 4) mapeiam direto pro status normalizado da conversa — ver
 * comentário em `INBOX_CONVERSATION_STATUSES` (`resolved` = "Finalizada"/CLOSED na UI).
 */
export type InboxConversationListFilter = "all" | "mine" | "unassigned" | "unread" | "urgent" | "open" | "pending" | "resolved";

/** Read-model só de listagem (Fase 3) — denormaliza nome/telefone do contato pra Inbox não
 * precisar de uma segunda chamada por conversa. Nunca usado fora de `listByWorkspace`; toda
 * escrita continua contra `InboxConversation` puro. `crmContactId` (Fase 4) é
 * `inbox_contacts.contact_id` denormalizado do mesmo join — ver `InboxContact.crmContactId`. */
/** Redesign operacional — resumo da última mensagem da conversa, para a lista de conversas
 * mostrar um preview real (texto ou rótulo de mídia) em vez de um placeholder genérico. */
export type InboxConversationLastMessagePreview = {
  type: InboxMessageType;
  body?: string;
  direction: InboxMessageDirection;
  /** Correção do bug de identidade de conversa — quem mandou a última mensagem (só relevante pra
   * `chatType: "group"`, onde a lista precisa mostrar "Maria: Fechou" em vez de só "Fechou"). */
  senderDisplayName?: string;
};

export type InboxConversationListItem = InboxConversation & {
  /** `undefined` em conversas de grupo (`chatType: "group"`) — não há um único contato. */
  contactName?: string;
  contactPhone?: string;
  crmContactId?: string;
  /** Foto de perfil (pedido explícito do usuário em produção) — denormalizada do mesmo join,
   * pra lista de conversas mostrar o avatar real sem uma segunda chamada por item. */
  contactProfilePictureStorageRef?: InboxMediaStorageRef;
  lastMessagePreview?: InboxConversationLastMessagePreview;
};

export type InboxConversationRepositoryPort = {
  /** Idempotente por `(connectionId, externalChatId)` — nunca cria uma segunda conversa pro mesmo
   * chat (grupo ou DM), mesmo que remetentes diferentes mandem mensagem nele (ver correção do bug
   * de identidade de conversa, migration 0115). */
  findOrCreate(input: FindOrCreateInboxConversationInput): Promise<InboxConversation>;
  getById(id: string): Promise<InboxConversation | undefined>;
  /** Bloco "réplica de identidade" — busca sem criar, usado pelo reconciliador de merge (Fase 4)
   * pra checar se já existem DUAS conversas divergentes (pseudo-telefone-por-LID vs. telefone
   * real) pro mesmo `connectionId`, antes de decidir fundir. */
  getByExternalChatId(input: { connectionId: string; externalChatId: string }): Promise<InboxConversation | undefined>;
  /** Exclusão PERMANENTE, pedida explicitamente por um humano (nunca automática) — mensagens e
   * eventos desta conversa cascateiam junto (ver `db/migrations/0083`/`0084`). Sem efeito se a
   * conversa já não existir (idempotente — um duplo-clique/retry nunca lança). */
  delete(id: string): Promise<void>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; filter?: InboxConversationListFilter; assignedUserId?: string }): Promise<InboxConversationListItem[]>;
  markLastMessage(id: string, input: { lastMessageAt: string; incrementUnread: boolean }): Promise<void>;
  /** Bloco "Identity UX" — metadata de grupo (nome real/quantidade de participantes), buscada via
   * `MessagingProvider.getGroupInfo` (ver `syncGroupMetadata` em inbox-use-cases.ts). Só grava
   * campos presentes em `input` (nunca apaga um valor já conhecido com `undefined`). */
  updateGroupMetadata(id: string, input: { groupName?: string; participantCount?: number; metadataUpdatedAt: string }): Promise<void>;
  /** Foto do grupo — pedido explícito do usuário em produção, gravada separadamente de
   * `updateGroupMetadata` (mesmo racional de `InboxContactRepositoryPort.updateProfilePicture`:
   * preenchida de forma assíncrona/best-effort, nunca no caminho crítico do ack). */
  updateGroupPicture(id: string, input: { storageRef: InboxMediaStorageRef; syncedAt: string }): Promise<void>;
  markRead(id: string): Promise<void>;
  /** Bloco "ler/não lida" (pedido explícito do usuário em produção) — força a conversa de volta
   * pra "não lida" mesmo sem mensagem nova (nunca um campo booleano separado: reaproveita
   * `unread_count`, subindo pra pelo menos 1 — o mesmo filtro `unread` já existente, e qualquer
   * mensagem nova de verdade continua incrementando a partir daí normalmente). */
  markUnread(id: string): Promise<void>;
  /** Bloco "urgente" (pedido explícito do usuário em produção) — marcação manual, liga/desliga. */
  setUrgent(id: string, isUrgent: boolean): Promise<InboxConversation>;
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
