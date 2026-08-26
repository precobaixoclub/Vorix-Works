/** Módulo Meta Ads Manager — Fase 1 (conexão + descoberta de contas de anúncio).
 * DELIBERADAMENTE separado de `web/features/meta/types.ts` (publicação de conteúdo) — ver
 * `src/application/ports/meta-ads-credential-repository.port.ts` no backend. */

export type MetaAdsCredentialReference = {
  credentialReferenceId: string;
  tenantId: string;
  workspaceId: string;
  providerId: "meta_ads";
  status: "active" | "disabled" | "revoked";
  environment?: "sandbox" | "production";
  providerSubjectId?: string;
  scopes?: readonly string[];
  expiresAt?: string;
  lastRefreshedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type MetaAdsOAuthStatus = {
  connected: boolean;
  configured: boolean;
  credentialReferences: readonly MetaAdsCredentialReference[];
};

export type MetaAdsOAuthBegin = {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
};

export type MetaAdsConnectedAccount = {
  accountId: string;
  name: string;
  currency: string;
  accountStatus?: number;
  businessName?: string;
};

export type MetaAdsOAuthComplete = {
  credentialReferenceId: string;
  accounts: readonly MetaAdsConnectedAccount[];
};

/** Fase 2 — hierarquia sincronizada da Marketing API. Ver
 * `src/application/ports/meta-ad-campaign-repository.port.ts` no backend. */
export type MetaAdEntityStatus = "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";

export type MetaAdCampaign = {
  id: string;
  adAccountId: string;
  campaignId: string;
  name: string;
  objective?: string;
  status: MetaAdEntityStatus;
  effectiveStatus?: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
  spend?: number;
  impressions?: number;
  clicks?: number;
  reach?: number;
  lastSyncedAt?: string;
  deletedAt?: string;
};

export type MetaAdSet = {
  id: string;
  campaignId: string;
  adAccountId: string;
  adSetId: string;
  name: string;
  status: MetaAdEntityStatus;
  effectiveStatus?: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
  spend?: number;
  impressions?: number;
  clicks?: number;
  reach?: number;
  deletedAt?: string;
};

export type MetaAdEntity = {
  id: string;
  adSetId: string;
  campaignId: string;
  adAccountId: string;
  adId: string;
  name: string;
  status: MetaAdEntityStatus;
  effectiveStatus?: string;
  spend?: number;
  impressions?: number;
  clicks?: number;
  reach?: number;
  deletedAt?: string;
};

export type MetaAdCampaignTree = {
  campaigns: readonly MetaAdCampaign[];
  adSets: readonly MetaAdSet[];
  ads: readonly MetaAdEntity[];
};

export type MetaAdCampaignSyncResult = { campaignsSynced: number; adSetsSynced: number; adsSynced: number };

/** Fase 3 — criação e edição. Toda entidade criada nasce PAUSADA; ativar é sempre uma chamada
 * separada de update com `status: "ACTIVE"`. */
export type CreateMetaAdCampaignInput = {
  adAccountId: string;
  name: string;
  objective: string;
  specialAdCategories?: readonly string[];
  dailyBudget?: number;
  lifetimeBudget?: number;
  buyingType?: string;
};

export type UpdateMetaAdCampaignInput = {
  name?: string;
  status?: "ACTIVE" | "PAUSED";
  dailyBudget?: number;
  lifetimeBudget?: number;
};

export type SimpleTargeting = { geoCountries: readonly string[]; ageMin?: number; ageMax?: number; genders?: readonly number[] };

export type CreateMetaAdSetInput = {
  campaignId: string;
  name: string;
  optimizationGoal: string;
  billingEvent: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
  bidAmount?: number;
  targeting: SimpleTargeting;
};

export type UpdateMetaAdSetInput = {
  name?: string;
  status?: "ACTIVE" | "PAUSED";
  dailyBudget?: number;
  lifetimeBudget?: number;
  bidAmount?: number;
};

export type CreateMetaAdInput = {
  adSetId: string;
  name: string;
  pageId: string;
  creative: {
    link: string;
    message?: string;
    headline?: string;
    description?: string;
    imageUrl?: string;
    callToActionType?: string;
  };
};

export type UpdateMetaAdInput = {
  name?: string;
  status?: "ACTIVE" | "PAUSED";
};

export type MetaAdAccount = {
  id: string;
  tenantId: string;
  workspaceId: string;
  credentialReferenceId: string;
  accountId: string;
  name: string;
  currency: string;
  accountStatus?: number;
  businessName?: string;
  timezoneName?: string;
  spendCap?: number;
  balance?: number;
  disableReason?: string;
  isActive: boolean;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** Fase 4 — públicos customizados/semelhantes, pixels e Conversions API. Ver
 * `src/application/ports/meta-custom-audience-repository.port.ts` no backend. */
export type MetaCustomAudience = {
  id: string;
  adAccountId: string;
  audienceId: string;
  name: string;
  /** Texto livre — a Marketing API tem ~15 subtypes reais, nunca uma enum fechada aqui. */
  subtype: string;
  description?: string;
  approximateCount?: number;
  lookalikeOriginAudienceId?: string;
  lookalikeRatio?: number;
  lookalikeCountry?: string;
  deletedAt?: string;
};

export type MetaCustomAudienceSyncResult = { audiencesSynced: number };

export type CreateMetaCustomAudienceInput = {
  adAccountId: string;
  name: string;
  description?: string;
  customers?: readonly { email?: string; phone?: string }[];
};

export type CreateMetaCustomAudienceResult = { audience: MetaCustomAudience; usersUploaded: number };

export type CreateMetaLookalikeAudienceInput = {
  originAudienceId: string;
  name: string;
  ratio: number;
  country: string;
};

export type MetaPixel = {
  id: string;
  adAccountId: string;
  pixelId: string;
  name: string;
  lastFiredTime?: string;
  isActive: boolean;
};

export type MetaPixelSyncResult = { pixelsSynced: number };

export type CreateMetaPixelInput = { adAccountId: string; name: string };

export type MetaCapiEventUserData = { email?: string; phone?: string; firstName?: string; lastName?: string; countryCode?: string };

export type SendMetaCapiEventInput = {
  eventName: string;
  eventTime?: string;
  eventId?: string;
  actionSource?: "website" | "app" | "phone_call" | "chat" | "email" | "other" | "physical_store" | "system_generated";
  userData: MetaCapiEventUserData;
  customData?: Record<string, unknown>;
  eventSourceUrl?: string;
  testEventCode?: string;
};

export type SendMetaCapiEventResult = { eventsReceived?: number; fbtraceId?: string };

export type MetaCapiEventRecord = {
  id: string;
  eventName: string;
  eventTime: string;
  actionSource: string;
  userDataFields: readonly string[];
  testEventCode?: string;
  status: "sent" | "failed";
  eventsReceived?: number;
  fbtraceId?: string;
  errorMessage?: string;
  createdAt: string;
};

export type MetaAdInterest = { id: string; name: string; audienceSize?: number; path?: readonly string[] };
