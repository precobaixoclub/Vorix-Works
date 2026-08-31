import type { InboxContact, InboxConversation, InboxConversationEvent, InboxMessage, MessagingConnection, MessagingConnectionStatus } from "../../domain/inbox/inbox.model.js";
import { normalizePhoneNumber } from "../../domain/inbox/inbox.model.js";
import type { InboxContactRepositoryPort } from "../ports/inbox-contact-repository.port.js";
import type { InboxConversationEventRepositoryPort } from "../ports/inbox-conversation-event-repository.port.js";
import type { InboxConversationListFilter, InboxConversationListItem, InboxConversationRepositoryPort } from "../ports/inbox-conversation-repository.port.js";
import type { InboxMessageRepositoryPort } from "../ports/inbox-message-repository.port.js";
import type { MessagingConnectionRepositoryPort } from "../ports/messaging-connection-repository.port.js";
import type { MessagingProvider } from "../ports/messaging-provider.port.js";
import { MessagingProviderError } from "../ports/messaging-provider.port.js";
import type { OutboundMessageQueuePort } from "../ports/outbound-message-queue.port.js";
import type { WorkspaceRepositoryPort } from "../ports/workspace-repository.port.js";

/**
 * Casos de uso do módulo Conversas — Fase 1/3/4. Mesmo padrão de `conversation-use-cases.ts`:
 * `tenantId` sempre vem do principal autenticado (nunca do corpo da requisição); toda operação
 * sobre um recurso existente confere `tenantId` E `workspaceId` (nunca só o primeiro); erros são
 * `Error` com prefixo `INBOX_*`, traduzidos para status HTTP em `inbox.route.ts`. Um recurso de
 * outro tenant/workspace responde "not found", nunca "forbidden" — evita vazar existência entre tenants.
 */
export type InboxUseCaseDeps = {
  connectionRepository: MessagingConnectionRepositoryPort;
  contactRepository: InboxContactRepositoryPort;
  conversationRepository: InboxConversationRepositoryPort;
  conversationEventRepository: InboxConversationEventRepositoryPort;
  messageRepository: InboxMessageRepositoryPort;
  workspaceRepository: WorkspaceRepositoryPort;
  outboundQueue: OutboundMessageQueuePort;
  provider: MessagingProvider;
  idGenerator?: () => string;
};

const defaultIdGenerator = () => `wuzsess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function mustConnectionBelongToTenantAndWorkspace(deps: InboxUseCaseDeps, id: string, tenantId: string, workspaceId: string): Promise<MessagingConnection> {
  const connection = await deps.connectionRepository.getById(id);
  if (!connection || connection.tenantId !== tenantId || connection.workspaceId !== workspaceId) {
    throw new Error(`INBOX_CONNECTION_NOT_FOUND: conexão "${id}" não existe.`);
  }
  return connection;
}

async function mustConversationBelongToTenantAndWorkspace(deps: InboxUseCaseDeps, id: string, tenantId: string, workspaceId: string): Promise<InboxConversation> {
  const conversation = await deps.conversationRepository.getById(id);
  if (!conversation || conversation.tenantId !== tenantId || conversation.workspaceId !== workspaceId) {
    throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${id}" não existe.`);
  }
  return conversation;
}

export type CreateConnectionInput = { tenantId: string; workspaceId: string; displayName: string };

export async function createConnection(deps: InboxUseCaseDeps, input: CreateConnectionInput): Promise<MessagingConnection> {
  const workspace = await deps.workspaceRepository.getById(input.workspaceId);
  if (!workspace || workspace.tenantId !== input.tenantId) {
    throw new Error(`INBOX_WORKSPACE_NOT_FOUND: workspace "${input.workspaceId}" não existe.`);
  }
  if (!input.displayName.trim()) throw new Error("INBOX_DISPLAY_NAME_EMPTY: informe um nome para identificar esta conexão.");

  const connection = await deps.connectionRepository.create({ tenantId: input.tenantId, workspaceId: input.workspaceId, provider: "wuzapi", displayName: input.displayName.trim() });
  const externalSessionId = (deps.idGenerator ?? defaultIdGenerator)();
  // `instanceName: connection.id` — o RawEventConsumer do worker correlaciona eventos de volta a
  // esta conexão por esse id direto (ver `wuzapi-event-mapper.ts`), nunca pelo token de sessão.
  const { phoneNumber } = await deps.provider.connect({ externalSessionId, instanceName: connection.id });
  return deps.connectionRepository.updateStatus(connection.id, { status: "connecting", externalSessionId, phoneNumber });
}

export type ListConnectionsInput = { tenantId: string; workspaceId: string };

export async function listConnections(deps: InboxUseCaseDeps, input: ListConnectionsInput): Promise<MessagingConnection[]> {
  return deps.connectionRepository.listByWorkspace(input);
}

export type GetQrCodeInput = { tenantId: string; workspaceId: string; connectionId: string };

export async function getConnectionQrCode(deps: InboxUseCaseDeps, input: GetQrCodeInput): Promise<{ qrCode: string; expiresAt: string }> {
  const connection = await mustConnectionBelongToTenantAndWorkspace(deps, input.connectionId, input.tenantId, input.workspaceId);
  if (!connection.externalSessionId) throw new Error("INBOX_CONNECTION_NOT_READY: a conexão ainda não iniciou a sessão no gateway.");
  return deps.provider.getQrCode({ externalSessionId: connection.externalSessionId });
}

export type RefreshConnectionStatusInput = { tenantId: string; workspaceId: string; connectionId: string };

/** Consulta o status real no gateway e reconcilia `messaging_connections` — mesma operação usada
 * pelo health monitor periódico (Fase 6), aqui exposta sob demanda para a UI. */
export async function refreshConnectionStatus(deps: InboxUseCaseDeps, input: RefreshConnectionStatusInput): Promise<MessagingConnection> {
  const connection = await mustConnectionBelongToTenantAndWorkspace(deps, input.connectionId, input.tenantId, input.workspaceId);
  if (!connection.externalSessionId) return connection;
  const status = await deps.provider.getConnectionStatus({ externalSessionId: connection.externalSessionId });
  return deps.connectionRepository.updateStatus(connection.id, { status: status.status, phoneNumber: status.phoneNumber, connectionHealth: "healthy" });
}

export type DisconnectConnectionInput = { tenantId: string; workspaceId: string; connectionId: string };

export async function disconnectConnection(deps: InboxUseCaseDeps, input: DisconnectConnectionInput): Promise<MessagingConnection> {
  const connection = await mustConnectionBelongToTenantAndWorkspace(deps, input.connectionId, input.tenantId, input.workspaceId);
  if (connection.externalSessionId) await deps.provider.disconnect({ externalSessionId: connection.externalSessionId });
  return deps.connectionRepository.updateStatus(connection.id, { status: "disconnected" });
}

export type ListConversationsInput = { tenantId: string; workspaceId: string; filter?: InboxConversationListFilter; assignedUserId?: string };

export async function listConversations(deps: InboxUseCaseDeps, input: ListConversationsInput): Promise<InboxConversationListItem[]> {
  return deps.conversationRepository.listByWorkspace(input);
}

export type ListConversationMessagesInput = { tenantId: string; workspaceId: string; conversationId: string; cursor?: string; limit?: number };

export async function listConversationMessages(deps: InboxUseCaseDeps, input: ListConversationMessagesInput): Promise<InboxMessage[]> {
  await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  return deps.messageRepository.listByConversation(input);
}

export type MarkConversationReadInput = { tenantId: string; workspaceId: string; conversationId: string };

export async function markConversationRead(deps: InboxUseCaseDeps, input: MarkConversationReadInput): Promise<void> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  // `readByAgent` (esta flag) é distinto de recibo de leitura do WhatsApp (`InboxMessage.readAt`,
  // populado pelo consumer de status) — nunca assumir que um implica o outro.
  await deps.conversationRepository.markRead(conversation.id);
}

export type AssignConversationInput = { tenantId: string; workspaceId: string; conversationId: string; assignedUserId?: string; performedBy: string };

/**
 * Atribuição DIRETA (Fase 4) — um supervisor definindo/removendo o responsável, ou o próprio fluxo
 * de "assumir"/"transferir" usando isto só pra registrar o evento (a mudança de estado em si, nos
 * dois últimos casos, já aconteceu de forma atômica via `tryTakeOver`/`tryTransfer` — nunca duas
 * vezes). Nunca usar isto sozinho pra implementar "assumir conversa": não tem proteção de
 * concorrência (ver `takeOverConversation`).
 */
export async function assignConversation(deps: InboxUseCaseDeps, input: AssignConversationInput): Promise<InboxConversation> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  const updated = await deps.conversationRepository.assign(conversation.id, input.assignedUserId);
  await deps.conversationEventRepository.record({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    type: input.assignedUserId ? "assigned" : "unassigned",
    performedBy: input.performedBy,
    fromUserId: conversation.assignedUserId,
    toUserId: input.assignedUserId,
  });
  return updated;
}

export type TakeOverConversationInput = { tenantId: string; workspaceId: string; conversationId: string; userId: string };

/**
 * "Assumir conversa" (Fase 4, requisito crítico de concorrência) — ATÔMICO via
 * `tryTakeOver` (compare-and-set no repositório): dois atendentes clicando "assumir" ao mesmo
 * tempo NUNCA resultam em ambos "ganhando" — um deles recebe `INBOX_CONVERSATION_ALREADY_ASSIGNED`
 * (409), nunca um estado inconsistente. A IA é desligada NA MESMA operação atômica do backend
 * (dentro de `tryTakeOver`, nunca uma segunda chamada separada) — é isso que fecha a janela onde
 * IA e humano poderiam responder ao mesmo tempo. Registra até 2 eventos discretos na timeline:
 * sempre "took_over", e "ai_paused" só se a IA estava de fato ativa antes (evita ruído no
 * histórico quando a IA já estava pausada).
 */
export async function takeOverConversation(deps: InboxUseCaseDeps, input: TakeOverConversationInput): Promise<InboxConversation> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  // Reclique do MESMO atendente que já é dono: no-op de verdade, nunca gera uma segunda linha
  // redundante de "assumiu o atendimento" no histórico.
  if (conversation.assignedUserId === input.userId && !conversation.aiEnabled) return conversation;
  const wasAiEnabled = conversation.aiEnabled;
  const updated = await deps.conversationRepository.tryTakeOver(conversation.id, input.userId);
  if (!updated) {
    throw new Error(`INBOX_CONVERSATION_ALREADY_ASSIGNED: a conversa "${conversation.id}" já foi assumida por outro atendente.`);
  }
  await deps.conversationEventRepository.record({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    type: "took_over",
    performedBy: input.userId,
    fromUserId: conversation.assignedUserId,
    toUserId: input.userId,
  });
  if (wasAiEnabled) {
    await deps.conversationEventRepository.record({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
      type: "ai_paused",
      performedBy: input.userId,
    });
  }
  return updated;
}

export type TransferConversationInput = { tenantId: string; workspaceId: string; conversationId: string; toUserId: string; performedBy: string };

/**
 * Transferência (Fase 4) — ATÔMICA via `tryTransfer`, mesmo raciocínio de `takeOverConversation`:
 * só transfere se o responsável atual ainda for quem a UI achava que era; se outra ação mudou isso
 * entre a leitura da tela e o clique, `INBOX_CONVERSATION_TRANSFER_CONFLICT` (409) em vez de
 * sobrescrever silenciosamente. Exige uma conversa JÁ atribuída — transferir uma conversa sem
 * responsável não faz sentido semântico (isso é "assumir" ou "atribuir", não "transferir").
 */
export async function transferConversation(deps: InboxUseCaseDeps, input: TransferConversationInput): Promise<InboxConversation> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  if (!conversation.assignedUserId) {
    throw new Error("INBOX_CONVERSATION_NOT_ASSIGNED: só é possível transferir uma conversa que já tem responsável — use atribuição direta para uma conversa sem dono.");
  }
  const fromUserId = conversation.assignedUserId;
  const updated = await deps.conversationRepository.tryTransfer(conversation.id, { fromUserId, toUserId: input.toUserId });
  if (!updated) {
    throw new Error(`INBOX_CONVERSATION_TRANSFER_CONFLICT: a conversa "${conversation.id}" já não está mais com o responsável esperado.`);
  }
  await deps.conversationEventRepository.record({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    type: "transferred",
    performedBy: input.performedBy,
    fromUserId,
    toUserId: input.toUserId,
  });
  return updated;
}

export type CloseConversationInput = { tenantId: string; workspaceId: string; conversationId: string; performedBy: string };

/** Finalizar atendimento — status vira `resolved` ("Finalizada" na UI). Idempotente: já
 * finalizada, não faz nada (nunca duplica evento de histórico). */
export async function closeConversation(deps: InboxUseCaseDeps, input: CloseConversationInput): Promise<InboxConversation> {
  return transitionConversationStatus(deps, input, "resolved");
}

export type ReopenConversationInput = { tenantId: string; workspaceId: string; conversationId: string; performedBy: string };

/** Reabrir uma conversa finalizada — só faz sentido a partir de `resolved`; volta pra `open`. */
export async function reopenConversation(deps: InboxUseCaseDeps, input: ReopenConversationInput): Promise<InboxConversation> {
  return transitionConversationStatus(deps, input, "open");
}

async function transitionConversationStatus(
  deps: InboxUseCaseDeps,
  input: { tenantId: string; workspaceId: string; conversationId: string; performedBy: string },
  toStatus: InboxConversation["status"],
): Promise<InboxConversation> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  if (conversation.status === toStatus) return conversation;
  const updated = await deps.conversationRepository.setStatus(conversation.id, toStatus);
  await deps.conversationEventRepository.record({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    type: "status_changed",
    performedBy: input.performedBy,
    fromStatus: conversation.status,
    toStatus,
  });
  return updated;
}

export type SetAiConversationEnabledInput = { tenantId: string; workspaceId: string; conversationId: string; aiEnabled: boolean; performedBy: string };

export async function setAiConversationEnabled(deps: InboxUseCaseDeps, input: SetAiConversationEnabledInput): Promise<InboxConversation> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  if (conversation.aiEnabled === input.aiEnabled) return conversation;
  const updated = await deps.conversationRepository.setAiEnabled(conversation.id, input.aiEnabled);
  await deps.conversationEventRepository.record({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    type: input.aiEnabled ? "ai_resumed" : "ai_paused",
    performedBy: input.performedBy,
  });
  return updated;
}

export type ListConversationEventsInput = { tenantId: string; workspaceId: string; conversationId: string };

/** Timeline operacional (Fase 4) — a Inbox intercala isso com as mensagens por `createdAt`.
 * NUNCA vira mensagem real enviada ao WhatsApp, é só histórico interno do Vorix. */
export async function listConversationEvents(deps: InboxUseCaseDeps, input: ListConversationEventsInput): Promise<InboxConversationEvent[]> {
  await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  return deps.conversationEventRepository.listByConversation(input);
}

export type SendInboxMessageInput = { tenantId: string; workspaceId: string; conversationId: string; body: string; sentByUserId?: string; sentByAi?: boolean };

/**
 * Envio outbound — nunca espera a confirmação do WhatsApp. Persiste `status: "queued"` e publica
 * na fila de saída; quem envia de fato ao provider é o `OutboxSenderConsumer` do `vorix-worker`.
 */
export async function sendInboxMessage(deps: InboxUseCaseDeps, input: SendInboxMessageInput): Promise<InboxMessage> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  const body = input.body.trim();
  if (!body) throw new Error("INBOX_MESSAGE_BODY_EMPTY: a mensagem não pode ser vazia.");

  const { message } = await deps.messageRepository.create({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    connectionId: conversation.connectionId,
    direction: "outbound",
    type: "text",
    status: "queued",
    body,
    sentByUserId: input.sentByUserId,
    sentByAi: input.sentByAi ?? false,
  });
  await deps.outboundQueue.publish({ messageId: message.id, tenantId: input.tenantId, workspaceId: input.workspaceId, connectionId: conversation.connectionId });
  await deps.conversationRepository.markLastMessage(conversation.id, { lastMessageAt: message.createdAt, incrementUnread: false });
  return message;
}

export type RegisterInboundMessageInput = {
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  fromPhone: string;
  fromName?: string;
  externalMessageId: string;
  type: InboxMessage["type"];
  body?: string;
  occurredAt: string;
};

/**
 * Normalização de mensagem inbound — usada pelo consumer de `inbox.incoming.queue` (Fase 2).
 * Idempotente ponta a ponta: `upsertByPhone` nunca duplica contato, `findOrCreate` nunca duplica
 * conversa, `messageRepository.create` nunca duplica mensagem (constraint `(connection_id,
 * external_message_id)`) — uma reentrega do mesmo evento é inofensiva.
 *
 * ACHADO AO VIVO (spike Fase 2): `markLastMessage`/`incrementUnread` só pode rodar quando a
 * mensagem foi REALMENTE inserida agora (`wasCreated`) — sem essa checagem, uma reentrega do
 * mesmo evento (mensagem corretamente deduplicada) ainda incrementava `unread_count` de novo,
 * fazendo o contador de não lidas divergir do número real de mensagens.
 */
export async function registerInboundMessage(deps: InboxUseCaseDeps, input: RegisterInboundMessageInput): Promise<{ contact: InboxContact; conversation: InboxConversation; message: InboxMessage }> {
  const phoneNormalized = normalizePhoneNumber(input.fromPhone);
  const contact = await deps.contactRepository.upsertByPhone({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    phoneNormalized,
    name: input.fromName,
  });
  const conversation = await deps.conversationRepository.findOrCreate({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    contactId: contact.id,
  });
  const { message, wasCreated } = await deps.messageRepository.create({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    connectionId: input.connectionId,
    externalMessageId: input.externalMessageId,
    direction: "inbound",
    type: input.type,
    body: input.body,
  });
  if (wasCreated) {
    await deps.conversationRepository.markLastMessage(conversation.id, { lastMessageAt: input.occurredAt, incrementUnread: true });
  }
  return { contact, conversation, message };
}

export type ApplyMessageStatusChangedInput = { connectionId: string; externalMessageId: string; status: InboxMessage["status"]; occurredAt: string };

/** Usado pelo consumer de `inbox.status.queue` (Fase 2) — recibo de entrega/leitura do WhatsApp. */
export async function applyMessageStatusChanged(deps: InboxUseCaseDeps, input: ApplyMessageStatusChangedInput): Promise<void> {
  await deps.messageRepository.updateStatusByExternalId(input);
}

export type ApplyConnectionStateChangedInput = { connectionId: string; status: MessagingConnectionStatus; phoneNumber?: string };

/** Usado pelo consumer de `inbox.connection.queue` (Fase 2). Nunca dispara reconexão automática
 * aqui — isso é papel do health monitor (Fase 6); este consumer só reflete o estado reportado. */
export async function applyConnectionStateChanged(deps: InboxUseCaseDeps, input: ApplyConnectionStateChangedInput): Promise<void> {
  await deps.connectionRepository.updateStatus(input.connectionId, { status: input.status, phoneNumber: input.phoneNumber });
  await deps.connectionRepository.touchEvent(input.connectionId, new Date().toISOString());
}

export type ProcessOutboundMessageInput = { messageId: string };

/**
 * Drena `inbox.outgoing.queue` (Fase 2) — chamado pelo `OutboxSenderConsumer` do `vorix-worker`.
 * Idempotente por construção: se a mensagem já não estiver `queued` (reentrega tardia de um evento
 * já processado), não reenvia de novo. Erros do provider propagam como `MessagingProviderError`
 * para o worker decidir retry/backoff/DLQ a partir de `error.kind` — nunca decidido aqui.
 */
export async function processOutboundMessage(deps: InboxUseCaseDeps, input: ProcessOutboundMessageInput): Promise<InboxMessage | undefined> {
  const message = await deps.messageRepository.getById(input.messageId);
  if (!message) return undefined;
  if (message.status !== "queued") return message;

  const conversation = await deps.conversationRepository.getById(message.conversationId);
  if (!conversation) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${message.conversationId}" não existe.`);
  const contact = await deps.contactRepository.getById(conversation.contactId);
  if (!contact) throw new Error(`INBOX_CONTACT_NOT_FOUND: contato "${conversation.contactId}" não existe.`);
  const connection = await deps.connectionRepository.getById(message.connectionId);
  if (!connection?.externalSessionId) throw new MessagingProviderError("transient", `Conexão "${message.connectionId}" sem sessão ativa no gateway.`);

  try {
    const result = await deps.provider.sendText({ externalSessionId: connection.externalSessionId, to: contact.phoneNormalized, body: message.body ?? "" });
    return await deps.messageRepository.markSent(message.id, { externalMessageId: result.externalMessageId, sentAt: new Date().toISOString() });
  } catch (error) {
    await deps.messageRepository.recordAttempt(message.id, { lastError: error instanceof Error ? error.message : String(error), lastAttemptAt: new Date().toISOString() });
    throw error;
  }
}
