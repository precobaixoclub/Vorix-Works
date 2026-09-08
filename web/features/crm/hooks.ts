import useSWR from "swr";
import { getContact, getContactTimeline, listContacts } from "./api";

export function useContacts(workspaceId: string, params?: { search?: string; ownerUserId?: string; teamId?: string }) {
  return useSWR(["contacts", workspaceId, params?.search, params?.ownerUserId, params?.teamId], () => listContacts(workspaceId, params));
}

export function useContact(contactId: string | undefined, workspaceId: string) {
  return useSWR(contactId ? ["contact", contactId, workspaceId] : null, () => getContact(contactId!, workspaceId));
}

export function useContactTimeline(contactId: string | undefined, workspaceId: string) {
  return useSWR(contactId ? ["contact-timeline", contactId, workspaceId] : null, () => getContactTimeline(contactId!, workspaceId));
}
