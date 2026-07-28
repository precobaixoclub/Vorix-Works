import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";

export type TenantPlanCode = "FREE" | "START" | "PRO" | "BUSINESS" | "ENTERPRISE";

export type TenantStatus = "created" | "active" | "suspended" | "deleted";

export type TenantSubscriptionStatus = "trial" | "active" | "past_due" | "cancelled" | "expired";

export type TenantEnvironment = "development" | "production";

export type TenantSocialNetwork =
  | "meta"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "tiktok"
  | "threads"
  | "youtube"
  | "google_business";

export type TenantIntegrationStatus = "not_connected" | "connected" | "disconnected" | "expired";

export type TenantActor = {
  id: string;
  type: "valentina" | "arthur" | "caio" | "helena" | "clara" | "icaro" | "specialist" | "system" | "human";
  name?: string;
};

export type TenantAuditMetadata = {
  actor: TenantActor;
  reason?: string;
  correlationId?: string;
};

export type TenantPlanLimits = {
  monthlyAiTokens: number | "unlimited";
  dailyAiTokens: number | "unlimited";
  specialists: SkillCapability[] | "all";
  features: string[] | "all";
  integrations: TenantSocialNetwork[] | "all";
  monthlyPublications: number | "unlimited";
  monthlyCampaigns: number | "unlimited";
  monthlyImages: number | "unlimited";
  monthlyVideos: number | "unlimited";
};

export type TenantPlanDefinition = {
  code: TenantPlanCode;
  name: string;
  description: string;
  limits: TenantPlanLimits;
};

export type TenantIntegration = {
  network: TenantSocialNetwork;
  status: TenantIntegrationStatus;
  connectedAt?: string;
  disconnectedAt?: string;
  tokenReference?: string;
  scopes?: string[];
  expiresAt?: string;
  metadata?: Record<string, unknown>;
};

export type TenantCredits = {
  addedAiTokens: number;
  consumedExtraAiTokens: number;
  availableExtraAiTokens: number;
};

export type TenantMonthlyConsumption = {
  period: string;
  aiTokens: number;
  estimatedCost: number;
  realCost: number;
  publications: number;
  campaigns: number;
  images: number;
  videos: number;
  dailyAiTokens: Record<string, number>;
};

export type TenantUsageHistory = {
  monthly: TenantMonthlyConsumption[];
};

export type TenantPreferences = {
  aiPriority?: "quality" | "balanced" | "cost" | "speed";
  defaultTone?: string;
  approvalRequired?: boolean;
  [key: string]: unknown;
};

export type TenantSettings = {
  timezone: string;
  language: string;
  country: string;
  environment: TenantEnvironment;
  preferences: TenantPreferences;
  general?: Record<string, unknown>;
};

export type TenantPermissions = {
  canPublish: boolean;
  canCreateCampaigns: boolean;
  canUsePaidAds: boolean;
  canUseImageGeneration: boolean;
  canUseVideoGeneration: boolean;
};

export type TenantRecord = {
  id: string;
  clientId: string;
  displayName: string;
  status: TenantStatus;
  subscriptionStatus: TenantSubscriptionStatus;
  plan: TenantPlanCode;
  planLimits: TenantPlanLimits;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
  expiresAt?: string;
  suspendedAt?: string;
  deletedAt?: string;
  niche?: string;
  mainObjectives: string[];
  connectedSocialNetworks: TenantSocialNetwork[];
  integrations: Partial<Record<TenantSocialNetwork, TenantIntegration>>;
  credits: TenantCredits;
  usage: TenantUsageHistory;
  enabledSpecialists: SkillCapability[] | "all";
  enabledFeatures: string[] | "all";
  permissions: TenantPermissions;
  settings: TenantSettings;
  currentVersion: number;
  versions: TenantVersion[];
  history: TenantHistoryEntry[];
};

export type TenantVersion = {
  version: number;
  createdAt: string;
  createdBy: TenantActor;
  reason?: string;
  snapshot: Omit<TenantRecord, "versions" | "history">;
  changeSummary: string;
};

export type TenantHistoryEntry = {
  id: string;
  occurredAt: string;
  action:
    | "created"
    | "updated"
    | "activated"
    | "suspended"
    | "plan_changed"
    | "credits_consumed"
    | "credits_added"
    | "integration_connected"
    | "integration_disconnected"
    | "deleted";
  actor: TenantActor;
  reason?: string;
  version: number;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
};

export type CreateTenantInput = {
  clientId?: string;
  displayName: string;
  plan?: TenantPlanCode;
  subscriptionStatus?: TenantSubscriptionStatus;
  timezone: string;
  language: string;
  country: string;
  environment: TenantEnvironment;
  niche?: string;
  mainObjectives?: string[];
  preferences?: TenantPreferences;
  generalSettings?: Record<string, unknown>;
  expiresAt?: string;
  audit: TenantAuditMetadata;
};

export type UpdateTenantInput = {
  tenantId: string;
  patch: Partial<Pick<TenantRecord,
    | "displayName"
    | "status"
    | "subscriptionStatus"
    | "expiresAt"
    | "niche"
    | "mainObjectives"
    | "enabledSpecialists"
    | "enabledFeatures"
    | "permissions"
  >> & {
    settings?: Partial<TenantSettings>;
    preferences?: TenantPreferences;
  };
  audit: TenantAuditMetadata;
};

export type TenantActionInput = {
  tenantId: string;
  audit: TenantAuditMetadata;
};

export type ChangeTenantPlanInput = TenantActionInput & {
  plan: TenantPlanCode;
  expiresAt?: string;
};

export type TenantConsumptionInput = TenantActionInput & {
  aiTokens?: number;
  estimatedCost?: number;
  realCost?: number;
  publications?: number;
  campaigns?: number;
  images?: number;
  videos?: number;
  occurredAt?: string;
};

export type TenantCreditsInput = TenantActionInput & {
  aiTokens: number;
};

export type TenantIntegrationInput = TenantActionInput & {
  network: TenantSocialNetwork;
  tokenReference?: string;
  scopes?: string[];
  expiresAt?: string;
  metadata?: Record<string, unknown>;
};

export type TenantQuery = {
  tenantId?: string;
  clientId?: string;
  status?: TenantStatus | "all";
  plan?: TenantPlanCode;
  environment?: TenantEnvironment;
  limit?: number;
};

export type TenantLimitCheckRequest = {
  tenantId: string;
  capability?: SkillCapability;
  feature?: string;
  integration?: TenantSocialNetwork;
  expectedConsumption?: Omit<TenantConsumptionInput, "tenantId" | "audit">;
};

export type TenantLimitCheckResult = {
  allowed: boolean;
  reasons: string[];
  tenant: TenantRecord;
};

export type TenantClientContext = {
  tenantId: string;
  clientId: string;
  plan: TenantPlanCode;
  status: TenantStatus;
  subscriptionStatus: TenantSubscriptionStatus;
  timezone: string;
  language: string;
  country: string;
  environment: TenantEnvironment;
  aiPriority?: TenantPreferences["aiPriority"];
  enabledSpecialists: SkillCapability[] | "all";
  enabledFeatures: string[] | "all";
  planLimits: TenantPlanLimits;
};

export type ValentinaIdGenerator = {
  create(prefix: string): string;
};
