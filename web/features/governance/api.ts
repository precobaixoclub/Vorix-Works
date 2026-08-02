import { apiClient } from "@/lib/api-client";
import type { AuditEvent, ComplianceReport, Credential, CredentialDetail, CredentialHealth, ExportResult } from "./types";

export function listCredentials(workspaceId: string): Promise<Credential[]> {
  return apiClient.get<Credential[]>(`/v1/credentials?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function getCredential(workspaceId: string, credentialId: string): Promise<CredentialDetail> {
  return apiClient.get<CredentialDetail>(`/v1/credentials/${encodeURIComponent(credentialId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function beginCredentialConnection(workspaceId: string): Promise<{ authorizationUrl: string; state: string; expiresAt: string }> {
  return apiClient.post<{ authorizationUrl: string; state: string; expiresAt: string }>("/v1/credentials/connect", { workspaceId });
}

export function rotateCredential(workspaceId: string, credentialId: string, reason: string): Promise<CredentialDetail> {
  return apiClient.post<CredentialDetail>("/v1/credentials/rotate", { workspaceId, credentialId, reason });
}

export function revokeCredential(workspaceId: string, credentialId: string, reason: string): Promise<CredentialDetail> {
  return apiClient.post<CredentialDetail>("/v1/credentials/revoke", { workspaceId, credentialId, reason });
}

export function disableCredential(workspaceId: string, credentialId: string, reason: string): Promise<CredentialDetail> {
  return apiClient.post<CredentialDetail>("/v1/credentials/disable", { workspaceId, credentialId, reason });
}

export function enableCredential(workspaceId: string, credentialId: string, reason: string): Promise<CredentialDetail> {
  return apiClient.post<CredentialDetail>("/v1/credentials/enable", { workspaceId, credentialId, reason });
}

export function checkCredentialHealth(workspaceId: string, credentialId: string): Promise<CredentialHealth> {
  return apiClient.post<CredentialHealth>("/v1/credentials/health-check", { workspaceId, credentialId });
}

export function exportCredentialHistory(workspaceId: string, credentialId: string, format: "json" | "csv"): Promise<ExportResult> {
  return apiClient.get<ExportResult>(`/v1/credentials/${encodeURIComponent(credentialId)}/export?workspaceId=${encodeURIComponent(workspaceId)}&format=${format}`);
}

export function listAuditEvents(workspaceId: string): Promise<AuditEvent[]> {
  return apiClient.get<AuditEvent[]>(`/v1/audit?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function exportAuditEvents(workspaceId: string, format: "json" | "csv"): Promise<ExportResult> {
  return apiClient.get<ExportResult>(`/v1/audit?workspaceId=${encodeURIComponent(workspaceId)}&format=${format}`);
}

export function getComplianceReport(workspaceId: string): Promise<ComplianceReport> {
  return apiClient.get<ComplianceReport>(`/v1/compliance?workspaceId=${encodeURIComponent(workspaceId)}`);
}
