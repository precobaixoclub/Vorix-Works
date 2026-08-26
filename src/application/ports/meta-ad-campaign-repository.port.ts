/** Campanhas de anúncio sincronizadas da Marketing API — módulo Meta Ads Manager, Fase 2. Ver
 * `db/migrations/0070_meta_ad_campaigns.sql`. */

export const META_AD_ENTITY_STATUSES = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"] as const;
export type MetaAdEntityStatus = (typeof META_AD_ENTITY_STATUSES)[number];

export type MetaAdCampaign = {
  id: string;
  tenantId: string;
  workspaceId: string;
  adAccountId: string;
  /** id da campanha na Meta — nunca o id interno (`id`). */
  campaignId: string;
  name: string;
  objective?: string;
  status: MetaAdEntityStatus;
  effectiveStatus?: string;
  buyingType?: string;
  specialAdCategories?: readonly string[];
  dailyBudget?: number;
  lifetimeBudget?: number;
  budgetRemaining?: number;
  spend?: number;
  impressions?: number;
  clicks?: number;
  reach?: number;
  /** Blob bruto de `insights{}` da Marketing API — preservado integralmente. */
  insights?: unknown;
  startTime?: string;
  stopTime?: string;
  metaCreatedTime?: string;
  lastSyncedAt?: string;
  /** Soft delete — sumiu da Meta ou foi apagada, nunca DELETE físico. */
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertMetaAdCampaignInput = Omit<MetaAdCampaign, "id" | "createdAt" | "updatedAt" | "deletedAt"> & { id?: string };

export type MetaAdCampaignRepositoryPort = {
  /** Upsert por `(adAccountId, campaignId)` — resincronizar nunca duplica. */
  upsertCampaign(input: UpsertMetaAdCampaignInput): Promise<MetaAdCampaign>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; adAccountId?: string; includeDeleted?: boolean }): Promise<MetaAdCampaign[]>;
  getById(id: string): Promise<MetaAdCampaign | undefined>;
  /** Marca como `deletedAt` (nunca deleta a linha) qualquer campanha desta conta cujo
   * `campaignId` NÃO esteja em `keepCampaignIds` — a campanha pode ter sido apagada na Meta entre
   * duas sincronizações. */
  markDeletedMissing(input: { adAccountId: string; keepCampaignIds: readonly string[] }): Promise<void>;
};
