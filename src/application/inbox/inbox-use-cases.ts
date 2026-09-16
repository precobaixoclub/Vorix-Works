import type { InboxContact, InboxConversation, InboxConversationEvent, InboxMessage, MessagingConnection, MessagingConnectionStatus, MessagingProviderId } from "../../domain/inbox/inbox.model.js";
import { INBOX_AI_ACTOR, MESSAGING_CONNECTION_TERMINAL_STATUSES, normalizePhoneNumber } from "../../domain/inbox/inbox.model.js";
import type { KanbanPhaseType, TeamKanbanPhase } from "../../domain/identity/identity.model.js";
import { KANBAN_PHASE_TYPES } from "../../domain/identity/identity.model.js";
import type { OperationalCircuitBreaker, OperationalRateLimiter } from "../operations/operational-services.js";
import type { ChannelRoutingConfig, ChannelRoutingRepositoryPort } from "../ports/channel-routing-repository.port.js";
import type { ConversationServiceTime, ConversationTimeEntryRepositoryPort } from "../ports/inbox-conversation-time-entry-repository.port.js";
import type { InboxAiResponderPort } from "../ports/inbox-ai-responder.port.js";
import type { InboxContactRepositoryPort } from "../ports/inbox-contact-repository.port.js";
import type { InboxConversationEventRepositoryPort } from "../ports/inbox-conversation-event-repository.port.js";
import type { InboxConversationListFilter, InboxConversationListItem, InboxConversationRepositoryPort } from "../ports/inbox-conversation-repository.port.js";
import type { InboxIdentityLinkRepositoryPort } from "../ports/inbox-identity-link-repository.port.js";
import type { InboxMediaStoragePort } from "../ports/inbox-media-storage.port.js";
import type { InboxMessageRepositoryPort } from "../ports/inbox-message-repository.port.js";
import type { InboxMetricsRecorder } from "../ports/inbox-metrics.port.js";
import type { MessagingConnectionRepositoryPort } from "../ports/messaging-connection-repository.port.js";
import type { MessagingProvider, MessagingProviderErrorKind } from "../ports/messaging-provider.port.js";
import { MessagingProviderError } from "../ports/messaging-provider.port.js";
import type { OutboundMessageQueuePort } from "../ports/outbound-message-queue.port.js";
import type { TeamKanbanPhaseRepositoryPort } from "../ports/team-kanban-phase-repository.port.js";
import type { NotificationRepositoryPort } from "../ports/notification-repository.port.js";
import type { NotificationRealtimePublisherPort } from "../ports/notification-realtime-publisher.port.js";
import { notifyBestEffort } from "../notification/notification-use-cases.js";
import type { TeamMembershipRepositoryPort, TeamRepositoryPort } from "../ports/team-repository.port.js";
import type { WorkspaceRepositoryPort } from "../ports/workspace-repository.port.js";
import { recordFirstEvent, type ProductAnalyticsUseCaseDeps } from "../product-analytics/product-analytics-use-cases.js";
import { mustTeamBelongToTenantAndWorkspace, resolveNextTeamMember } from "../identity/team-use-cases.js";

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
  /** Instagram DM virou canal de primeira classe (pedido explícito do usuário) — o provider deixou
   * de ser um singleton global (WuzAPI era o único canal) e virou um registro POR CANAL, resolvido
   * a partir de `connection.provider` em cada chamada (`resolveProvider`, abaixo). `wuzapi` é
   * sempre obrigatório (o módulo inteiro depende dele); `instagram` é opcional — `undefined` nesse
   * processo faz `resolveProvider` lançar `INBOX_PROVIDER_NOT_CONFIGURED` só quando alguém tenta
   * de fato usar uma conexão Instagram, nunca afeta o WhatsApp. */
  providers: { wuzapi: MessagingProvider } & Partial<Record<Exclude<MessagingProviderId, "wuzapi">, MessagingProvider>>;
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
  /** Bloco "réplica de identidade" (ver docs do plano — inspirado no `IdentityLink` de outro
   * sistema do usuário). `undefined` = comportamento anterior a esta entrega (LID só resolve
   * telefone quando o `*Alt` vem NESTE evento específico, nunca persiste pra eventos futuros). */
  identityLinkRepository?: InboxIdentityLinkRepositoryPort;
  /** Trial + Product Analytics — integração MÍNIMA (`first_channel_connected`,
   * `first_conversation_received`, `first_conversation_replied`). Nenhuma regra de Conversas
   * muda por causa disto. */
  productAnalytics?: ProductAnalyticsUseCaseDeps;
  /** Bloco "roteamento por equipe" (réplica adaptada do CMDesk, pedido explícito do usuário) —
   * `undefined` = canal sem roteamento por equipe configurado neste processo; conversas novas
   * nunca ganham `currentTeamId`/atribuição automática nesse caso (comportamento anterior a esta
   * entrega, 100% preservado). */
  channelRoutingRepository?: ChannelRoutingRepositoryPort;
  teamRepository?: TeamRepositoryPort;
  teamMembershipRepository?: TeamMembershipRepositoryPort;
  /** Bloco "kanban de atendimento" (réplica adaptada do CMDesk, pedido explícito do usuário) —
   * `undefined` = módulo de kanban não configurado neste processo (mesmo racional dos deps de
   * roteamento por equipe acima). */
  teamKanbanPhaseRepository?: TeamKanbanPhaseRepositoryPort;
  conversationTimeEntryRepository?: ConversationTimeEntryRepositoryPort;
  /** Central de notificações in-app (réplica adaptada do CMDesk, pedido explícito do usuário) —
   * `undefined` = notificação desligada neste processo; `assignConversation` simplesmente não
   * notifica ninguém nesse caso (nunca bloqueia a atribuição em si). */
  notificationRepository?: NotificationRepositoryPort;
  notificationRealtimePublisher?: NotificationRealtimePublisherPort;
};

const defaultIdGenerator = () => `wuzsess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Resolve o adapter certo pra UMA conexão específica (Instagram DM virou canal de primeira
 * classe — pedido explícito do usuário). Nunca `deps.providers.wuzapi` direto fora daqui: todo
 * lugar que precisa falar com o canal de uma conversa/conexão passa por este resolver, pra nunca
 * disparar a chamada errada (ex.: pedir QR code pro adapter do Instagram). */
function resolveProvider(deps: InboxUseCaseDeps, provider: MessagingProviderId): MessagingProvider {
  const resolved = deps.providers[provider];
  if (!resolved) throw new Error(`INBOX_PROVIDER_NOT_CONFIGURED: canal "${provider}" não está configurado neste ambiente.`);
  return resolved;
}

async function mustConnectionBelongToTenantAndWorkspace(deps: InboxUseCaseDeps, id: string, tenantId: string, workspaceId: string): Promise<MessagingConnection> {
  const connection = await deps.connectionRepository.getById(id);
  if (!connection || connection.tenantId !== tenantId || connection.workspaceId !== workspaceId) {
    throw new Error(`INBOX_CONNECTION_NOT_FOUND: conexão "${id}" não existe.`);
  }
  return connection;
}

/**
 * Bloco "réplica de identidade" — segue o ponteiro de tombstone (`mergedIntoConversationId`)
 * quando o id pedido já foi fundido em outra conversa (ver `db/migrations/0118`). Sem isto,
 * qualquer ação (mandar mensagem, marcar como lida, assumir, transferir, fechar...) contra uma
 * conversa que acabou de ser fundida pelo reconciliador (ex.: usuário com a conversa "perdedora"
 * ainda aberta na tela no exato momento do merge) seria silenciosamente perdida — persistida contra
 * um id que nunca mais aparece em nenhuma listagem. Teto de 5 saltos só como cinto-e-suspensório
 * contra um ciclo malformado; na prática um merge nunca encadeia (o vencedor nunca é, ele mesmo,
 * marcado como perdedor de outro merge).
 */
async function mustConversationBelongToTenantAndWorkspace(deps: InboxUseCaseDeps, id: string, tenantId: string, workspaceId: string): Promise<InboxConversation> {
  let conversation = await deps.conversationRepository.getById(id);
  for (let hops = 0; conversation?.mergeStatus === "merged" && conversation.mergedIntoConversationId && hops < 5; hops += 1) {
    conversation = await deps.conversationRepository.getById(conversation.mergedIntoConversationId);
  }
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
  const { phoneNumber } = await resolveProvider(deps, "wuzapi").connect({ externalSessionId, instanceName: connection.id });
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
  const provider = resolveProvider(deps, connection.provider);
  await provider.connect({ externalSessionId: connection.externalSessionId, instanceName: connection.id });
  return provider.getQrCode({ externalSessionId: connection.externalSessionId });
}

export type RefreshConnectionStatusInput = { tenantId: string; workspaceId: string; connectionId: string };

/** Consulta o status real no gateway e reconcilia `messaging_connections` — mesma operação usada
 * pelo health monitor periódico (Fase 6), aqui exposta sob demanda para a UI. */
export async function refreshConnectionStatus(deps: InboxUseCaseDeps, input: RefreshConnectionStatusInput): Promise<MessagingConnection> {
  const connection = await mustConnectionBelongToTenantAndWorkspace(deps, input.connectionId, input.tenantId, input.workspaceId);
  if (!connection.externalSessionId) return connection;
  const status = await resolveProvider(deps, connection.provider).getConnectionStatus({ externalSessionId: connection.externalSessionId });
  return deps.connectionRepository.updateStatus(connection.id, { status: status.status, phoneNumber: status.phoneNumber, connectionHealth: "healthy" });
}

export type GetChannelRoutingInput = { tenantId: string; workspaceId: string; connectionId: string };
export type ChannelRoutingSnapshot = { teamIds: string[]; config?: ChannelRoutingConfig };

/** Bloco "roteamento por equipe" (réplica adaptada do CMDesk) — equipes vinculadas ao canal +
 * config de distribuição. `deps.channelRoutingRepository` ausente = módulo não configurado neste
 * processo, devolve lista vazia (nunca erro — mesmo racional de `inboxMediaStorage`/etc.). */
export async function getChannelRouting(deps: InboxUseCaseDeps, input: GetChannelRoutingInput): Promise<ChannelRoutingSnapshot> {
  await mustConnectionBelongToTenantAndWorkspace(deps, input.connectionId, input.tenantId, input.workspaceId);
  if (!deps.channelRoutingRepository) return { teamIds: [] };
  const [teamIds, config] = await Promise.all([
    deps.channelRoutingRepository.listTeamIdsByConnection(input.connectionId),
    deps.channelRoutingRepository.getRoutingConfig(input.connectionId),
  ]);
  return { teamIds, config };
}

export type UpdateChannelRoutingInput = {
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  /** Substituição TOTAL da lista de equipes vinculadas — mesmo idioma do CMDesk ("salvar canal"
   * sempre reescreve a lista inteira, nunca um patch incremental). */
  teamIds: string[];
  defaultTeamId: string;
  distributionMode: "default" | "round_robin";
};

/** `defaultTeamId` precisa estar entre `teamIds` — mesma trava do CMDesk (a UI só oferece as
 * equipes vinculadas no seletor, o backend reforça de novo aqui). */
export async function updateChannelRouting(deps: InboxUseCaseDeps, input: UpdateChannelRoutingInput): Promise<ChannelRoutingSnapshot> {
  await mustConnectionBelongToTenantAndWorkspace(deps, input.connectionId, input.tenantId, input.workspaceId);
  if (!deps.channelRoutingRepository) throw new Error("INBOX_TEAM_ROUTING_NOT_CONFIGURED: roteamento por equipe não está disponível neste ambiente.");
  if (!input.teamIds.includes(input.defaultTeamId)) {
    throw new Error("INBOX_DEFAULT_TEAM_NOT_LINKED: a equipe padrão precisa estar entre as equipes vinculadas ao canal.");
  }
  await deps.channelRoutingRepository.replaceLinkedTeams(input.connectionId, input.teamIds);
  const config = await deps.channelRoutingRepository.upsertRoutingConfig({ connectionId: input.connectionId, defaultTeamId: input.defaultTeamId, distributionMode: input.distributionMode });
  return { teamIds: input.teamIds, config };
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
    // Instagram (canal stateless, token OAuth) fica de fora deste monitor — "saúde do gateway" não
    // se aplica da mesma forma a uma API HTTP sem sessão pareada; a validade do token é checada sob
    // demanda no envio (`resolveProvider(deps, "instagram")`), nunca por um poll periódico aqui.
    if (connection.provider !== "wuzapi") continue;
    try {
      const status = await resolveProvider(deps, connection.provider).getConnectionStatus({ externalSessionId: connection.externalSessionId });
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
  if (connection.externalSessionId) await resolveProvider(deps, connection.provider).disconnect({ externalSessionId: connection.externalSessionId });
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

export type MarkConversationUnreadInput = { tenantId: string; workspaceId: string; conversationId: string };

/** Bloco "ler/não lida" (pedido explícito do usuário em produção) — marcação manual do atendente
 * pra voltar a chamar atenção pra uma conversa já lida, sem esperar mensagem nova. */
export async function markConversationUnread(deps: InboxUseCaseDeps, input: MarkConversationUnreadInput): Promise<void> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  await deps.conversationRepository.markUnread(conversation.id);
}

export type SetConversationUrgentInput = { tenantId: string; workspaceId: string; conversationId: string; isUrgent: boolean };

/** Bloco "urgente" (pedido explícito do usuário em produção: "criar uma opção de marcar como
 * urgente... onde fica um foguinho do lado da conversa") — marcação manual, liga/desliga. */
export async function setConversationUrgent(deps: InboxUseCaseDeps, input: SetConversationUrgentInput): Promise<InboxConversation> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  return deps.conversationRepository.setUrgent(conversation.id, input.isUrgent);
}

export type DeleteConversationInput = { tenantId: string; workspaceId: string; conversationId: string };

/**
 * Exclusão PERMANENTE de uma conversa (direta ou de grupo) — pedida explicitamente por um humano
 * (nunca automática, nunca parte do fluxo de merge de identidade, que usa tombstone/preserva
 * histórico). Mensagens e eventos cascateiam junto (FK `on delete cascade`, ver
 * `db/migrations/0083`/`0084`) — não há como recuperar depois desta chamada.
 */
export async function deleteConversation(deps: InboxUseCaseDeps, input: DeleteConversationInput): Promise<void> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  await deps.conversationRepository.delete(conversation.id);
}

export type DeleteInboxMessageInput = { tenantId: string; workspaceId: string; conversationId: string; messageId: string };

/**
 * Bloco "excluir mensagem" (pedido explícito do usuário em produção: "excluir uma mensagem que eu
 * queira") — sempre remove a mensagem do lado do Vorix (permanente, mesmo racional de
 * `deleteConversation`). Adicionalmente, para mensagens `direction: "outbound"` já confirmadas
 * pelo WhatsApp, tenta revogar de verdade ("apagar para todos") via `provider.revokeMessage` —
 * limitação REAL do protocolo (confirmada via `gh api` no código-fonte do WuzAPI/whatsmeow): só
 * funciona pra mensagens que O PRÓPRIO número conectado mandou, nunca mensagens de um
 * contato/participante (por isso nunca tentado para `direction: "inbound"`). Best-effort — uma
 * falha na revogação (mensagem antiga demais, sessão sem esta conversa, canal sem suporte) NUNCA
 * impede a exclusão local, que é a garantia principal deste caso de uso.
 */
export async function deleteInboxMessage(deps: InboxUseCaseDeps, input: DeleteInboxMessageInput): Promise<void> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  const message = await deps.messageRepository.getById(input.messageId);
  if (!message || message.conversationId !== conversation.id) {
    throw new Error(`INBOX_MESSAGE_NOT_FOUND: mensagem "${input.messageId}" não existe nesta conversa.`);
  }

  if (message.direction === "outbound" && message.externalMessageId) {
    try {
      const connection = await deps.connectionRepository.getById(conversation.connectionId);
      const provider = connection ? deps.providers[connection.provider] : undefined;
      if (connection?.externalSessionId && provider?.revokeMessage) {
        await provider.revokeMessage({ externalSessionId: connection.externalSessionId, to: conversation.externalChatId, externalMessageId: message.externalMessageId });
      }
    } catch (error) {
      console.warn(`[inbox] falha ao revogar mensagem "${message.id}" no WhatsApp (best-effort, exclusão local segue normalmente):`, error instanceof Error ? error.message : error);
    }
  }

  await deps.messageRepository.delete(input.messageId);
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

  // Central de notificações in-app — gatilho concreto (réplica adaptada do catálogo do CMDesk,
  // "serviço atribuído a alguém" vira "conversa atribuída a alguém" aqui). Só notifica quando o
  // NOVO responsável é de fato alguém (nunca no unassign) e é uma pessoa diferente de quem
  // executou a ação (ninguém precisa ser avisado de algo que a própria pessoa acabou de fazer).
  if (input.assignedUserId && input.assignedUserId !== input.performedBy) {
    const conversationLabel = conversation.groupName || "uma conversa";
    notifyBestEffort(deps, {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      userId: input.assignedUserId,
      title: "Conversa atribuída a você",
      body: `Você agora é responsável por ${conversationLabel}.`,
      sourceType: "inbox_conversation_assigned",
      sourceId: conversation.id,
      sourceUrl: `/workspaces/${input.workspaceId}/conversas?conversation=${conversation.id}`,
    });
  }

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

export type SetConversationTeamInput = { tenantId: string; workspaceId: string; conversationId: string; teamId: string | undefined; performedBy: string };

/**
 * Atribuição manual de equipe (achado de suporte: "por que as conversas não carregam no
 * Kanban" — antes desta função, `currentTeamId` só era setado automaticamente pelo roteamento por
 * canal em conversas NOVAS; sem canal roteado configurado — ou pra qualquer conversa já
 * existente antes da funcionalidade — não havia NENHUM jeito de colocar uma conversa numa equipe,
 * então o quadro Kanban ficava vazio pra sempre, mesmo com conversas de sobra). `teamId: undefined`
 * tira a conversa de qualquer equipe (some do quadro Kanban de novo).
 */
export async function setConversationTeam(deps: InboxUseCaseDeps, input: SetConversationTeamInput): Promise<InboxConversation> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  if (input.teamId) {
    await mustTeamBelongToTenantAndWorkspace(requireTeamDeps(deps), input.teamId, input.tenantId, input.workspaceId);
  }
  if (conversation.currentTeamId === input.teamId) return conversation;

  // Trocar (ou tirar) de equipe invalida a fase atual — ela pertence à equipe ANTERIOR; deixar
  // `currentPhaseId` apontando pra lá quebraria o board da equipe nova (`moveConversationPhase`
  // valida que a fase pertence à equipe atual da conversa antes de qualquer operação). Fecha
  // também o cronômetro aberto — mesmo racional de `transitionConversationStatus` saindo do board.
  if (conversation.currentTeamId && conversation.currentPhaseId && deps.conversationTimeEntryRepository) {
    await deps.conversationTimeEntryRepository.closeOpenEntry({ conversationId: conversation.id, teamId: conversation.currentTeamId }).catch((error) => {
      console.warn("[inbox] falha ao fechar cronômetro do kanban ao trocar de equipe (best-effort):", error instanceof Error ? error.message : error);
    });
    await deps.conversationRepository.setPhase(conversation.id, undefined);
  }

  return deps.conversationRepository.setTeam(conversation.id, input.teamId);
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

  // Kanban (achado de revisão) — sair do quadro (resolvida/arquivada) precisa fechar o cronômetro
  // aberto, senão reabrir a conversa depois conta o tempo "parada" como atendimento ativo na mesma
  // fase (o board só mostra status open/pending, ver `BOARD_STATUSES` no frontend). AWAIT (não
  // fire-and-forget como o evento de auditoria acima): isto afeta um NÚMERO reportado (tempo de
  // atendimento), não só uma trilha informativa — vale esperar terminar antes de devolver. Ainda
  // assim nunca desfaz a transição de status: erro aqui só gera um warning, sempre dentro de
  // try/catch — resolver/reabrir uma conversa é um fluxo sempre-precisa-funcionar, kanban é
  // infraestrutura opcional (ver `requireKanbanDeps`).
  const wasBoardVisible = conversation.status === "open" || conversation.status === "pending";
  const isBoardVisible = toStatus === "open" || toStatus === "pending";
  if (deps.teamKanbanPhaseRepository && deps.conversationTimeEntryRepository && conversation.currentTeamId && conversation.currentPhaseId) {
    const teamId = conversation.currentTeamId;
    const phaseId = conversation.currentPhaseId;
    try {
      if (wasBoardVisible && !isBoardVisible) {
        await deps.conversationTimeEntryRepository.closeOpenEntry({ conversationId: conversation.id, teamId });
      } else if (!wasBoardVisible && isBoardVisible) {
        const phase = await deps.teamKanbanPhaseRepository.getById(phaseId);
        if (phase) {
          await deps.conversationTimeEntryRepository.moveConversationPhase({
            tenantId: input.tenantId,
            conversationId: conversation.id,
            teamId,
            phaseId: phase.id,
            phaseType: phase.phaseType,
          });
        }
      }
    } catch (error) {
      console.warn("[inbox] falha ao sincronizar o cronômetro do kanban na transição de status (best-effort):", error instanceof Error ? error.message : error);
    }
  }

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

export type SendInboxMessageInput = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  body: string;
  sentByUserId?: string;
  sentByAi?: boolean;
  /** Bloco "responder mensagem específica" (pedido explícito do usuário em produção: "clicar para
   * reponder uma mensagem especifica") — id (do Vorix, nunca o `externalMessageId` do WhatsApp) da
   * mensagem sendo respondida, quando presente. */
  replyToMessageId?: string;
};

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

  // Bloco "responder mensagem específica" — snapshot gravado AGORA (mesmo padrão de
  // `InboxMessage.quotedMessage` já usado pra respostas RECEBIDAS, ver `registerInboundMessage`),
  // nunca resolvido de novo depois. Exige `externalMessageId` conhecido: sem ele não há como montar
  // o `ContextInfo.StanzaId` que o WuzAPI exige pra citar de verdade (ver `sendOutboundByType`)
  // — nunca finge uma citação que não vai aparecer de verdade pro contato.
  let quotedMessage: InboxMessage["quotedMessage"];
  if (input.replyToMessageId) {
    const target = await deps.messageRepository.getById(input.replyToMessageId);
    if (!target || target.conversationId !== conversation.id) {
      throw new Error(`INBOX_MESSAGE_NOT_FOUND: mensagem "${input.replyToMessageId}" não existe nesta conversa.`);
    }
    if (!target.externalMessageId) {
      throw new Error(`INBOX_QUOTED_MESSAGE_NOT_SENT_YET: mensagem "${input.replyToMessageId}" ainda não foi confirmada pelo WhatsApp — tente responder de novo em instantes.`);
    }
    // `Participant` (quem MANDOU a mensagem citada) é obrigatório junto de `StanzaId` no WuzAPI
    // (achado real, `gh api`/`validateMessageFields`) — em mensagem INBOUND já é `senderExternalId`;
    // numa mensagem OUTBOUND (respondendo à PRÓPRIA mensagem anterior do Vorix) não há
    // `senderExternalId` gravado (ver comentário em `InboxMessage`), então cai pro telefone da
    // própria conexão pareada.
    const participantJid = target.senderExternalId ?? (target.direction === "outbound" ? (await deps.connectionRepository.getById(conversation.connectionId))?.phoneNumber : undefined);
    quotedMessage = { externalMessageId: target.externalMessageId, senderId: participantJid, body: target.body, type: target.type };
  }

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
    quotedMessage,
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
  /** Bloco "resposta citada" (pedido explícito do usuário em produção) — presentes só quando esta
   * mensagem é uma resposta a outra (ver `wuzapi-event-mapper.ts`). */
  quotedExternalMessageId?: string;
  quotedSenderId?: string;
  quotedBody?: string;
  quotedType?: InboxMessage["type"];
  /** Bloco "menção em grupo" (pedido explícito do usuário) — JIDs crus mencionados no `body`
   * (`@<dígitos>`, ainda não resolvidos pro nome real da pessoa). */
  mentionedJids?: string[];
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
/**
 * Bloco "réplica de identidade" — resolve o pivô (telefone canônico) de UM chat direto, consultando
 * `inbox_identity_links` quando o evento atual não traz evidência forte (`chatPhoneE164`). Sem
 * isto, um LID visto de novo sem o `*Alt` recalcularia um pseudo-telefone diferente do já
 * resolvido antes, fragmentando o mesmo contato/conversa em dois (risco "PN/LID cruzado",
 * documentado em `docs/conversas-canonical-chat-identity.md`).
 *
 * Quando `chatPhoneE164` ESTÁ presente (evidência forte deste evento), grava/atualiza o link pra
 * `chatLid` (se houver) — nunca fica só no evento atual, fica disponível pra qualquer evento
 * futuro do mesmo LID, mesmo sem `*Alt` de novo.
 */
async function resolveInboundPivotPhone(deps: InboxUseCaseDeps, input: RegisterInboundMessageInput): Promise<string> {
  if (input.chatPhoneE164) {
    if (input.chatLid && deps.identityLinkRepository) {
      await deps.identityLinkRepository.upsert({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        lid: input.chatLid,
        phoneE164: input.chatPhoneE164,
        confidence: 100,
        source: "wuzapi_alt_field",
      });
    }
    return input.chatPhoneE164;
  }
  if (input.chatLid && deps.identityLinkRepository) {
    const link = await deps.identityLinkRepository.getByLid(input.workspaceId, input.chatLid);
    if (link) return link.phoneE164;
  }
  // Pivô degradado (documentado) — nenhuma evidência forte disponível, nem agora nem antes.
  return normalizePhoneNumber(input.chatId);
}

/**
 * Bloco "menção em grupo" (pedido explícito do usuário em produção: "quando marca uma pessoa em
 * um grupo... não esta funcionando corretamente") — o WhatsApp entrega o texto já com um
 * placeholder CRU (`@<dígitos-do-jid>`, nunca o nome da pessoa) e uma lista separada
 * (`mentionedJids`) dos JIDs de fato mencionados; é responsabilidade de quem exibe resolver isso
 * pro nome real. Substitui cada placeholder pelo nome do contato já conhecido (ou o telefone
 * normalizado, se o nome ainda não foi observado) — nunca lança, um JID que não resolve fica como
 * veio (melhor mostrar o número cru do que quebrar a mensagem inteira).
 */
async function resolveMentionsInBody(deps: InboxUseCaseDeps, input: { tenantId: string; workspaceId: string; body: string; mentionedJids: string[] }): Promise<string> {
  let body = input.body;
  for (const rawJid of input.mentionedJids) {
    const digits = rawJid.split("@")[0];
    if (!digits) continue;
    const placeholder = `@${digits}`;
    if (!body.includes(placeholder)) continue;

    let phoneE164: string | undefined;
    if (rawJid.endsWith("@lid") && deps.identityLinkRepository) {
      const link = await deps.identityLinkRepository.getByLid(input.workspaceId, `+${digits}`);
      phoneE164 = link?.phoneE164;
    } else if (rawJid.endsWith("@s.whatsapp.net")) {
      phoneE164 = `+${digits}`;
    }
    if (!phoneE164) continue; // LID sem link conhecido ainda — pivô degradado, mesmo racional do resto do módulo. Deixa o placeholder cru.

    const contact = await deps.contactRepository.findByPhone({ tenantId: input.tenantId, workspaceId: input.workspaceId, phoneNormalized: phoneE164 });
    body = body.split(placeholder).join(`@${contact?.name ?? phoneE164}`);
  }
  return body;
}

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
  let pivotPhone: string | undefined;
  if (!input.isGroup) {
    // Bloco "Identity UX" + "réplica de identidade" — telefone é o pivô CANÔNICO da pessoa,
    // resolvido com evidência forte (`chatPhoneE164` deste evento OU de um evento anterior do
    // mesmo LID, via `inbox_identity_links`); só cai pro LID-como-pseudo-telefone quando isso
    // nunca foi observado (pivô degradado, documentado — ver `resolveInboundPivotPhone` acima).
    pivotPhone = await resolveInboundPivotPhone(deps, input);
    contact = await deps.contactRepository.upsertByPhone({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      phoneNormalized: pivotPhone,
      // Self-echo nunca deveria sobrescrever o nome do CONTATO com o nome do próprio operador —
      // `PushName` num evento `fromMe` é o nome de quem mandou (o bot), não da pessoa do outro lado.
      name: input.fromMe ? undefined : input.senderName,
      whatsappPn: input.chatPn,
      whatsappLid: input.chatLid,
    });
  }

  let conversation = await deps.conversationRepository.findOrCreate({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    chatType: input.isGroup ? "group" : "direct",
    // Mesmo pivô resolvido acima (nunca recalculado separadamente) — garante que contato e
    // conversa convirjam pra identidade certa juntos, nunca um resolvido e o outro não.
    externalChatId: input.isGroup ? input.chatId : (pivotPhone ?? normalizePhoneNumber(input.chatId)),
    groupName: input.groupName,
    contactId: contact?.id,
  });
  // Bloco "roteamento por equipe" (réplica adaptada do CMDesk, pedido explícito do usuário) — só
  // decide UMA vez, na criação da conversa (nunca reavalia depois: uma vez atribuída, fica com
  // quem pegou, até uma transferência manual explícita). `createdAt === updatedAt` é o MESMO sinal
  // já usado acima pra "conversa acabou de nascer agora" — nunca refaz em reentregas/mensagens
  // seguintes da mesma conversa.
  if (!input.fromMe && conversation.createdAt === conversation.updatedAt && !conversation.currentTeamId && !conversation.assignedUserId) {
    conversation = await maybeRouteNewConversationToTeam(deps, conversation);
  }
  const resolvedBody = input.body && input.mentionedJids?.length
    ? await resolveMentionsInBody(deps, { tenantId: input.tenantId, workspaceId: input.workspaceId, body: input.body, mentionedJids: input.mentionedJids })
    : input.body;

  const { message, wasCreated } = await deps.messageRepository.create({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: conversation.id,
    connectionId: input.connectionId,
    externalMessageId: input.externalMessageId,
    direction: input.fromMe ? "outbound" : "inbound",
    type: input.type,
    body: resolvedBody,
    senderExternalId: input.senderId,
    senderDisplayName: input.senderName,
    senderPhoneE164: input.senderPn,
    // Bloco "resposta citada" — snapshot no momento da criação, nunca resolvido de novo depois
    // (ver `InboxMessage.quotedMessage`).
    quotedMessage: input.quotedExternalMessageId
      ? { externalMessageId: input.quotedExternalMessageId, senderId: input.quotedSenderId, body: input.quotedBody, type: input.quotedType }
      : undefined,
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

/**
 * Bloco "roteamento por equipe" (réplica adaptada do CMDesk) — chamado só na criação da conversa
 * (ver `registerInboundMessage`). Dois passos independentes, cada um best-effort na ausência de
 * config (nunca lança, nunca impede a mensagem de ser registrada): (1) resolve a EQUIPE do canal
 * (`ChannelRoutingRepositoryPort`); (2) se achou equipe e as duas dependências de round-robin
 * estão configuradas, resolve o PRÓXIMO AGENTE dentro dela. Uma equipe sem agente elegível
 * (`resolveNextTeamMember` devolve `undefined`) fica só com `currentTeamId`, sem
 * `assignedUserId` — mesmo fallback do CMDesk (conversa cai na equipe certa, mesmo sem dono).
 */
async function maybeRouteNewConversationToTeam(deps: InboxUseCaseDeps, conversation: InboxConversation): Promise<InboxConversation> {
  if (!deps.channelRoutingRepository) return conversation;
  try {
    const teamId = await deps.channelRoutingRepository.resolveTeamForNewConversation(conversation.connectionId);
    if (!teamId) return conversation;
    let updated = await deps.conversationRepository.setTeam(conversation.id, teamId);

    if (deps.teamRepository && deps.teamMembershipRepository) {
      const nextMember = await resolveNextTeamMember({ teamRepository: deps.teamRepository, teamMembershipRepository: deps.teamMembershipRepository }, { teamId });
      if (nextMember) updated = await deps.conversationRepository.assign(conversation.id, nextMember.userId);
    }
    return updated;
  } catch (error) {
    console.warn("[inbox] falha ao rotear conversa nova por equipe (best-effort, nunca bloqueia o registro da mensagem):", error instanceof Error ? error.message : error);
    return conversation;
  }
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
  const connection = await deps.connectionRepository.getById(input.connectionId);
  if (!connection?.externalSessionId) return { synced: false };
  const provider = deps.providers[connection.provider];
  if (!provider?.getGroupInfo) return { synced: false };
  const conversation = await deps.conversationRepository.getById(input.conversationId);
  if (!conversation || conversation.chatType !== "group") return { synced: false };
  // ACHADO AO VIVO (produção, pós-deploy da réplica de identidade) — `chatType: "group"` também é
  // usado pro Canal/Newsletter do WhatsApp (`@newsletter`), de propósito (ver
  // `wuzapi-event-mapper.ts`: "qualquer coisa que não seja pessoa vira group, nunca um telefone
  // fake") — mas um Canal NUNCA é um grupo de verdade pro protocolo: `whatsmeow.Client.GetGroupInfo`
  // só entende `@g.us`. Chamar isto com `@newsletter` trava até o WuzAPI desistir por timeout
  // ("info query timed out"), devolvendo um corpo de erro que nem é JSON — nunca uma falha
  // transitória que valha reprocessar. Guarda aqui, na fonte única de verdade, em vez de duplicar
  // a checagem em cada chamador.
  if (!conversation.externalChatId.endsWith("@g.us")) return { synced: false };

  const info = await provider.getGroupInfo({ externalSessionId: connection.externalSessionId, groupJid: conversation.externalChatId });
  if (!info) return { synced: false };
  await deps.conversationRepository.updateGroupMetadata(conversation.id, {
    groupName: info.name,
    participantCount: info.participantCount,
    metadataUpdatedAt: new Date().toISOString(),
  });
  return { synced: true };
}

export type SyncGroupPictureInput = { tenantId: string; workspaceId: string; connectionId: string; conversationId: string };

/**
 * Foto do grupo — pedido explícito do usuário em produção ("ajustar para carregar as fotos dos
 * grupos"). Mesmo racional/guardas de `syncGroupMetadata` (best-effort, nunca refaz se já
 * sincronizada, nunca chama pra Canal/Newsletter). Separado de `syncGroupMetadata` porque usa outro
 * endpoint do provider (`getProfilePicture`, não `getGroupInfo`) e pode falhar/suceder
 * independentemente (um grupo pode ter nome mas nunca ter definido uma foto, e vice-versa).
 */
export async function syncGroupPicture(deps: InboxUseCaseDeps, input: SyncGroupPictureInput): Promise<{ synced: boolean }> {
  if (!deps.inboxMediaStorage) return { synced: false };
  const connection = await deps.connectionRepository.getById(input.connectionId);
  if (!connection?.externalSessionId) return { synced: false };
  const provider = deps.providers[connection.provider];
  if (!provider?.getProfilePicture) return { synced: false };
  const conversation = await deps.conversationRepository.getById(input.conversationId);
  if (!conversation || conversation.chatType !== "group" || conversation.groupPictureStorageRef) return { synced: false };
  if (!conversation.externalChatId.endsWith("@g.us")) return { synced: false };

  const picture = await provider.getProfilePicture({ externalSessionId: connection.externalSessionId, jid: conversation.externalChatId });
  if (!picture) return { synced: false };

  const objectKey = `${input.tenantId}/${input.workspaceId}/avatar-group-${conversation.id}`;
  await deps.inboxMediaStorage.put({ key: objectKey, body: picture.body, contentType: picture.mimeType });
  await deps.conversationRepository.updateGroupPicture(conversation.id, {
    storageRef: { provider: "inbox-media", objectKey, metadata: { tenantId: input.tenantId } },
    syncedAt: new Date().toISOString(),
  });
  return { synced: true };
}

export type SyncContactProfilePictureInput = { tenantId: string; workspaceId: string; connectionId: string; contactId: string };

/**
 * Foto de perfil de um contato direto — mesmo racional de `syncGroupPicture`, para o outro lado do
 * chat (pessoa em vez de grupo). `jid` usado é `contact.phoneNormalized` (mesmo valor já usado como
 * `to` em `sendOutboundByType`/`conversation.externalChatId` — confirmado funcionando ao vivo pro
 * envio de mensagens, então o WuzAPI já sabe resolver esse formato).
 */
export async function syncContactProfilePicture(deps: InboxUseCaseDeps, input: SyncContactProfilePictureInput): Promise<{ synced: boolean }> {
  if (!deps.inboxMediaStorage) return { synced: false };
  const connection = await deps.connectionRepository.getById(input.connectionId);
  if (!connection?.externalSessionId) return { synced: false };
  const provider = deps.providers[connection.provider];
  if (!provider?.getProfilePicture) return { synced: false };
  const contact = await deps.contactRepository.getById(input.contactId);
  if (!contact || contact.profilePictureStorageRef) return { synced: false };

  const picture = await provider.getProfilePicture({ externalSessionId: connection.externalSessionId, jid: contact.phoneNormalized });
  if (!picture) return { synced: false };

  const objectKey = `${input.tenantId}/${input.workspaceId}/avatar-contact-${contact.id}`;
  await deps.inboxMediaStorage.put({ key: objectKey, body: picture.body, contentType: picture.mimeType });
  await deps.contactRepository.updateProfilePicture(contact.id, {
    storageRef: { provider: "inbox-media", objectKey, metadata: { tenantId: input.tenantId } },
    syncedAt: new Date().toISOString(),
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
  if (!deps.inboxMediaStorage) return { attached: false };
  const connection = await deps.connectionRepository.getById(input.connectionId);
  if (!connection?.externalSessionId) return { attached: false };
  const provider = deps.providers[connection.provider];
  if (!provider?.downloadMedia) return { attached: false };

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

  // Bloco "retry de mídia" (pedido explícito do usuário em produção) — grava o ref bruto ANTES da
  // tentativa em si (nunca depois): se `provider.downloadMedia` falhar por qualquer motivo
  // transitório (rede instável, WuzAPI reiniciando no meio), o reconciliador periódico
  // (`reconcilePendingMediaDownloads`) ainda tem como tentar de novo mais tarde, em vez de perder a
  // única chance de baixar essa mídia pra sempre.
  await deps.messageRepository.attachMediaSourceRef(input.messageId, {
    url: input.mediaUrl, directPath: input.mediaDirectPath, mediaKey: input.mediaKey, mimeType: input.mimeType,
    fileSha256: input.fileSha256, fileEncSha256: input.fileEncSha256, fileSizeBytes: input.fileSizeBytes,
    fileName: input.fileName, durationSeconds: input.durationSeconds, thumbnailBase64: input.thumbnailBase64,
  });

  const downloaded = await provider.downloadMedia({
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

export type ApplyMessageReactionInput = {
  connectionId: string;
  targetExternalMessageId: string;
  emoji: string;
  reactorId: string;
  reactorName?: string;
};

/**
 * Bloco "reações" (pedido explícito do usuário em produção: "ajuste tambem para quando alguem
 * reagir a uma mensagem") — usado pelo consumer de `inbox.reaction.queue`. NUNCA cria uma mensagem
 * nova (uma reação é uma atualização de uma mensagem já existente — ver `mapReactionMessage`,
 * `wuzapi-event-mapper.ts`). `undefined` (mensagem-alvo não encontrada) é um resultado normal, não
 * um erro: a mensagem reagida pode ter sido apagada por retenção, ou pertencer a um período antes
 * do Vorix começar a rastrear esta conversa — nunca lança, quem chama só decide se publica ou não
 * uma notificação de tempo real.
 */
export async function applyMessageReaction(deps: InboxUseCaseDeps, input: ApplyMessageReactionInput): Promise<{ applied: boolean; conversationId?: string; tenantId?: string; workspaceId?: string }> {
  const message = await deps.messageRepository.findByExternalId({ connectionId: input.connectionId, externalMessageId: input.targetExternalMessageId });
  if (!message) return { applied: false };
  await deps.messageRepository.setReaction(message.id, { reactorId: input.reactorId, reactorName: input.reactorName, emoji: input.emoji });
  return { applied: true, conversationId: message.conversationId, tenantId: message.tenantId, workspaceId: message.workspaceId };
}

export type ReactToInboxMessageInput = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  /** `""` remove a reação já mandada pelo atendente. */
  emoji: string;
  reactorId: string;
  reactorName?: string;
};

/**
 * Bloco "reagir a uma mensagem" (pedido explícito do usuário em produção: "reagir com emoji a uma
 * mensagem especifica") — o ATENDENTE reagindo de dentro do Vorix (distinto de `applyMessageReaction`,
 * que aplica uma reação que JÁ chegou de um contato/participante via WuzAPI). Chama o provider
 * PRIMEIRO — se a reação não sai de verdade pro WhatsApp, nunca grava localmente (mostraria um
 * badge de reação que ninguém do outro lado realmente vê, uma mentira visual).
 */
export async function reactToInboxMessage(deps: InboxUseCaseDeps, input: ReactToInboxMessageInput): Promise<InboxMessage> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  const message = await deps.messageRepository.getById(input.messageId);
  if (!message || message.conversationId !== conversation.id) {
    throw new Error(`INBOX_MESSAGE_NOT_FOUND: mensagem "${input.messageId}" não existe nesta conversa.`);
  }
  if (!message.externalMessageId) {
    throw new Error(`INBOX_MESSAGE_NOT_SENT_YET: mensagem "${input.messageId}" ainda não foi confirmada pelo WhatsApp.`);
  }
  const connection = await deps.connectionRepository.getById(conversation.connectionId);
  if (!connection?.externalSessionId) throw new MessagingProviderError("transient", `Conexão "${conversation.connectionId}" sem sessão ativa no gateway.`);
  const provider = resolveProvider(deps, connection.provider);
  if (!provider.sendReaction) {
    throw new Error("INBOX_REACTION_NOT_SUPPORTED: este canal não suporta reações enviadas pelo Vorix.");
  }

  // `Participant` só faz sentido (e só é honrado pelo WuzAPI) reagindo à mensagem de OUTRO
  // participante dentro de um GRUPO — nunca numa conversa direta, nunca reagindo à própria
  // mensagem (ver achado real documentado em `WuzApiClient.sendReaction`).
  const fromMe = message.direction === "outbound";
  const participantJid = !fromMe && conversation.chatType === "group" ? message.senderExternalId : undefined;

  await provider.sendReaction({
    externalSessionId: connection.externalSessionId,
    to: conversation.externalChatId,
    externalMessageId: message.externalMessageId,
    emoji: input.emoji,
    fromMe,
    participantJid,
  });
  await deps.messageRepository.setReaction(input.messageId, { reactorId: input.reactorId, reactorName: input.reactorName, emoji: input.emoji });
  const updated = await deps.messageRepository.getById(input.messageId);
  if (!updated) throw new Error(`INBOX_MESSAGE_NOT_FOUND: mensagem "${input.messageId}" não existe nesta conversa.`);
  return updated;
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
  input: { provider: MessagingProvider; externalSessionId: string; to: string; message: InboxMessage },
): Promise<{ externalMessageId: string }> {
  const { message, provider } = input;
  if (message.type === "text") {
    // Bloco "responder mensagem específica" — `quotedMessage` já é o mesmo snapshot usado pra
    // exibir respostas RECEBIDAS (ver `registerInboundMessage`); aqui, reaproveitado pra CONSTRUIR
    // o `ContextInfo` real que o WuzAPI espera (achado via `gh api`, `handlers.go SendMessage()`).
    const replyTo = message.quotedMessage?.externalMessageId
      ? { externalMessageId: message.quotedMessage.externalMessageId, participantJid: message.quotedMessage.senderId, quotedText: message.quotedMessage.body }
      : undefined;
    return provider.sendText({ externalSessionId: input.externalSessionId, to: input.to, body: message.body ?? "", replyTo });
  }
  if (!deps.inboxMediaStorage) throw new MessagingProviderError("permanent", "Envio de mídia sem storage configurado neste processo.");
  if (!message.mediaStorageRef) throw new MessagingProviderError("permanent", `Mensagem "${message.id}" do tipo "${message.type}" sem mediaStorageRef — nada pra enviar.`);
  const stored = await deps.inboxMediaStorage.get(message.mediaStorageRef.objectKey);
  if (!stored) throw new MessagingProviderError("permanent", `Mídia da mensagem "${message.id}" não encontrada no storage.`);
  const dataUri = `data:${stored.contentType};base64,${stored.body.toString("base64")}`;

  if (message.type === "image") return provider.sendImage({ externalSessionId: input.externalSessionId, to: input.to, mediaUrl: dataUri, caption: message.body });
  if (message.type === "audio") return provider.sendAudio({ externalSessionId: input.externalSessionId, to: input.to, mediaUrl: dataUri });
  if (message.type === "video") return provider.sendVideo({ externalSessionId: input.externalSessionId, to: input.to, mediaUrl: dataUri, caption: message.body });
  if (message.type === "document") {
    const fileName = (message.metadata?.fileName as string | undefined) ?? "documento";
    return provider.sendDocument({ externalSessionId: input.externalSessionId, to: input.to, mediaUrl: dataUri, fileName });
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
    const result = await sendOutboundByType(deps, { provider: resolveProvider(deps, connection.provider), externalSessionId: connection.externalSessionId, to: conversation.externalChatId, message });
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

// ============================================================================================
// Bloco "kanban de atendimento" (réplica adaptada do CMDesk, pedido explícito do usuário: "criar
// uma kanban de atendimento dentro do VORIX onde eu consigo controlar as conversas por fases
// igual no CMDESK"). Quadro estilo Trello POR EQUIPE — cada coluna é uma `TeamKanbanPhase`, cada
// card é uma `InboxConversation`. Fora de escopo desta rodada (marcado como opcional no próprio
// guia do usuário): motor de automação por fase (SEND_MESSAGE/MOVE_PHASE automático) e a
// varredura de "ciclo obsoleto" (depende de `AttendanceSession`, que o Vorix não tem).
// ============================================================================================

function requireKanbanDeps(deps: InboxUseCaseDeps): { teamKanbanPhaseRepository: TeamKanbanPhaseRepositoryPort; conversationTimeEntryRepository: ConversationTimeEntryRepositoryPort } {
  if (!deps.teamKanbanPhaseRepository || !deps.conversationTimeEntryRepository) {
    throw new Error("INBOX_KANBAN_NOT_CONFIGURED: quadro de atendimento não está disponível neste ambiente.");
  }
  return { teamKanbanPhaseRepository: deps.teamKanbanPhaseRepository, conversationTimeEntryRepository: deps.conversationTimeEntryRepository };
}

function requireTeamDeps(deps: InboxUseCaseDeps): { teamRepository: TeamRepositoryPort; teamMembershipRepository: TeamMembershipRepositoryPort } {
  if (!deps.teamRepository || !deps.teamMembershipRepository) {
    throw new Error("INBOX_KANBAN_NOT_CONFIGURED: quadro de atendimento não está disponível neste ambiente.");
  }
  return { teamRepository: deps.teamRepository, teamMembershipRepository: deps.teamMembershipRepository };
}

async function mustKanbanPhaseBelongToTeam(deps: InboxUseCaseDeps, phaseId: string, teamId: string): Promise<TeamKanbanPhase> {
  const { teamKanbanPhaseRepository } = requireKanbanDeps(deps);
  const phase = await teamKanbanPhaseRepository.getById(phaseId);
  if (!phase || phase.teamId !== teamId) throw new Error(`KANBAN_PHASE_NOT_FOUND: fase "${phaseId}" não existe nesta equipe.`);
  return phase;
}

/** Mesmas 3 fases padrão do CMDesk (seção 4.1 do guia do usuário) — nomes/ordem/tipo idênticos. */
const DEFAULT_KANBAN_PHASES: { name: string; isDefaultFirst: boolean; phaseType: KanbanPhaseType }[] = [
  { name: "Novos", isDefaultFirst: true, phaseType: "RUNNING" },
  { name: "Em atendimento", isDefaultFirst: false, phaseType: "RUNNING" },
  { name: "Aguardando retorno", isDefaultFirst: false, phaseType: "PAUSED" },
];

/** Criação PREGUIÇOSA — nunca no `createTeam`, só na primeira vez que qualquer operação de fase
 * roda pra uma equipe (seção 4.1/seção 7.6 do guia do usuário: "não precisa de migration/seed
 * manual"). Chamado no início de toda função pública de fase abaixo. */
async function ensureDefaultKanbanPhases(deps: InboxUseCaseDeps, input: { tenantId: string; teamId: string }): Promise<void> {
  const { teamKanbanPhaseRepository } = requireKanbanDeps(deps);
  const count = await teamKanbanPhaseRepository.countByTeam(input.teamId);
  if (count > 0) return;
  await teamKanbanPhaseRepository.createMany(
    DEFAULT_KANBAN_PHASES.map((phase, index) => ({
      tenantId: input.tenantId,
      teamId: input.teamId,
      name: phase.name,
      orderIndex: index,
      isDefaultFirst: phase.isDefaultFirst,
      phaseType: phase.phaseType,
    })),
  );
}

export type ListKanbanPhasesInput = { teamId: string; tenantId: string; workspaceId: string };

export async function listKanbanPhases(deps: InboxUseCaseDeps, input: ListKanbanPhasesInput): Promise<TeamKanbanPhase[]> {
  const { teamKanbanPhaseRepository } = requireKanbanDeps(deps);
  await mustTeamBelongToTenantAndWorkspace(requireTeamDeps(deps), input.teamId, input.tenantId, input.workspaceId);
  await ensureDefaultKanbanPhases(deps, { tenantId: input.tenantId, teamId: input.teamId });
  return teamKanbanPhaseRepository.listByTeam(input.teamId);
}

export type CreateKanbanPhaseInput = { teamId: string; tenantId: string; workspaceId: string; name: string; phaseType?: KanbanPhaseType };

export async function createKanbanPhase(deps: InboxUseCaseDeps, input: CreateKanbanPhaseInput): Promise<TeamKanbanPhase> {
  const { teamKanbanPhaseRepository } = requireKanbanDeps(deps);
  await mustTeamBelongToTenantAndWorkspace(requireTeamDeps(deps), input.teamId, input.tenantId, input.workspaceId);
  await ensureDefaultKanbanPhases(deps, { tenantId: input.tenantId, teamId: input.teamId });
  const existing = await teamKanbanPhaseRepository.listByTeam(input.teamId);
  const nextOrderIndex = existing.length > 0 ? Math.max(...existing.map((phase) => phase.orderIndex)) + 1 : 0;
  return teamKanbanPhaseRepository.create({ tenantId: input.tenantId, teamId: input.teamId, name: input.name, phaseType: input.phaseType, orderIndex: nextOrderIndex });
}

export type UpdateKanbanPhaseInput = {
  teamId: string;
  phaseId: string;
  tenantId: string;
  workspaceId: string;
  name?: string;
  isDefaultFirst?: boolean;
  phaseType?: KanbanPhaseType;
  naoContabilizaOperacional?: boolean;
};

/** Exatamente uma fase padrão por equipe — desmarca as outras ANTES de marcar esta (seção 1.5/7.3
 * do guia do usuário: "ao marcar uma nova, desmarque todas as outras da mesma equipe"). */
export async function updateKanbanPhase(deps: InboxUseCaseDeps, input: UpdateKanbanPhaseInput): Promise<TeamKanbanPhase> {
  const { teamKanbanPhaseRepository } = requireKanbanDeps(deps);
  await mustTeamBelongToTenantAndWorkspace(requireTeamDeps(deps), input.teamId, input.tenantId, input.workspaceId);
  await mustKanbanPhaseBelongToTeam(deps, input.phaseId, input.teamId);
  if (input.isDefaultFirst === true) await teamKanbanPhaseRepository.clearDefaultFirst(input.teamId, input.phaseId);
  return teamKanbanPhaseRepository.update(input.phaseId, {
    name: input.name,
    isDefaultFirst: input.isDefaultFirst,
    phaseType: input.phaseType,
    naoContabilizaOperacional: input.naoContabilizaOperacional,
  });
}

export type DeleteKanbanPhaseInput = { teamId: string; phaseId: string; tenantId: string; workspaceId: string };

/** Bloqueado se restar só 1 fase (seção 4.4/7.4 do guia do usuário). Migra os cards da fase
 * excluída pro fallback (padrão da equipe > primeira por ordem > qualquer outra) e reindexa as
 * fases restantes (fecha os buracos de `orderIndex`) — mesmo algoritmo documentado. */
export async function deleteKanbanPhase(deps: InboxUseCaseDeps, input: DeleteKanbanPhaseInput): Promise<void> {
  const { teamKanbanPhaseRepository } = requireKanbanDeps(deps);
  await mustTeamBelongToTenantAndWorkspace(requireTeamDeps(deps), input.teamId, input.tenantId, input.workspaceId);
  const target = await mustKanbanPhaseBelongToTeam(deps, input.phaseId, input.teamId);
  const phases = await teamKanbanPhaseRepository.listByTeam(input.teamId);
  if (phases.length <= 1) throw new Error("KANBAN_LAST_PHASE: é necessário manter ao menos uma fase.");

  const fallback =
    phases.find((phase) => phase.id !== input.phaseId && phase.isDefaultFirst) ??
    phases.find((phase) => phase.id !== input.phaseId && phase.orderIndex === 0) ??
    phases.find((phase) => phase.id !== input.phaseId);
  if (!fallback) throw new Error("KANBAN_LAST_PHASE: é necessário manter ao menos uma fase.");

  await teamKanbanPhaseRepository.deleteWithFallback(input.phaseId, fallback.id);
  if (target.isDefaultFirst) await teamKanbanPhaseRepository.update(fallback.id, { isDefaultFirst: true });

  const remaining = await teamKanbanPhaseRepository.listByTeam(input.teamId);
  await teamKanbanPhaseRepository.reorder(input.teamId, remaining.map((phase) => phase.id));
}

export type ReorderKanbanPhasesInput = { teamId: string; tenantId: string; workspaceId: string; phaseIds: string[] };

/** A lista precisa conter TODAS as fases da equipe, exatamente uma vez cada — nunca um reorder
 * parcial (mesmo racional do "salvar canal" já usado em `updateChannelRouting`: substituição
 * total, nunca patch incremental). */
export async function reorderKanbanPhases(deps: InboxUseCaseDeps, input: ReorderKanbanPhasesInput): Promise<TeamKanbanPhase[]> {
  const { teamKanbanPhaseRepository } = requireKanbanDeps(deps);
  await mustTeamBelongToTenantAndWorkspace(requireTeamDeps(deps), input.teamId, input.tenantId, input.workspaceId);
  const existing = await teamKanbanPhaseRepository.listByTeam(input.teamId);
  const existingIds = new Set(existing.map((phase) => phase.id));
  if (input.phaseIds.length !== existing.length || !input.phaseIds.every((id) => existingIds.has(id))) {
    throw new Error("KANBAN_REORDER_MISMATCH: a lista precisa conter exatamente todas as fases da equipe, uma vez cada.");
  }
  await teamKanbanPhaseRepository.reorder(input.teamId, input.phaseIds);
  return teamKanbanPhaseRepository.listByTeam(input.teamId);
}

export type MoveConversationPhaseInput = { teamId: string; conversationId: string; tenantId: string; workspaceId: string; phaseId: string; performedBy: string };

/**
 * O ALGORITMO CENTRAL do kanban (seção 4.2 do guia do usuário) — o lock+transação de verdade vive
 * inteiro no adapter Postgres (`ConversationTimeEntryRepositoryPort.moveConversationPhase`); esta
 * função só valida (equipe/conversa/fase pertencem ao tenant/workspace certo, e a conversa
 * REALMENTE pertence à equipe deste quadro — adaptação ao Vorix: like o CMDesk documenta,
 * `current_team_id` é a equipe DONA da conversa agora, uma conversa nunca pode ter uma fase de
 * uma equipe que não é a sua atual) e registra o evento de auditoria (fire-and-forget, fora do
 * caminho crítico — mesmo racional de `logPhaseChangedActivity` no guia do usuário).
 */
export async function moveConversationPhase(deps: InboxUseCaseDeps, input: MoveConversationPhaseInput): Promise<InboxConversation> {
  const { conversationTimeEntryRepository } = requireKanbanDeps(deps);
  await mustTeamBelongToTenantAndWorkspace(requireTeamDeps(deps), input.teamId, input.tenantId, input.workspaceId);
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  if (conversation.currentTeamId !== input.teamId) {
    throw new Error("KANBAN_CONVERSATION_NOT_IN_TEAM: esta conversa não pertence à equipe deste quadro.");
  }
  const targetPhase = await mustKanbanPhaseBelongToTeam(deps, input.phaseId, input.teamId);
  const fromPhaseId = conversation.currentPhaseId;

  await conversationTimeEntryRepository.moveConversationPhase({
    tenantId: input.tenantId,
    conversationId: conversation.id,
    teamId: input.teamId,
    phaseId: targetPhase.id,
    phaseType: targetPhase.phaseType,
  });

  deps.conversationEventRepository
    .record({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
      type: "kanban_phase_changed",
      performedBy: input.performedBy,
      metadata: { fromPhaseId, toPhaseId: targetPhase.id, toPhaseName: targetPhase.name },
    })
    .catch((error) => {
      console.warn("[inbox] falha ao registrar evento de mudança de fase (best-effort, nunca desfaz a mudança):", error instanceof Error ? error.message : error);
    });

  const updated = await deps.conversationRepository.getById(conversation.id);
  if (!updated) throw new Error(`INBOX_CONVERSATION_NOT_FOUND: conversa "${conversation.id}" não existe.`);
  return updated;
}

export type EnsureConversationPhaseStatesInput = { teamId: string; tenantId: string; workspaceId: string; conversationIds: readonly string[] };

/**
 * Seção 4.3 do guia do usuário — chamado quando o board é aberto, pra conversas que já pertencem
 * à equipe (`currentTeamId`) mas ainda não têm `currentPhaseId` (conversa nova recém-roteada, ou
 * primeira vez que o board desta equipe é aberto). Idempotente: nunca mexe em quem já tem fase.
 */
export async function ensureConversationPhaseStates(deps: InboxUseCaseDeps, input: EnsureConversationPhaseStatesInput): Promise<void> {
  const { teamKanbanPhaseRepository, conversationTimeEntryRepository } = requireKanbanDeps(deps);
  await mustTeamBelongToTenantAndWorkspace(requireTeamDeps(deps), input.teamId, input.tenantId, input.workspaceId);
  await ensureDefaultKanbanPhases(deps, { tenantId: input.tenantId, teamId: input.teamId });
  if (input.conversationIds.length === 0) return;

  const phases = await teamKanbanPhaseRepository.listByTeam(input.teamId);
  const firstPhase = phases.find((phase) => phase.isDefaultFirst) ?? phases[0];
  if (!firstPhase) return;

  for (const conversationId of input.conversationIds) {
    const conversation = await deps.conversationRepository.getById(conversationId);
    if (!conversation || conversation.tenantId !== input.tenantId || conversation.currentTeamId !== input.teamId) continue;
    if (!conversation.currentPhaseId) {
      await deps.conversationRepository.setPhase(conversationId, firstPhase.id);
    }
    await conversationTimeEntryRepository.openFirstIfMissing({
      tenantId: input.tenantId,
      conversationId,
      teamId: input.teamId,
      phaseId: conversation.currentPhaseId ?? firstPhase.id,
      phaseType: (phases.find((phase) => phase.id === (conversation.currentPhaseId ?? firstPhase.id)) ?? firstPhase).phaseType,
    });
  }
}

export type GetConversationsServiceTimeInput = { teamId: string; tenantId: string; workspaceId: string; conversationIds: readonly string[] };

/** Seção 4.6 do guia do usuário — simplificado (Vorix não tem horário comercial por equipe ainda,
 * ver relatório de canal/equipe): `isRunning = phaseType !== "PAUSED"` da entrada aberta, sem gate
 * de expediente. O frontend incrementa visualmente via `setInterval` local (seção 5.3) — este
 * endpoint NUNCA é chamado a cada segundo. */
export async function getConversationsServiceTime(deps: InboxUseCaseDeps, input: GetConversationsServiceTimeInput): Promise<ConversationServiceTime[]> {
  const { conversationTimeEntryRepository } = requireKanbanDeps(deps);
  await mustTeamBelongToTenantAndWorkspace(requireTeamDeps(deps), input.teamId, input.tenantId, input.workspaceId);
  return conversationTimeEntryRepository.getServiceTimeBulk({ tenantId: input.tenantId, teamId: input.teamId, conversationIds: input.conversationIds });
}

export type SetConversationPinnedInput = { conversationId: string; tenantId: string; workspaceId: string; pinned: boolean };

export async function setConversationPinned(deps: InboxUseCaseDeps, input: SetConversationPinnedInput): Promise<InboxConversation> {
  const conversation = await mustConversationBelongToTenantAndWorkspace(deps, input.conversationId, input.tenantId, input.workspaceId);
  return deps.conversationRepository.setPinned(conversation.id, input.pinned);
}
