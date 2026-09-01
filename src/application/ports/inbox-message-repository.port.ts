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
  /**
   * Fase 7 — achado de auditoria (bug crítico): claim atômico (CAS `queued` → `sending`) que
   * `processOutboundMessage` DEVE adquirir imediatamente antes de chamar `provider.sendText`.
   * `undefined` = perdeu a corrida (outra execução concorrente já está enviando, ou a mensagem já
   * não está mais `queued`) — quem chamou NUNCA deve chamar o provider nesse caso. Sem este claim,
   * um crash do worker exatamente entre `provider.sendText()` suceder e `markSent()` commitar
   * deixava a mensagem em `queued`; a reentrega (mesmo `messageId`, via redelivery do RabbitMQ)
   * reprocessava do zero e enviava a MESMA mensagem ao WhatsApp uma segunda vez — duplicidade real,
   * irreversível e visível ao cliente. Com o claim, essa reentrega encontra `status = 'sending'`
   * (não `queued`) e é tratada como estado ambíguo (nunca reenviada — ver `processOutboundMessage`).
   */
  tryMarkSending(id: string): Promise<InboxMessage | undefined>;
  /** Reverte `sending` → `queued` — chamado quando `provider.sendText` lança um erro capturado
   * DENTRO do próprio processo (falha transitória normal, não um crash). Preserva a escada de
   * retry existente: a próxima entrega verá `queued` de novo, não `sending` travado. */
  revertToQueued(id: string): Promise<void>;
  markSent(id: string, input: { externalMessageId: string; sentAt: string }): Promise<InboxMessage>;
  /** Fase 6 — `failureCategory` (opcional) é a categoria segura da falha final (mesmo vocabulário
   * de `MessagingProviderErrorKind` + `circuit_open`/`rate_limited_local`) — permite diagnosticar
   * uma mensagem na DLQ sem reabrir logs. */
  markFailed(id: string, input: { lastError: string; failedAt: string; failureCategory?: string }): Promise<InboxMessage>;
  recordAttempt(id: string, input: { lastError?: string; lastAttemptAt: string; failureCategory?: string }): Promise<void>;

  /**
   * Fase 5/6 — claim atômico (CAS/lease) de "quem gera/envia a resposta de IA para esta mensagem
   * inbound". Casa se `direction = 'inbound'` E (`ai_claim_status is null` OU o claim `processing`
   * já passou de `staleBeforeIso` — Fase 6: um processo que morreu segurando o claim nunca deveria
   * travar a mensagem para sempre). `undefined` = já reivindicada por outra execução e ainda
   * dentro do lease (defesa em profundidade contra duas gerações para a mesma mensagem — a defesa
   * principal continua sendo `wasCreated` em `registerInboundMessage`).
   */
  tryClaimForAiResponse(id: string, claimedAt: string, staleBeforeIso: string): Promise<InboxMessage | undefined>;
  /** Resolve um claim já feito (`processing` → `answered`/`skipped`/`failed`). `responseMessageId`
   * só é gravado quando `status === "answered"`. Nunca re-tenta automaticamente um claim
   * `failed`/`skipped` — a mensagem fica disponível só para atendimento manual. */
  resolveAiClaim(id: string, input: { status: "answered" | "skipped" | "failed"; responseMessageId?: string }): Promise<void>;
  /** Mensagens inbound de uma conversa ainda sem claim VÁLIDO — `ai_claim_status is null` OU um
   * claim `processing` mais velho que `staleProcessingBeforeIso` (Fase 6: lease expirado, ver
   * `tryClaimForAiResponse`) — ordem cronológica ascendente. Usado pelo drenador de IA para pegar
   * tudo que se acumulou (ou ficou órfão) desde a última rodada (ver `maybeGenerateAiResponse`). */
  listUnansweredInboundByConversation(input: { conversationId: string; staleProcessingBeforeIso: string }): Promise<InboxMessage[]>;
};
