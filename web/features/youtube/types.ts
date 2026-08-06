export type YouTubeConnectedAccount = {
  credentialReferenceId: string;
  channelId: string;
  displayName?: string;
  avatarUrl?: string;
  status: string;
  scopes: readonly string[];
  expiresAt?: string;
  connectedAt?: string;
};

export type YouTubeOAuthStatus = {
  connected: boolean;
  providerId: "youtube";
  configured: boolean;
  accounts: readonly YouTubeConnectedAccount[];
  telemetry: {
    oauthSuccess: number;
    oauthFailure: number;
    tokenRefreshSuccess: number;
    tokenRefreshFailure: number;
    lastFailureCode?: string;
  };
};

export type YouTubeOAuthBegin = {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
};

export type YouTubeOAuthComplete = {
  credentialReferenceId: string;
  providerSubjectId: string;
  displayName?: string;
};

export type YouTubePost = {
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

export type YouTubePrivacyStatus = "public" | "unlisted" | "private";

export type ScheduleYouTubePostInput = {
  workspaceId: string;
  title?: string;
  description: string;
  videoUrl: string;
  scheduledAt?: string;
  timezone?: string;
  privacyStatus?: YouTubePrivacyStatus;
  tags?: string[];
  categoryId?: string;
  credentialReferenceId?: string;
};

export type ScheduleYouTubePostResult = {
  publicationId: string;
  state: string;
  scheduledAt?: string;
  timezone?: string;
};
