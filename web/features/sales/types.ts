import type { BillingType, Deal, Proposal } from "@/features/crm/types";

/** Espelho dos contratos do Sales Engine (backend é a autoridade de todos os números). */

export type DealItem = {
  id: string;
  dealId: string;
  productId?: string;
  variantId?: string;
  position: number;
  productNameSnapshot: string;
  productCodeSnapshot?: string;
  billingTypeSnapshot: BillingType;
  unitSnapshot?: string;
  quantity: number;
  unitCostCentsSnapshot?: number;
  listPriceCentsSnapshot: number;
  minimumPriceCentsSnapshot?: number;
  proposedUnitPriceCents: number;
  subtotalListCents: number;
  subtotalProposedCents: number;
  subtotalCostCents?: number;
  discountCents: number;
  grossProfitCents?: number;
  grossMarginBp?: number;
};

export type CommercialTotals = {
  itemCount: number;
  listTotalCents: number;
  subtotalProposedCents: number;
  globalDiscountCents: number;
  totalCents: number;
  discountCents: number;
  discountBp: number;
  costCents?: number;
  grossProfitCents?: number;
  grossMarginBp?: number;
  minimumTotalCents?: number;
  negotiationRoomCents?: number;
  belowMinimum: boolean;
  mrrCents: number;
  arrCents: number;
  oneTimeCents: number;
  tcvCents: number;
  contractMonths?: number;
};

export type ApprovalReason = "below_minimum_price" | "margin_below_policy" | "discount_above_autonomy";
export type NegotiationHealth = "healthy" | "near_limit" | "below_limit";

export type CommercialApprovalRequest = {
  id: string;
  dealId: string;
  proposalId?: string;
  requestedByUserId: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  justification?: string;
  reasons: readonly ApprovalReason[];
  snapshot: {
    dealTitle?: string;
    contactName?: string;
    ownerUserId?: string;
    currency?: string;
    listTotalCents?: number;
    minimumTotalCents?: number;
    requestedTotalCents?: number;
    costCents?: number;
    originalMarginBp?: number;
    proposedMarginBp?: number;
    discountCents?: number;
    discountBp?: number;
    items?: { name: string; quantity: number; listPriceCents: number; minimumPriceCents?: number; proposedUnitPriceCents: number; unitCostCents?: number }[];
  };
  decidedByUserId?: string;
  decidedAt?: string;
  decisionReason?: string;
  approvedValueCents?: number;
  createdAt: string;
};

export type SalesVisibility = { canViewCost: boolean; canViewMargin: boolean; isManager: boolean };

export type DealCommercialSummary = {
  dealId: string;
  status: Deal["status"];
  valueMode: "manual" | "calculated";
  currency: string;
  valueCents: number;
  items: DealItem[];
  totals: CommercialTotals;
  visibility: SalesVisibility;
  policy: { minMarginBp?: number; maxDiscountBp?: number; allowBelowMinimum: boolean; source: "user" | "team" | "role" | "workspace" | "none" };
  evaluation: { reasons: ApprovalReason[]; requiresApproval: boolean; health: NegotiationHealth };
  approval: { required: boolean; status: "not_required" | "approved" | "pending" | "rejected" | "missing"; request?: CommercialApprovalRequest };
  probability: { value: number; source: "deal" | "stage" | "default" | "terminal" };
  weightedValueCents: number;
  forecastCategory: NonNullable<Deal["forecastCategory"]>;
  aging: { daysOpen: number; daysInStage: number; daysWithoutActivity?: number; staleAfterDays?: number; stale: boolean; expectedCloseOverdue: boolean };
  nextActivity?: { id: string; title: string; type: string; dueAt?: string; overdue: boolean };
};

export type CommercialSettings = {
  workspaceId: string;
  sellersCanViewCost: boolean;
  sellersCanViewMargin: boolean;
  dealVisibility: "all" | "team" | "own";
  proposalAcceptAutoWin: boolean;
  proposalWhatsappTemplate?: string;
  proposalReminderTemplate?: string;
  defaultContractMonths?: number;
  rankingEnabled: boolean;
  visibility: SalesVisibility;
};

export type CommercialPolicy = {
  id: string;
  scopeType: "workspace" | "role" | "team" | "user";
  scopeId?: string;
  minMarginBp?: number;
  maxDiscountBp?: number;
  allowBelowMinimum: boolean;
};

export type CloseReasonKind = "won" | "lost" | "proposal_decline";
export type CloseReason = { id: string; kind: CloseReasonKind; label: string; position: number; active: boolean };
export type Competitor = { id: string; name: string; active: boolean };

export type CustomFieldType = "text" | "number" | "currency" | "date" | "select" | "multi_select" | "boolean";
export type DealCustomField = { id: string; key: string; label: string; fieldType: CustomFieldType; options: readonly string[]; position: number; active: boolean };

export type ParticipantRole = "decision_maker" | "influencer" | "user" | "financial" | "other";
export type DealParticipant = { id: string; dealId: string; contactId: string; role: ParticipantRole };

export type PriceBook = { id: string; name: string; description?: string; currency: string; active: boolean };
export type PriceBookItem = { id: string; priceBookId: string; productId: string; variantId?: string; listPriceCents: number; minimumPriceCents?: number };
export type ProductVariant = {priceOverride?:boolean; id: string; productId: string; name: string; code?: string; costCents?: number; listPriceCents: number; minimumPriceCents?: number; active: boolean; position: number;optionValues?:Record<string,string>;stockQuantity?:number;reservedQuantity?:number;imageUrl?:string };

export type GoalScope = "user" | "team" | "company";
export type GoalMetric = "sales_revenue" | "gross_margin" | "won_opportunities" | "mrr";
export type GoalPeriod = "monthly" | "quarterly" | "annual";
export type GoalProgress = { targetValue: number; realizedValue: number; attainmentBp: number; remainingValue: number; reached: boolean };
export type SalesGoal = {
  id: string;
  scopeType: GoalScope;
  scopeId?: string;
  metric: GoalMetric;
  periodType: GoalPeriod;
  periodStart: string;
  targetValue: number;
  currency: string;
  progress: GoalProgress;
  pace?: { elapsedMonths: number; totalMonths: number; requiredPerRemainingMonth: number; projectedValue: number };
};

export type ForecastBuckets = { wonCents: number; commitCents: number; bestCaseCents: number; pipelineCents: number; weightedCents: number };

export type PerformanceReport = {
  subject: { userId?: string; teamId?: string };
  period: { type: GoalPeriod; start: string; from: string; to: string };
  goals: SalesGoal[];
  won: { count: number; revenueCents: number; averageTicketCents?: number; grossProfitCents?: number; averageMarginBp?: number; mrrCents: number; arrCents: number };
  lost: { count: number; valueCents: number };
  conversionBp?: number;
  averageCycleDays?: number;
  pipeline: { openCount: number; openValueCents: number; weightedValueCents: number };
  forecast: ForecastBuckets;
  dataQuality: { withoutNextActivity: number; stale: number; overdueExpectedClose: number; withoutValue: number; withoutOwner: number };
  comparison: { previousRevenueCents: number; previousWonCount: number; available: boolean };
};

export type SellerRow = {
  userId: string;
  role: string;
  goalCents?: number;
  soldCents: number;
  attainmentBp?: number;
  averageMarginBp?: number;
  wonCount: number;
  pipelineCents: number;
  weightedCents: number;
  conversionBp?: number;
  averageTicketCents?: number;
  averageCycleDays?: number;
};

export type TeamPerformance = { team: PerformanceReport; sellers: SellerRow[]; rankingEnabled: boolean };

export type SalesForecast = {
  periodType: GoalPeriod;
  start: string;
  months: (ForecastBuckets & { month: string; goalCents?: number; gapCents?: number })[];
  totals: ForecastBuckets & { goalCents?: number; gapCents?: number };
};

export type ConversionRow = { id: string; won: number; lost: number; wonValueCents: number; conversionBp?: number };

export type SalesReports = {
  conversion: { won: number; lost: number; conversionBp?: number; bySeller: ConversionRow[]; byTeam: ConversionRow[]; byPipeline: ConversionRow[]; byOrigin: ConversionRow[] };
  products: { productId?: string; name: string; quantity: number; revenueCents: number; wonDeals: number; lostDeals: number; averageTicketCents?: number; grossMarginBp?: number; conversionBp?: number }[];
  losses: { count: number; valueCents: number; byReason: { reason: string; count: number }[]; byCompetitor: { competitorId: string; count: number }[]; bySeller: { userId: string; count: number }[] };
  funnel: { pipelineId: string; stages: { stageId: string; name: string; isWon: boolean; isLost: boolean; entered: number; advanceRateBp?: number; averageDays?: number }[] }[];
  cycle: { averageDaysWon?: number; averageDaysLost?: number };
  proposals: { created: number; sent: number; viewed: number; accepted: number; declined: number; expired: number; sentToViewedBp?: number; viewedToAcceptedBp?: number; sentToAcceptedBp?: number; averageHoursSentToViewed?: number; averageHoursViewedToAccepted?: number };
  margin?: { revenueCents: number; costCents: number; grossProfitCents: number; grossMarginBp?: number; bySeller: { userId: string; revenueCents: number; grossProfitCents: number; grossMarginBp?: number }[] };
  discounts: { wonWithDiscount: number; totalDiscountCents: number; averageDiscountBp?: number; approvalsRequested: number; approvalsApproved: number; approvalsRejected: number };
  visibility: SalesVisibility;
};

export type GoalImpact =
  | { available: false; ownerUserId?: string }
  | { available: true; ownerUserId: string; targetCents: number; realizedCents: number; attainmentBp: number; remainingCents: number; dealValueCents: number; dealShareOfGoalBp: number; afterCloseCents: number; afterCloseAttainmentBp: number; afterCloseRemainingCents: number };

export type DealInsights = {
  dealId: string;
  risks: { code: string; title: string; evidence?: string }[];
  explanations: string[];
  goalImpact: GoalImpact;
  aiAvailable: boolean;
  hasConversation: boolean;
  marginVisible: boolean;
};

export type DealAiInsights = {
  generatedAt: string;
  summary: string;
  summaryEvidence: string[];
  risks: { title: string; evidence: string }[];
  nextActions: { title: string; rationale: string; evidence: string; actionType: "call" | "message" | "meeting" | "proposal" | "follow_up" | "other" }[];
};

export type ProposalEventType =
  | "created" | "approval_requested" | "approved" | "rejected_internally" | "sent" | "delivered" | "whatsapp_read" | "whatsapp_failed"
  | "viewed" | "downloaded" | "accepted" | "declined" | "expired" | "superseded" | "cancelled" | "reminder_sent" | "follow_up_task_created";

export type ProposalEvent = { id: string; proposalId: string; eventType: ProposalEventType; recipientId?: string; occurredAt: string; payload: Record<string, unknown> };

export type ProposalTracking = {
  proposal: Proposal;
  deliveries: { id: string; conversationId: string; inboxMessageId?: string; status: "pending" | "queued" | "failed"; errorMessage?: string; createdAt: string; messageStatus?: "queued" | "sending" | "sent" | "delivered" | "read" | "failed" }[];
  events: ProposalEvent[];
  recipients: { id: string; name: string; viewCount: number; firstViewedAt?: string; lastViewedAt?: string }[];
  versions: { id: string; version: number; status: Proposal["status"]; sentAt?: string; totalCents: number }[];
};

export type ConversationProposal = {
  inboxMessageId: string;
  proposalId: string;
  dealId?: string;
  number?: string;
  version: number;
  title: string;
  totalCents: number;
  currency: string;
  status: Proposal["status"];
  viewCount: number;
  lastViewedAt?: string;
  validUntil?: string;
};
