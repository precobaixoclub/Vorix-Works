/** Públicos customizados/semelhantes (Marketing API) — módulo Meta Ads Manager, Fase 4. Ver
 * `db/migrations/0073_meta_custom_audiences.sql`. */

/** Subtypes que ESTE app efetivamente cria (`create-meta-custom-audience.ts`/
 * `create-meta-lookalike-audience.ts`). `MetaCustomAudience.subtype` aceita qualquer string —
 * o sync também traz públicos criados fora daqui, com qualquer um dos ~15 subtypes da Marketing
 * API (`WEBSITE`, `ENGAGEMENT`, `OFFLINE_CONVERSION`...), nunca só estes dois. */
export const META_CUSTOM_AUDIENCE_CREATABLE_SUBTYPES = ["CUSTOM", "LOOKALIKE"] as const;
export type MetaCustomAudienceCreatableSubtype = (typeof META_CUSTOM_AUDIENCE_CREATABLE_SUBTYPES)[number];

export type MetaCustomAudience = {
  id: string;
  tenantId: string;
  workspaceId: string;
  adAccountId: string;
  audienceId: string;
  name: string;
  subtype: string;
  description?: string;
  approximateCount?: number;
  operationStatus?: unknown;
  deliveryStatus?: unknown;
  /** id INTERNO (`meta_custom_audiences.id`) do público de origem — só presente quando
   * `subtype === "LOOKALIKE"`. */
  lookalikeOriginAudienceId?: string;
  lookalikeRatio?: number;
  lookalikeCountry?: string;
  lastSyncedAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertMetaCustomAudienceInput = Omit<MetaCustomAudience, "id" | "createdAt" | "updatedAt"> & { id?: string };

export type MetaCustomAudienceRepositoryPort = {
  /** Upsert por `(adAccountId, audienceId)` — resincronizar nunca duplica. */
  upsertAudience(input: UpsertMetaCustomAudienceInput): Promise<MetaCustomAudience>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; adAccountId?: string; includeDeleted?: boolean }): Promise<MetaCustomAudience[]>;
  getById(id: string): Promise<MetaCustomAudience | undefined>;
  /** Marca como `deletedAt` (nunca deleta a linha) qualquer público desta conta cujo `audienceId`
   * NÃO esteja em `keepAudienceIds`. */
  markDeletedMissing(input: { adAccountId: string; keepAudienceIds: readonly string[] }): Promise<void>;
};
