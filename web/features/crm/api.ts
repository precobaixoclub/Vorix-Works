import { apiClient } from "@/lib/api-client";
import type { Contact, ContactChannel, ContactIdentity, Deal, DealStageSummary, Pipeline, PipelineStage, TimelineEvent } from "./types";

export type CreateContactInput = {
  workspaceId: string;
  name: string;
  company?: string;
  document?: string;
  origin?: string;
  ownerUserId?: string;
  teamId?: string;
  tags?: readonly string[];
  notes?: string;
};

export function listContacts(workspaceId: string, params?: { search?: string; ownerUserId?: string; teamId?: string }): Promise<Contact[]> {
  const query = new URLSearchParams({ workspaceId, ...(params?.search ? { search: params.search } : {}), ...(params?.ownerUserId ? { ownerUserId: params.ownerUserId } : {}), ...(params?.teamId ? { teamId: params.teamId } : {}) });
  return apiClient.get<Contact[]>(`/v1/contacts?${query.toString()}`);
}

export function getContact(contactId: string, workspaceId: string): Promise<Contact> {
  return apiClient.get<Contact>(`/v1/contacts/${encodeURIComponent(contactId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function createContact(input: CreateContactInput): Promise<Contact> {
  return apiClient.post<Contact>("/v1/contacts", input);
}

export function updateContact(contactId: string, workspaceId: string, patch: Partial<CreateContactInput>): Promise<Contact> {
  return apiClient.patch<Contact>(`/v1/contacts/${encodeURIComponent(contactId)}`, { workspaceId, ...patch });
}

export function getContactTimeline(contactId: string, workspaceId: string): Promise<TimelineEvent[]> {
  return apiClient.get<TimelineEvent[]>(`/v1/contacts/${encodeURIComponent(contactId)}/timeline?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function linkContactIdentity(contactId: string, workspaceId: string, channel: ContactChannel, externalId: string): Promise<ContactIdentity> {
  return apiClient.post<ContactIdentity>(`/v1/contacts/${encodeURIComponent(contactId)}/identities`, { workspaceId, channel, externalId });
}

// ---------------------------------------------------------------------------------------------
// Pipelines / Etapas / Negócios (Fase 2 — Kanban)
// ---------------------------------------------------------------------------------------------

export function listPipelines(workspaceId: string): Promise<Pipeline[]> {
  return apiClient.get<Pipeline[]>(`/v1/pipelines?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listPipelineStages(pipelineId: string, workspaceId: string): Promise<PipelineStage[]> {
  return apiClient.get<PipelineStage[]>(`/v1/pipelines/${encodeURIComponent(pipelineId)}/stages?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export type ListDealsParams = { pipelineId?: string; stageId?: string; ownerUserId?: string; teamId?: string; origin?: string; search?: string };

export function listDeals(workspaceId: string, params?: ListDealsParams): Promise<Deal[]> {
  const query = new URLSearchParams({ workspaceId });
  if (params?.pipelineId) query.set("pipelineId", params.pipelineId);
  if (params?.stageId) query.set("stageId", params.stageId);
  if (params?.ownerUserId) query.set("ownerUserId", params.ownerUserId);
  if (params?.teamId) query.set("teamId", params.teamId);
  if (params?.origin) query.set("origin", params.origin);
  if (params?.search) query.set("search", params.search);
  return apiClient.get<Deal[]>(`/v1/deals?${query.toString()}`);
}

export function getDealsSummary(workspaceId: string, pipelineId: string, params?: Omit<ListDealsParams, "pipelineId" | "stageId">): Promise<DealStageSummary[]> {
  const query = new URLSearchParams({ workspaceId, pipelineId });
  if (params?.ownerUserId) query.set("ownerUserId", params.ownerUserId);
  if (params?.teamId) query.set("teamId", params.teamId);
  if (params?.origin) query.set("origin", params.origin);
  if (params?.search) query.set("search", params.search);
  return apiClient.get<DealStageSummary[]>(`/v1/deals/summary?${query.toString()}`);
}

export type CreateDealInput = {
  workspaceId: string;
  pipelineId: string;
  stageId: string;
  contactId?: string;
  title: string;
  valueCents?: number;
  ownerUserId?: string;
  teamId?: string;
  origin?: string;
  expectedCloseDate?: string;
};

export function createDeal(input: CreateDealInput): Promise<Deal> {
  return apiClient.post<Deal>("/v1/deals", input);
}

export function getDeal(dealId: string, workspaceId: string): Promise<Deal> {
  return apiClient.get<Deal>(`/v1/deals/${encodeURIComponent(dealId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function updateDeal(dealId: string, workspaceId: string, patch: Partial<Omit<CreateDealInput, "workspaceId" | "pipelineId" | "stageId">>): Promise<Deal> {
  return apiClient.patch<Deal>(`/v1/deals/${encodeURIComponent(dealId)}`, { workspaceId, ...patch });
}

export function moveDealStage(dealId: string, workspaceId: string, stageId: string, lossReason?: string): Promise<Deal> {
  return apiClient.post<Deal>(`/v1/deals/${encodeURIComponent(dealId)}/move-stage`, { workspaceId, stageId, lossReason });
}

export function getDealTimeline(dealId: string, workspaceId: string): Promise<TimelineEvent[]> {
  return apiClient.get<TimelineEvent[]>(`/v1/deals/${encodeURIComponent(dealId)}/timeline?workspaceId=${encodeURIComponent(workspaceId)}`);
}
