import { test } from "node:test";
import assert from "node:assert/strict";
import { marketplaceRelease, marketplaceReleasePolicyFromEnv } from "../dist/domain/marketplaces/marketplace-availability.js";
import { MarketplaceService } from "../dist/application/marketplaces/marketplace-service.js";

test("marketplace credentials alone never enable an unvalidated tenant", async () => {
  for (const id of ["MERCADO_LIVRE", "SHOPEE", "TIKTOK_SHOP"]) {
    assert.deepEqual(marketplaceRelease({}, id, "customer"), { availability: "BETA", enabled: false });
    const service = new MarketplaceService({ providers: { [id]: { id } } });
    assert.deepEqual(service.configuredProviders({ tenantId: "customer" }), []);
    await assert.rejects(() => service.startOAuth({ tenantId: "customer" }, id), /MARKETPLACE_PROVIDER_NOT_ENABLED/);
  }
});

test("beta and validated releases require exact tenant enrollment; disabled always denies", () => {
  for (const availability of ["BETA", "REAL_VALIDATED", "DISABLED"]) {
    const policy = { SHOPEE: { availability, tenantIds: ["qa"] } };
    assert.equal(marketplaceRelease(policy, "SHOPEE", "qa").enabled, availability !== "DISABLED");
    assert.equal(marketplaceRelease(policy, "SHOPEE", "qa-extra").enabled, false);
    assert.equal(marketplaceRelease(policy, "TIKTOK_SHOP", "qa").enabled, false);
  }
  assert.equal(marketplaceRelease({ SHOPEE: { availability: "GENERALLY_AVAILABLE", tenantIds: [] } }, "SHOPEE", "customer").enabled, true);
});

test("release environment parsing fails closed and never treats wildcard as enrollment", () => {
  const policy = marketplaceReleasePolicyFromEnv({ MARKETPLACE_SHOPEE_AVAILABILITY: "GA", MARKETPLACE_SHOPEE_TENANT_IDS: "qa", MARKETPLACE_TIKTOK_SHOP_TENANT_IDS: " qa, * " });
  assert.equal(marketplaceRelease(policy, "SHOPEE", "qa").enabled, false);
  assert.equal(marketplaceRelease(policy, "TIKTOK_SHOP", "qa").enabled, true);
  assert.equal(marketplaceRelease(policy, "TIKTOK_SHOP", "customer").enabled, false);
});
