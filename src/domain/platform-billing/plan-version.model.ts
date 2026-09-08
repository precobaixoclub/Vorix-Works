import type { PlatformPlanCode } from "./platform-plan-catalog.js";
import type { PlanCapabilityMap, PlanLimitMap } from "./plan-entitlements.model.js";

/**
 * `PlanVersion` — SaaS Commercialization, Fase 1. Snapshot IMUTÁVEL de capabilities/limites/preço
 * para um `(planCode, version)`. Resolve o não-negociável "assinaturas existentes devem manter a
 * versão contratada": mudar o catálogo em código nunca sobrescreve uma versão já publicada — gera
 * uma nova, com `version` incrementado. Uma `Subscription` referencia sempre um `planVersionId`
 * específico, nunca só um `planCode` solto (ver `subscription.model.ts`).
 */
export type PlanVersion = {
  id: string;
  planCode: PlatformPlanCode;
  version: number;
  name: string;
  tagline: string;
  monthlyPriceUsd: number;
  yearlyPriceUsd: number;
  currency: string;
  capabilities: PlanCapabilityMap;
  limits: PlanLimitMap;
  /** Códigos de `AddonDefinition` que uma assinatura deste plano pode comprar. */
  allowedAddonCodes: readonly string[];
  /** `null` = sem trial (ex.: FREE, que já é grátis; ENTERPRISE, vendido por contato). */
  trialDays: number | null;
  /** Só a versão mais recente e `active` de cada `planCode` é oferecida a NOVAS assinaturas —
   * versões antigas continuam válidas pra quem já as contratou, nunca são reativadas. */
  active: boolean;
  createdAt: string;
};

export type AddonDefinition = {
  code: string;
  name: string;
  description: string;
  monthlyPriceUsd: number;
  yearlyPriceUsd: number;
  /** Recurso que este addon incrementa (ex.: comprar "addon_extra_user" soma a `increment` no
   * limite de `users` calculado pelo `resolveEffectiveEntitlements`). */
  resource: import("./plan-entitlements.model.js").PlanLimitResource;
  increment: number;
  active: boolean;
  createdAt: string;
};
