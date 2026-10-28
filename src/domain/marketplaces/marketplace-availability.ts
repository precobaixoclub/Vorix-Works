import type { MarketplaceProviderId } from "./marketplace.model.js";

export type MarketplaceAvailability = "DISABLED" | "BETA" | "REAL_VALIDATED" | "GENERALLY_AVAILABLE";
export type MarketplaceReleasePolicy = Partial<Record<MarketplaceProviderId, { availability: MarketplaceAvailability; tenantIds: readonly string[] }>>;

/** Credentials configure an app; only an explicit release policy authorizes a tenant. */
export function marketplaceRelease(policy: MarketplaceReleasePolicy, provider: MarketplaceProviderId, tenantId: string) {
  const release = policy[provider] ?? { availability: "BETA" as const, tenantIds: [] };
  return { availability: release.availability, enabled: release.availability !== "DISABLED" &&
    (release.availability === "GENERALLY_AVAILABLE" || release.tenantIds.includes(tenantId)) };
}

export function marketplaceReleasePolicyFromEnv(env: Record<string, string | undefined>): MarketplaceReleasePolicy {
  return Object.fromEntries((["MERCADO_LIVRE", "SHOPEE", "TIKTOK_SHOP"] as const).map(provider => {
    const value = env[`MARKETPLACE_${provider}_AVAILABILITY`] ?? "BETA";
    // A typo fails closed, never silently promotes an unvalidated provider.
    const availability: MarketplaceAvailability = ["DISABLED", "BETA", "REAL_VALIDATED", "GENERALLY_AVAILABLE"].includes(value)
      ? value as MarketplaceAvailability : "DISABLED";
    return [provider, { availability, tenantIds: (env[`MARKETPLACE_${provider}_TENANT_IDS`] ?? "").split(",").map(v => v.trim()).filter(Boolean) }];
  }));
}
