import useSWR, { useSWRConfig } from "swr";
import {
  getCommercialSettings,
  getDealCommercial,
  getDealInsights,
  getForecast,
  getPerformance,
  getProposalTracking,
  getSalesReports,
  getTeamPerformance,
  listApprovals,
  listCompetitors,
  listConversationProposals,
  listCustomFields,
  listGoals,
  listPolicies,
  listPriceBookItems,
  listPriceBooks,
  listReasons,
  listVariants,
  type PerformanceParams,
} from "./api";
import type { CloseReasonKind, CommercialApprovalRequest, GoalPeriod } from "./types";

/** Chaves começam com o recurso — mutações invalidam por prefixo (ver `invalidateSales`). */
export const dealCommercialKey = (workspaceId: string, dealId: string) => ["deal-commercial", workspaceId, dealId] as const;

export function useDealCommercial(workspaceId: string, dealId: string | undefined) {
  return useSWR(dealId ? dealCommercialKey(workspaceId, dealId) : null, () => getDealCommercial(workspaceId, dealId as string));
}

export function useDealInsights(workspaceId: string, dealId: string | undefined) {
  return useSWR(dealId ? ["deal-insights", workspaceId, dealId] : null, () => getDealInsights(dealId as string, workspaceId));
}

export function useCommercialSettings(workspaceId: string) {
  return useSWR(["commercial-settings", workspaceId], () => getCommercialSettings(workspaceId));
}

export function usePolicies(workspaceId: string, enabled = true) {
  return useSWR(enabled ? ["commercial-policies", workspaceId] : null, () => listPolicies(workspaceId));
}

export function useApprovals(workspaceId: string, params?: { status?: CommercialApprovalRequest["status"]; dealId?: string }) {
  return useSWR(["commercial-approvals", workspaceId, params?.status, params?.dealId], () => listApprovals(workspaceId, params));
}

export function useReasons(workspaceId: string, kind?: CloseReasonKind, includeInactive?: boolean) {
  return useSWR(["sales-reasons", workspaceId, kind, includeInactive], () => listReasons(workspaceId, kind, includeInactive));
}

export function useCompetitors(workspaceId: string, includeInactive?: boolean) {
  return useSWR(["sales-competitors", workspaceId, includeInactive], () => listCompetitors(workspaceId, includeInactive));
}

export function useCustomFields(workspaceId: string, includeInactive?: boolean) {
  return useSWR(["deal-custom-fields", workspaceId, includeInactive], () => listCustomFields(workspaceId, includeInactive));
}

export function usePriceBooks(workspaceId: string) {
  return useSWR(["price-books", workspaceId], () => listPriceBooks(workspaceId));
}

export function usePriceBookItems(workspaceId: string, priceBookId: string | undefined) {
  return useSWR(priceBookId ? ["price-book-items", workspaceId, priceBookId] : null, () => listPriceBookItems(priceBookId as string, workspaceId));
}

export function useVariants(workspaceId: string, productId: string | undefined) {
  return useSWR(productId ? ["product-variants", workspaceId, productId] : null, () => listVariants(productId as string, workspaceId));
}

export function useGoals(workspaceId: string, params?: { year?: number; periodType?: GoalPeriod }) {
  return useSWR(["sales-goals", workspaceId, params?.year, params?.periodType], () => listGoals(workspaceId, params));
}

export function usePerformance(workspaceId: string, params?: PerformanceParams, enabled = true) {
  return useSWR(enabled ? ["sales-performance", workspaceId, params?.userId, params?.teamId, params?.periodType, params?.periodStart] : null, () => getPerformance(workspaceId, params));
}

export function useTeamPerformance(workspaceId: string, params?: Omit<PerformanceParams, "userId">, enabled = true) {
  return useSWR(enabled ? ["sales-performance-team", workspaceId, params?.teamId, params?.periodType, params?.periodStart] : null, () => getTeamPerformance(workspaceId, params));
}

export function useForecast(workspaceId: string, params?: PerformanceParams) {
  return useSWR(["sales-forecast", workspaceId, params?.userId, params?.teamId, params?.periodType, params?.periodStart], () => getForecast(workspaceId, params));
}

export function useSalesReports(workspaceId: string, params: { from: string; to: string; userId?: string; teamId?: string; pipelineId?: string; origin?: string }) {
  return useSWR(["sales-reports", workspaceId, params.from, params.to, params.userId, params.teamId, params.pipelineId, params.origin], () => getSalesReports(workspaceId, params));
}

export function useProposalTracking(workspaceId: string, proposalId: string | undefined) {
  return useSWR(proposalId ? ["proposal-tracking", workspaceId, proposalId] : null, () => getProposalTracking(proposalId as string, workspaceId));
}

export function useConversationProposals(workspaceId: string, conversationId: string | undefined) {
  return useSWR(conversationId ? ["conversation-proposals", workspaceId, conversationId] : null, () => listConversationProposals(conversationId as string, workspaceId), { refreshInterval: 30_000 });
}

/** Prefixos de cache afetados por qualquer mudança comercial numa oportunidade. */
export const SALES_CACHE_PREFIXES = ["deal-commercial", "deal-insights", "deal", "deals", "contact-open-deals", "proposals", "proposal-tracking", "commercial-approvals", "sales-performance", "sales-performance-team", "sales-forecast", "sales-goals", "deal-timeline"];


/** Revalida tudo que depende dos números comerciais do workspace (cockpit, listas, metas...). */
export function useInvalidateSales(workspaceId: string) {
  const { mutate } = useSWRConfig();
  return () => mutate((key) => Array.isArray(key) && SALES_CACHE_PREFIXES.includes(String(key[0])) && key[1] === workspaceId);
}
