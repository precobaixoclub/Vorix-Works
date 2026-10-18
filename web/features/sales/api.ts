import { apiClient } from "@/lib/api-client";
import type { Deal, Proposal, ProposalWithToken } from "@/features/crm/types";
import type {
  CloseReason,
  CloseReasonKind,
  CommercialApprovalRequest,
  CommercialPolicy,
  CommercialSettings,
  Competitor,
  ConversationProposal,
  DealAiInsights,
  DealCommercialSummary,
  DealCustomField,
  DealInsights,
  DealItem,
  DealParticipant,
  GoalImpact,
  GoalMetric,
  GoalPeriod,
  GoalScope,
  ParticipantRole,
  PerformanceReport,
  PriceBook,
  PriceBookItem,
  ProductVariant,
  ProposalTracking,
  SalesForecast,
  SalesGoal,
  SalesReports,
  TeamPerformance,
} from "./types";

const q = encodeURIComponent;
const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return search.toString();
};

// --- Oportunidade: cockpit, itens, termos, fechamento ----------------------------------------
export const getDealCommercial = (workspaceId: string, dealId: string) => apiClient.get<DealCommercialSummary>(`/v1/deals/${q(dealId)}/commercial?workspaceId=${q(workspaceId)}`);
export type AddDealItemInput = { workspaceId: string; productId?: string; variantId?: string; name?: string; listPriceCents?: number; unitCostCents?: number; billingType?: string; quantity: number; proposedUnitPriceCents?: number; discountBp?: number };
export const addDealItem = (dealId: string, input: AddDealItemInput) => apiClient.post<DealItem>(`/v1/deals/${q(dealId)}/items`, input);
export const updateDealItem = (dealId: string, itemId: string, input: { workspaceId: string; quantity?: number; proposedUnitPriceCents?: number; discountBp?: number }) => apiClient.patch<DealItem>(`/v1/deals/${q(dealId)}/items/${q(itemId)}`, input);
export const removeDealItem = (dealId: string, itemId: string, workspaceId: string) => apiClient.delete<null>(`/v1/deals/${q(dealId)}/items/${q(itemId)}?workspaceId=${q(workspaceId)}`);
export const updateDealCommercial = (dealId: string, input: { workspaceId: string; valueMode?: "manual" | "calculated"; discountCents?: number; contractMonths?: number | null; priceBookId?: string | null; probability?: number | null; forecastCategory?: "pipeline" | "best_case" | "commit"; valueCents?: number }) => apiClient.patch<Deal>(`/v1/deals/${q(dealId)}/commercial`, input);
export const winDeal = (dealId: string, input: { workspaceId: string; wonReason?: string; proposalId?: string; comment?: string; finalValueCents?: number }) => apiClient.post<Deal>(`/v1/deals/${q(dealId)}/win`, input);
export const loseDeal = (dealId: string, input: { workspaceId: string; lossReason: string; competitorId?: string; competitorName?: string; comment?: string }) => apiClient.post<Deal>(`/v1/deals/${q(dealId)}/lose`, input);
export const reopenDeal = (dealId: string, workspaceId: string) => apiClient.post<Deal>(`/v1/deals/${q(dealId)}/reopen`, { workspaceId });
export const setDealCustomFields = (dealId: string, workspaceId: string, values: Record<string, unknown>) => apiClient.put<Deal>(`/v1/deals/${q(dealId)}/custom-fields`, { workspaceId, values });
export const listDealParticipants = (dealId: string, workspaceId: string) => apiClient.get<DealParticipant[]>(`/v1/deals/${q(dealId)}/participants?workspaceId=${q(workspaceId)}`);
export const upsertDealParticipant = (dealId: string, contactId: string, workspaceId: string, role: ParticipantRole) => apiClient.put<DealParticipant>(`/v1/deals/${q(dealId)}/participants/${q(contactId)}`, { workspaceId, role });
export const removeDealParticipant = (dealId: string, contactId: string, workspaceId: string) => apiClient.delete<null>(`/v1/deals/${q(dealId)}/participants/${q(contactId)}?workspaceId=${q(workspaceId)}`);
export const findDuplicateDeals = (workspaceId: string, params: { pipelineId: string; title: string; contactId?: string }) => apiClient.get<{ id: string; title: string; valueCents: number; currency: string }[]>(`/v1/deals-duplicates?${qs({ workspaceId, ...params })}`);

// --- Aprovações ----------------------------------------------------------------------------
export const requestApproval = (dealId: string, input: { workspaceId: string; justification?: string; proposalId?: string }) => apiClient.post<CommercialApprovalRequest>(`/v1/deals/${q(dealId)}/approvals`, input);
export const listApprovals = (workspaceId: string, params?: { status?: CommercialApprovalRequest["status"]; dealId?: string }) => apiClient.get<CommercialApprovalRequest[]>(`/v1/commercial-approvals?${qs({ workspaceId, ...params })}`);
export const decideApproval = (approvalId: string, input: { workspaceId: string; decision: "approved" | "rejected"; reason?: string }) => apiClient.post<CommercialApprovalRequest>(`/v1/commercial-approvals/${q(approvalId)}/decision`, input);
export const cancelApproval = (approvalId: string, workspaceId: string) => apiClient.post<CommercialApprovalRequest>(`/v1/commercial-approvals/${q(approvalId)}/cancel`, { workspaceId });

// --- Catálogo: variações e tabelas -----------------------------------------------------------
export const listVariants = (productId: string, workspaceId: string) => apiClient.get<ProductVariant[]>(`/v1/products/${q(productId)}/variants?workspaceId=${q(workspaceId)}`);
export const createVariant = (productId: string, input: { workspaceId: string; name: string; code?: string; costCents?: number; listPriceCents: number; minimumPriceCents?: number }) => apiClient.post<ProductVariant>(`/v1/products/${q(productId)}/variants`, input);
export const updateVariant = (productId: string, variantId: string, input: { workspaceId: string } & Partial<Omit<ProductVariant, "id" | "productId" | "costCents" | "minimumPriceCents" | "imageUrl">> & {costCents?:number|null;minimumPriceCents?:number|null;imageUrl?:string|null}) => apiClient.patch<ProductVariant>(`/v1/products/${q(productId)}/variants/${q(variantId)}`, input);
export const deleteVariant = (productId: string, variantId: string, workspaceId: string) => apiClient.delete<null>(`/v1/products/${q(productId)}/variants/${q(variantId)}?workspaceId=${q(workspaceId)}`);
export const listPriceBooks = (workspaceId: string) => apiClient.get<PriceBook[]>(`/v1/price-books?workspaceId=${q(workspaceId)}`);
export const createPriceBook = (input: { workspaceId: string; name: string; description?: string }) => apiClient.post<PriceBook>("/v1/price-books", input);
export const updatePriceBook = (id: string, input: { workspaceId: string; name?: string; description?: string; active?: boolean }) => apiClient.patch<PriceBook>(`/v1/price-books/${q(id)}`, input);
export const deletePriceBook = (id: string, workspaceId: string) => apiClient.delete<null>(`/v1/price-books/${q(id)}?workspaceId=${q(workspaceId)}`);
export const listPriceBookItems = (id: string, workspaceId: string) => apiClient.get<PriceBookItem[]>(`/v1/price-books/${q(id)}/items?workspaceId=${q(workspaceId)}`);
export const upsertPriceBookItem = (id: string, input: { workspaceId: string; productId: string; variantId?: string; listPriceCents: number; minimumPriceCents?: number }) => apiClient.put<PriceBookItem>(`/v1/price-books/${q(id)}/items`, input);
export const deletePriceBookItem = (id: string, itemId: string, workspaceId: string) => apiClient.delete<null>(`/v1/price-books/${q(id)}/items/${q(itemId)}?workspaceId=${q(workspaceId)}`);

// --- Configuração comercial ------------------------------------------------------------------
export const getCommercialSettings = (workspaceId: string) => apiClient.get<CommercialSettings>(`/v1/commercial-settings?workspaceId=${q(workspaceId)}`);
export const updateCommercialSettings = (input: { workspaceId: string } & Partial<Omit<CommercialSettings, "workspaceId" | "visibility" | "proposalWhatsappTemplate" | "proposalReminderTemplate" | "defaultContractMonths">> & { proposalWhatsappTemplate?: string | null; proposalReminderTemplate?: string | null; defaultContractMonths?: number | null }) => apiClient.patch<CommercialSettings>("/v1/commercial-settings", input);
export const listPolicies = (workspaceId: string) => apiClient.get<CommercialPolicy[]>(`/v1/commercial-policies?workspaceId=${q(workspaceId)}`);
export const upsertPolicy = (input: { workspaceId: string; scopeType: CommercialPolicy["scopeType"]; scopeId?: string; minMarginBp?: number | null; maxDiscountBp?: number | null; allowBelowMinimum?: boolean }) => apiClient.put<CommercialPolicy>("/v1/commercial-policies", input);
export const deletePolicy = (id: string, workspaceId: string) => apiClient.delete<null>(`/v1/commercial-policies/${q(id)}?workspaceId=${q(workspaceId)}`);
export const listReasons = (workspaceId: string, kind?: CloseReasonKind, includeInactive?: boolean) => apiClient.get<CloseReason[]>(`/v1/sales-reasons?${qs({ workspaceId, kind, includeInactive })}`);
export const createReason = (input: { workspaceId: string; kind: CloseReasonKind; label: string }) => apiClient.post<CloseReason>("/v1/sales-reasons", input);
export const updateReason = (id: string, input: { workspaceId: string; label?: string; active?: boolean }) => apiClient.patch<CloseReason>(`/v1/sales-reasons/${q(id)}`, input);
export const listCompetitors = (workspaceId: string, includeInactive?: boolean) => apiClient.get<Competitor[]>(`/v1/sales-competitors?${qs({ workspaceId, includeInactive })}`);
export const createCompetitor = (input: { workspaceId: string; name: string }) => apiClient.post<Competitor>("/v1/sales-competitors", input);
export const updateCompetitor = (id: string, input: { workspaceId: string; name?: string; active?: boolean }) => apiClient.patch<Competitor>(`/v1/sales-competitors/${q(id)}`, input);
export const listCustomFields = (workspaceId: string, includeInactive?: boolean) => apiClient.get<DealCustomField[]>(`/v1/deal-custom-fields?${qs({ workspaceId, includeInactive })}`);
export const createCustomField = (input: { workspaceId: string; key: string; label: string; fieldType: DealCustomField["fieldType"]; options?: string[] }) => apiClient.post<DealCustomField>("/v1/deal-custom-fields", input);
export const updateCustomField = (id: string, input: { workspaceId: string; label?: string; options?: string[]; active?: boolean }) => apiClient.patch<DealCustomField>(`/v1/deal-custom-fields/${q(id)}`, input);

// --- Metas, performance, forecast, relatórios, IA ---------------------------------------------
export const listGoals = (workspaceId: string, params?: { year?: number; periodType?: GoalPeriod }) => apiClient.get<SalesGoal[]>(`/v1/sales-goals?${qs({ workspaceId, ...params })}`);
export const upsertGoal = (input: { workspaceId: string; scopeType: GoalScope; scopeId?: string; metric: GoalMetric; periodType: GoalPeriod; periodStart: string; targetValue: number }) => apiClient.put<SalesGoal>("/v1/sales-goals", input);
/** Define os 12 meses de uma vez (null = sem meta). Trimestres e ano são recalculados pela API. */
export const setMonthlyGoals = (input: { workspaceId: string; scopeType: GoalScope; scopeId?: string; metric: GoalMetric; year: number; months: (number | null)[] }) => apiClient.put<SalesGoal[]>("/v1/sales-goals/monthly", input);
export const deleteGoal = (id: string, workspaceId: string) => apiClient.delete<null>(`/v1/sales-goals/${q(id)}?workspaceId=${q(workspaceId)}`);
export type PerformanceParams = { userId?: string; teamId?: string; periodType?: GoalPeriod; periodStart?: string };
export const getPerformance = (workspaceId: string, params?: PerformanceParams) => apiClient.get<PerformanceReport>(`/v1/sales-performance?${qs({ workspaceId, ...params })}`);
export const getTeamPerformance = (workspaceId: string, params?: Omit<PerformanceParams, "userId">) => apiClient.get<TeamPerformance>(`/v1/sales-performance/team?${qs({ workspaceId, ...params })}`);
export const getForecast = (workspaceId: string, params?: PerformanceParams) => apiClient.get<SalesForecast>(`/v1/sales-forecast?${qs({ workspaceId, ...params })}`);
export const getSalesReports = (workspaceId: string, params: { from: string; to: string; userId?: string; teamId?: string; pipelineId?: string; origin?: string }) => apiClient.get<SalesReports>(`/v1/sales-reports?${qs({ workspaceId, ...params })}`);
export const getDealGoalImpact = (dealId: string, workspaceId: string) => apiClient.get<GoalImpact>(`/v1/deals/${q(dealId)}/goal-impact?workspaceId=${q(workspaceId)}`);
export const getDealInsights = (dealId: string, workspaceId: string) => apiClient.get<DealInsights>(`/v1/deals/${q(dealId)}/insights?workspaceId=${q(workspaceId)}`);
export const generateDealAiInsights = (dealId: string, workspaceId: string) => apiClient.post<DealAiInsights>(`/v1/deals/${q(dealId)}/insights/ai`, { workspaceId });

// --- Propostas do Sales Engine ----------------------------------------------------------------
export const createProposalFromDeal = (dealId: string, input: { workspaceId: string; templateId?: string; title?: string; introduction?: string; validUntil?: string; conditions?: string; notes?: string; terms?: string; justification?: string }) =>
  apiClient.post<ProposalWithToken & { approvalRequired: boolean }>(`/v1/deals/${q(dealId)}/proposals`, input);
export const createProposalVersion = (proposalId: string, input: { workspaceId: string; validUntil?: string; discountCents?: number; title?: string }) => apiClient.post<ProposalWithToken>(`/v1/proposals/${q(proposalId)}/versions`, input);
export const cancelProposal = (proposalId: string, workspaceId: string) => apiClient.post<Proposal>(`/v1/proposals/${q(proposalId)}/cancel`, { workspaceId });
export const markProposalSent = (proposalId: string, workspaceId: string, channel: "link" | "email" | "other" = "link") => apiClient.post<Proposal>(`/v1/proposals/${q(proposalId)}/mark-sent`, { workspaceId, channel });
export const sendProposalWhatsapp = (proposalId: string, input: { workspaceId: string; conversationId: string; message?: string; idempotencyKey: string }) => apiClient.post<Proposal>(`/v1/proposals/${q(proposalId)}/send-whatsapp`, input);
export const remindProposalWhatsapp = (proposalId: string, input: { workspaceId: string; conversationId: string; message?: string; idempotencyKey: string }) => apiClient.post<Proposal>(`/v1/proposals/${q(proposalId)}/remind-whatsapp`, input);
export const getProposalTracking = (proposalId: string, workspaceId: string) => apiClient.get<ProposalTracking>(`/v1/proposals/${q(proposalId)}/tracking?workspaceId=${q(workspaceId)}`);
export const listConversationProposals = (conversationId: string, workspaceId: string) => apiClient.get<ConversationProposal[]>(`/v1/inbox/conversations/${q(conversationId)}/proposals?workspaceId=${q(workspaceId)}`);

// --- Funil: configuração das etapas -----------------------------------------------------------
export const updatePipelineStage = (pipelineId: string, stageId: string, input: { workspaceId: string; probability?: number | null; staleAfterDays?: number | null; requiredFields?: string[] }) =>
  apiClient.patch<import("@/features/crm/types").PipelineStage>(`/v1/pipelines/${q(pipelineId)}/stages/${q(stageId)}`, input);
