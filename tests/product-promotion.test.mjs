import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCommercialRules } from "../dist/domain/commerce/commercial-rules.js";
import { productDetailsSchema } from "../dist/domain/products/product-details.js";

const line = (patch = {}) => ({ key: "a", productId: "p1", quantity: 2, unitPriceCents: 10000, currency: "BRL", ...patch });
const now = new Date("2026-11-14T12:00:00Z");
const storeRule = { id: "r1", tenantId: "t", workspaceId: "w", siteId: "s", revision: 1, createdAt: "", updatedAt: "", name: "10% loja", active: true, priority: 0, stackable: false, allowCoupon: false, channels: ["CHECKOUT", "WHATSAPP"], currency: "BRL", scope: { type: "STORE", ids: [] }, trigger: { type: "QUANTITY", count: "ELIGIBLE", minimum: 1 }, benefit: { type: "PERCENT", basisPoints: 1000 } };

test("a product promotion lowers the price and shows as 'Promoção' in the cart", () => {
  const result = evaluateCommercialRules({ lines: [line({ promotion: { percent: 20 } })], rules: [], channel: "WHATSAPP", now });
  assert.equal(result.totalCents, 16000);
  assert.equal(result.originalSubtotalCents, 20000);
  assert.equal(result.discountCents, 4000);
  assert.equal(result.items[0].originalUnitPriceCents, 10000);
  assert.deepEqual(result.appliedRules.map((rule) => [rule.name, rule.discountCents]), [["Promoção", 4000]]);
});

test("store rules apply on top of the promotional price", () => {
  const result = evaluateCommercialRules({ lines: [line({ promotion: { percent: 20 } })], rules: [storeRule], channel: "CHECKOUT", now });
  assert.equal(result.totalCents, 14400);
  assert.equal(result.discountCents, 5600);
});

test("a promotion outside its dates changes nothing", () => {
  for (const promotion of [{ percent: 20, endsAt: "2026-11-01T00:00:00Z" }, { percent: 20, startsAt: "2026-12-01T00:00:00Z" }]) {
    const result = evaluateCommercialRules({ lines: [line({ promotion })], rules: [], channel: "CHECKOUT", now });
    assert.equal(result.totalCents, 20000);
    assert.equal(result.appliedRules.length, 0);
  }
});

test("product details accept featured and a 1-90% promotion with a valid window", () => {
  const base = { type: "GENERAL", attributes: {}, options: [], siteVisible: true, catalogVisible: true, canPurchaseOnline: false, seo: {}, media: [] };
  assert.equal(productDetailsSchema.safeParse({ ...base, featured: true, promotion: { percent: 15 } }).success, true);
  assert.equal(productDetailsSchema.safeParse({ ...base, promotion: { percent: 95 } }).success, false);
  assert.equal(productDetailsSchema.safeParse({ ...base, promotion: { percent: 10, startsAt: "2026-12-02T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" } }).success, false);
});
