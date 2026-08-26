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
