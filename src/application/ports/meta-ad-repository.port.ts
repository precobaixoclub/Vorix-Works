import type { MetaAdEntityStatus } from "./meta-ad-campaign-repository.port.js";

/** Anúncios (nível folha) sincronizados da Marketing API — módulo Meta Ads Manager, Fase 2. Ver
 * `db/migrations/0072_meta_ads.sql`. */

export type MetaAd = {
  id: string;
  tenantId: string;
  workspaceId: string;
  /** id INTERNO do ad set (`meta_ad_sets.id`). */
  adSetId: string;
  /** id INTERNO da campanha (`meta_ad_campaigns.id`) — desnormalizado de propósito, a árvore lista
   * anúncios por campanha sem precisar de JOIN via ad set. */
  campaignId: string;
  adAccountId: string;
  adId: string;
  name: string;
  status: MetaAdEntityStatus;
  effectiveStatus?: string;
  /** Blob bruto do criativo (`object_story_spec`, imagem/vídeo, call_to_action). */
  creative?: unknown;
  spend?: number;
  impressions?: number;
  clicks?: number;
  reach?: number;
  videoCompletionRate?: number;
  negativeFeedback?: number;
  insights?: unknown;
  metaCreatedTime?: string;
  lastSyncedAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertMetaAdInput = Omit<MetaAd, "id" | "createdAt" | "updatedAt" | "deletedAt"> & { id?: string };

export type MetaAdRepositoryPort = {
  upsertAd(input: UpsertMetaAdInput): Promise<MetaAd>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; adSetId?: string; campaignId?: string; adAccountId?: string; includeDeleted?: boolean }): Promise<MetaAd[]>;
  getById(id: string): Promise<MetaAd | undefined>;
  markDeletedMissing(input: { adAccountId: string; keepAdIds: readonly string[] }): Promise<void>;
};
