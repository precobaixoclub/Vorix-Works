/**
 * Cat\u00e1logo de planos B2C \u2014 Sprint 25 (Fase 1).
 *
 * Espelha (mas n\u00e3o duplica) `TenantPlanCode` da Valentina. A Valentina descreve o que o Tenant
 * PODE fazer (limites, features, especialistas); aqui descrevemos o que o Tenant PAGA / RECEBE
 * (cotas de tokens de IA, publica\u00e7\u00f5es mensais, pre\u00e7o).
 *
 * Todo pre\u00e7o est\u00e1 em USD com 2 casas (mesmo padr\u00e3o do `cost-calculator.ts` da IA), para que a
 * matem\u00e1tica de markup n\u00e3o dependa de convers\u00e3o de moeda \u2014 c\u00e2mbio para BRL fica na camada UI
 * (fase futura), nunca aqui.
 */

export const PLATFORM_PLAN_CODES = ["FREE", "START", "PRO", "BUSINESS", "ENTERPRISE"] as const;
export type PlatformPlanCode = (typeof PLATFORM_PLAN_CODES)[number];

export const PLATFORM_SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "past_due",
  "cancelled",
  "expired",
  "suspended",
] as const;
export type PlatformSubscriptionStatus = (typeof PLATFORM_SUBSCRIPTION_STATUSES)[number];

export type PlatformPlanDefinition = {
  code: PlatformPlanCode;
  name: string;
  tagline: string;
  /** Pre\u00e7o mensal cobrado do cliente (USD). `0` no FREE. */
  monthlyPriceUsd: number;
  /** Cota de tokens Anthropic inclu\u00eddos no plano (input + output somados). */
  monthlyTokenQuota: number;
  /** Cota de publica\u00e7\u00f5es reais (Meta/etc.) no m\u00eas. */
  monthlyPublicationsQuota: number;
  /** Se `true`, o plano \u00e9 apresentado com destaque na landing. */
  highlighted?: boolean;
  /** Descri\u00e7\u00f5es livres para exibir na p\u00e1gina de planos. */
  features: readonly string[];
};

/**
 * Precifica\u00e7\u00e3o inicial \u2014 valores conservadores. A cota de tokens do FREE (100k) foi calibrada
 * para permitir experimentar o produto sem virar canal de custo (100k de tokens do Claude
 * Sonnet 4.5 = ~$0.30 de custo real com margem embutida no markup do avulso). Os planos pagos
 * ficam com preferencia clara por assinatura vs. tokens avulsos (o "extra pack" custa 2x o custo,
 * o plano PRO cobra ~1.5x \u2014 desconto de atacado deliberado).
 */
export const PLATFORM_PLAN_CATALOG: Readonly<Record<PlatformPlanCode, PlatformPlanDefinition>> = Object.freeze({
  FREE: {
    code: "FREE",
    name: "Gratuito",
    tagline: "Para conhecer o Vorix",
    monthlyPriceUsd: 0,
    monthlyTokenQuota: 100_000,
    monthlyPublicationsQuota: 5,
    features: [
      "100 mil tokens de IA por m\u00eas",
      "5 publica\u00e7\u00f5es reais no m\u00eas",
      "1 Workspace",
      "Suporte por comunidade",
    ],
  },
  START: {
    code: "START",
    name: "Start",
    tagline: "Para consultores e influenciadores",
    monthlyPriceUsd: 29,
    monthlyTokenQuota: 1_500_000,
    monthlyPublicationsQuota: 60,
    features: [
      "1,5 milh\u00e3o de tokens de IA por m\u00eas",
      "60 publica\u00e7\u00f5es reais no m\u00eas",
      "Workspaces ilimitados",
      "Suporte por e-mail",
    ],
  },
  PRO: {
    code: "PRO",
    name: "Pro",
    tagline: "Para ag\u00eancias em opera\u00e7\u00e3o",
    monthlyPriceUsd: 89,
    monthlyTokenQuota: 6_000_000,
    monthlyPublicationsQuota: 300,
    highlighted: true,
    features: [
      "6 milh\u00f5es de tokens de IA por m\u00eas",
      "300 publica\u00e7\u00f5es reais no m\u00eas",
      "Workspaces ilimitados",
      "Integra\u00e7\u00f5es sociais completas",
      "Suporte priorit\u00e1rio",
    ],
  },
  BUSINESS: {
    code: "BUSINESS",
    name: "Business",
    tagline: "Para opera\u00e7\u00f5es multi-marca",
    monthlyPriceUsd: 249,
    monthlyTokenQuota: 20_000_000,
    monthlyPublicationsQuota: 1_500,
    features: [
      "20 milh\u00f5es de tokens de IA por m\u00eas",
      "1.500 publica\u00e7\u00f5es reais no m\u00eas",
      "Workspaces ilimitados",
      "SLA de disponibilidade",
      "Success manager dedicado",
    ],
  },
  ENTERPRISE: {
    code: "ENTERPRISE",
    name: "Enterprise",
    tagline: "Volume corporativo",
    monthlyPriceUsd: 0,
    monthlyTokenQuota: Number.MAX_SAFE_INTEGER,
    monthlyPublicationsQuota: Number.MAX_SAFE_INTEGER,
    features: [
      "Cotas negociadas",
      "SLA cont\u00e1bil e jur\u00eddico",
      "Onboarding assistido",
      "Contrato empresarial",
    ],
  },
});

export function getPlatformPlan(code: PlatformPlanCode): PlatformPlanDefinition {
  const plan = PLATFORM_PLAN_CATALOG[code];
  if (!plan) throw new Error(`PLATFORM_PLAN_UNKNOWN: plano "${code}" não existe no catálogo.`);
  return plan;
}

/** Preview de todos os planos p\u00fablicos (exclui ENTERPRISE, que \u00e9 vendido por contato). */
export function listPublicPlans(): readonly PlatformPlanDefinition[] {
  return PLATFORM_PLAN_CODES
    .filter((code) => code !== "ENTERPRISE")
    .map((code) => PLATFORM_PLAN_CATALOG[code]);
}
