/** Espelha `src/domain/workspace/workspace.model.ts` (backend) — nunca importado diretamente, por
 * `web/` ser um pacote npm independente; o formato é mantido igual de propósito, ver `api.ts`. */

export type WorkspaceStatus = "active" | "inactive" | "archived";
export type WorkspaceMemberRole = "owner" | "admin" | "editor" | "viewer";

export type WorkspaceMember = {
  userId: string;
  role: WorkspaceMemberRole;
  addedAt: string;
};

export type WorkspaceIntegration = {
  id: string;
  channel: string;
  externalAccountId?: string;
  displayName?: string;
  status: "connected" | "disconnected" | "pending";
  connectedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceSettings = {
  timezone?: string;
  language?: string;
  defaultAspectRatio?: string;
  logoUrl?: string;
};

export type TenantCreditsSummary = {
  period: string;
  monthlyCreditsQuota: number;
  creditsExtra: number;
  creditsConsumedThisMonth: number;
  remainingCredits: number;
};

export type Workspace = {
  id: string;
  tenantId: string;
  name: string;
  kind?: string;
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  knowledge?: { clientId: string };
  campaignIds: string[];
  assetLibraryId?: string;
  integrations: WorkspaceIntegration[];
  members: WorkspaceMember[];
  settings: WorkspaceSettings;
};
