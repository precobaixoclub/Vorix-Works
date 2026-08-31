import type { InboxMediaStorageRef, InboxMessage, InboxMessageStatus, InboxMessageType } from "../../domain/inbox/inbox.model.js";

/** Módulo Conversas (Fase 1). Ver `db/migrations/0083_inbox_messages.sql`. */

export type CreateInboxMessageInput = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  connectionId: string;
  externalMessageId?: string;
  direction: InboxMessage["direction"];
  type: InboxMessageType;
  body?: string;
  mediaStorageRef?: InboxMediaStorageRef;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  status?: InboxMessageStatus;
  sentByUserId?: string;
  sentByAi?: boolean;
  sentByAutomation?: boolean;
};

export type InboxMessageRepositoryPort = {
  /**
   * Cria a mensagem. Para `direction: "inbound"` com `externalMessageId` preenchido, é
   * IDEMPOTENTE por `(connectionId, externalMessageId)` — uma segunda chamada com o mesmo par
   * retorna a linha já existente em vez de lançar/duplicar (ver `unique` na migration e
   * `insert ... on conflict do nothing` no adapter Postgres). Essencial porque eventos de fila
   * podem ser entregues mais de uma vez.
   *
   * `wasCreated` distingue "inseriu uma linha nova" de "reentrega, devolveu a linha existente" —
   * ACHADO AO VIVO (spike Fase 2): sem isso, `registerInboundMessage` incrementava
   * `unread_count`/`lastMessageAt` da conversa a cada reentrega do MESMO evento, mesmo a mensagem
   * em si sendo corretamente deduplicada. Todo chamador que atualiza estado derivado (contador de
   * não lidas, "última mensagem") deve checar `wasCreated` antes de agir.
   */
  create(input: CreateInboxMessageInput): Promise<{ message: InboxMessage; wasCreated: boolean }>;
  getById(id: string): Promise<InboxMessage | undefined>;
  listByConversation(input: { tenantId: string; workspaceId: string; conversationId: string; cursor?: string; limit?: number }): Promise<InboxMessage[]>;
  /** Usado pelo consumer de status (delivery/read receipts) e pelo `OutboxSenderConsumer`. Ignora
   * silenciosamente se a mensagem já estiver num status terminal — retries podem chegar tarde. */
  updateStatusByExternalId(input: { connectionId: string; externalMessageId: string; status: InboxMessageStatus; occurredAt: string }): Promise<void>;
  markSent(id: string, input: { externalMessageId: string; sentAt: string }): Promise<InboxMessage>;
  markFailed(id: string, input: { lastError: string; failedAt: string }): Promise<InboxMessage>;
  recordAttempt(id: string, input: { lastError?: string; lastAttemptAt: string }): Promise<void>;

  /**
   * Fase 5 — claim atômico (CAS) de "quem gera/envia a resposta de IA para esta mensagem
   * inbound". Só casa se `direction = 'inbound'` e `ai_claim_status is null`. `undefined` = já
   * reivindicada por outra execução (defesa em profundidade contra duas gerações para a mesma
   * mensagem — a defesa principal continua sendo `wasCreated` em `registerInboundMessage`).
   */
  tryClaimForAiResponse(id: string, claimedAt: string): Promise<InboxMessage | undefined>;
  /** Resolve um claim já feito (`processing` → `answered`/`skipped`/`failed`). `responseMessageId`
   * só é gravado quando `status === "answered"`. Nunca re-tenta automaticamente um claim
   * `failed`/`skipped` — a mensagem fica disponível só para atendimento manual. */
  resolveAiClaim(id: string, input: { status: "answered" | "skipped" | "failed"; responseMessageId?: string }): Promise<void>;
  /** Mensagens inbound de uma conversa ainda sem claim (`ai_claim_status is null`), ordem
   * cronológica ascendente — usado pelo drenador de IA para pegar tudo que se acumulou desde a
   * última rodada (ver `maybeGenerateAiResponse`). */
  listUnansweredInboundByConversation(input: { conversationId: string }): Promise<InboxMessage[]>;
};
