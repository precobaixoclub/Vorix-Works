import { describe, expect, it } from "vitest";
import { buildPublicProductCatalog, formatPublicPrice, PUBLIC_REFERENCE_PRICES } from "@/features/public-site/catalog";
import type { PublicBillingCatalog } from "@/features/platform-plans/api";

const billing: PublicBillingCatalog = {
  priceSource: "plan_versions", addons: [],
  solutions: [{ key: "conversations", name: "Vorix Conversas", contractable: true }, { key: "meetings", name: "Vorix Meetings", contractable: false }],
  plans: [{ code: "START", name: "Start", tagline: "", monthlyPriceUsd: 149, yearlyPriceUsd: 1490, currency: "BRL", includedUsers: 2, includedWhatsappConnections: 1, monthlyCreditsQuota: 500, trialDays: 7 }],
};
describe("public commercial catalog", () => {
  it("uses the checkout price and selected plan for Conversas acquisition", () => {
    const product = buildPublicProductCatalog(billing).products[0];
    expect(product.monthlyPrice).toBe(149);
    expect(product.annualPrice).toBe(1490);
    expect(product.provisional).toBe(false);
    expect(product.cta.href).toBe("/signup?plan=START");
    expect(product.contractable).toBe(true);
  });
  it("never sells Meetings or Suite while Meetings is unavailable", () => {
    const products = buildPublicProductCatalog(billing).products;
    expect(products.slice(1).every(product => !product.contractable && !product.cta.href.includes("signup") && !product.cta.href.includes("checkout"))).toBe(true);
    expect(products[1].monthlyPrice).toBe(PUBLIC_REFERENCE_PRICES.meetings);
    expect(products[2].includes).toEqual(["conversations", "meetings"]);
  });
  it("does not turn a reference price into a billable bundle after a gate change", () => {
    const promoted = { ...billing, solutions: billing.solutions.map(solution => ({ ...solution, contractable: true })) };
    expect(buildPublicProductCatalog(promoted).products.slice(1).every(product => !product.contractable)).toBe(true);
  });
  it("prices Meetings and Suite from the official offer and sells them only when the gate opens", () => {
    const meetingsOffer = { currency: "BRL", baseMonthlyPrice: 147, baseYearlyPrice: 1470, includedConcurrentRecordings: 1, additionalRecordingMonthlyPrice: 67, additionalRecordingYearlyPrice: 670 };
    const gated = buildPublicProductCatalog({ ...billing, meetingsOffer }).products;
    expect([gated[1].monthlyPrice, gated[2].monthlyPrice]).toEqual([147, 149 + 147]);
    expect(gated.slice(1).every(product => !product.contractable && !product.provisional)).toBe(true);
    const open = buildPublicProductCatalog({ ...billing, meetingsOffer, solutions: billing.solutions.map(solution => ({ ...solution, contractable: true })) }).products;
    expect(open.every(product => product.contractable)).toBe(true);
  });
  it("fails closed without commercial metadata, catalog or official prices", () => {
    for (const input of [null, { ...billing, solutions: [] }, { ...billing, priceSource: "unavailable" as const }, { ...billing, plans: [] }]) {
      expect(buildPublicProductCatalog(input).products.every(product => !product.contractable)).toBe(true);
    }
  });
  it("does not invent an annual price or discount", () => {
    const input = { ...billing, plans: billing.plans.map(plan => ({ ...plan, yearlyPriceUsd: 0 })) };
    expect(buildPublicProductCatalog(input).products.every(product => product.annualPrice === null)).toBe(true);
  });
  it("does not replace an unavailable official catalog with a conflicting reference quote", () => {
    expect(buildPublicProductCatalog(null).products[0].monthlyPrice).toBeNull();
    expect(buildPublicProductCatalog({ ...billing, plans: [] }).products[0].monthlyPrice).toBe(PUBLIC_REFERENCE_PRICES.conversations);
  });
  it("selects the lowest valid official price without rewriting the billing catalog", () => {
    const input = { ...billing, plans: [{ ...billing.plans[0], monthlyPriceUsd: 299, code: "PRO" as const }, billing.plans[0]] };
    const catalog = buildPublicProductCatalog(input);
    expect(catalog.products[0].monthlyPrice).toBe(149);
    expect(input.plans[0].code).toBe("PRO");
    expect(formatPublicPrice(catalog.products[0])).toContain("149");
  });
});
