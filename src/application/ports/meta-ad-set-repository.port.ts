import type { MetaAdEntityStatus } from "./meta-ad-campaign-repository.port.js";

/** Ad sets sincronizados da Marketing API — módulo Meta Ads Manager, Fase 2. Ver
 * `db/migrations/0071_meta_ad_sets.sql`. */

export type MetaAdSet = {
  id: string;
  tenantId: string;
  workspaceId: string;
  /** id INTERNO da campanha (`meta_ad_campaigns.id`), nunca o `campaignId` externo da Meta. */
  campaignId: string;
  adAccountId: string;
  adSetId: string;
  name: string;
  status: MetaAdEntityStatus;
  effectiveStatus?: string;
  optimizationGoal?: string;
  billingEvent?: string;
  bidAmount?: number;
  dailyBudget?: number;
  lifetimeBudget?: number;
  /** Blob bruto de `targeting{}` — estrutura profundamente aninhada da Marketing API. */
  targeting?: unknown;
  spend?: number;
  impressions?: number;
  clicks?: number;
  reach?: number;
  insights?: unknown;
  startTime?: string;
  endTime?: string;
  metaCreatedTime?: string;
  lastSyncedAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertMetaAdSetInput = Omit<MetaAdSet, "id" | "createdAt" | "updatedAt" | "deletedAt"> & { id?: string };

export type MetaAdSetRepositoryPort = {
  upsertAdSet(input: UpsertMetaAdSetInput): Promise<MetaAdSet>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; campaignId?: string; adAccountId?: string; includeDeleted?: boolean }): Promise<MetaAdSet[]>;
  getById(id: string): Promise<MetaAdSet | undefined>;
  markDeletedMissing(input: { adAccountId: string; keepAdSetIds: readonly string[] }): Promise<void>;
};
