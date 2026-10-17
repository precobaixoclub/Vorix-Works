import type { BillingType } from "../sales/pricing.js";
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
  /** Sales Engine — probabilidade padrão da etapa (0–100); ausente = derivada da posição. */
  probability?: number;
  /** Dias sem mudar de etapa para considerar a oportunidade parada; ausente = sem alerta. */
  staleAfterDays?: number;
  /** Chaves de campos exigidos para ENTRAR nesta etapa (ex.: `expectedCloseDate`, `custom:budget`). */
  requiredFields: readonly string[];
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
  // Sales Engine — status explícito (não depende só da coluna do Kanban), modo do valor,
  // forecast e snapshot definitivo do fechamento (nunca recalculado com o catálogo atual).
  status: DealStatus;
  /** `calculated` = `valueCents` é a soma dos itens (backend recalcula); `manual` = informado. */
  valueMode: DealValueMode;
  /** Override de probabilidade; ausente = probabilidade da etapa. */
  probability?: number;
  forecastCategory: ForecastCategory;
  priceBookId?: string;
  /** Desconto global da oportunidade (além dos descontos por item; nunca aplicado duas vezes). */
  discountCents: number;
  contractMonths?: number;
  customFields: Readonly<Record<string, unknown>>;
  closedAt?: string;
  closedByUserId?: string;
  /** Quem recebe o crédito da venda — o responsável NO MOMENTO do ganho, nunca o atual. */
  creditedOwnerUserId?: string;
  creditedTeamId?: string;
  wonReason?: string;
  closeComment?: string;
  competitorId?: string;
  wonProposalId?: string;
  finalValueCents?: number;
  finalCostCents?: number;
  finalGrossProfitCents?: number;
  finalMarginBp?: number;
  finalMrrCents?: number;
  finalArrCents?: number;
  finalTcvCents?: number;
  finalSnapshot?: Readonly<Record<string, unknown>>;
};

export const DEAL_STATUSES = ["open", "won", "lost", "cancelled"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];
export const DEAL_VALUE_MODES = ["manual", "calculated"] as const;
export type DealValueMode = (typeof DEAL_VALUE_MODES)[number];
/** Confiança comercial — independente da etapa (o vendedor sinaliza sem mover o card). */
export const FORECAST_CATEGORIES = ["pipeline", "best_case", "commit", "closed", "omitted"] as const;
export type ForecastCategory = (typeof FORECAST_CATEGORIES)[number];

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
  /** Preço de TABELA (nome histórico mantido por compatibilidade — ver `listPriceCents` na API). */
  priceCents: number;
  currency: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  // Sales Engine — preços formais (nunca colapsados num único "price").
  code?: string;
  category?: string;
  itemType: "product" | "service";
  unit?: string;
  billingType: BillingType;
  /** Custo unitário — visível só para quem a política comercial permite. */
  costCents?: number;
  /** Preço mínimo sem aprovação; ausente = sem piso. */
  minimumPriceCents?: number;
  commissionType?: "percent" | "fixed";
  /** `percent` em basis points; `fixed` em centavos. */
  commissionValue?: number;
  taxMetadata: Readonly<Record<string, unknown>>;
};

/**
 * CRM — Fase 5 (Inteligência). `LeadScore` é DETERMINÍSTICO — nunca calculado por IA, nunca
 * apresentado como verdade absoluta (auditoria, seção 12: "nunca uma pontuação absoluta"), sempre
 * com `factors` explicando a composição. Calculado sob demanda (`computeLeadScore`), nunca
 * persistido — evita ficar desatualizado (dado sempre reflete o estado real e atual do CRM).
 */
export const LEAD_TEMPERATURES = ["frio", "morno", "quente"] as const;
export type LeadTemperature = (typeof LEAD_TEMPERATURES)[number];

export type LeadScoreFactor = {
  label: string;
  points: number;
};

export type LeadScore = {
  score: number;
  temperature: LeadTemperature;
  factors: readonly LeadScoreFactor[];
};

/**
 * `CommercialSuggestion` — Copiloto Comercial (Fase 5). Gerada pelo AI Gateway (nunca Ícaro — ver
 * `scripts/check-ai-stack-isolation.mjs`), sempre com `evidence` (trecho literal dos dados reais
 * que embasou a sugestão — nunca inventado, mesma validação semântica anti-alucinação de
 * `briefing-field-extraction-result.v1.ts`) e `confidence`. NUNCA executa a ação sozinha: só uma
 * ação humana explícita (`accept`) pode transformar a sugestão em algo real (ex.: criar uma
 * Tarefa) — "aceitar" É a autorização humana exigida pela auditoria, seção 13.
 */
export const COMMERCIAL_SUGGESTION_ACTIONS = ["follow_up_task", "reach_out", "review_deal_stage", "send_proposal", "none"] as const;
export type CommercialSuggestionAction = (typeof COMMERCIAL_SUGGESTION_ACTIONS)[number];

export const COMMERCIAL_SUGGESTION_STATUSES = ["pending", "accepted", "dismissed"] as const;
export type CommercialSuggestionStatus = (typeof COMMERCIAL_SUGGESTION_STATUSES)[number];

export type CommercialSuggestion = {
  id: string;
  tenantId: string;
  workspaceId: string;
  contactId: string;
  dealId?: string;
  title: string;
  rationale: string;
  evidence: string;
  confidence: number;
  suggestedAction: CommercialSuggestionAction;
  status: CommercialSuggestionStatus;
  createdAt: string;
  resolvedAt?: string;
};

/**
 * CRM — Fase 6 (Automação). Motor SIMPLES e guiado (auditoria, seção 16: "nunca um Zapier") —
 * gatilho fechado + até 3 condições (E lógico só, vocabulário fechado, sem OR/grupos/expressões) +
 * UMA ação por regra. Cada disparo grava um `AutomationRunLog` (auditabilidade obrigatória) e
 * NUNCA pode quebrar a ação de negócio que o disparou — falha de automação é sempre contida e
 * registrada, nunca propagada (ver `evaluateAutomationTrigger`).
 */
export const AUTOMATION_TRIGGERS = ["deal_stage_changed", "contact_created", "proposal_accepted", "proposal_rejected", "deal_created", "deal_won", "deal_lost", "proposal_sent", "proposal_viewed", "approval_requested", "approval_decided", "goal_reached"] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const AUTOMATION_CONDITION_FIELDS = ["pipelineId", "stageId", "origin", "tag"] as const;
export type AutomationConditionField = (typeof AUTOMATION_CONDITION_FIELDS)[number];

export type AutomationCondition = {
  field: AutomationConditionField;
  equals: string;
};

/**
 * `assign_owner_least_loaded_in_team` é o "roteamento inteligente" desta fase (auditoria, seção
 * 17) — distribui entre os membros de `actionConfig.teamId` escolhendo sempre quem tem MENOS
 * contatos daquele time atribuídos no momento (round-robin por carga real, nunca um cursor
 * artificial que dessincroniza do estado de verdade). As demais estratégias citadas na auditoria
 * (disponibilidade/agenda) exigem infraestrutura de presença que não existe hoje — deliberadamente
 * fora de escopo desta fase, não fingidas aqui.
 */
export const AUTOMATION_ACTIONS = ["create_task", "add_tag", "assign_owner", "assign_owner_least_loaded_in_team", "move_deal_stage"] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTIONS)[number];

export type AutomationActionConfig = {
  taskType?: TaskType;
  taskTitle?: string;
  tag?: string;
  ownerUserId?: string;
  teamId?: string;
  targetStageId?: string;
};

export type AutomationRule = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  trigger: AutomationTrigger;
  conditions: readonly AutomationCondition[];
  action: AutomationActionType;
  actionConfig: AutomationActionConfig;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRunLog = {
  id: string;
  tenantId: string;
  workspaceId: string;
  ruleId: string;
  contactId?: string;
  dealId?: string;
  matched: boolean;
  actionTaken: boolean;
  error?: string;
  occurredAt: string;
};

export type ProposalItem = {
  productId?: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  // Sales Engine — snapshot comercial copiado da oportunidade na geração (nunca referência viva).
  variantId?: string;
  description?: string;
  billingType?: BillingType;
  listPriceCents?: number;
  minimumPriceCents?: number;
  /** Interno — nunca exposto no link público. */
  unitCostCents?: number;
  discountCents?: number;
};

export type ProposalTemplate = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  defaultTitle: string;
  defaultItems: readonly ProposalItem[];
  defaultConditions?: string;
  defaultValidDays: number;
  defaultIntroduction?: string;
  defaultTerms?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

/** `rejected` = recusada pelo CLIENTE (DECLINED); `pending_approval`/`approved` = aprovação comercial
 * interna antes do envio; `superseded` = substituída por versão mais nova efetivamente enviada. */
export const PROPOSAL_STATUSES = ["draft", "pending_approval", "approved", "sent", "viewed", "accepted", "rejected", "expired", "cancelled", "superseded"] as const;
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
  lastViewedAt?: string;
  viewCount: number;
  respondedAt?: string;
  publicLinkRevokedAt?: string;
  rejectionReason?: string;
  rejectionComment?: string;
  createdAt: string;
  updatedAt: string;
  // Sales Engine — versionamento (PROP-AAAA-NNN vN), conteúdo, envio e aceite auditado.
  number?: string;
  version: number;
  rootProposalId: string;
  supersedesProposalId?: string;
  supersededByProposalId?: string;
  supersededAt?: string;
  cancelledAt?: string;
  introduction?: string;
  notes?: string;
  terms?: string;
  listTotalCents?: number;
  createdByUserId?: string;
  sentByUserId?: string;
  sentChannel?: string;
  sentConversationId?: string;
  sentMessageId?: string;
  /** Tempo aproximado de leitura (heartbeats da página pública) — nunca precisão inventada. */
  totalViewSeconds: number;
  acceptedContentHash?: string;
  acceptedVersion?: number;
};

export const PROPOSAL_EVENT_TYPES = [
  "created", "approval_requested", "approved", "rejected_internally", "sent", "delivered", "whatsapp_read", "whatsapp_failed",
  "viewed", "downloaded", "accepted", "declined", "expired", "superseded", "cancelled", "reminder_sent", "follow_up_task_created",
] as const;
export type ProposalEventType = (typeof PROPOSAL_EVENT_TYPES)[number];

export type ProposalEvent = {
  id: string;
  proposalId: string;
  eventType: ProposalEventType;
  recipientId?: string;
  occurredAt: string;
  payload: Readonly<Record<string, unknown>>;
};

export type ProposalRecipient = {
  id: string;
  proposalId: string;
  contactId?: string;
  name: string;
  viewCount: number;
  firstViewedAt?: string;
  lastViewedAt?: string;
  revokedAt?: string;
  createdAt: string;
};

export type ProposalDelivery = {
  id: string;
  proposalId: string;
  conversationId: string;
  inboxMessageId?: string;
  status: "pending" | "queued" | "failed";
  errorMessage?: string;
  createdAt: string;
  queuedAt?: string;
};
