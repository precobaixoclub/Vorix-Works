import useSWR from "swr";
import { getContact, getContactTimeline, getDealsSummary, getDealTimeline, listContacts, listDeals, listPipelines, listPipelineStages } from "./api";
import type { ListDealsParams } from "./api";

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
    ["deals", workspaceId, params?.pipelineId, params?.stageId, params?.ownerUserId, params?.teamId, params?.origin, params?.search],
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
