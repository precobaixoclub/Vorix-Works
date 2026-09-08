import { apiClient } from "@/lib/api-client";
import type { Team, TeamMembership, TenantMemberInvite, TenantMembership as TenantMembershipType, TenantRole } from "./types";

export function listTeams(workspaceId: string): Promise<Team[]> {
  return apiClient.get<Team[]>(`/v1/teams?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function createTeam(workspaceId: string, name: string): Promise<Team> {
  return apiClient.post<Team>("/v1/teams", { workspaceId, name });
}

export function updateTeam(teamId: string, workspaceId: string, name: string): Promise<Team> {
  return apiClient.patch<Team>(`/v1/teams/${encodeURIComponent(teamId)}`, { workspaceId, name });
}

export function deleteTeam(teamId: string, workspaceId: string): Promise<void> {
  return apiClient.delete<void>(`/v1/teams/${encodeURIComponent(teamId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listTeamMembers(teamId: string, workspaceId: string): Promise<TeamMembership[]> {
  return apiClient.get<TeamMembership[]>(`/v1/teams/${encodeURIComponent(teamId)}/members?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function addTeamMember(teamId: string, workspaceId: string, userId: string, role: TenantRole): Promise<TeamMembership> {
  return apiClient.post<TeamMembership>(`/v1/teams/${encodeURIComponent(teamId)}/members`, { workspaceId, userId, role });
}

export function removeTeamMember(teamId: string, workspaceId: string, userId: string): Promise<void> {
  return apiClient.delete<void>(`/v1/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function listTenantMembers(): Promise<TenantMembershipType[]> {
  return apiClient.get<TenantMembershipType[]>("/v1/tenant-members");
}

export function listTenantInvites(): Promise<TenantMemberInvite[]> {
  return apiClient.get<TenantMemberInvite[]>("/v1/tenant-members/invites");
}

export function inviteTenantMember(email: string, role: TenantRole): Promise<TenantMemberInvite> {
  return apiClient.post<TenantMemberInvite>("/v1/tenant-members/invites", { email, role });
}

export function revokeTenantInvite(inviteId: string): Promise<TenantMemberInvite> {
  return apiClient.post<TenantMemberInvite>(`/v1/tenant-members/invites/${encodeURIComponent(inviteId)}/revoke`, {});
}

export function updateTenantMemberRole(userId: string, role: TenantRole): Promise<TenantMembershipType> {
  return apiClient.patch<TenantMembershipType>(`/v1/tenant-members/${encodeURIComponent(userId)}`, { role });
}

export function removeTenantMember(userId: string): Promise<void> {
  return apiClient.delete<void>(`/v1/tenant-members/${encodeURIComponent(userId)}`);
}
