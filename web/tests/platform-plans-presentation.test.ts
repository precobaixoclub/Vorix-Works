import { describe, expect, it } from "vitest";
import { formatCapacityLine, formatPlanPrice } from "../features/platform-plans/api";
import type { PublicPlan } from "../features/platform-plans/api";

/** Pricing/Capacity Etapa B — formatação BRL e linha de capacidade (nunca calcula preço/plano,
 * só formata o que a API já resolveu — backend é a autoridade, seção 9/35 do pedido). */

function makePlan(overrides: Partial<PublicPlan> = {}): PublicPlan {
  return {
    code: "PRO",
    name: "Pro",
    tagline: "Para agências em operação",
    monthlyPriceUsd: 299,
    yearlyPriceUsd: 2990,
    currency: "BRL",
    includedUsers: 5,
    includedWhatsappConnections: 2,
    monthlyCreditsQuota: 2500,
    highlighted: true,
    trialDays: 7,
    ...overrides,
  };
}

describe("formatPlanPrice", () => {
  it("formata em BRL usando a moeda real do plano", () => {
    expect(formatPlanPrice(makePlan({ monthlyPriceUsd: 299, currency: "BRL" }))).toBe("R$ 299,00");
  });

  it("nunca assume USD — respeita a moeda vinda da API", () => {
    expect(formatPlanPrice(makePlan({ monthlyPriceUsd: 89, currency: "USD" }))).toMatch(/89,00/);
  });
});

describe("formatCapacityLine", () => {
  it("mostra usuários e números incluídos, singular/plural corretos", () => {
    expect(formatCapacityLine({ includedUsers: 1, includedWhatsappConnections: 1 })).toBe("1 usuário · 1 número conectado");
    expect(formatCapacityLine({ includedUsers: 5, includedWhatsappConnections: 2 })).toBe("5 usuários · 2 números conectados");
  });

  it("trata null como ilimitado, nunca mostra 'null' cru", () => {
    expect(formatCapacityLine({ includedUsers: null, includedWhatsappConnections: null })).toBe("usuários ilimitados · números ilimitados");
  });
});
