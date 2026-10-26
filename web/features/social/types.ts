/** Espelha as visões públicas de `/v1/social/*` (backend). Nada técnico: sem token, provider ou credencial. */

export type SocialNetwork = "instagram" | "facebook" | "tiktok";
export const SOCIAL_NETWORKS: readonly SocialNetwork[] = ["instagram", "facebook", "tiktok"];

export type SocialPostFormat = "feed_image" | "feed_video" | "carousel" | "story_image" | "story_video" | "reel" | "short_video" | "photo_post";
export type SocialFeature = "caption" | "hashtags" | "mentions" | "location" | "link" | "nativeMusic" | "embeddedAudio" | "musicSegment";
export type SocialConnectionStatus = "CONNECTED" | "HEALTHY" | "REAUTH_REQUIRED" | "CHECKPOINT_REQUIRED" | "DISCONNECTED" | "TEMPORARY_ERROR" | "DISABLED";
export type SocialDestinationState = "DRAFT" | "AWAITING_APPROVAL" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED" | "RECONCILIATION_REQUIRED" | "WAITING_REAUTH" | "AWAITING_CONFIRMATION" | "PAUSED" | "CANCELLED" | "SKIPPED";
export type SocialPostState = "DRAFT" | "AWAITING_APPROVAL" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "PARTIAL_SUCCESS" | "FAILED" | "RECONCILIATION_REQUIRED" | "WAITING_REAUTH" | "CANCELLED";
export type SocialDestinationAction = "retry" | "cancel" | "confirm_late" | "skip_late" | "reconnect" | "resolve_unknown";
export type SocialAudioMode = "NONE" | "NATIVE_PLATFORM_MUSIC" | "EMBEDDED_AUDIO";

export type SocialAccountView = {
  id: string;
  network: SocialNetwork;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  status: SocialConnectionStatus;
  statusLabel: string;
  needsReconnect: boolean;
  connectedAt?: string;
  lastSyncAt?: string;
  lastSuccessfulPublishAt?: string;
  nextPublicationAt?: string;
  waitingPublications: number;
  problem?: string;
};

export type SocialNetworkAvailability = { network: SocialNetwork; canConnect: boolean; message?: string };

export type SocialAccountsResponse = { accounts: SocialAccountView[]; networks: SocialNetworkAvailability[] };

export type SocialAuthorizedAccount = { externalAccountId: string; username?: string; displayName?: string; avatarUrl?: string; alreadyConnected: boolean };

export type SocialConnectionCallbackResult = { workspaceId: string; network: SocialNetwork; returnPath?: string; autoConnected: boolean; accounts: SocialAuthorizedAccount[] };

export type SocialComposerFormat = { format: SocialPostFormat; label: string; features: readonly SocialFeature[]; maxItems: number; kinds: readonly ("image" | "video")[]; maxCaptionLength: number };

export type SocialComposerAccount = {
  accountId: string;
  network: SocialNetwork;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  publishable: boolean;
  warning?: string;
  formats: SocialComposerFormat[];
  musicSearch: boolean;
};

export type SocialMediaItem = { url: string; kind: "image" | "video"; mimeType?: string; width?: number; height?: number; durationSec?: number; sizeBytes?: number; hasAudio?: boolean; coverUrl?: string };

export type SocialMusicSelection = { musicId: string; title: string; artist?: string; coverUrl?: string; durationSec?: number; segmentStartSec?: number; segmentDurationSec?: number; providerData?: Record<string, string> };

export type SocialValidationIssue = { field: "media" | "caption" | "music" | "format"; code: string; message: string };

export type SocialDestinationCheck = { accountId: string; network: SocialNetwork; format: SocialPostFormat; issues: SocialValidationIssue[]; warnings: string[] };

export type SocialDestinationView = {
  id: string;
  accountId: string;
  network: SocialNetwork;
  username?: string;
  format: SocialPostFormat;
  formatLabel: string;
  caption: string;
  hashtags: readonly string[];
  media: readonly SocialMediaItem[];
  music?: SocialMusicSelection;
  audioMode: SocialAudioMode;
  scheduledAt?: string;
  timezone?: string;
  state: SocialDestinationState;
  attemptCount: number;
  lastAttemptAt?: string;
  publishedAt?: string;
  externalPostId?: string;
  externalUrl?: string;
  problem?: string;
  actions: SocialDestinationAction[];
};

export type SocialHistoryEntry = { at: string; kind: string; label: string; network?: SocialNetwork; scheduledFor?: string };

export type SocialPostView = {
  id: string;
  state: SocialPostState;
  scheduledAt?: string;
  timezone?: string;
  createdAt: string;
  requiresApproval: boolean;
  destinations: SocialDestinationView[];
  history: SocialHistoryEntry[];
};

export type SocialLatePolicy = { toleranceMinutes: number; whenLate: "PUBLISH_ON_RECONNECT" | "ASK_CONFIRMATION" | "SKIP" };

export type SocialSettings = { networks: { network: SocialNetwork; latePolicy: SocialLatePolicy; rateLimits: Record<string, number> }[]; timezone: string };

export type SocialComposeRequest = {
  workspaceId: string;
  idempotencyKey: string;
  base: { caption: string; hashtags: string[]; media: SocialMediaItem[] };
  destinations: { accountId: string; format: SocialPostFormat; caption?: string; hashtags?: string[]; audioMode?: SocialAudioMode }[];
  when: { mode: "now" } | { mode: "schedule"; localDateTime: string; timezone?: string };
  source?: { executionRunId?: string };
};

// ---------- Admin (platform) ----------
export type SocialProviderSwitchView = { providerType: string; enabled: boolean; approved: boolean; reason?: string; updatedAt?: string; implemented: boolean; configured: boolean; realPublishingValidated: boolean; networks: SocialNetwork[] };

export type SocialProviderAvailabilityView = { providerType: string; implemented: boolean; configured: boolean; enabled: boolean; approved: boolean; tenantEnabled: boolean; realPublishingValidated: boolean };

export type SocialTenantPolicyView = { tenantId: string; network: SocialNetwork; publishingEnabled: boolean; preferredProvider: string; enabledProviders: string[]; latePolicy: SocialLatePolicy };

export type SocialTenantOverview = {
  tenantId: string;
  networks: { network: SocialNetwork; policy: SocialTenantPolicyView; providers: SocialProviderAvailabilityView[]; accounts: { id: string; username?: string; status: SocialConnectionStatus; providerType: string; connectedProviders: string[] }[] }[];
};
