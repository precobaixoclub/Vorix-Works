/**
 * Domínio CRM/Comercial — Fase 1 (Fundação Comercial). Ver
 * `docs/crm-omnichannel-architecture-audit.md` para o racional completo. Bounded context próprio,
 * isolado de `inbox`/`instagram-dm` (verificado por `scripts/check-crm-isolation.mjs`) — a única
 * ligação com o WhatsApp existente é via `contact_identities`/`inbox_contacts.contact_id`
 * (migration 0092), nunca um import direto de código.
 *
 * PRINCÍPIO CENTRAL: `Contact` é a pessoa 360°, nunca duplicada por canal — `ContactIdentity` é a
 * ligação (contato × canal × id externo). `inbox_contacts` (WhatsApp) nunca muda de forma; ganha
 * só uma coluna opcional apontando pra cima. Nenhuma fusão automática de duas identidades sem
 * sinal de confiança explícito (ver `mergeContacts`, Fase futura — não implementado nesta fase).
 */

export const CONTACT_CHANNELS = ["whatsapp", "instagram", "facebook", "tiktok"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export type Contact = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  company?: string;
  document?: string;
  /** Origem de marketing (ex.: "whatsapp", "instagram", "indicação") — nunca inventada sem
   * evidência (auditoria, seção 22: "não inventar atribuição quando não houver evidência"). */
  origin?: string;
  ownerUserId?: string;
  teamId?: string;
  tags: readonly string[];
  customFields: Record<string, unknown>;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastInteractionAt?: string;
};

export type ContactIdentity = {
  id: string;
  contactId: string;
  tenantId: string;
  workspaceId: string;
  channel: ContactChannel;
  externalId: string;
  connectionId?: string;
  createdAt: string;
};

/**
 * Timeline genérica — deliberadamente separada do pipeline de Analytics (métrica agregada por
 * janela de tempo, não narrativa por entidade — ver auditoria, seção 17). Nunca duplica o payload
 * inteiro do evento de origem, só uma referência/resumo suficiente pra renderizar a timeline.
 */
export const TIMELINE_ENTITY_TYPES = ["contact", "deal", "conversation", "proposal", "task"] as const;
export type TimelineEntityType = (typeof TIMELINE_ENTITY_TYPES)[number];

export const TIMELINE_ACTOR_TYPES = ["user", "ai", "automation", "system"] as const;
export type TimelineActorType = (typeof TIMELINE_ACTOR_TYPES)[number];

export type TimelineEvent = {
  id: string;
  tenantId: string;
  workspaceId: string;
  entityType: TimelineEntityType;
  entityId: string;
  eventType: string;
  actorType: TimelineActorType;
  actorId?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

/**
 * CRM — Fase 2 (pipelines/negócios/Kanban). `Pipeline`/`PipelineStage` são configuráveis por
 * workspace (auditoria, seção 6: "nunca hardcoded") — um pipeline padrão é criado sob demanda
 * (`ensureDefaultPipeline`) na primeira leitura, nunca via seed de migration (multi-tenant).
 * `PipelineStage.isWon`/`isLost` marcam as etapas terminais; mover um negócio pra uma etapa
 * `isLost` exige `lossReason` (nunca perdido silenciosamente); mover de volta pra uma etapa aberta
 * limpa `wonAt`/`lostAt`/`lossReason` (reabertura é permitida, não é um estado especial).
 */
export type Pipeline = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PipelineStage = {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  createdAt: string;
};

export type Deal = {
  id: string;
  tenantId: string;
  workspaceId: string;
  pipelineId: string;
  stageId: string;
  contactId?: string;
  title: string;
  valueCents: number;
  currency: string;
  ownerUserId?: string;
  teamId?: string;
  origin?: string;
  lossReason?: string;
  wonAt?: string;
  lostAt?: string;
  expectedCloseDate?: string;
  createdAt: string;
  updatedAt: string;
  lastStageChangedAt: string;
};

export type DealStageSummary = {
  stageId: string;
  count: number;
  valueCentsSum: number;
};

/**
 * CRM — Fase 3 (Execução Comercial). `Task` é o lembrete de próximo passo (ligar, enviar
 * proposta...), sempre ligado opcionalmente a um `Contact`/`Deal` — nunca obrigatório, uma tarefa
 * solta também é válida. `Product` é um catálogo simples de preço (SEM estoque — fora de escopo,
 * ver auditoria seção "o que não construir"). `Proposal` tem itens congelados no momento do envio
 * (nome/preço snapshot, nunca uma referência viva ao `Product` que pode mudar de preço depois) e
 * um token público de acesso — só o HASH é persistido (`publicTokenHash`), o token bruto só existe
 * na resposta de criação/reenvio, nunca no banco (mesmo padrão de `TenantMemberInvite.tokenHash`).
 */
export const TASK_TYPES = ["ligacao", "whatsapp", "reuniao", "enviar_proposta", "follow_up", "personalizada"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ["pending", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Task = {
  id: string;
  tenantId: string;
  workspaceId: string;
  contactId?: string;
  dealId?: string;
  type: TaskType;
  title: string;
  description?: string;
  dueAt?: string;
  status: TaskStatus;
  ownerUserId?: string;
  teamId?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type Product = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  description?: string;
  priceCents: number;
  currency: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProposalItem = {
  productId?: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
};

export const PROPOSAL_STATUSES = ["draft", "sent", "viewed", "accepted", "rejected", "expired"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export type Proposal = {
  id: string;
  tenantId: string;
  workspaceId: string;
  dealId?: string;
  contactId?: string;
  title: string;
  items: readonly ProposalItem[];
  discountCents: number;
  totalCents: number;
  currency: string;
  validUntil?: string;
  conditions?: string;
  status: ProposalStatus;
  publicTokenHash: string;
  sentAt?: string;
  viewedAt?: string;
  respondedAt?: string;
  createdAt: string;
  updatedAt: string;
};
