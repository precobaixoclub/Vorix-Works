export type KwaiConnectedAccount = {
  credentialReferenceId: string;
  openId: string;
  displayName?: string;
  avatarUrl?: string;
  status: string;
  scopes: readonly string[];
  expiresAt?: string;
  connectedAt?: string;
};

export type KwaiOAuthStatus = {
  connected: boolean;
  providerId: "kwai";
  configured: boolean;
  accounts: readonly KwaiConnectedAccount[];
  telemetry: {
    oauthSuccess: number;
    oauthFailure: number;
    tokenRefreshSuccess: number;
    tokenRefreshFailure: number;
    lastFailureCode?: string;
  };
};

export type KwaiOAuthBegin = {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
};

export type KwaiOAuthComplete = {
  credentialReferenceId: string;
  providerSubjectId: string;
  displayName?: string;
};

export type KwaiPost = {
  publicationId: string;
  state: string;
  caption: string;
  media: { videoUrl?: string; thumbnailUrl?: string };
  scheduledAt?: string;
  timezone?: string;
  scheduleStatus?: string;
  createdAt: string;
  publishedAt?: string;
  cancelledAt?: string;
};

export type SchedulePostInput = {
  workspaceId: string;
  caption: string;
  videoUrl: string;
  thumbnailUrl: string;
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
