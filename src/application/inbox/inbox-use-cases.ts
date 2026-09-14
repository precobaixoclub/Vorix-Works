import type { InboxContact, InboxConversation, InboxConversationEvent, InboxMessage, MessagingConnection, MessagingConnectionStatus } from "../../domain/inbox/inbox.model.js";
import { INBOX_AI_ACTOR, MESSAGING_CONNECTION_TERMINAL_STATUSES, normalizePhoneNumber } from "../../domain/inbox/inbox.model.js";
import type { OperationalCircuitBreaker, OperationalRateLimiter } from "../operations/operational-services.js";
import type { InboxAiResponderPort } from "../ports/inbox-ai-responder.port.js";
import type { InboxContactRepositoryPort } from "../ports/inbox-contact-repository.port.js";
import type { InboxConversationEventRepositoryPort } from "../ports/inbox-conversation-event-repository.port.js";
import type { InboxConversationListFilter, InboxConversationListItem, InboxConversationRepositoryPort } from "../ports/inbox-conversation-repository.port.js";
import type { InboxMediaStoragePort } from "../ports/inbox-media-storage.port.js";
import type { InboxMessageRepositoryPort } from "../ports/inbox-message-repository.port.js";
import type { InboxMetricsRecorder } from "../ports/inbox-metrics.port.js";
import type { MessagingConnectionRepositoryPort } from "../ports/messaging-connection-repository.port.js";
import type { MessagingProvider, MessagingProviderErrorKind } from "../ports/messaging-provider.port.js";
import { MessagingProviderError } from "../ports/messaging-provider.port.js";
import type { OutboundMessageQueuePort } from "../ports/outbound-message-queue.port.js";
import type { WorkspaceRepositoryPort } from "../ports/workspace-repository.port.js";
import { recordFirstEvent, type ProductAnalyticsUseCaseDeps } from "../product-analytics/product-analytics-use-cases.js";

/**
 * Casos de uso do módulo Conversas — Fase 1/3/4/5/6. Mesmo padrão de `conversation-use-cases.ts`:
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
  /** Fase 5 — `undefined` = IA de atendimento não configurada neste processo (ex.: API, ou worker
   * sem `ANTHROPIC_API_KEY`). `maybeGenerateAiResponse` vira um no-op silencioso nesse caso — a
   * Inbox continua 100% funcional sem IA (IA caiu != Inbox caiu). */
  aiResponder?: InboxAiResponderPort;
  /** Fase 6 — reaproveita o `OperationalCircuitBreaker` já existente (Postgres-backed, sobrevive a
   * restart do worker) para as chamadas HTTP ao WuzAPI (`scope: "messaging_provider"`, `target:
   * connectionId`) — nunca uma segunda stack de circuit breaker só para Inbox. `undefined` = sem
   * proteção (dev/teste sem `operationalStateRepository` configurado); `processOutboundMessage`
   * simplesmente pula a checagem nesse caso. */
  circuitBreaker?: OperationalCircuitBreaker;
  /** Fase 6 — mesmo racional do `circuitBreaker`: reaproveita `OperationalRateLimiter` já
   * existente, keyed por `connectionId` (`routeGroup: "inbox_outbound"`). `undefined` = sem
   * limite (dev/teste). */
  rateLimiter?: OperationalRateLimiter;
  /** Fase 6 — `undefined` = métricas não configuradas neste processo (nunca bloqueia nada). */
  metrics?: InboxMetricsRecorder;
  /**
   * Fase 7 — kill switch de EMERGÊNCIA para envio outbound (`INBOX_OUTBOUND_SEND_PAUSED`,
   * verificado uma vez no boot do worker — trocar exige restart, deliberadamente simples e
   * confiável, sem infraestrutura nova). Distinto de `CONVERSATIONS_MODULE_ENABLED=false` (que
   * desligaria o módulo INTEIRO, inclusive inbound/humano) e distinto de desligar a IA
   * (`AI_INBOX_AUTO_REPLY_ENABLED=false`, que só afeta resposta automática): isto pausa SÓ o envio
   * real ao WuzAPI, mantendo inbound/composição humana/IA funcionando normalmente — útil quando o
   * incidente é especificamente "não podemos mandar mensagem agora" (ex.: suspeita de loop de
   * envio, ban iminente do número, gateway comportando-se de forma inesperada) sem precisar
   * derrubar o resto do atendimento. Mensagem nunca é perdida — fica `queued`, requeue automático
   * (mesmo raciocínio do circuit breaker/rate limiter).
   */
  outboundSendPaused?: boolean;
  idGenerator?: () => string;
  /** Redesign operacional (mídia real) — `undefined` = storage de mídia de conversas não
   * configurado neste processo; `downloadInboundMediaAndAttach` vira no-op silencioso nesse caso
   * (a Inbox continua 100% funcional, só sem baixar o arquivo — mensagem de mídia fica com `type`
   * correto e `mediaStorageRef` vazio, o frontend cai no fallback de ícone+rótulo). */
  inboxMediaStorage?: InboxMediaStoragePort;
  /** Trial + Product Analytics — integração MÍNIMA (`first_channel_connected`,
   * `first_conversation_received`, `first_conversation_replied`). Nenhuma regra de Conversas
   * muda por causa disto. */
  productAnalytics?: ProductAnalyticsUseCaseDeps;
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
  const updated = await deps.connectionRepository.updateStatus(connection.id, { status: "connecting", externalSessionId, phoneNumber });
  if (deps.productAnalytics) {
    await recordFirstEvent(deps.productAnalytics, { eventName: "first_channel_connected", source: "server", tenantId: input.tenantId, workspaceId: input.workspaceId });
  }
  return updated;
}

export type ListConnectionsInput = { tenantId: string; workspaceId: string };

export async function listConnections(deps: InboxUseCaseDeps, input: ListConnectionsInput): Promise<MessagingConnection[]> {
  return deps.connectionRepository.listByWorkspace(input);
}

export type GetQrCodeInput = { tenantId: string; workspaceId: string; connectionId: string };

export async function getConnectionQrCode(deps: InboxUseCaseDeps, input: GetQrCodeInput): Promise<{ qrCode: string; expiresAt: string }> {
  const connection = await mustConnectionBelongToTenantAndWorkspace(deps, input.connectionId, input.tenantId, input.workspaceId);
  if (!connection.externalSessionId) throw new Error("INBOX_CONNECTION_NOT_READY: a conexão ainda não iniciou a sessão no gateway.");
  // Achado real em produção (Fase 10.1): pedir o QR direto falha com "no session" no WuzAPI para
  // qualquer canal que não esteja "connecting" agora mesmo (logged_out/requires_repair/error) —
  // o gateway derruba o cliente whatsmeow no logout, e `/session/qr` exige um cliente ativo.
  // `connect()` reabre a sessão (idempotente — `createAdminUser` tolera "já existe") antes de
  // pedir o QR; para uma conexão que acabou de ser criada isso é um no-op inofensivo.
  await deps.provider.connect({ externalSessionId: connection.externalSessionId, instanceName: connection.id });
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

/**
 * Fase 6 — monitor de saúde periódico das conexões, chamado pelo `vorix-worker` num tick
 * `setInterval` (nunca acionado por HTTP nem por evento de fila). Deliberadamente PASSIVO: só
 * pergunta ao gateway o status atual e reconcilia `connectionHealth`/`lastConnectionError` —
 * NUNCA chama `connect()`/tenta reautenticar. "Não implementar reconexão agressiva" é atendido por
 * construção: a única "recuperação" possível é o PRÓXIMO tick constatar sucesso, nunca um loop de
 * retry dentro desta função. Conexões em status TERMINAL (`logged_out`/`requires_repair`) nunca
 * são sequer checadas — `listAllActive()` já as exclui — evitando qualquer chance de reautenticar
 * ou "acordar" uma sessão revogada.
 *
 * Container WuzAPI saudável != sessão WhatsApp saudável: `connectionHealth` é um sinal
 * INDEPENDENTE do último `status` conhecido — uma falha aqui nunca sobrescreve `status` (só
 * reflete status quando a checagem tem SUCESSO, mesmo raciocínio de `refreshConnectionStatus`).
 */
export async function reconcileConnectionsHealth(deps: InboxUseCaseDeps): Promise<{ checked: number; healthy: number; unhealthy: number }> {
  const connections = await deps.connectionRepository.listAllActive();
  let healthy = 0;
  let unhealthy = 0;
  const at = new Date().toISOString();

  for (const connection of connections) {
    if (!connection.externalSessionId) continue;
    try {
      const status = await deps.provider.getConnectionStatus({ externalSessionId: connection.externalSessionId });
      await deps.connectionRepository.recordHealthCheck(connection.id, { connectionHealth: "healthy", at });
      // Só reconcilia `status` em sucesso — nunca infere um novo status a partir de uma FALHA de
      // checagem (isso seria inventar informação que não temos: "não consegui perguntar" não é o
      // mesmo que "a sessão caiu").
      if (status.status !== connection.status) {
        await deps.connectionRepository.updateStatus(connection.id, { status: status.status, phoneNumber: status.phoneNumber });
      }
      healthy += 1;
    } catch (error) {
      const kind = error instanceof MessagingProviderError ? error.kind : "transient";
      // `transient` na checagem de status é o sinal mais próximo de "o próprio gateway está
      // inalcançável" (ver comentário em `wuzapi-client.ts`: falha de rede vira `transient` com a
      // mensagem "WuzAPI inalcançável"); `auth`/`permanent`/`rate_limit` indicam algo específico
      // desta sessão/credencial, nunca o gateway inteiro fora do ar — nunca confundir os dois.
      // `session_logged_out` nem chega aqui de fato (a sessão já teria sido marcada terminal por
      // outro caminho), mas por segurança também não é tratado como indisponibilidade de gateway.
      const connectionHealth = kind === "transient" ? "gateway_unavailable" : "degraded";
      await deps.connectionRepository.recordHealthCheck(connection.id, {
        connectionHealth,
        lastConnectionError: kind,
        at,
      });
      unhealthy += 1;
    }
  }

  return { checked: connections.length, healthy, unhealthy };
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
  const updated = await deps.conversationRepository.setAiEnabled(conversation.id, input.aiEnabled, input.aiEnabled ? undefined : "manual");
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
 *
 * ACHADO REAL (homologação de runtime, bug confirmado): se `outboundQueue.publish()` falhar DEPOIS
 * do commit do insert (ex.: RabbitMQ momentaneamente fora do ar), a linha ficava `queued` para
 * sempre — nada a distinguia de uma mensagem normal aguardando processamento, e nenhum mecanismo
 * existente jamais a alcançava. Agora a falha de publish é capturada e registrada
 * (`recordPublishAttempt`, camada DISTINTA da falha de envio ao provider — nunca confundir as
 * duas) e a exceção original ainda sobe pro chamador HTTP (comportamento visível preservado) — a
 * garantia nova é que `reconcileOrphanedOutboundMessages` (rodando periodicamente no worker)
 * encontra e republica esta mensagem depois, sem depender de nenhum evento futuro do usuário.
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
  return finishEnqueueingOutboundMessage(deps, { conversationId: conversation.id, connectionId: conversation.connectionId, message, sentByAi: input.sentByAi ?? false, tenantId: input.tenantId, workspaceId: input.workspaceId });
}

export type SendInboxMediaMessageInput = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  sentByUserId?: string;
  type: Exclude<InboxMessage["type"], "text" | "location" | "contact" | "other">;
  body: Buffer;
  mimeType: string;
  fileName?: string;
  caption?: string;
};

/**
 * Bloco "Media Outbound" (ver docs/conversas-whatsapp-experience-completion.md) — envio de
 * imagem/áudio/vídeo/documento pela UI. Guarda uma cópia PRÓPRIA no `InboxMediaStoragePort` (pra
 * preview imediato na UI, igual ao caminho inbound — ver `downloadInboundMediaAndAttach`) e
 * enfileira exatamente como texto: `processOutboundMessage` (worker) é quem de fato chama o
 * provider, reaproveitando TODA a resiliência já existente (circuit breaker, rate limiter, retry,
 * DLQ) sem duplicar nenhuma dessa lógica aqui. Nunca lê o arquivo do disco/request aqui além de
 * gravar no storage — o envio de verdade ao WhatsApp é assíncrono, como qualquer outbound.
 */
export async function sendInboxMediaMessage(deps: InboxUseCaseDeps, input: SendInboxMediaMessageInput): Promise<InboxMessage> {
  if (!deps.inboxMediaStorage) throw new Error("INBOX_MEDIA_STORAGE_NOT_CONFIGURED: envio de mídia não está disponível neste ambiente.");
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);

  const objectKey = `${input.tenantId}/${input.workspaceId}/${conversation.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await deps.inboxMediaStorage.put({ key: objectKey, body: input.body, contentType: input.mimeType });

  const metadata: Record<string, unknown> = { fileSizeBytes: input.body.length };
  if (input.fileName) metadata.fileName = input.fileName;

  const { message } = await deps.messageRepository.create({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    connectionId: conversation.connectionId,
    direction: "outbound",
    type: input.type,
    status: "queued",
    body: input.caption,
    mediaStorageRef: { provider: "inbox-media", objectKey, metadata: { tenantId: input.tenantId } },
    mimeType: input.mimeType,
    metadata,
    sentByUserId: input.sentByUserId,
  });
  return finishEnqueueingOutboundMessage(deps, { conversationId: conversation.id, connectionId: conversation.connectionId, message, sentByAi: false, tenantId: input.tenantId, workspaceId: input.workspaceId });
}

async function finishEnqueueingOutboundMessage(
  deps: InboxUseCaseDeps,
  input: { conversationId: string; connectionId: string; message: InboxMessage; sentByAi: boolean; tenantId: string; workspaceId: string },
): Promise<InboxMessage> {
  try {
    await deps.outboundQueue.publish({ messageId: input.message.id, tenantId: input.tenantId, workspaceId: input.workspaceId, connectionId: input.connectionId });
    await deps.messageRepository.markOutboundPublished(input.message.id, { publishedAt: new Date().toISOString() });
  } catch (error) {
    await deps.messageRepository.recordPublishAttempt(input.message.id, {
      lastPublishError: error instanceof Error ? error.message : String(error),
      attemptedAt: new Date().toISOString(),
    });
    deps.metrics?.incOutboundPublishFailed();
    throw error;
  }
  await deps.conversationRepository.markLastMessage(input.conversationId, { lastMessageAt: input.message.createdAt, incrementUnread: false });
  if (deps.productAnalytics && !input.sentByAi) {
    // "Reply" no sentido do funil de ativação é uma resposta HUMANA — resposta automática de IA
    // não conta como o marco de "alguém do time respondeu pela primeira vez".
    await recordFirstEvent(deps.productAnalytics, { eventName: "first_conversation_replied", source: "server", tenantId: input.tenantId, workspaceId: input.workspaceId });
  }
  return input.message;
}

export type RegisterInboundMessageInput = {
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  /** Identidade CANÔNICA do chat (JID de grupo ou telefone normalizado do peer) — NUNCA o
   * remetente de uma mensagem específica. Ver `docs/conversas-canonical-chat-identity.md`. */
  chatId: string;
  isGroup: boolean;
  groupName?: string;
  /** Bloco "Identity UX" — telefone canônico do peer, quando o provider confirmou o alias PN/LID
   * (ver `src/domain/inbox/whatsapp-identity.ts`). `undefined` em grupo, ou DM só-LID sem alias
   * conhecido ainda (pivô degradado, documentado). */
  chatPhoneE164?: string;
  chatPn?: string;
  chatLid?: string;
  /** `true` = self-echo do WuzAPI (o PRÓPRIO número conectado mandou esta mensagem, via Vorix ou
   * direto do celular pareado) — nunca um contato externo. Ver comentário na função abaixo. */
  fromMe: boolean;
  senderId: string;
  senderName?: string;
  senderPn?: string;
  senderLid?: string;
  externalMessageId: string;
  type: InboxMessage["type"];
  body?: string;
  occurredAt: string;
};

/**
 * Registra um evento de mensagem (inbound de um contato/participante, OU self-echo do próprio
 * número) — usado pelo consumer de `inbox.incoming.queue` (Fase 2). Idempotente ponta a ponta:
 * `upsertByPhone` nunca duplica contato, `findOrCreate` nunca duplica conversa,
 * `messageRepository.create` nunca duplica mensagem (constraint `(connection_id,
 * external_message_id)`) — uma reentrega do mesmo evento é inofensiva.
 *
 * ACHADO AO VIVO (spike Fase 2): `markLastMessage`/`incrementUnread` só pode rodar quando a
 * mensagem foi REALMENTE inserida agora (`wasCreated`) — sem essa checagem, uma reentrega do
 * mesmo evento (mensagem corretamente deduplicada) ainda incrementava `unread_count` de novo,
 * fazendo o contador de não lidas divergir do número real de mensagens.
 *
 * CORREÇÃO DO BUG DE IDENTIDADE DE CONVERSA (ver docs/conversas-canonical-chat-identity.md):
 * (1) GRUPO — a conversa é resolvida por `chatId` (o grupo), nunca por `senderId` (o participante).
 *     `contactId` só existe para `chatType: "direct"`; grupo nunca ganha um `InboxContact`/CRM
 *     próprio (participantes continuam anônimos aqui — a atribuição por mensagem é via
 *     `senderExternalId`/`senderDisplayName`, não via um contato).
 * (2) SELF-ECHO (`fromMe: true`) — primeiro checa se esta `externalMessageId` já existe (mensagem
 *     que o próprio Vorix mandou via `sendInboxMessage`/`processOutboundMessage`): se sim, este
 *     evento é só a confirmação do WuzAPI, tratado como no-op (`wasCreated: false`), NUNCA cria uma
 *     segunda conversa/mensagem para o mesmo par. Se não existir ainda, é uma mensagem que o número
 *     mandou por fora do Vorix (direto do celular pareado) — registrada como `outbound` na MESMA
 *     conversa do chat (nunca como "inbound de um contato chamado eu mesmo").
 */
export async function registerInboundMessage(
  deps: InboxUseCaseDeps,
  input: RegisterInboundMessageInput,
): Promise<{ contact?: InboxContact; conversation: InboxConversation; message: InboxMessage; wasCreated: boolean }> {
  if (input.fromMe) {
    const existing = await deps.messageRepository.findByExternalId({ connectionId: input.connectionId, externalMessageId: input.externalMessageId });
    if (existing) {
      const conversation = await deps.conversationRepository.getById(existing.conversationId);
      if (conversation) return { conversation, message: existing, wasCreated: false };
    }
  }

  let contact: InboxContact | undefined;
  if (!input.isGroup) {
    // Bloco "Identity UX" — telefone é o pivô CANÔNICO da pessoa quando o provider confirmou o
    // alias PN/LID (`chatPhoneE164`); só cai pro LID-como-pseudo-telefone quando isso ainda não
    // foi observado (pivô degradado, documentado — ver src/domain/inbox/whatsapp-identity.ts).
    const phoneNormalized = input.chatPhoneE164 ?? normalizePhoneNumber(input.chatId);
    contact = await deps.contactRepository.upsertByPhone({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      phoneNormalized,
      // Self-echo nunca deveria sobrescrever o nome do CONTATO com o nome do próprio operador —
      // `PushName` num evento `fromMe` é o nome de quem mandou (o bot), não da pessoa do outro lado.
      name: input.fromMe ? undefined : input.senderName,
      whatsappPn: input.chatPn,
      whatsappLid: input.chatLid,
    });
  }

  const conversation = await deps.conversationRepository.findOrCreate({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    chatType: input.isGroup ? "group" : "direct",
    externalChatId: input.isGroup ? input.chatId : normalizePhoneNumber(input.chatId),
    groupName: input.groupName,
    contactId: contact?.id,
  });
  const { message, wasCreated } = await deps.messageRepository.create({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    connectionId: input.connectionId,
    externalMessageId: input.externalMessageId,
    direction: input.fromMe ? "outbound" : "inbound",
    type: input.type,
    body: input.body,
    senderExternalId: input.senderId,
    senderDisplayName: input.senderName,
    senderPhoneE164: input.senderPn,
    ...(input.fromMe ? { status: "sent" as const } : {}),
  });
  if (wasCreated) {
    await deps.conversationRepository.markLastMessage(conversation.id, { lastMessageAt: input.occurredAt, incrementUnread: !input.fromMe });
    if (!input.fromMe) {
      deps.metrics?.incMessageInbound();
      // `createdAt === updatedAt` é o sinal de que `findOrCreate` acabou de CRIAR a conversa agora
      // (nunca reaproveitou uma existente) — só aí é de fato a primeira conversa do workspace.
      if (deps.productAnalytics && conversation.createdAt === conversation.updatedAt) {
        await recordFirstEvent(deps.productAnalytics, { eventName: "first_conversation_received", source: "server", tenantId: input.tenantId, workspaceId: input.workspaceId });
      }
    }
  }
  return { contact, conversation, message, wasCreated };
}

export type SyncGroupMetadataInput = { tenantId: string; workspaceId: string; connectionId: string; conversationId: string };

/**
 * Bloco "Identity UX" — busca nome/quantidade de participantes de uma conversa de grupo via
 * `MessagingProvider.getGroupInfo` (ver docs/conversas-whatsapp-experience-completion.md).
 * Best-effort, sempre chamado FORA do caminho crítico do ack (mesmo racional de
 * `downloadInboundMediaAndAttach`): a conversa já existe e funciona sem isso, sucesso aqui só
 * ENRIQUECE com o nome real em vez do fallback genérico "Grupo". Nunca lança — provider sem
 * suporte (`getGroupInfo` ausente), conexão sem sessão ativa, ou erro do gateway viram no-op.
 */
export async function syncGroupMetadata(deps: InboxUseCaseDeps, input: SyncGroupMetadataInput): Promise<{ synced: boolean }> {
  if (!deps.provider.getGroupInfo) return { synced: false };
  const conversation = await deps.conversationRepository.getById(input.conversationId);
  if (!conversation || conversation.chatType !== "group") return { synced: false };
  const connection = await deps.connectionRepository.getById(input.connectionId);
  if (!connection?.externalSessionId) return { synced: false };

  const info = await deps.provider.getGroupInfo({ externalSessionId: connection.externalSessionId, groupJid: conversation.externalChatId });
  if (!info) return { synced: false };
  await deps.conversationRepository.updateGroupMetadata(conversation.id, {
    groupName: info.name,
    participantCount: info.participantCount,
    metadataUpdatedAt: new Date().toISOString(),
  });
  return { synced: true };
}

export type DownloadInboundMediaInput = {
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  messageId: string;
  type: Exclude<InboxMessage["type"], "text" | "location" | "contact" | "other">;
  mediaUrl: string;
  /** Campo CRÍTICO pro download funcionar — ver comentário em `downloadMedia` (`wuzapi-client.ts`):
   * `whatsmeow.Client.Download()` exige isto não-vazio, nunca olha `mediaUrl` pra essa checagem. */
  mediaDirectPath?: string;
  mimeType?: string;
  mediaKey?: string;
  fileSha256?: string;
  fileEncSha256?: string;
  fileName?: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
  thumbnailBase64?: string;
};

/**
 * Redesign operacional (mídia real) — best-effort, sempre chamado FORA do caminho crítico do ack
 * (nunca `await`-ado pelo worker antes de confirmar a mensagem no RabbitMQ; ver
 * `inbox-worker.ts`). A mensagem já existe com `type` correto e `mediaStorageRef` vazio quando
 * isto roda — sucesso aqui só ENRIQUECE a mensagem (`attachMedia`), nunca é pré-requisito para ela
 * aparecer na tela. Qualquer falha (provider sem suporte, sessão perdida, storage indisponível,
 * payload sem os campos esperados) é tratada como "mídia indisponível", nunca lançada — quem
 * chama já espera isso e só loga.
 */
export async function downloadInboundMediaAndAttach(deps: InboxUseCaseDeps, input: DownloadInboundMediaInput): Promise<{ attached: boolean; reason?: "no_media_key_unsupported_source" | "no_direct_path" }> {
  if (!deps.inboxMediaStorage || !deps.provider.downloadMedia) return { attached: false };
  const connection = await deps.connectionRepository.getById(input.connectionId);
  if (!connection?.externalSessionId) return { attached: false };

  // ACHADO AO VIVO (diagnóstico temporário em produção — ver
  // docs/conversas-inbox-organization-media-runtime.md) — mídia de WhatsApp normal (DM/grupo) é
  // E2E criptografada e SEMPRE traz `mediaKey` (confirmado no .proto real do whatsmeow,
  // `waE2E.ImageMessage.mediaKey` etc.); mensagens de CANAL/NEWSLETTER (`@newsletter`) não são
  // criptografadas por destinatário e por isso NUNCA trazem `mediaKey` — o endpoint de download do
  // WuzAPI (`/chat/download*`) exige o par completo (Url+MediaKey) pra descriptografar e responde
  // um erro genérico ("no url present", mesmo quando só o MediaKey falta) nesse caso. Sem essa
  // checagem, o worker tentava o download de toda mídia de canal, sempre falhando com uma
  // mensagem enganosa. Nunca fingir recuperação aqui (seção 25 do pedido original) — só marca a
  // causa raiz real e desiste sem tentar a chamada HTTP que sabemos que vai falhar.
  if (!input.mediaKey) {
    console.warn(
      `[inbox] mensagem "${input.messageId}" do tipo "${input.type}" sem mediaKey — provável Canal/Newsletter do WhatsApp (mídia não criptografada por destinatário, o endpoint de download do WuzAPI exige mediaKey). Mídia não pôde ser baixada; isto NÃO é um erro transitório, não adianta reprocessar sem uma chave real.`,
    );
    return { attached: false, reason: "no_media_key_unsupported_source" };
  }
  // CAUSA RAIZ REAL (encontrada lendo o código-fonte de `whatsmeow`/`wuzapi`, não suposição) do
  // motivo pelo qual `mediaKey` presente NUNCA foi suficiente pra baixar com sucesso: o handler do
  // WuzAPI monta um `waE2E.ImageMessage` a partir do que enviamos e chama
  // `whatsmeow.Client.Download()`, que checa `len(msg.GetDirectPath()) == 0` (NUNCA olha `mediaUrl`
  // pra essa checagem) e retorna `"no url present"` se vazio — ver `wuzapi-client.ts:downloadMedia`.
  // `mediaDirectPath` só começou a ser extraído do payload nesta correção.
  if (!input.mediaDirectPath) {
    console.warn(
      `[inbox] mensagem "${input.messageId}" do tipo "${input.type}" com mediaKey mas SEM directPath — o download do WuzAPI vai falhar com "no url present" (whatsmeow.Client.Download() exige directPath, nunca usa a url). Mídia não pôde ser baixada.`,
    );
    return { attached: false, reason: "no_direct_path" };
  }

  const downloaded = await deps.provider.downloadMedia({
    externalSessionId: connection.externalSessionId,
    type: input.type,
    ref: {
      url: input.mediaUrl,
      directPath: input.mediaDirectPath,
      mediaKey: input.mediaKey,
      mimeType: input.mimeType,
      fileSha256: input.fileSha256,
      fileSizeBytes: input.fileSizeBytes,
      fileEncSha256: input.fileEncSha256,
    },
  });
  if (!downloaded) return { attached: false };

  const objectKey = `${input.tenantId}/${input.workspaceId}/${input.messageId}`;
  await deps.inboxMediaStorage.put({ key: objectKey, body: downloaded.body, contentType: downloaded.mimeType ?? input.mimeType ?? "application/octet-stream" });

  const metadata: Record<string, unknown> = {};
  if (input.fileName) metadata.fileName = input.fileName;
  if (input.fileSizeBytes) metadata.fileSizeBytes = input.fileSizeBytes;
  if (input.durationSeconds) metadata.durationSeconds = input.durationSeconds;
  if (input.thumbnailBase64) metadata.thumbnailDataUrl = `data:image/jpeg;base64,${input.thumbnailBase64}`;

  await deps.messageRepository.attachMedia(input.messageId, {
    mediaStorageRef: { provider: "inbox-media", objectKey, metadata: { tenantId: input.tenantId } },
    mimeType: downloaded.mimeType ?? input.mimeType,
    metadata,
  });
  return { attached: true };
}

export type ApplyMessageStatusChangedInput = { connectionId: string; externalMessageId: string; status: InboxMessage["status"]; occurredAt: string };

/** Usado pelo consumer de `inbox.status.queue` (Fase 2) — recibo de entrega/leitura do WhatsApp. */
export async function applyMessageStatusChanged(deps: InboxUseCaseDeps, input: ApplyMessageStatusChangedInput): Promise<void> {
  await deps.messageRepository.updateStatusByExternalId(input);
}

export type ApplyConnectionStateChangedInput = { connectionId: string; status: MessagingConnectionStatus; phoneNumber?: string };

/**
 * Usado pelo consumer de `inbox.connection.queue` (Fase 2). Nunca dispara reconexão automática
 * aqui — isso é papel do health monitor (Fase 6); este consumer só reflete o estado reportado.
 *
 * Fase 7 — achado de auditoria: um evento de fila ATRASADO (reentrega, reordenação do broker,
 * escada de retry) podia sobrescrever silenciosamente um status TERMINAL (`logged_out`/
 * `requires_repair`) de volta para `connected`/`reconnecting` — exatamente o "logout tratado como
 * reconnecting eterno" que a Fase 6 já evitava no monitor de saúde periódico
 * (`reconcileConnectionsHealth`, que só opera em `listAllActive()`), mas que este consumer
 * orientado a evento não respeitava. Agora lê o estado ATUAL primeiro: uma vez terminal, só
 * `reopenConversation`-like ação explícita (hoje: reconectar de verdade via `createConnection`/
 * `refreshConnectionStatus`, nunca um evento de fila) pode tirar a conexão desse estado.
 */
export async function applyConnectionStateChanged(deps: InboxUseCaseDeps, input: ApplyConnectionStateChangedInput): Promise<void> {
  const current = await deps.connectionRepository.getById(input.connectionId);
  if (current && MESSAGING_CONNECTION_TERMINAL_STATUSES.includes(current.status)) {
    return; // conexão já revogada/precisa de reparo — nunca "ressuscitada" por um evento de fila atrasado.
  }
  await deps.connectionRepository.updateStatus(input.connectionId, { status: input.status, phoneNumber: input.phoneNumber });
  await deps.connectionRepository.touchEvent(input.connectionId, new Date().toISOString());
  if (input.status === "connected") deps.metrics?.incConnectionConnected();
  else if (input.status === "disconnected") deps.metrics?.incConnectionDisconnected();
  else if (input.status === "reconnecting") deps.metrics?.incReconnect();
}

export type ProcessOutboundMessageInput = { messageId: string };

/**
 * Bloco "Media Outbound" — escolhe o método certo do `MessagingProvider` conforme `message.type`.
 * Pra mídia, lê os bytes de volta do `InboxMediaStoragePort` (gravados por `sendInboxMediaMessage`)
 * e monta um data URI (`data:&lt;mime&gt;;base64,...`) — contrato CONFIRMADO via documentação real do
 * `asternic/wuzapi` (`API.md`: `/chat/send/image`/`audio`/`video`/`document` esperam
 * `Image`/`Audio`/`Video`/`Document` como data URI base64, nunca uma URL fetchável — diferente da
 * suposição original deste arquivo, nunca verificada ao vivo). `to`/`mediaUrl` no port continuam
 * chamados `mediaUrl` por compatibilidade de nome — o VALOR passado é o data URI, que também é
 * tecnicamente uma URL (`data:` é um scheme de URL válido), então o port não precisou mudar.
 */
async function sendOutboundByType(
  deps: InboxUseCaseDeps,
  input: { externalSessionId: string; to: string; message: InboxMessage },
): Promise<{ externalMessageId: string }> {
  const { message } = input;
  if (message.type === "text") {
    return deps.provider.sendText({ externalSessionId: input.externalSessionId, to: input.to, body: message.body ?? "" });
  }
  if (!deps.inboxMediaStorage) throw new MessagingProviderError("permanent", "Envio de mídia sem storage configurado neste processo.");
  if (!message.mediaStorageRef) throw new MessagingProviderError("permanent", `Mensagem "${message.id}" do tipo "${message.type}" sem mediaStorageRef — nada pra enviar.`);
  const stored = await deps.inboxMediaStorage.get(message.mediaStorageRef.objectKey);
  if (!stored) throw new MessagingProviderError("permanent", `Mídia da mensagem "${message.id}" não encontrada no storage.`);
  const dataUri = `data:${stored.contentType};base64,${stored.body.toString("base64")}`;

  if (message.type === "image") return deps.provider.sendImage({ externalSessionId: input.externalSessionId, to: input.to, mediaUrl: dataUri, caption: message.body });
  if (message.type === "audio") return deps.provider.sendAudio({ externalSessionId: input.externalSessionId, to: input.to, mediaUrl: dataUri });
  if (message.type === "video") return deps.provider.sendVideo({ externalSessionId: input.externalSessionId, to: input.to, mediaUrl: dataUri, caption: message.body });
  if (message.type === "document") {
    const fileName = (message.metadata?.fileName as string | undefined) ?? "documento";
    return deps.provider.sendDocument({ externalSessionId: input.externalSessionId, to: input.to, mediaUrl: dataUri, fileName });
  }
  throw new MessagingProviderError("permanent", `Tipo de mensagem "${message.type}" não tem envio outbound suportado.`);
}

/** Fase 6 — categoria de circuit breaker correspondente a cada `MessagingProviderErrorKind`.
 * Deliberadamente NUNCA conta `session_logged_out`/`permanent` — erro de UMA sessão específica
 * nunca deve abrir o circuito de todas as conexões (requisito explícito: "não confundir erro de
 * sessão específica com indisponibilidade global do gateway"). `authentication` abre o circuito
 * imediatamente (mesma regra já aplicada a outros consumidores de `OperationalCircuitBreaker`). */
function circuitCategoryFor(kind: MessagingProviderErrorKind): string {
  switch (kind) {
    case "transient": return "provider_unavailable";
    case "rate_limit": return "rate_limited";
    case "auth": return "authentication";
    case "session_logged_out": return "session_logged_out";
    case "permanent": return "permanent";
    case "operator_paused": return "permanent"; // nunca deveria chegar aqui — kind lançado antes do circuit breaker (ver processOutboundMessage).
    default: return "permanent";
  }
}

/**
 * Drena `inbox.outgoing.queue` (Fase 2) — chamado pelo `OutboxSenderConsumer` do `vorix-worker`.
 * Idempotente por construção: se a mensagem já não estiver `queued` (reentrega tardia de um evento
 * já processado), não reenvia de novo. Erros do provider propagam como `MessagingProviderError`
 * para o worker decidir retry/backoff/DLQ a partir de `error.kind` — nunca decidido aqui.
 *
 * Fase 6 — duas proteções ANTES de chamar o provider, ambas reaproveitando infraestrutura
 * operacional já existente (nunca uma segunda stack): (1) circuit breaker por conexão
 * (`scope: "messaging_provider"`) — se aberto, nem tenta a chamada, lança `MessagingProviderError`
 * transitório para o worker requeue via a escada de retry já existente (a mensagem PERMANECE
 * `queued`, nunca é perdida); (2) rate limiter por conexão — se o limite foi atingido, mesma
 * consequência (requeue, nunca descarte). As duas são best-effort: `deps.circuitBreaker`/
 * `deps.rateLimiter` ausentes (`undefined`) significam "sem proteção configurada", nunca um erro.
 */
export async function processOutboundMessage(deps: InboxUseCaseDeps, input: ProcessOutboundMessageInput): Promise<InboxMessage | undefined> {
  const message = await deps.messageRepository.getById(input.messageId);
  if (!message) return undefined;
  if (message.status === "sending") {
    // Fase 7 — achado crítico de auditoria: NUNCA reenvia aqui. Ver `tryMarkSending` — este estado
    // só existe entre o claim e `markSent`/`revertToQueued`; se uma redelivery encontra a mensagem
    // ainda `sending`, é porque o processo anterior morreu no meio do envio (nunca chegou ao
    // catch). Não há como saber com certeza se `provider.sendText` já chegou a executar no
    // WhatsApp — reenviar arrisca duplicidade real e irreversível, então a mensagem fica parada
    // aqui para reconciliação manual em vez disso. Log alto para dar visibilidade operacional.
    console.warn(`[inbox] mensagem "${message.id}" travada em "sending" — possível crash do worker durante um envio anterior. Requer reconciliação manual (verificar no WhatsApp se a mensagem já foi entregue).`);
    return message;
  }
  if (message.status !== "queued") return message;

  const conversation = await deps.conversationRepository.getById(message.conversationId);
  if (!conversation) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${message.conversationId}" não existe.`);
  const connection = await deps.connectionRepository.getById(message.connectionId);
  if (!connection?.externalSessionId) throw new MessagingProviderError("transient", `Conexão "${message.connectionId}" sem sessão ativa no gateway.`);

  if (deps.outboundSendPaused) {
    // Kill switch de emergência (Fase 7) — nunca perde a mensagem, nunca conta como falha do
    // provider/circuit breaker (isto é uma pausa DELIBERADA, não uma indisponibilidade real).
    await deps.messageRepository.recordAttempt(message.id, { lastError: "Envio outbound pausado manualmente (kill switch de emergência).", lastAttemptAt: new Date().toISOString(), failureCategory: "outbound_paused" });
    deps.metrics?.incMessageRetry();
    // Fase 7 — achado de auditoria: `kind: "operator_paused"` (nunca "transient") é o que garante
    // que o worker NUNCA esgota a escada de retry e manda para a DLQ enquanto a pausa durar, por
    // mais longa que seja — ver `MessagingProviderErrorKind` e `retryOrDeadLetter` no worker.
    throw new MessagingProviderError("operator_paused", "Envio outbound pausado manualmente — mensagem permanece na fila.");
  }

  const circuitKey = { tenantId: message.tenantId, workspaceId: message.workspaceId, scope: "messaging_provider" as const, target: connection.id };

  if (deps.circuitBreaker) {
    const { allowed } = await deps.circuitBreaker.canExecute(circuitKey);
    if (!allowed) {
      await deps.messageRepository.recordAttempt(message.id, { lastError: `Circuit breaker aberto para a conexão "${connection.id}" — WuzAPI considerado indisponível.`, lastAttemptAt: new Date().toISOString(), failureCategory: "circuit_open" });
      deps.metrics?.incMessageRetry();
      throw new MessagingProviderError("transient", `Circuit breaker aberto para a conexão "${connection.id}".`);
    }
  }

  if (deps.rateLimiter) {
    // Nunca passa `limit` explícito aqui — o valor vem do `defaultLimit` configurado na PRÓPRIA
    // instância de `OperationalRateLimiter` injetada (o worker a constrói a partir de
    // `INBOX_OUTBOUND_RATE_LIMIT_PER_MINUTE`). Passar um `limit` fixo aqui ignoraria silenciosamente
    // essa configuração (bug real encontrado escrevendo os testes da Fase 6).
    const { allowed, retryAfterMs } = await deps.rateLimiter.consume({
      routeGroup: "inbox_outbound",
      tenantId: message.tenantId,
      principalId: connection.id,
    });
    if (!allowed) {
      // Nunca perde a mensagem: fica `queued`, o worker requeue via a escada de retry (erro
      // classificado como transitório) — ela é processada de novo assim que a janela abrir.
      await deps.messageRepository.recordAttempt(message.id, { lastError: `Limite de envio por conexão atingido (retryAfterMs=${retryAfterMs ?? 0}).`, lastAttemptAt: new Date().toISOString(), failureCategory: "rate_limited_local" });
      deps.metrics?.incMessageRetry();
      throw new MessagingProviderError("transient", `Limite de envio por conexão "${connection.id}" atingido.`);
    }
  }

  // Fase 7 — achado crítico de auditoria: claim atômico ANTES de chamar o provider. Fecha duas
  // condições de corrida com uma única mudança: (1) duas execuções concorrentes do mesmo
  // `messageId` (ex.: redelivery sobreposta) nunca chamam `provider.sendText` duas vezes — só uma
  // ganha o CAS `queued → sending`; (2) um crash exatamente entre o provider responder sucesso e
  // `markSent` commitar deixa a mensagem em `sending` (nunca de volta pra `queued`), e o guard no
  // topo desta função recusa reenviar uma mensagem `sending` — ver comentário lá.
  const claimed = await deps.messageRepository.tryMarkSending(message.id);
  if (!claimed) return message;

  try {
    // Destino é sempre a identidade CANÔNICA do chat (`externalChatId` — grupo ou peer), nunca o
    // telefone de um contato: uma conversa de GRUPO não tem `contactId` (ver correção do bug de
    // identidade de conversa), e usar o remetente da ÚLTIMA mensagem recebida como destino
    // (em vez do chat) mandaria a resposta pro participante errado, nunca pro grupo. Ver
    // docs/conversas-canonical-chat-identity.md.
    const result = await sendOutboundByType(deps, { externalSessionId: connection.externalSessionId, to: conversation.externalChatId, message });
    if (deps.circuitBreaker) await deps.circuitBreaker.recordSuccess(circuitKey);
    deps.metrics?.incMessageOutbound();
    return await deps.messageRepository.markSent(message.id, { externalMessageId: result.externalMessageId, sentAt: new Date().toISOString() });
  } catch (error) {
    const kind = error instanceof MessagingProviderError ? error.kind : "transient";
    if (deps.circuitBreaker) {
      await deps.circuitBreaker.recordFailure(circuitKey, { code: kind, category: circuitCategoryFor(kind) });
    }
    deps.metrics?.incMessageFailed(kind);
    // Falha capturada AQUI DENTRO do processo (nunca um crash) — sabemos com certeza que o
    // provider não foi chamado com sucesso, então é seguro devolver a mensagem pra `queued` e
    // deixar a escada de retry existente (RabbitMQ) reprocessar normalmente.
    await deps.messageRepository.revertToQueued(message.id);
    await deps.messageRepository.recordAttempt(message.id, { lastError: error instanceof Error ? error.message : String(error), lastAttemptAt: new Date().toISOString(), failureCategory: kind });
    throw error;
  }
}

export type ReconcileOrphanedOutboundMessagesResult = { reconciled: number; failed: number; oldestOrphanAgeSeconds?: number };

/**
 * Correção de bug real (homologação de runtime): reconcilia mensagens outbound que ficaram
 * `queued` porque `sendInboxMessage` conseguiu commitar o insert no Postgres mas
 * `outboundQueue.publish()` falhou logo em seguida (ex.: RabbitMQ momentaneamente fora do ar) —
 * sem isso, essas linhas nunca eram alcançadas por NENHUM mecanismo existente (retry ladder, DLQ,
 * redelivery), mesmo depois do broker voltar. Rodado periodicamente pelo `vorix-worker` (nunca
 * pela API HTTP, que não deveria bloquear uma requisição de usuário esperando isto).
 *
 * `gracePeriodMs` existe para NUNCA reconciliar uma mensagem recém-criada cujo `sendInboxMessage`
 * ainda pode estar em voo, terminando de publicar normalmente sozinho — só mensagens já mais
 * velhas que o fluxo normal têm qualquer chance de ser genuinamente órfãs.
 *
 * Duplicidade real (o mesmo `messageId` publicado duas vezes — uma pelo `sendInboxMessage`
 * original que na verdade teve sucesso mas morreu antes de gravar `outboundPublishedAt`, e outra
 * por esta reconciliação) É POSSÍVEL e é aceita de propósito (at-least-once na fila, nunca
 * "exactly-once" fingido) — a proteção real contra enviar ao provider duas vezes já existe e não
 * muda: o CAS `tryMarkSending` (`queued → sending`) em `processOutboundMessage` garante que só a
 * PRIMEIRA entrega a chegar no worker chama `provider.sendText`; a segunda encontra `status !==
 * "queued"` e retorna sem fazer nada (ver o guard logo no topo daquela função).
 *
 * Nunca reconcilia mensagens `sending` (trava intencional pré-existente — ver comentário em
 * `processOutboundMessage` sobre por que uma mensagem travada em `sending` exige reconciliação
 * MANUAL, nunca automática, para não arriscar reenviar algo que pode já ter sido entregue de
 * verdade ao WhatsApp) nem `sent`/`failed` (estados que já convergiram).
 *
 * Cada mensagem carrega seu próprio `tenantId`/`workspaceId`/`connectionId` (lidos da própria
 * linha, nunca inferidos) — reconciliação cross-tenant incorreta não é possível por construção.
 */
export async function reconcileOrphanedOutboundMessages(deps: InboxUseCaseDeps, input: { gracePeriodMs: number; limit?: number }): Promise<ReconcileOrphanedOutboundMessagesResult> {
  const now = Date.now();
  const olderThanIso = new Date(now - input.gracePeriodMs).toISOString();
  const orphans = await deps.messageRepository.listOrphanedOutboundMessages({ olderThanIso, limit: input.limit ?? 100 });

  let reconciled = 0;
  let failed = 0;
  for (const message of orphans) {
    try {
      await deps.outboundQueue.publish({ messageId: message.id, tenantId: message.tenantId, workspaceId: message.workspaceId, connectionId: message.connectionId });
      await deps.messageRepository.markOutboundPublished(message.id, { publishedAt: new Date().toISOString() });
      deps.metrics?.incOutboundReconciled();
      reconciled += 1;
    } catch (error) {
      await deps.messageRepository.recordPublishAttempt(message.id, {
        lastPublishError: error instanceof Error ? error.message : String(error),
        attemptedAt: new Date().toISOString(),
      });
      deps.metrics?.incOutboundReconcileFailed();
      failed += 1;
    }
  }

  const oldestOrphanAgeSeconds = orphans[0] ? Math.floor((now - new Date(orphans[0].createdAt).getTime()) / 1000) : undefined;
  if (oldestOrphanAgeSeconds !== undefined) deps.metrics?.setOldestQueuedMessageAgeSeconds(oldestOrphanAgeSeconds);
  return { reconciled, failed, oldestOrphanAgeSeconds };
}

// ---------------------------------------------------------------------------------------------
// IA de Atendimento — Fase 5. Ver `src/application/ports/inbox-ai-responder.port.ts` para o
// contrato e o racional de isolamento (nunca importa AiGatewayPort/AiRequest diretamente).
// ---------------------------------------------------------------------------------------------

/** Janela de contexto enviada à IA — controla tanto o tamanho quanto o custo por resposta (nunca
 * o histórico completo de uma conversa longa). 20 mensagens cobrem confortavelmente uma troca
 * recente de WhatsApp; o teto duro de verdade contra estouro é `INBOX_AUTO_REPLY_POLICY.
 * maxInputTokens` no próprio AI Gateway — esta constante é só a primeira linha de defesa,
 * mais barata (evita nem buscar/serializar mensagens que nunca caberiam). */
const AI_CONTEXT_MESSAGE_LIMIT = 20;

/** Segunda tentativa de adquirir o lock de geração da conversa antes de desistir — cobre só a
 * janela estreita entre "o dono atual do lock decidiu que não há mais nada pendente" e "ele
 * efetivamente libera o lock" (ver `drainAiResponses`). Não é uma fila de retry de verdade: se
 * mesmo assim perder a corrida, esta mensagem específica só será respondida quando a PRÓXIMA
 * mensagem inbound da conversa disparar um novo `maybeGenerateAiResponse` (ela nunca é perdida —
 * `ai_claim_status` continua `null` até alguém efetivamente a reivindicar), ou manualmente por um
 * humano. Ver relatório da Fase 5 para a análise completa desse trade-off. */
const AI_LOCK_RETRY_DELAY_MS = 200;

/**
 * Fase 6 — TTL do lease de geração de IA (conversa) e do claim por mensagem. Um processo que
 * morre segurando `ai_processing_since`/`ai_claim_status='processing'` NUNCA deveria travar uma
 * conversa/mensagem para sempre (bug de classe real: "lock lógico correto para concorrência, mas
 * sem recuperação"). 90s é generoso o bastante para cobrir o pior caso de uma geração real
 * (`INBOX_AUTO_REPLY_POLICY.timeoutMs = 12_000` × até 2 tentativas do AI Gateway + overhead de
 * claim/envio/evento) sem arriscar duas gerações válidas simultâneas por engano — e ainda assim
 * baixo o bastante para uma recuperação em tempo operacionalmente razoável após um crash. Mesmo
 * valor usado para os dois (lock de conversa e claim de mensagem) por simplicidade — não há
 * evidência hoje que justifique dois TTLs distintos.
 */
const AI_LOCK_TTL_MS = 90_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fase 6 — instante a partir do qual um lock/claim é considerado abandonado (agora menos
 * `AI_LOCK_TTL_MS`). Recalculado a cada chamada (nunca cacheado) para nunca usar um "agora"
 * desatualizado numa retentativa. */
function staleBeforeIso(): string {
  return new Date(Date.now() - AI_LOCK_TTL_MS).toISOString();
}

/**
 * Gate de elegibilidade da IA — checado SEMPRE a partir de uma leitura fresca do banco, nunca de
 * uma cópia em memória potencialmente desatualizada (é isto que fecha a janela de corrida entre
 * "IA começou a gerar" e "humano assumiu enquanto isso"). Checa `assignedUserId` diretamente, não
 * só `aiEnabled`: atribuição DIRETA (`assign()`, Fase 4) não desliga `aiEnabled`, mas um humano
 * responsável nunca pode competir com a IA de qualquer forma que a atribuição tenha acontecido.
 */
function isConversationEligibleForAi(conversation: InboxConversation): boolean {
  return conversation.aiEnabled && !conversation.assignedUserId && conversation.status !== "resolved" && conversation.status !== "archived";
}

async function resolveClaims(deps: InboxUseCaseDeps, claimed: readonly InboxMessage[], status: "answered" | "skipped" | "failed", responseMessageId?: string): Promise<void> {
  for (const message of claimed) {
    await deps.messageRepository.resolveAiClaim(message.id, { status, responseMessageId });
  }
}

export type MaybeGenerateAiResponseInput = { tenantId: string; workspaceId: string; conversationId: string; triggeringMessageId: string };

/**
 * Ponto de entrada da IA de Atendimento — chamado pelo `vorix-worker` logo após CADA mensagem
 * INBOUND ser persistida (só quando `wasCreated`, nunca numa reentrega — isso sozinho já evita
 * qualquer duplicidade de resposta para o caso comum). Nunca lança: qualquer falha inesperada aqui
 * nunca pode derrubar o consumer de `inbox.incoming.queue` nem impedir que um humano responda.
 *
 * Estratégia de concorrência/serialização por conversa (decisão obrigatória, documentada no
 * relatório da Fase 5): LOCK lógico por conversa (`ai_processing_since`, CAS) — só uma geração de
 * IA pode estar em voo por conversa a qualquer momento. Quem detém o lock DRENA (num laço) toda
 * mensagem inbound ainda não respondida antes de liberar, incluindo qualquer uma que tenha
 * chegado durante a própria geração — em vez de várias respostas paralelas e desconexas para
 * mensagens consecutivas, o resultado é uma única resposta coerente considerando o estado mais
 * recente da conversa. Quem perde a corrida pelo lock não gera nada por conta própria: confia que
 * o dono atual do lock cobre sua mensagem (ela fica com `ai_claim_status: null`, visível para o
 * drenador). Ver `AI_LOCK_RETRY_DELAY_MS` para o único caso estreito em que isso pode falhar.
 *
 * Sem backlog retroativo (requisito explícito): quando a conversa NÃO está elegível (IA pausada
 * ou humano responsável) no momento em que ESTA mensagem específica chega, ela é imediatamente
 * marcada `skipped` — nunca fica com `ai_claim_status: null` esperando uma reativação futura da
 * IA "pescar" ela. É isso que garante que reativar a IA só afeta mensagens que chegarem DEPOIS —
 * o drenador (`listUnansweredInboundByConversation`) só encontra mensagens que já estavam
 * elegíveis quando chegaram, nunca um acúmulo de antes da pausa.
 */
export async function maybeGenerateAiResponse(deps: InboxUseCaseDeps, input: MaybeGenerateAiResponseInput): Promise<void> {
  if (!deps.aiResponder) return;

  const conversation = await deps.conversationRepository.getById(input.conversationId);
  if (!conversation || conversation.tenantId !== input.tenantId || conversation.workspaceId !== input.workspaceId) return;
  if (!isConversationEligibleForAi(conversation)) {
    const claimed = await deps.messageRepository.tryClaimForAiResponse(input.triggeringMessageId, new Date().toISOString(), staleBeforeIso());
    if (claimed) await deps.messageRepository.resolveAiClaim(claimed.id, { status: "skipped" });
    return;
  }

  const lockOwnedAt = new Date().toISOString();
  let lock = await deps.conversationRepository.tryAcquireAiLock(conversation.id, lockOwnedAt, staleBeforeIso());
  if (!lock) {
    await sleep(AI_LOCK_RETRY_DELAY_MS);
    lock = await deps.conversationRepository.tryAcquireAiLock(conversation.id, new Date().toISOString(), staleBeforeIso());
  }
  if (!lock) return; // outra geração já está em andamento (dentro do lease) — o dono atual drena esta mensagem.
  const ownedAt = lock.aiProcessingSince as string;

  try {
    await drainAiResponses(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, conversationId: conversation.id });
  } finally {
    await deps.conversationRepository.releaseAiLock(conversation.id, ownedAt);
  }
}

async function drainAiResponses(deps: InboxUseCaseDeps, ctx: { tenantId: string; workspaceId: string; conversationId: string }): Promise<void> {
  for (;;) {
    const pending = await deps.messageRepository.listUnansweredInboundByConversation({ conversationId: ctx.conversationId, staleProcessingBeforeIso: staleBeforeIso() });
    if (pending.length === 0) return;

    const claimed: InboxMessage[] = [];
    for (const message of pending) {
      const claimedMessage = await deps.messageRepository.tryClaimForAiResponse(message.id, new Date().toISOString(), staleBeforeIso());
      if (claimedMessage) claimed.push(claimedMessage);
    }
    if (claimed.length === 0) return;

    // Race-check #1 — antes de gastar uma chamada de IA: se a elegibilidade já mudou (ex.: alguém
    // assumiu a conversa entre a mensagem chegar e o lock ser adquirido), nem tenta gerar.
    const freshBefore = await deps.conversationRepository.getById(ctx.conversationId);
    if (!freshBefore || !isConversationEligibleForAi(freshBefore)) {
      await resolveClaims(deps, claimed, "skipped");
      return;
    }

    // `contactId` é `undefined` em conversas de grupo (ver correção do bug de identidade de
    // conversa) — `contact`/`contactName`/`contactPhone` ficam vazios nesse caso, nunca lança.
    const contact = freshBefore.contactId ? await deps.contactRepository.getById(freshBefore.contactId) : undefined;
    const recentMessages = await deps.messageRepository.listByConversation({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      limit: AI_CONTEXT_MESSAGE_LIMIT,
    });
    // `listByConversation` devolve mais recente primeiro — inverte para ordem cronológica antes
    // de montar o prompt (uma transcrição de trás pra frente confundiria o modelo).
    const chronological = [...recentMessages].reverse();

    // Fase 7 — chave de idempotência FINANCEIRA determinística: sempre a mesma para o mesmo lote
    // de mensagens reivindicadas, mesmo entre tentativas diferentes (reprocessamento após claim
    // expirado) — `claimed` já vem ordenado cronologicamente, e ordenar os ids de novo garante
    // determinismo mesmo que a ordem de claim varie entre tentativas.
    const idempotencyKey = `inbox_auto_reply:${claimed.map((message) => message.id).sort().join("+")}`;

    const result = await deps.aiResponder!.generateReply({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      contactName: contact?.name,
      contactPhone: contact?.phoneNormalized ?? "",
      recentMessages: chronological.map((message) => ({ direction: message.direction, body: message.body ?? "", sentByAi: message.sentByAi, createdAt: message.createdAt })),
      idempotencyKey,
    });

    if (!result.ok) {
      // Fase 6 — crédito insuficiente é uma falha DE NEGÓCIO, não operacional: nunca conta como
      // "IA quebrada" nos eventos/métricas de erro, tem seu próprio evento visível
      // (`ai_response_skipped_insufficient_credits`) e NUNCA desliga a IA/Inbox — a conversa
      // continua disponível para um humano responder normalmente. `"quota_exceeded"` é a mesma
      // categoria que `CreditGatedAiGateway` usa para tenant sem billing/suspenso/sem saldo (ver
      // `CreditAccountingService.checkAvailability` — todas essas colapsam nessa categoria).
      if (result.category === "quota_exceeded") {
        await resolveClaims(deps, claimed, "skipped");
        deps.metrics?.incAiSkippedInsufficientCredits();
        await deps.conversationEventRepository.record({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          conversationId: ctx.conversationId,
          type: "ai_response_skipped_insufficient_credits",
          performedBy: INBOX_AI_ACTOR,
          metadata: { inboundMessageIds: claimed.map((message) => message.id) },
        });
        return;
      }

      // Falha operacional controlada (timeout, provider indisponível, saída inválida...) — nunca
      // um retry automático ilimitado aqui (o próprio AI Gateway já tentou algumas vezes
      // internamente); a mensagem fica `failed`, disponível para atendimento manual, e a IA só
      // tenta de novo quando uma NOVA mensagem inbound chegar.
      await resolveClaims(deps, claimed, "failed");
      deps.metrics?.incAiFailure(result.category);
      await deps.conversationEventRepository.record({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        conversationId: ctx.conversationId,
        type: "ai_response_failed",
        performedBy: INBOX_AI_ACTOR,
        metadata: { inboundMessageIds: claimed.map((message) => message.id), errorCategory: result.category },
      });
      return;
    }

    // Race-check #2 — depois da chamada de IA, ANTES de persistir/enfileirar qualquer coisa
    // (requisito crítico da Fase 5): se um humano assumiu ENQUANTO a IA gerava, a resposta é
    // descartada aqui e NUNCA chega a entrar na fila outbound.
    const freshAfter = await deps.conversationRepository.getById(ctx.conversationId);
    if (!freshAfter || !isConversationEligibleForAi(freshAfter)) {
      await resolveClaims(deps, claimed, "skipped");
      deps.metrics?.incAiCancelled();
      await deps.conversationEventRepository.record({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        conversationId: ctx.conversationId,
        type: "ai_response_cancelled",
        performedBy: INBOX_AI_ACTOR,
        metadata: { inboundMessageIds: claimed.map((message) => message.id), reason: "human_took_over_during_generation" },
      });
      return;
    }

    // A partir daqui a resposta da IA passa pelo MESMO pipeline outbound de uma mensagem humana —
    // persiste `queued`, publica na fila, o `vorix-worker` drena e chama o `MessagingProvider`.
    // Nenhum código de IA jamais chama o provider/WuzAPI diretamente.
    const outbound = await sendInboxMessage(deps, { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, conversationId: ctx.conversationId, body: result.reply, sentByAi: true });
    await resolveClaims(deps, claimed, "answered", outbound.id);
    deps.metrics?.incAiReply();
    deps.metrics?.addAiCostUsd(result.usage.estimatedCost);
    deps.metrics?.observeAiLatencyMs(result.latencyMs);
    await deps.conversationEventRepository.record({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversationId,
      type: "ai_response_sent",
      performedBy: INBOX_AI_ACTOR,
      metadata: {
        inboundMessageIds: claimed.map((message) => message.id),
        outboundMessageId: outbound.id,
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        tokens: result.usage,
        estimatedCost: result.usage.estimatedCost,
        aiTraceId: result.traceId,
      },
    });
    // Volta ao topo do laço: drena qualquer mensagem nova que tenha chegado durante a geração —
    // é assim que várias mensagens consecutivas do mesmo contato viram UMA resposta coerente por
    // rodada em vez de N respostas paralelas desconexas, sem precisar de debounce/timer nenhum.
  }
}
