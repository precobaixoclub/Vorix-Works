export type ContactChannel = "whatsapp" | "instagram" | "facebook" | "tiktok";

export type Contact = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  company?: string;
  document?: string;
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
  channel: ContactChannel;
  externalId: string;
  connectionId?: string;
  createdAt: string;
};

export type TimelineEntityType = "contact" | "deal" | "conversation" | "proposal" | "task";
export type TimelineActorType = "user" | "ai" | "automation" | "system";

export type TimelineEvent = {
  id: string;
  entityType: TimelineEntityType;
  entityId: string;
  eventType: string;
  actorType: TimelineActorType;
  actorId?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

/** Jornada Comercial, Fase 5 — item normalizado da TIMELINE COMERCIAL 360 (`GET
 * /contacts/:id/activity`). `actor.type === "user"` é o único caso em que o frontend precisa
 * resolver um nome (via `userLabel(actor.id, members)`, mesmo padrão já usado no resto do Contact
 * 360) — os demais tipos já vêm com um rótulo fixo (Sistema/IA/Automação/Cliente). */
export type ContactActivityActor = { type: "user"; id: string } | { type: "system" | "ai" | "automation" | "contact" };

export type ContactActivityCategory = "contact" | "conversation" | "deal" | "task" | "proposal";

export type ContactActivityItem = {
  id: string;
  type: string;
  category: ContactActivityCategory;
  occurredAt: string;
  actor: ContactActivityActor;
  title: string;
  description?: string;
  entityType?: "contact" | "deal" | "task" | "proposal" | "conversation";
  entityId?: string;
  metadata?: Record<string, unknown>;
};

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
  /** Sales Engine — probabilidade padrão (0–100), alerta de parada e campos exigidos para entrar. */
  probability?: number;
  staleAfterDays?: number;
  requiredFields?: readonly string[];
  createdAt: string;
};

export type DealStatus = "open" | "won" | "lost" | "cancelled";
export type ForecastCategory = "pipeline" | "best_case" | "commit" | "closed" | "omitted";

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
  // Sales Engine (opcionais para compatibilidade com respostas antigas em cache).
  status?: DealStatus;
  valueMode?: "manual" | "calculated";
  probability?: number;
  forecastCategory?: ForecastCategory;
  priceBookId?: string;
  discountCents?: number;
  contractMonths?: number;
  customFields?: Readonly<Record<string, unknown>>;
  closedAt?: string;
  closedByUserId?: string;
  creditedOwnerUserId?: string;
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
};

export type DealStageSummary = {
  stageId: string;
  count: number;
  valueCentsSum: number;
};

export type TaskType = "ligacao" | "whatsapp" | "reuniao" | "enviar_proposta" | "follow_up" | "personalizada";
export type TaskStatus = "pending" | "done" | "cancelled";

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
  /** Preço de tabela (nome histórico). */
  priceCents: number;
  currency: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  listPriceCents?: number;
  code?: string;
  category?: string;
  itemType?: "product" | "service";
  unit?: string;
  billingType?: BillingType;
  /** Só vem para quem pode ver custo. */
  costCents?: number;
  minimumPriceCents?: number;
  commissionType?: "percent" | "fixed";
  commissionValue?: number;
  /** Controle de estoque (opcional por produto). */
  trackStock?: boolean;
  stockQuantity?: number;
  /** Ponto de reposição — com o estoque neste valor ou abaixo, o sistema alerta. */
  stockAlertThreshold?: number;
  /** Calculado pela API: estoque no ponto de reposição ou abaixo. */
  lowStock?: boolean;
  /** Fotos; a primeira é a capa. */
  imageUrls?: string[];
};

export type BillingType = "one_time" | "monthly" | "quarterly" | "annual" | "per_unit" | "per_hour" | "custom";

export type ProposalItem = {
  productId?: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  variantId?: string;
  description?: string;
  billingType?: BillingType;
  listPriceCents?: number;
  minimumPriceCents?: number;
  unitCostCents?: number;
  discountCents?: number;
};

export type ProposalStatus = "draft" | "pending_approval" | "approved" | "sent" | "viewed" | "accepted" | "rejected" | "expired" | "cancelled" | "superseded";

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
  publicTokenHash?: string;
  sentAt?: string;
  viewedAt?: string;
  lastViewedAt?: string;
  viewCount: number;
  respondedAt?: string;
  publicLinkRevokedAt?: string;
  rejectionReason?: string;
  rejectionComment?: string;
  customerName?: string;
  customerCompany?: string;
  issuerName?: string;
  createdAt: string;
  updatedAt: string;
  number?: string;
  version?: number;
  rootProposalId?: string;
  supersededByProposalId?: string;
  introduction?: string;
  notes?: string;
  terms?: string;
  listTotalCents?: number;
  sentChannel?: string;
  sentByUserId?: string;
  totalViewSeconds?: number;
  acceptedVersion?: number;
};

export type ProposalWithToken = Proposal & { publicToken: string };

export type LeadTemperature = "frio" | "morno" | "quente";

export type LeadScoreFactor = {
  label: string;
  points: number;
};

export type LeadScore = {
  score: number;
  temperature: LeadTemperature;
  factors: readonly LeadScoreFactor[];
};

export type CommercialSuggestionAction = "follow_up_task" | "reach_out" | "review_deal_stage" | "send_proposal" | "none";
export type CommercialSuggestionStatus = "pending" | "accepted" | "dismissed";

export type StageAging = { stageId: string; stageName: string; openCount: number; avgDaysInStage: number };
export type LossReasonBreakdown = { reason: string; count: number };
export type OriginRevenue = { origin: string; wonCount: number; wonValueCents: number };

export type CommercialMetricsReport = {
  dealsCreatedCount: number;
  openPipelineValueCents: number;
  wonCount: number;
  wonValueCents: number;
  lostCount: number;
  conversionRate?: number;
  avgTicketCents?: number;
  avgCycleDays?: number;
  proposalsSentCount: number;
  proposalsAcceptedCount: number;
  proposalAcceptRate?: number;
  dealsWithoutNextActionCount: number;
  stageAging: readonly StageAging[];
  lossReasons: readonly LossReasonBreakdown[];
  revenueByOrigin: readonly OriginRevenue[];
};

export type AutomationTrigger = "deal_stage_changed" | "contact_created" | "proposal_accepted" | "proposal_rejected" | "deal_created" | "deal_won" | "deal_lost" | "proposal_sent" | "proposal_viewed" | "approval_requested" | "approval_decided" | "goal_reached";
export type AutomationConditionField = "pipelineId" | "stageId" | "origin" | "tag";
export type AutomationActionType = "create_task" | "add_tag" | "assign_owner" | "assign_owner_least_loaded_in_team" | "move_deal_stage";

export type AutomationCondition = {
  field: AutomationConditionField;
  equals: string;
};

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
  ruleId: string;
  contactId?: string;
  dealId?: string;
  matched: boolean;
  actionTaken: boolean;
  error?: string;
  occurredAt: string;
};

export type CommercialSuggestion = {
  id: string;
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

/** Risco de estoque das oportunidades abertas — laranja (atenção) e vermelho (revisar). */
export type StockRiskLevel = "ok" | "warning" | "critical";
export type ProductStockRisk = { productId: string; name: string; unit?: string; stockQuantity: number; openDemand: number; level: StockRiskLevel };
export type DealStockRiskItem = { productId: string; name: string; unit?: string; quantity: number; available: number; openDemand: number; level: "warning" | "critical" };
export type DealStockRisk = { dealId: string; level: "warning" | "critical"; items: DealStockRiskItem[] };
export type StockRiskReport = { products: ProductStockRisk[]; deals: DealStockRisk[] };
