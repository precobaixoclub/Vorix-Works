import { apiClient } from "@/lib/api-client";
import type {
  SocialAccountsResponse,
  SocialAuthorizedAccount,
  SocialComposeRequest,
  SocialComposerAccount,
  SocialConnectionCallbackResult,
  SocialDestinationCheck,
  SocialLatePolicy,
  SocialNetwork,
  SocialPostView,
  SocialProviderSwitchView,
  SocialSettings,
  SocialTenantOverview,
  SocialTenantPolicyView,
} from "./types";

const q = (workspaceId: string) => `workspaceId=${encodeURIComponent(workspaceId)}`;

/** Marca que o próximo retorno de OAuth pertence ao fluxo social (as páginas de callback são compartilhadas). */
export const SOCIAL_OAUTH_FLOW_KEY = "social:oauth-flow";

export const getSocialAccounts = (workspaceId: string) => apiClient.get<SocialAccountsResponse>(`/v1/social/accounts?${q(workspaceId)}`);
export const beginSocialConnection = (workspaceId: string, network: SocialNetwork, returnPath?: string) =>
  apiClient.post<{ redirectUrl: string }>("/v1/social/connections", { workspaceId, network, ...(returnPath ? { returnPath } : {}) });
export const completeSocialConnection = (network: SocialNetwork, state: string, code: string) =>
  apiClient.post<SocialConnectionCallbackResult>("/v1/social/connections/callback", { network, state, code });
export const getAuthorizedAccounts = (workspaceId: string, network: SocialNetwork) =>
  apiClient.get<{ accounts: SocialAuthorizedAccount[] }>(`/v1/social/connections/authorized?${q(workspaceId)}&network=${network}`);
export const syncSocialAccounts = (workspaceId: string, input: { network?: SocialNetwork; externalAccountIds?: string[] } = {}) =>
  apiClient.post<SocialAccountsResponse & { connected: number; reconnected: number; revoked: number }>(`/v1/social/accounts/sync?${q(workspaceId)}`, input);
export const testSocialAccount = (workspaceId: string, accountId: string) =>
  apiClient.post<{ healthy: boolean; message: string }>(`/v1/social/accounts/${encodeURIComponent(accountId)}/test?${q(workspaceId)}`);
export const disconnectSocialAccount = (workspaceId: string, accountId: string) =>
  apiClient.post<{ disconnected: boolean }>(`/v1/social/accounts/${encodeURIComponent(accountId)}/disconnect?${q(workspaceId)}`);

export const getComposerOptions = (workspaceId: string) => apiClient.get<{ accounts: SocialComposerAccount[] }>(`/v1/social/composer?${q(workspaceId)}`);
export const validateSocialPost = (request: SocialComposeRequest) => apiClient.post<{ destinations: SocialDestinationCheck[] }>("/v1/social/posts/validate", request);
export const createSocialPost = (request: SocialComposeRequest) => apiClient.post<SocialPostView>("/v1/social/posts", request);

export const listSocialPosts = (workspaceId: string, range: { from?: string; to?: string } = {}) =>
  apiClient.get<{ posts: SocialPostView[] }>(`/v1/social/posts?${q(workspaceId)}${range.from ? `&from=${encodeURIComponent(range.from)}` : ""}${range.to ? `&to=${encodeURIComponent(range.to)}` : ""}`);
export const getSocialPost = (workspaceId: string, postId: string) => apiClient.get<SocialPostView>(`/v1/social/posts/${encodeURIComponent(postId)}?${q(workspaceId)}`);
export const publishSocialPostNow = (workspaceId: string, postId: string) => apiClient.post<SocialPostView>(`/v1/social/posts/${encodeURIComponent(postId)}/publish-now?${q(workspaceId)}`);
export const cancelSocialPost = (workspaceId: string, postId: string) => apiClient.post<SocialPostView>(`/v1/social/posts/${encodeURIComponent(postId)}/cancel?${q(workspaceId)}`);
export const approveSocialPost = (workspaceId: string, postId: string) => apiClient.post<SocialPostView>(`/v1/social/posts/${encodeURIComponent(postId)}/approve?${q(workspaceId)}`);
export const rescheduleSocialPost = (workspaceId: string, postId: string, localDateTime: string, timezone?: string) =>
  apiClient.post<SocialPostView>(`/v1/social/posts/${encodeURIComponent(postId)}/reschedule?${q(workspaceId)}`, { localDateTime, ...(timezone ? { timezone } : {}) });

const destinationAction = <T>(workspaceId: string, destinationId: string, action: string, body?: unknown) =>
  apiClient.post<T>(`/v1/social/destinations/${encodeURIComponent(destinationId)}/${action}?${q(workspaceId)}`, body);
export const retrySocialDestination = (workspaceId: string, destinationId: string) => destinationAction<SocialPostView>(workspaceId, destinationId, "retry");
export const cancelSocialDestination = (workspaceId: string, destinationId: string) => destinationAction<SocialPostView>(workspaceId, destinationId, "cancel");
export const decideLateSocialDestination = (workspaceId: string, destinationId: string, decision: "publish" | "skip") => destinationAction<SocialPostView>(workspaceId, destinationId, "late-decision", { decision });
export const resolveUnknownSocialDestination = (workspaceId: string, destinationId: string, outcome: "published" | "not_published", externalUrl?: string) =>
  destinationAction<SocialPostView>(workspaceId, destinationId, "resolve-unknown", { outcome, ...(externalUrl ? { externalUrl } : {}) });

export const getSocialSettings = (workspaceId: string) => apiClient.get<SocialSettings>(`/v1/social/settings?${q(workspaceId)}`);
export const updateSocialLatePolicy = (workspaceId: string, network: SocialNetwork, latePolicy: SocialLatePolicy) =>
  apiClient.put<{ network: SocialNetwork; latePolicy: SocialLatePolicy }>(`/v1/social/settings/${network}?${q(workspaceId)}`, { latePolicy });

// ---------- Platform admin ----------
export const getSocialProviderSwitches = () => apiClient.get<{ providers: SocialProviderSwitchView[] }>("/v1/admin/social-providers");
export const setSocialProviderSwitch = (providerType: string, input: { enabled: boolean; approved?: boolean; reason?: string }) =>
  apiClient.put<SocialProviderSwitchView>(`/v1/admin/social-providers/${encodeURIComponent(providerType)}`, input);
export const getSocialTenantOverview = (tenantId: string) => apiClient.get<SocialTenantOverview>(`/v1/admin/social-providers/tenants/${encodeURIComponent(tenantId)}`);
export const setSocialTenantPolicy = (tenantId: string, network: SocialNetwork, input: { publishingEnabled?: boolean; preferredProvider?: string; enabledProviders?: string[] }) =>
  apiClient.put<SocialTenantPolicyView>(`/v1/admin/social-providers/tenants/${encodeURIComponent(tenantId)}/${network}`, input);
