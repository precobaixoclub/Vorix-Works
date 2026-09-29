import type { MessagingConnection, MessagingConnectionStatus, MessagingProviderId } from "../../domain/inbox/inbox.model.js";

/** Módulo Conversas (Fase 1). Ver `db/migrations/0080_messaging_connections.sql`. */

export type CreateMessagingConnectionInput = {
  tenantId: string;
  workspaceId: string;
  provider: MessagingProviderId;
  displayName: string;
};

export type UpdateMessagingConnectionStatusInput = {
  status: MessagingConnectionStatus;
  connectionHealth?: "healthy" | "degraded" | "unknown" | "gateway_unavailable";
  externalSessionId?: string;
  phoneNumber?: string;
  incrementReconnectCount?: boolean;
};

export type MessagingConnectionRepositoryPort = {
  create(input: CreateMessagingConnectionInput): Promise<MessagingConnection>;
  getById(id: string): Promise<MessagingConnection | undefined>;
  /** Achado necessário pro Instagram virar canal de primeira classe — diferente do WhatsApp
   * (pareado via QR, 1 conexão criada manualmente pelo usuário), uma conexão Instagram é
   * encontrada/criada de forma IDEMPOTENTE a partir do `instagramBusinessAccountId` que chega em
   * todo evento de webhook (nunca duplica conexão a cada mensagem recebida). */
  getByProviderAndExternalSessionId(provider: MessagingProviderId, externalSessionId: string): Promise<MessagingConnection | undefined>;
  listByWorkspace(input: { tenantId: string; workspaceId: string }): Promise<MessagingConnection[]>;
  /** Usado pelo worker/health monitor, que só tem `connectionId` (sem tenant/workspace) vindo do
   * evento de fila — nunca exposto a uma rota HTTP. */
  listAllActive(): Promise<MessagingConnection[]>;
  updateStatus(id: string, input: UpdateMessagingConnectionStatusInput): Promise<MessagingConnection>;
  /** Exclusão de canal (pedido explícito do usuário) — permanente, cascateia conversas/mensagens/
   * eventos/tags/roteamento (`db/migrations/0082`/`0083`/`0084`/`0123`/`0129`, todos `on delete
   * cascade` a partir de `messaging_connections`). NUNCA cascateia `inbox_contacts` (não é FK
   * direta — ver `deleteConnection` em `inbox-use-cases.ts` pra limpeza de contato órfão) nem CRM
   * (`contacts`/`deals`/`tasks`/`proposals`, sem FK nenhuma vinda daqui). Pode lançar um erro de
   * violação de FK (`23503`) se existir `proposal_deliveries` vinculada a uma conversa deste canal
   * (`on delete restrict` de propósito — nunca apagar histórico de entrega de proposta em
   * silêncio); `deleteConnection` traduz isso pra uma mensagem clara antes de propagar. */
  delete(id: string): Promise<void>;
  touchEvent(id: string, at: string): Promise<void>;
  touchHeartbeat(id: string, at: string): Promise<void>;
  /**
   * Fase 6 — resultado de UMA checagem do monitor de saúde periódico. Sempre sobrescreve
   * `connectionHealth`/`lastConnectionError` (nunca `coalesce` — uma checagem bem-sucedida DEVE
   * limpar um erro anterior, `lastConnectionError: undefined`). Separado de `updateStatus`
   * (que é sobre o STATUS da sessão, escrito por eventos de fila/ações do usuário) porque as duas
   * fontes de verdade são independentes: o gateway pode estar saudável com a sessão desconectada,
   * ou o gateway pode estar inalcançável mesmo com a última sessão conhecida "connected".
   */
  recordHealthCheck(id: string, input: { connectionHealth: "healthy" | "degraded" | "unknown" | "gateway_unavailable"; lastConnectionError?: string; at: string }): Promise<MessagingConnection | undefined>;
};
