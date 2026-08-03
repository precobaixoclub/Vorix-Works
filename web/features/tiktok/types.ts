export type TikTokConnectedAccount = {
  credentialReferenceId: string;
  openId: string;
  displayName?: string;
  avatarUrl?: string;
  status: string;
  scopes: readonly string[];
  expiresAt?: string;
  connectedAt?: string;
};

export type TikTokOAuthStatus = {
  connected: boolean;
  providerId: "tiktok";
  configured: boolean;
  accounts: readonly TikTokConnectedAccount[];
  telemetry: {
    oauthSuccess: number;
    oauthFailure: number;
    tokenRefreshSuccess: number;
    tokenRefreshFailure: number;
    lastFailureCode?: string;
  };
};

export type TikTokOAuthBegin = {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
};

export type TikTokOAuthComplete = {
  credentialReferenceId: string;
  providerSubjectId: string;
  displayName?: string;
};

export type TikTokPost = {
  publicationId: string;
  state: string;
  description: string;
  media: { videoUrl?: string; imageUrls: readonly string[] };
  scheduledAt?: string;
  timezone?: string;
  scheduleStatus?: string;
  createdAt: string;
  publishedAt?: string;
  cancelledAt?: string;
};

export type TikTokPrivacyLevel = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";

export type SchedulePostInput = {
  workspaceId: string;
  description: string;
  title?: string;
  videoUrl?: string;
  imageUrls?: string[];
  scheduledAt?: string;
  timezone?: string;
  privacyLevel?: TikTokPrivacyLevel;
  disableComment?: boolean;
  credentialReferenceId?: string;
};

export type SchedulePostResult = {
  publicationId: string;
  state: string;
  scheduledAt?: string;
  timezone?: string;
};
