import { describe, expect, it } from "vitest";
import { buildPublicProductCatalog } from "@/features/public-site/catalog";
import { homeOffers } from "@/features/public-site/home";
import type { PublicBillingCatalog } from "@/features/platform-plans/api";

const billing: PublicBillingCatalog = {
  priceSource: "plan_versions",
  addons: [],
  solutions: [
    { key: "conversations", name: "Conversas", contractable: true },
    { key: "meetings", name: "Meetings", contractable: true },
  ],
  plans: [
    {
      code: "START",
      name: "Start",
      tagline: "",
      monthlyPriceUsd: 149,
      yearlyPriceUsd: 1490,
      currency: "BRL",
      includedUsers: 2,
      includedWhatsappConnections: 1,
      monthlyCreditsQuota: 500,
      trialDays: 7,
    },
  ],
  meetingsOffer: {
    currency: "BRL",
    baseMonthlyPrice: 147,
    baseYearlyPrice: 1470,
    includedConcurrentRecordings: 1,
    additionalRecordingMonthlyPrice: 67,
    additionalRecordingYearlyPrice: 670,
  },
};

describe("home prices from the checkout catalog", () => {
  it("uses official live offers and follows a price update", () => {
    const catalog = buildPublicProductCatalog(billing);
    expect(homeOffers(catalog)).toMatchObject({
      conversationsPrice: 149,
      meetingsPrice: 147,
      trialDays: 7,
    });
    const changed = {
      ...billing,
      plans: billing.plans.map((plan) => ({ ...plan, monthlyPriceUsd: 179 })),
      meetingsOffer: { ...billing.meetingsOffer!, baseMonthlyPrice: 167 },
    };
    expect(homeOffers(buildPublicProductCatalog(changed))).toMatchObject({
      conversationsPrice: 179,
      meetingsPrice: 167,
    });
  });
  it("hides local reference values when official offers are missing", () => {
    expect(homeOffers(buildPublicProductCatalog(null))).toMatchObject({
      conversationsPrice: null,
      meetingsPrice: null,
      trialDays: null,
    });
    expect(
      homeOffers(
        buildPublicProductCatalog({
          ...billing,
          plans: [],
          meetingsOffer: undefined,
        }),
      ),
    ).toMatchObject({ conversationsPrice: null, meetingsPrice: null });
    expect(
      homeOffers(
        buildPublicProductCatalog({ ...billing, priceSource: "unavailable" }),
      ),
    ).toMatchObject({ conversationsPrice: null, meetingsPrice: null });
  });
  it("does not publish non-finite or negative recording quotes", () => {
    for (const baseMonthlyPrice of [NaN, Infinity, -10]) {
      expect(
        homeOffers(
          buildPublicProductCatalog({
            ...billing,
            meetingsOffer: { ...billing.meetingsOffer!, baseMonthlyPrice },
          }),
        ).meetingsPrice,
      ).toBeNull();
    }
  });
  it("does not infer an all-product package from the two-product Suite", () => {
    const offers = homeOffers(buildPublicProductCatalog(billing));
    expect(offers).not.toHaveProperty("suitePrice");
    expect(offers).not.toHaveProperty("marketingPrice");
  });
});
