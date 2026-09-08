import useSWR from "swr";
import { listTeamMembers, listTeams, listTenantInvites, listTenantMembers } from "./api";

export function useTeams(workspaceId: string) {
  return useSWR(["teams", workspaceId], () => listTeams(workspaceId));
}

export function useTeamMembers(teamId: string | undefined, workspaceId: string) {
  return useSWR(teamId ? ["team-members", teamId, workspaceId] : null, () => listTeamMembers(teamId!, workspaceId));
}

export function useTenantMembers() {
  return useSWR("tenant-members", () => listTenantMembers());
}

export function useTenantInvites() {
  return useSWR("tenant-member-invites", () => listTenantInvites());
}
