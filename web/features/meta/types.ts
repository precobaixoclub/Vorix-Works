export type MetaTarget = "instagram" | "facebook";

export type MetaConnectedAccount = {
  credentialReferenceId: string;
  providerId: MetaTarget;
  providerSubjectId: string;
  displayName?: string;
  avatarUrl?: string;
  status: string;
  scopes: readonly string[];
  expiresAt?: string;
  connectedAt?: string;
};

export type MetaOAuthStatus = {
  connected: boolean;
  configured: boolean;
  accounts: readonly MetaConnectedAccount[];
  telemetry: {
    oauthSuccess: number;
    oauthFailure: number;
    tokenRefreshSuccess: number;
    tokenRefreshFailure: number;
    lastFailureCode?: string;
  };
};

export type MetaOAuthBegin = {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
};

export type MetaOAuthComplete = {
  accounts: readonly MetaConnectedAccount[];
};

export type MetaPost = {
  publicationId: string;
  target: MetaTarget;
  placement: "feed" | "story";
  state: string;
  caption: string;
  media: { videoUrl?: string; imageUrls: readonly string[] };
  scheduledAt?: string;
  timezone?: string;
  scheduleStatus?: string;
  createdAt: string;
  publishedAt?: string;
  cancelledAt?: string;
};

export type SchedulePostInput = {
  workspaceId: string;
  target?: MetaTarget;
  placement?: "feed" | "story";
  caption: string;
  videoUrl?: string;
  imageUrls?: string[];
  thumbnailUrl?: string;
  scheduledAt?: string;
  timezone?: string;
  credentialReferenceId?: string;
};

export type SchedulePostResult = {
  publicationId: string;
  state: string;
  scheduledAt?: string;
  timezone?: string;
};
