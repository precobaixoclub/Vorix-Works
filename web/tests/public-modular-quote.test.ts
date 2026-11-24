import { describe, expect, it } from "vitest";
import type { PublicBillingCatalog, PublicPlan } from "@/features/platform-plans/api";
import { buildPublicProductCatalog } from "@/features/public-site/catalog";
import { includedPlanQuote } from "@/features/public-site/configurator";
import { bundleSavings, initialSelection, makeModularQuote, toggleModule, type ModuleLine } from "@/features/public-site/modular-quote";
import { MODULE_KEYS } from "@/features/public-site/showcase";

const start: PublicPlan = {
  code: "START", name: "Start", tagline: "", monthlyPriceUsd: 149, yearlyPriceUsd: 1490, currency: "BRL",
  includedUsers: 2, includedWhatsappConnections: 1, monthlyCreditsQuota: 500, trialDays: 7,
};
const billing: PublicBillingCatalog = {
  plans: [start], addons: [], priceSource: "plan_versions",
  solutions: [
    { key: "conversations", name: "Conversas", contractable: true },
    { key: "meetings", name: "Meetings", contractable: true },
  ],
  meetingsOffer: {
    currency: "BRL", baseMonthlyPrice: 147, baseYearlyPrice: 1470, includedConcurrentRecordings: 1,
    additionalRecordingMonthlyPrice: 67, additionalRecordingYearlyPrice: 670,
  },
};
const catalog = buildPublicProductCatalog(billing);
const initial = initialSelection(catalog, undefined);
const withExtras = { ...initial, users: 3, numbers: 2 };
const serverQuote = {
  ...includedPlanQuote(start)!, additionalUsers: 1, additionalWhatsappConnections: 1,
  userAddonMonthlyAmount: 39, whatsappAddonMonthlyAmount: 79, totalMonthlyAmount: 267,
};

describe("cotação modular pública", () => {
  it("usa o preço-base sem cobrar a capacidade incluída", () => {
    const quote = makeModularQuote(catalog, initial);
    expect(quote.lines).toHaveLength(1);
    expect(quote.total).toBe(149);
    expect(quote.href).toBe("/signup?plan=START&users=2&numbers=1");
    expect(toggleModule(initial, "conversations")).toBe(initial);
  });

  it("usa os adicionais retornados pelo simulador e exige cotação viável para cobrar", () => {
    const quote = makeModularQuote(catalog, withExtras, [serverQuote]);
    expect(quote.lines.map(line => line.amount)).toEqual([149, 39, 79]);
    expect(quote.total).toBe(267);
    expect(quote.href).toBe("/signup?plan=START&users=3&numbers=2");
    for (const options of [undefined, [], [{ ...serverQuote, feasible: false }], [{ ...serverQuote, currency: "USD" }]]) {
      expect(makeModularQuote(catalog, withExtras, options)).toMatchObject({ complete: false, direct: false, subtotal: 149 });
    }
  });

  it("cobra apenas a capacidade adicional do Meetings e preserva o ciclo anual suportado", () => {
    const selection = { ...initialSelection(catalog, "suite"), recordings: 3, period: "yearly" as const };
    const quote = makeModularQuote(catalog, selection);
    expect(quote.lines.map(line => line.amount)).toEqual([1490, 1470, 1340]);
    expect(quote.total).toBe(4300);
    expect(quote.href).toBe("/signup?plan=START&users=2&numbers=1&intervalo=anual&recordings=3");
    expect(makeModularQuote(catalog, { ...selection, users: 3 }, [serverQuote])).toMatchObject({ complete: false, direct: false });
  });

  it("suporta as 15 seleções possíveis sem encaminhar módulos não comercializados ao checkout", () => {
    for (let mask = 1; mask < 16; mask++) {
      const modules = MODULE_KEYS.filter((_, index) => (mask & (1 << index)) !== 0);
      const quote = makeModularQuote(catalog, { ...initial, modules });
      if (modules.includes("site") || modules.includes("marketing")) {
        expect(quote.href).toMatch(/^mailto:/);
        expect(quote.complete).toBe(false);
      } else if (modules.includes("conversations")) {
        expect(quote.href).toMatch(/^\/signup/);
      } else {
        expect(quote.href).toBe("/login?destino=reunioes");
        expect(quote.total).toBe(147);
      }
      expect(quote.discount).toBe(0);
    }
  });

  it("fecha a saída para contratação se faltar oferta oficial, sinal comercial ou moeda comum", () => {
    expect(makeModularQuote(buildPublicProductCatalog(null), initial).direct).toBe(false);
    const gated = buildPublicProductCatalog({ ...billing, solutions: [] });
    expect(makeModularQuote(gated, initial).direct).toBe(false);
    const mixed = buildPublicProductCatalog({ ...billing, meetingsOffer: { ...billing.meetingsOffer!, currency: "USD" } });
    expect(makeModularQuote(mixed, initialSelection(mixed, "suite"))).toMatchObject({ complete: false, direct: false, subtotal: null });
  });

  it("prepara o desconto exclusivamente sobre as bases elegíveis e exige uma política aprovada", () => {
    const lines: ModuleLine[] = [149, 129, 69, 147].map((amount, index) => ({
      module: MODULE_KEYS[index], label: MODULE_KEYS[index], amount, currency: "BRL", kind: "base",
    }));
    lines.push({ module: "conversations", label: "Usuário adicional", amount: 39, currency: "BRL", kind: "addon" });
    const policy = { eligible: MODULE_KEYS, basisPointsByCount: { 2: 500, 3: 1000, 4: 1500 } } as const;
    expect(bundleSavings(lines)).toBe(0);
    expect(bundleSavings(lines.slice(0, 2), policy)).toBe(13.9);
    expect(bundleSavings(lines.slice(0, 3), policy)).toBe(34.7);
    expect(bundleSavings(lines, policy)).toBe(74.1);
  });
});
