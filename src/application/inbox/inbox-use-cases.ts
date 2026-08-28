import type { InboxContact, InboxConversation, InboxMessage, MessagingConnection, MessagingConnectionStatus } from "../../domain/inbox/inbox.model.js";
import { normalizePhoneNumber } from "../../domain/inbox/inbox.model.js";
import type { InboxContactRepositoryPort } from "../ports/inbox-contact-repository.port.js";
import type { InboxConversationListFilter, InboxConversationRepositoryPort } from "../ports/inbox-conversation-repository.port.js";
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
  await deps.provider.connect({ externalSessionId });
  return deps.connectionRepository.updateStatus(connection.id, { status: "connecting", externalSessionId });
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

export async function listConversations(deps: InboxUseCaseDeps, input: ListConversationsInput): Promise<InboxConversation[]> {
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

export type AssignConversationInput = { tenantId: string; workspaceId: string; conversationId: string; assignedUserId?: string };

export async function assignConversation(deps: InboxUseCaseDeps, input: AssignConversationInput): Promise<InboxConversation> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  return deps.conversationRepository.assign(conversation.id, input.assignedUserId);
}

export type TakeOverConversationInput = { tenantId: string; workspaceId: string; conversationId: string; userId: string };

/** "Assumir conversa" (obrigatório, Fase 4/5): atribui ao atendente E desliga a IA SÓ nesta
 * conversa — nunca globalmente. Ver `setAiConversationEnabled` para o caminho inverso ("reativar IA"). */
export async function takeOverConversation(deps: InboxUseCaseDeps, input: TakeOverConversationInput): Promise<InboxConversation> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  await deps.conversationRepository.assign(conversation.id, input.userId);
  return deps.conversationRepository.setAiEnabled(conversation.id, false);
}

export type SetAiConversationEnabledInput = { tenantId: string; workspaceId: string; conversationId: string; aiEnabled: boolean };

export async function setAiConversationEnabled(deps: InboxUseCaseDeps, input: SetAiConversationEnabledInput): Promise<InboxConversation> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  return deps.conversationRepository.setAiEnabled(conversation.id, input.aiEnabled);
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

  const message = await deps.messageRepository.create({
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
  const message = await deps.messageRepository.create({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    connectionId: input.connectionId,
    externalMessageId: input.externalMessageId,
    direction: "inbound",
    type: input.type,
    body: input.body,
  });
  await deps.conversationRepository.markLastMessage(conversation.id, { lastMessageAt: input.occurredAt, incrementUnread: true });
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
