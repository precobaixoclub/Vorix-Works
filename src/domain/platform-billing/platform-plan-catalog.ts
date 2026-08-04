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
  /** Cota de cr\u00e9ditos Vorix inclu\u00eddos no plano. Cr\u00e9dito \u00e9 unidade fixa por opera\u00e7\u00e3o (texto=1,
   * imagem=2, v\u00eddeo=20 por padr\u00e3o \u2014 ver `ai_operation_types`), nunca proporcional a token/segundo
   * real gasto no provider. */
  monthlyCreditsQuota: number;
  /** Cota de publica\u00e7\u00f5es reais (Meta/etc.) no m\u00eas. */
  monthlyPublicationsQuota: number;
  /** N\u00famero m\u00e1ximo de Workspaces do Tenant. `null` = ilimitado. */
  maxWorkspaces: number | null;
  /** Se `true`, o plano \u00e9 apresentado com destaque na landing. */
  highlighted?: boolean;
  /** Descri\u00e7\u00f5es livres para exibir na p\u00e1gina de planos. */
  features: readonly string[];
};

/**
 * Precifica\u00e7\u00e3o inicial \u2014 valores conservadores. A cota do FREE (50 cr\u00e9ditos) foi calibrada para
 * permitir experimentar o produto (chat + algumas imagens) sem virar canal de custo \u2014 o cliente
 * nunca v\u00ea o custo real em USD, s\u00f3 o saldo de cr\u00e9ditos. Custo em cr\u00e9dito por opera\u00e7\u00e3o \u00e9
 * admin-configur\u00e1vel em `ai_operation_types` (padr\u00e3o: texto=1, imagem=2, v\u00eddeo curto=20).
 */
export const PLATFORM_PLAN_CATALOG: Readonly<Record<PlatformPlanCode, PlatformPlanDefinition>> = Object.freeze({
  FREE: {
    code: "FREE",
    name: "Gratuito",
    tagline: "Para conhecer o Vorix",
    monthlyPriceUsd: 0,
    monthlyCreditsQuota: 50,
    monthlyPublicationsQuota: 5,
    maxWorkspaces: 1,
    features: [
      "50 cr\u00e9ditos de IA por m\u00eas",
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
    monthlyCreditsQuota: 500,
    monthlyPublicationsQuota: 60,
    maxWorkspaces: null,
    features: [
      "500 cr\u00e9ditos de IA por m\u00eas",
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
    monthlyCreditsQuota: 2_500,
    monthlyPublicationsQuota: 300,
    maxWorkspaces: null,
    highlighted: true,
    features: [
      "2.500 cr\u00e9ditos de IA por m\u00eas",
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
    monthlyCreditsQuota: 10_000,
    monthlyPublicationsQuota: 1_500,
    maxWorkspaces: null,
    features: [
      "10.000 cr\u00e9ditos de IA por m\u00eas",
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
    monthlyCreditsQuota: Number.MAX_SAFE_INTEGER,
    monthlyPublicationsQuota: Number.MAX_SAFE_INTEGER,
    maxWorkspaces: null,
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
