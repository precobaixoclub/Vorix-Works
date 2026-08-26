/** Pixels do Meta (rastreamento de conversão) — módulo Meta Ads Manager, Fase 4. Ver
 * `db/migrations/0074_meta_pixels.sql`. */

export type MetaPixel = {
  id: string;
  tenantId: string;
  workspaceId: string;
  adAccountId: string;
  pixelId: string;
  name: string;
  lastFiredTime?: string;
  isActive: boolean;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertMetaPixelInput = Omit<MetaPixel, "id" | "createdAt" | "updatedAt"> & { id?: string };

export type MetaPixelRepositoryPort = {
  /** Upsert por `(adAccountId, pixelId)` — resincronizar nunca duplica. */
  upsertPixel(input: UpsertMetaPixelInput): Promise<MetaPixel>;
  listByWorkspace(input: { tenantId: string; workspaceId: string; adAccountId?: string }): Promise<MetaPixel[]>;
  getById(id: string): Promise<MetaPixel | undefined>;
};
