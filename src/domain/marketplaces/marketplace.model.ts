export type MarketplaceScope = { tenantId: string; workspaceId: string };
export type MarketplaceActor = MarketplaceScope & { userId: string };
export type ConnectionStatus = "CONNECTED" | "DISCONNECTED" | "REAUTH_REQUIRED" | "ERROR";
export type SyncStatus = "SYNCED" | "PENDING" | "ERROR" | "DIVERGED" | "REAUTH_REQUIRED";
export type MarketplaceConnection = MarketplaceScope & {
  id: string; provider: "MERCADO_LIVRE"; externalAccountId: string; externalAccountName: string;
  status: ConnectionStatus; siteId: string; userProducts: boolean; safetyStock: number;
  connectedAt?: string; lastSyncAt?: string; lastError?: string;
};
export type ExternalAttribute = { id: string; value_name?: string; value_id?: string };
export type ExternalVariant = { id: string; sku?: string; ean?: string; priceCents: number; quantity: number; options: Record<string,string> };
export type ExternalListing = {
  id: string; sellerId: string; title: string; description?: string; sku?: string; ean?: string;
  categoryId: string; priceCents: number; quantity: number; status: string; url?: string; currency: string;
  pictures: string[]; attributes: ExternalAttribute[]; variants: ExternalVariant[];
  userProductId?: string; familyName?: string; model: "LEGACY" | "USER_PRODUCT";
  stockWritable: boolean; priceWritable: boolean; updatedAt?: string;
};
export type VariantLink = { externalVariantId: string; variantId: string };
export type ChannelListing = MarketplaceScope & {
  id: string; connectionId: string; productId: string; variantId?: string;
  externalListingId?: string; externalProductId?: string; externalCategoryId: string; externalUrl?: string; externalSku?: string;
  status: string; syncStatus: SyncStatus; externalPrice?: number; externalQuantity?: number;
  lastSyncedPrice?: number; lastSyncedQuantity?: number; lastSyncAt?: string; lastError?: string;
  variantLinks: VariantLink[]; snapshot?: ExternalListing; draft?: PublishDraft; productName?: string;
};
export type PublishDraft = {
  categoryId: string; title: string; description: string; condition: "new" | "used" | "not_specified";
  listingTypeId: string; buyingMode: "buy_it_now"; attributes: ExternalAttribute[];
  pictures: string[]; settings: Record<string,unknown>; variantAttributes?: ExternalAttribute[];
};
export type CatalogIdentity = { productId: string; variantId?: string; sku?: string; ean?: string; name: string };
export type Matching = { kind: "SKU" | "EAN" | "NONE" | "AMBIGUOUS"; candidates: CatalogIdentity[] };
export function matchIdentity(input: {sku?:string;ean?:string}, catalog: readonly CatalogIdentity[]): Matching {
  for (const [field,kind] of [["sku","SKU"],["ean","EAN"]] as const) {
    const value=input[field]?.trim(); if (!value) continue;
    const candidates=catalog.filter(item=>item[field]?.trim()===value);
    if (candidates.length) return {kind:candidates.length===1?kind:"AMBIGUOUS",candidates};
  }
  return {kind:"NONE",candidates:[]};
}
export function publishedQuantity(stock: number, reserved: number, safetyStock: number): number {
  if (![stock,reserved,safetyStock].every(Number.isFinite) || safetyStock<0) throw new Error("MARKETPLACE_INVALID_QUANTITY");
  return Math.floor(Math.max(0,stock-reserved-safetyStock));
}
export type ImportDecision = {
  externalId: string; action: "LINK" | "CREATE" | "IGNORE"; productId?: string; variantId?: string;
  variantLinks?: VariantLink[]; useExternalInitialStock: boolean;
};
export type MarketplaceJob = MarketplaceScope & {
  id: string; connectionId: string; kind: "PREVIEW" | "IMPORT" | "PUBLISH" | "UPDATE" | "SYNC" | "RECONCILE" | "STATUS";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED" | "UNKNOWN_RESULT";
  payload: Record<string,unknown>; progress: number; total: number; attempts: number; lastError?: string;
  leaseToken?: string; createdAt?: string;
};
export class MarketplaceError extends Error {
  constructor(public readonly code: string, public readonly retryable=false, public readonly retryAfterMs=0) { super(code); }
}
export const safeMarketplaceError=(error:unknown):string=>error instanceof MarketplaceError?error.code:
  error instanceof Error && /^(PRODUCT_VALIDATION|PRODUCT_PRICING_INVALID|INVENTORY_INSUFFICIENT|PRODUCT_NOT_FOUND|PRODUCT_VARIANT_NOT_FOUND)/.test(error.message)
    ? error.message.slice(0,500) : "MARKETPLACE_OPERATION_FAILED";
