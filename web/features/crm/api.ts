import { apiClient } from "@/lib/api-client";
import type { Contact, ContactChannel, ContactIdentity, TimelineEvent } from "./types";

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
