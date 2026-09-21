import type { PlatformPlanCode } from "./platform-plan-catalog.js";
import type { AddonDefinition, PlanVersion } from "./plan-version.model.js";
import type { SubscriptionItem } from "./subscription.model.js";

/**
 * Pacote + capacidade + adicionais self-service — Pricing/Capacity Etapa B. Único lugar que sabe
 * calcular "quantos usuários/números uma assinatura tem" e "quanto custaria uma capacidade
 * hipotética" — backend é autoridade (pedido, seção 9/35): frontend nunca reimplementa esta conta,
 * só formata o que este módulo devolve. `PlanVersion.limits.users`/`limits.messaging_connections`
 * já são a fonte de "capacidade incluída" (vocabulário fechado existente,
 * `plan-entitlements.model.ts`) — nenhum campo `includedUsers` novo é criado no schema; os nomes
 * `includedUsers`/`includedWhatsappConnections` abaixo são só a forma de leitura pedida, lidos
 * sempre de `limits.users`/`limits.messaging_connections`.
 */

const USER_RESOURCE = "users" as const;
const WHATSAPP_RESOURCE = "messaging_connections" as const;

export type CapacitySnapshot = {
  planCode: PlatformPlanCode;
  currency: string;
  includedUsers: number | null;
  additionalUsers: number;
  totalUsers: number | null;
  includedWhatsappConnections: number | null;
  additionalWhatsappConnections: number;
  totalWhatsappConnections: number | null;
  baseMonthlyAmount: number;
  addonsMonthlyAmount: number;
  totalMonthlyAmount: number;
};

/** Capacidade REAL de uma assinatura existente — soma os `SubscriptionItem`s já comprados, usando
 * o preço CAPTURADO em cada item (`unitPriceUsd`, congelado no momento da compra) para o valor
 * mensal, nunca o preço atual do `AddonDefinition` (que pode já ter mudado desde então — nunca
 * reescreve histórico, seção 3 do pedido). */
export function resolveCommercialCapacity(planVersion: PlanVersion, addonDefinitions: readonly AddonDefinition[], items: readonly SubscriptionItem[]): CapacitySnapshot {
  const definitionByCode = new Map(addonDefinitions.map((addon) => [addon.code, addon]));
  let additionalUsers = 0;
  let additionalWhatsapp = 0;
  let addonsMonthlyAmount = 0;

  for (const item of items) {
    const addon = definitionByCode.get(item.addonCode);
    if (!addon) continue;
    const increment = addon.increment * item.quantity;
    if (addon.resource === USER_RESOURCE) additionalUsers += increment;
    if (addon.resource === WHATSAPP_RESOURCE) additionalWhatsapp += increment;
    addonsMonthlyAmount += item.unitPriceUsd * item.quantity;
  }

  const includedUsers = planVersion.limits[USER_RESOURCE];
  const includedWhatsapp = planVersion.limits[WHATSAPP_RESOURCE];

  return {
    planCode: planVersion.planCode,
    currency: planVersion.currency,
    includedUsers,
    additionalUsers,
    totalUsers: includedUsers === null ? null : includedUsers + additionalUsers,
    includedWhatsappConnections: includedWhatsapp,
    additionalWhatsappConnections: additionalWhatsapp,
    totalWhatsappConnections: includedWhatsapp === null ? null : includedWhatsapp + additionalWhatsapp,
    baseMonthlyAmount: planVersion.monthlyPriceUsd,
    addonsMonthlyAmount,
    totalMonthlyAmount: planVersion.monthlyPriceUsd + addonsMonthlyAmount,
  };
}

export type CapacityRequirement = { users: number; whatsappConnections: number };

export type CapacityCostBreakdown = {
  planCode: PlatformPlanCode;
  currency: string;
  baseMonthlyAmount: number;
  includedUsers: number | null;
  includedWhatsappConnections: number | null;
  additionalUsers: number;
  additionalWhatsappConnections: number;
  userAddonMonthlyAmount: number;
  whatsappAddonMonthlyAmount: number;
  addonsMonthlyAmount: number;
  totalMonthlyAmount: number;
  /** `false` quando o plano não tem addon de algum recurso necessário cadastrado em
   * `allowedAddonCodes` — nunca "custo zero" nesse caso, a opção simplesmente não é elegível. */
  feasible: boolean;
};

/** Custo de atingir uma capacidade HIPOTÉTICA num plano — não depende de assinatura nenhuma (só do
 * catálogo), usado tanto pelo preview de um tenant real quanto pelo simulador público (visitante
 * sem conta). Usa sempre o preço ATUAL do catálogo (`addon.monthlyPriceUsd`/`yearlyPriceUsd`) —
 * nunca um preço histórico, porque não existe assinatura ainda. */
export function computeCapacityCost(planVersion: PlanVersion, addonDefinitions: readonly AddonDefinition[], required: CapacityRequirement, billingInterval: "monthly" | "yearly" = "monthly"): CapacityCostBreakdown {
  const userAddon = addonDefinitions.find((addon) => addon.resource === USER_RESOURCE && planVersion.allowedAddonCodes.includes(addon.code));
  const whatsappAddon = addonDefinitions.find((addon) => addon.resource === WHATSAPP_RESOURCE && planVersion.allowedAddonCodes.includes(addon.code));

  const includedUsers = planVersion.limits[USER_RESOURCE];
  const includedWhatsapp = planVersion.limits[WHATSAPP_RESOURCE];
  const neededExtraUsers = includedUsers === null ? 0 : Math.max(0, required.users - includedUsers);
  const neededExtraWhatsapp = includedWhatsapp === null ? 0 : Math.max(0, required.whatsappConnections - includedWhatsapp);

  const feasible = (neededExtraUsers === 0 || Boolean(userAddon)) && (neededExtraWhatsapp === 0 || Boolean(whatsappAddon));

  const userUnits = userAddon && neededExtraUsers > 0 ? Math.ceil(neededExtraUsers / userAddon.increment) : 0;
  const whatsappUnits = whatsappAddon && neededExtraWhatsapp > 0 ? Math.ceil(neededExtraWhatsapp / whatsappAddon.increment) : 0;
  const additionalUsers = userAddon ? userUnits * userAddon.increment : 0;
  const additionalWhatsappConnections = whatsappAddon ? whatsappUnits * whatsappAddon.increment : 0;

  const userAddonPrice = userAddon ? (billingInterval === "monthly" ? userAddon.monthlyPriceUsd : userAddon.yearlyPriceUsd) : 0;
  const whatsappAddonPrice = whatsappAddon ? (billingInterval === "monthly" ? whatsappAddon.monthlyPriceUsd : whatsappAddon.yearlyPriceUsd) : 0;
  const userAddonMonthlyAmount = userUnits * userAddonPrice;
  const whatsappAddonMonthlyAmount = whatsappUnits * whatsappAddonPrice;
  const addonsMonthlyAmount = userAddonMonthlyAmount + whatsappAddonMonthlyAmount;
  const baseMonthlyAmount = billingInterval === "monthly" ? planVersion.monthlyPriceUsd : planVersion.yearlyPriceUsd;

  return {
    planCode: planVersion.planCode,
    currency: planVersion.currency,
    baseMonthlyAmount,
    includedUsers,
    includedWhatsappConnections: includedWhatsapp,
    additionalUsers,
    additionalWhatsappConnections,
    userAddonMonthlyAmount,
    whatsappAddonMonthlyAmount,
    addonsMonthlyAmount,
    totalMonthlyAmount: baseMonthlyAmount + addonsMonthlyAmount,
    feasible,
  };
}

export type PlanRecommendation = {
  options: CapacityCostBreakdown[];
  recommended: CapacityCostBreakdown | undefined;
};

/** Todas as opções elegíveis (planos ativos, não-ENTERPRISE/FREE) para uma capacidade pedida,
 * ordenadas por custo — nunca decide/aplica nada sozinho (seção 9/16/17 do pedido: "não mudar
 * silenciosamente"), só informa. */
export function recommendBestPlan(planVersions: readonly PlanVersion[], addonDefinitions: readonly AddonDefinition[], required: CapacityRequirement, billingInterval: "monthly" | "yearly" = "monthly"): PlanRecommendation {
  const eligible = planVersions.filter((plan) => plan.planCode !== "FREE" && plan.planCode !== "ENTERPRISE");
  const options = eligible
    .map((plan) => computeCapacityCost(plan, addonDefinitions, required, billingInterval))
    .filter((option) => option.feasible)
    .sort((a, b) => a.totalMonthlyAmount - b.totalMonthlyAmount);
  return { options, recommended: options[0] };
}

export type CatalogCoherenceViolation = {
  lowerPlanCode: PlatformPlanCode;
  higherPlanCode: PlatformPlanCode;
  equivalentCost: number;
  higherPlanCost: number;
};

export type CatalogCoherenceResult = { pass: boolean; violations: CatalogCoherenceViolation[] };

/**
 * Validação de coerência do catálogo (seção 17-18 do pedido): cada plano precisa custar MENOS do
 * que montar a MESMA capacidade incluída dele a partir do plano imediatamente inferior + adicionais
 * — nunca comparado com uma base genérica. `orderedPlans` precisa vir em ordem crescente de nível
 * (ex.: START, PRO, BUSINESS) — cada posição é comparada só com a anterior.
 */
export function validateCatalogCoherence(orderedPlans: readonly PlanVersion[], addonDefinitions: readonly AddonDefinition[], billingInterval: "monthly" | "yearly" = "monthly"): CatalogCoherenceResult {
  const violations: CatalogCoherenceViolation[] = [];
  for (let index = 1; index < orderedPlans.length; index += 1) {
    const lower = orderedPlans[index - 1];
    const higher = orderedPlans[index];
    const higherIncludedUsers = higher.limits[USER_RESOURCE] ?? 0;
    const higherIncludedWhatsapp = higher.limits[WHATSAPP_RESOURCE] ?? 0;
    const equivalent = computeCapacityCost(lower, addonDefinitions, { users: higherIncludedUsers, whatsappConnections: higherIncludedWhatsapp }, billingInterval);
    const higherCost = billingInterval === "monthly" ? higher.monthlyPriceUsd : higher.yearlyPriceUsd;
    if (equivalent.totalMonthlyAmount <= higherCost) {
      violations.push({ lowerPlanCode: lower.planCode, higherPlanCode: higher.planCode, equivalentCost: equivalent.totalMonthlyAmount, higherPlanCost: higherCost });
    }
  }
  return { pass: violations.length === 0, violations };
}
