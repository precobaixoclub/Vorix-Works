import useSWR from "swr";
import { getComplianceReport, getCredential, listAuditEvents, listCredentials } from "./api";

export function useCredentials(workspaceId: string) {
  return useSWR(["credentials", workspaceId], () => listCredentials(workspaceId));
}

export function useCredential(workspaceId: string, credentialId?: string) {
  return useSWR(credentialId ? ["credential", workspaceId, credentialId] : null, () => getCredential(workspaceId, credentialId!));
}

export function useAuditEvents(workspaceId: string) {
  return useSWR(["audit-events", workspaceId], () => listAuditEvents(workspaceId));
}

export function useComplianceReport(workspaceId: string) {
  return useSWR(["compliance", workspaceId], () => getComplianceReport(workspaceId));
}
