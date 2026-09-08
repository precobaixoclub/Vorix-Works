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

export type ProposalStatus = "draft" | "sent" | "viewed" | "accepted" | "rejected" | "expired";

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

export type AutomationTrigger = "deal_stage_changed" | "contact_created" | "proposal_accepted" | "proposal_rejected";
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
