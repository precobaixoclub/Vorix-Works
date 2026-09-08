import { apiClient } from "@/lib/api-client";
import type { TenantMemberInvite, TenantRole } from "@/features/identity/types";
import type { MessagingConnection } from "@/features/inbox/types";
import type { OnboardingGoal, WorkspaceOnboarding } from "./types";

/** Rotas `/v1/onboarding/*`. Toda ação real (convidar, conectar canal) delega para o módulo dono
 * daquilo no backend — este cliente só espelha isso, nunca reimplementa. */

export function getOnboarding(workspaceId: string): Promise<WorkspaceOnboarding | null> {
  return apiClient.get(`/v1/onboarding?workspaceId=${encodeURIComponent(workspaceId)}`);
}

export function startOnboarding(workspaceId: string): Promise<WorkspaceOnboarding> {
  return apiClient.post("/v1/onboarding/start", { workspaceId });
}

export function saveOnboardingCompanyStep(workspaceId: string, input: { segment?: string; size?: string; goal?: OnboardingGoal }): Promise<WorkspaceOnboarding> {
  return apiClient.patch("/v1/onboarding/company", { workspaceId, ...input });
}

export function inviteTeamMemberDuringOnboarding(workspaceId: string, email: string, role: TenantRole): Promise<{ invite: TenantMemberInvite; alreadyPending: boolean }> {
  return apiClient.post("/v1/onboarding/invite-team-member", { workspaceId, email, role });
}

export function connectChannelDuringOnboarding(workspaceId: string, displayName: string): Promise<{ connection: MessagingConnection; reused: boolean }> {
  return apiClient.post("/v1/onboarding/connect-channel", { workspaceId, displayName });
}

export function advanceOnboardingStep(workspaceId: string, step: string, skipped?: boolean): Promise<WorkspaceOnboarding> {
  return apiClient.post("/v1/onboarding/advance", { workspaceId, step, skipped });
}

export function completeOnboarding(workspaceId: string): Promise<WorkspaceOnboarding> {
  return apiClient.post("/v1/onboarding/complete", { workspaceId });
}
