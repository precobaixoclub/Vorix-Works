import { describe, expect, it } from "vitest";
import type { CapacityRecommendationOption, PublicBillingCatalog } from "@/features/platform-plans/api";
import { buildPublicProductCatalog, PUBLIC_REFERENCE_PRICES } from "@/features/public-site/catalog";
import {
  adjustQuantity, clamp, composeQuote, CONFIGURATOR_LIMITS, includedPlanQuote, initialConfiguratorState, setQuantity, toggleProduct,
} from "@/features/public-site/configurator";

const billing: PublicBillingCatalog = {
  priceSource: "plan_versions",
  addons: [{ code: "extra_user", name: "+1 usuário", monthlyPriceUsd: 39, currency: "BRL", resource: "users" }, { code: "extra_whatsapp_connection", name: "+1 conexão de WhatsApp", monthlyPriceUsd: 79, currency: "BRL", resource: "messaging_connections" }],
  solutions: [{ key: "conversations", name: "Vorix Conversas", contractable: true }, { key: "meetings", name: "Vorix Meetings", contractable: false }],
  plans: [
    { code: "START", name: "Start", tagline: "", monthlyPriceUsd: 149, yearlyPriceUsd: 1490, currency: "BRL", includedUsers: 2, includedWhatsappConnections: 1, monthlyCreditsQuota: 500, trialDays: 7 },
    { code: "PRO", name: "Pro", tagline: "", monthlyPriceUsd: 299, yearlyPriceUsd: 2990, currency: "BRL", includedUsers: 5, includedWhatsappConnections: 2, monthlyCreditsQuota: 2500, trialDays: 7 },
  ],
};
const catalog = buildPublicProductCatalog(billing);
const meetingsOffer = { currency: "BRL", baseMonthlyPrice: 147, baseYearlyPrice: 1470, includedConcurrentRecordings: 1, additionalRecordingMonthlyPrice: 67, additionalRecordingYearlyPrice: 670 };
const withOffer = buildPublicProductCatalog({ ...billing, meetingsOffer });
const released = buildPublicProductCatalog({ ...billing, meetingsOffer, solutions: billing.solutions.map(solution => ({ ...solution, contractable: true })) });
// Formato exato devolvido pelo simulador oficial (POST /v1/platform/plans/simulate).
const startPlusAddons: CapacityRecommendationOption = { planCode: "START", currency: "BRL", baseMonthlyAmount: 149, includedUsers: 2, includedWhatsappConnections: 1, additionalUsers: 1, additionalWhatsappConnections: 1, userAddonMonthlyAmount: 39, whatsappAddonMonthlyAmount: 79, addonsMonthlyAmount: 118, totalMonthlyAmount: 267, feasible: true };
const pro: CapacityRecommendationOption = { ...startPlusAddons, planCode: "PRO", baseMonthlyAmount: 299, includedUsers: 5, includedWhatsappConnections: 2, additionalUsers: 0, additionalWhatsappConnections: 0, userAddonMonthlyAmount: 0, whatsappAddonMonthlyAmount: 0, addonsMonthlyAmount: 0, totalMonthlyAmount: 299 };

describe("configurador — quantidades", () => {
  it("começa na capacidade incluída do plano de entrada, só com Conversas", () => {
    const state = initialConfiguratorState(catalog.plans[0]);
    expect(state).toEqual({ conversations: true, meetings: false, users: 2, numbers: 1, recordings: 1 });
  });
  it("incrementa e decrementa usuários, números e gravações respeitando mínimo e máximo", () => {
    let state = initialConfiguratorState(catalog.plans[0]);
    state = adjustQuantity(state, "users", 3);
    state = adjustQuantity(state, "numbers", 1);
    state = adjustQuantity(state, "recordings", 2);
    expect([state.users, state.numbers, state.recordings]).toEqual([5, 2, 3]);
    for (const field of ["users", "numbers", "recordings"] as const) {
      expect(adjustQuantity(setQuantity(state, field, CONFIGURATOR_LIMITS[field].min), field, -1)[field]).toBe(CONFIGURATOR_LIMITS[field].min);
      expect(adjustQuantity(setQuantity(state, field, CONFIGURATOR_LIMITS[field].max), field, 1)[field]).toBe(CONFIGURATOR_LIMITS[field].max);
    }
    expect(clamp("users", Number.NaN)).toBe(1);
    expect(clamp("numbers", 2.6)).toBe(3);
  });
  it("nunca deixa os dois produtos desmarcados", () => {
    const state = initialConfiguratorState(catalog.plans[0]);
    expect(toggleProduct(state, "conversations")).toBe(state);
    const both = toggleProduct(state, "meetings");
    expect([both.conversations, both.meetings]).toEqual([true, true]);
    expect(toggleProduct(both, "conversations").conversations).toBe(false);
  });
});

describe("configurador — preço", () => {
  it("o preço inicial é exatamente o plano oficial de entrada, sem chamar a API", () => {
    const quote = composeQuote({ state: initialConfiguratorState(catalog.plans[0]), catalog, conversationsQuote: includedPlanQuote(catalog.plans[0]) });
    expect(quote.knownTotal).toBe(149);
    expect(quote.totalIsOfficial).toBe(true);
    expect(quote.primaryCta.href).toBe("/signup?plan=START&users=2&numbers=1");
    expect(quote.contractable).toBe(true);
  });
  it("mostra a composição devolvida pelo simulador oficial, sem recalcular", () => {
    const state = { ...initialConfiguratorState(catalog.plans[0]), users: 3, numbers: 2 };
    const quote = composeQuote({ state, catalog, conversationsQuote: startPlusAddons });
    expect(quote.lines.map(line => [line.label, line.amount])).toEqual([["Plano Start · 2 usuários · 1 número", 149], ["+ 1 usuário adicional", 39], ["+ 1 número adicional", 79]]);
    expect(quote.knownTotal).toBe(startPlusAddons.totalMonthlyAmount);
    expect(quote.notes.some(note => note.includes("cartão") && note.includes("7 dias"))).toBe(true);
    expect(quote.primaryCta.href).toBe("/signup?plan=START&users=3&numbers=2");
  });
  it("recalcula quando a recomendação oficial muda de plano", () => {
    const state = { ...initialConfiguratorState(catalog.plans[0]), users: 5, numbers: 2 };
    const quote = composeQuote({ state, catalog, conversationsQuote: pro });
    expect(quote.knownTotal).toBe(299);
    expect(quote.primaryCta).toEqual({ label: "Contratar agora", href: "/signup?plan=PRO&users=5&numbers=2" });
  });
  it("sem cotação oficial não inventa valor e não deixa contratar", () => {
    const quote = composeQuote({ state: initialConfiguratorState(null), catalog, conversationsQuote: null, quoteFailed: true });
    expect(quote.knownTotal).toBeNull();
    expect(quote.contractable).toBe(false);
    expect(quote.primaryCta.disabled).toBe(true);
  });
});

describe("configurador — Meetings e Suite", () => {
  const suiteState = { ...initialConfiguratorState(catalog.plans[0]), meetings: true, recordings: 2 };
  const startQuote = includedPlanQuote(catalog.plans[0]);
  it("Conversas + Meetings vira Suite Vorix com os dois produtos no resumo", () => {
    const quote = composeQuote({ state: suiteState, catalog, conversationsQuote: startQuote });
    expect(quote.title).toBe("Suite Vorix");
    expect(quote.summary.map(item => [item.name, item.details])).toEqual([["Vorix Conversas", ["2 usuários", "1 número conectado"]], ["Vorix Meetings", ["2 gravações simultâneas"]]]);
  });
  it("cada gravação simultânea adicional muda o total pelo preço oficial", () => {
    const totals = [1, 2, 3].map(recordings => composeQuote({ state: { ...suiteState, recordings }, catalog: withOffer, conversationsQuote: startQuote }).knownTotal);
    expect(totals).toEqual([149 + 147, 149 + 147 + 67, 149 + 147 + 134]);
    const quote = composeQuote({ state: { ...suiteState, recordings: 3 }, catalog: withOffer, conversationsQuote: startQuote });
    expect(quote.lines.filter(line => line.product === "meetings").map(line => [line.label, line.amount, line.provisional])).toEqual([["Meetings · 1 gravação simultânea", 147, false], ["+ 2 gravações simultâneas", 134, false]]);
    expect(quote.totalIsOfficial).toBe(true);
  });
  it("sem oferta oficial no catálogo não inventa preço de gravação adicional", () => {
    const quote = composeQuote({ state: suiteState, catalog, conversationsQuote: startQuote });
    const meetingsLines = quote.lines.filter(line => line.product === "meetings");
    expect(meetingsLines[0].amount).toBe(PUBLIC_REFERENCE_PRICES.meetings);
    expect(meetingsLines.every(line => line.provisional)).toBe(true);
    expect(meetingsLines[1].amount).toBeNull();
    expect(quote.contractable).toBe(false);
  });
  it("com o gate fechado, Meetings fica 'em breve' e oferece Conversas sozinho, sem contato manual", () => {
    for (const state of [suiteState, { ...suiteState, conversations: false }]) {
      const quote = composeQuote({ state, catalog: withOffer, conversationsQuote: startQuote });
      expect(quote.contractable).toBe(false);
      expect(quote.primaryCta.disabled).toBe(true);
      expect(JSON.stringify(quote)).not.toContain("mailto:");
    }
    const suite = composeQuote({ state: suiteState, catalog: withOffer, conversationsQuote: startQuote });
    expect(suite.secondaryCta?.href).toBe("/signup?plan=START&users=2&numbers=1");
  });
  it("com o gate aberto e preço oficial, a Suite vai direto para cadastro + cartão com as gravações", () => {
    const quote = composeQuote({ state: suiteState, catalog: released, conversationsQuote: startQuote });
    expect(quote.contractable).toBe(true);
    expect(quote.primaryCta).toEqual({ label: "Contratar agora", href: "/signup?plan=START&users=2&numbers=1&recordings=2" });
  });
  it("mesmo com o gate liberado, não vende Meetings sem preço oficial", () => {
    const promoted = buildPublicProductCatalog({ ...billing, solutions: billing.solutions.map(solution => ({ ...solution, contractable: true })) });
    const quote = composeQuote({ state: suiteState, catalog: promoted, conversationsQuote: includedPlanQuote(promoted.plans[0]) });
    expect(quote.contractable).toBe(false);
  });
  it("a unidade comercial do Meetings é gravação simultânea, nunca bot ou conta", () => {
    const quote = composeQuote({ state: suiteState, catalog: withOffer, conversationsQuote: startQuote });
    const text = JSON.stringify(quote).toLowerCase();
    expect(text).toContain("gravação simultânea");
    expect(text).not.toMatch(/\bbots?\b|conta de gravação/);
  });
});

describe("catálogo — cards de preço", () => {
  it("cada card tem no máximo 4 destaques e a Suite leva ao configurador", () => {
    expect(catalog.products.every(product => product.highlights.length <= 4)).toBe(true);
    expect(catalog.products.find(product => product.key === "suite")?.cta).toEqual({ label: "Monte sua Suite", href: "#monte" });
  });
});
