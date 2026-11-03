import type { PublicProductCatalog } from "./catalog";

/** A home só exibe valores confirmados na mesma fonte do checkout. Referências locais ficam ocultas. */
export function homeOffers(catalog: PublicProductCatalog) {
  const official = catalog.billing?.priceSource === "plan_versions";
  const conversations = catalog.products.find(
    (product) => product.key === "conversations",
  );
  const meetings = catalog.products.find(
    (product) => product.key === "meetings",
  );
  return {
    conversations,
    meetings,
    conversationsPrice:
      official &&
      conversations?.plan &&
      !conversations.provisional &&
      validPrice(conversations.monthlyPrice)
        ? conversations.monthlyPrice
        : null,
    meetingsPrice:
      official &&
      meetings &&
      !meetings.provisional &&
      validPrice(catalog.billing?.meetingsOffer?.baseMonthlyPrice)
        ? catalog.billing!.meetingsOffer!.baseMonthlyPrice
        : null,
    trialDays: official ? (conversations?.plan?.trialDays ?? null) : null,
  };
}

function validPrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
