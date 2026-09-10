import useSWR from "swr";
import {
  getContact,
  getContactTimeline,
  getDealsSummary,
  getDealTimeline,
  getCommercialMetrics,
  getLeadScore,
  getProposalTimeline,
  listAutomationRules,
  listAutomationRunLogs,
  listCommercialSuggestions,
  listContacts,
  listDeals,
  listPipelines,
  listPipelineStages,
  listProducts,
  listProposals,
  listTasks,
} from "./api";
import type { CommercialMetricsParams, ListDealsParams } from "./api";
import type { CommercialSuggestionStatus, ProposalStatus, TaskStatus } from "./types";

export function useContacts(workspaceId: string, params?: { search?: string; ownerUserId?: string; teamId?: string }) {
  return useSWR(["contacts", workspaceId, params?.search, params?.ownerUserId, params?.teamId], () => listContacts(workspaceId, params));
}

export function useContact(contactId: string | undefined, workspaceId: string) {
  return useSWR(contactId ? ["contact", contactId, workspaceId] : null, () => getContact(contactId!, workspaceId));
}

export function useContactTimeline(contactId: string | undefined, workspaceId: string) {
  return useSWR(contactId ? ["contact-timeline", contactId, workspaceId] : null, () => getContactTimeline(contactId!, workspaceId));
}

export function usePipelines(workspaceId: string) {
  return useSWR(["pipelines", workspaceId], () => listPipelines(workspaceId));
}

export function usePipelineStages(pipelineId: string | undefined, workspaceId: string) {
  return useSWR(pipelineId ? ["pipeline-stages", pipelineId, workspaceId] : null, () => listPipelineStages(pipelineId!, workspaceId));
}

export function useDeals(workspaceId: string, params?: ListDealsParams) {
  return useSWR(
    ["deals", workspaceId, params?.pipelineId, params?.stageId, params?.contactId, params?.ownerUserId, params?.teamId, params?.origin, params?.search],
    () => listDeals(workspaceId, params),
  );
}

export function useDealsSummary(workspaceId: string, pipelineId: string | undefined, params?: Omit<ListDealsParams, "pipelineId" | "stageId">) {
  return useSWR(
    pipelineId ? ["deals-summary", workspaceId, pipelineId, params?.ownerUserId, params?.teamId, params?.origin, params?.search] : null,
    () => getDealsSummary(workspaceId, pipelineId!, params),
  );
}

export function useDealTimeline(dealId: string | undefined, workspaceId: string) {
  return useSWR(dealId ? ["deal-timeline", dealId, workspaceId] : null, () => getDealTimeline(dealId!, workspaceId));
}

export function useTasks(workspaceId: string, params?: { contactId?: string; dealId?: string; ownerUserId?: string; status?: TaskStatus }) {
  return useSWR(
    ["tasks", workspaceId, params?.contactId, params?.dealId, params?.ownerUserId, params?.status],
    () => listTasks(workspaceId, params),
  );
}

export function useProducts(workspaceId: string, params?: { search?: string; activeOnly?: boolean }) {
  return useSWR(["products", workspaceId, params?.search, params?.activeOnly], () => listProducts(workspaceId, params));
}

export function useProposals(workspaceId: string, params?: { dealId?: string; contactId?: string; status?: ProposalStatus }) {
  return useSWR(["proposals", workspaceId, params?.dealId, params?.contactId, params?.status], () => listProposals(workspaceId, params));
}

export function useProposalTimeline(proposalId: string | undefined, workspaceId: string) {
  return useSWR(proposalId ? ["proposal-timeline", proposalId, workspaceId] : null, () => getProposalTimeline(proposalId!, workspaceId));
}

export function useLeadScore(contactId: string | undefined, workspaceId: string) {
  return useSWR(contactId ? ["lead-score", contactId, workspaceId] : null, () => getLeadScore(contactId!, workspaceId));
}

export function useCommercialSuggestions(workspaceId: string, params?: { contactId?: string; status?: CommercialSuggestionStatus }) {
  return useSWR(["commercial-suggestions", workspaceId, params?.contactId, params?.status], () => listCommercialSuggestions(workspaceId, params));
}

export function useAutomationRules(workspaceId: string) {
  return useSWR(["automation-rules", workspaceId], () => listAutomationRules(workspaceId));
}

export function useAutomationRunLogs(ruleId: string | undefined, workspaceId: string) {
  return useSWR(ruleId ? ["automation-run-logs", ruleId, workspaceId] : null, () => listAutomationRunLogs(ruleId!, workspaceId));
}

export function useCommercialMetrics(workspaceId: string, params?: CommercialMetricsParams) {
  return useSWR(
    ["commercial-metrics", workspaceId, params?.pipelineId, params?.ownerUserId, params?.teamId, params?.origin, params?.dateFrom, params?.dateTo],
    () => getCommercialMetrics(workspaceId, params),
  );
}
