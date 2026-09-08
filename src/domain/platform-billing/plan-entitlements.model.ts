/**
 * Vocabulário FECHADO de capabilities e limites — SaaS Commercialization, Fase 1 (Billing
 * Foundation). Esta é a única lista de nomes que `canUse()`/`limit()` conhecem; o domínio nunca
 * conhece nomes comerciais de plano (`if (plan === "pro")` nunca aparece em lugar nenhum —
 * ver `docs/saas-commercialization-audit.md`, seção 2.4). Adicionar uma capability/limite novo é
 * sempre uma mudança nestas duas listas + uma nova versão de plano, nunca um `if` espalhado.
 */

export const PLAN_CAPABILITIES = [
  "crm",
  "conversations",
  "marketing",
  "proposals",
  "automation",
  "ai_auto_reply",
  "advanced_analytics",
] as const;
export type PlanCapability = (typeof PLAN_CAPABILITIES)[number];

export const PLAN_LIMIT_RESOURCES = [
  "users",
  "workspaces",
  "messaging_connections",
  "contacts",
  "ai_credits",
  "storage_mb",
  "automations",
] as const;
export type PlanLimitResource = (typeof PLAN_LIMIT_RESOURCES)[number];

/** `true`/`false` por capability — sempre as 7 chaves presentes (nunca parcial), pra nunca haver
 * ambiguidade entre "não configurado" e "desligado". */
export type PlanCapabilityMap = Record<PlanCapability, boolean>;

/** `null` = ilimitado. Nunca `0` como sinônimo de ilimitado, nunca `-1` como sentinela — `null` é
 * o único jeito de expressar "sem teto" (mesma convenção já usada por
 * `PlatformPlanDefinition.maxWorkspaces`). */
export type PlanLimitMap = Record<PlanLimitResource, number | null>;

export function emptyCapabilityMap(value: boolean): PlanCapabilityMap {
  return PLAN_CAPABILITIES.reduce((acc, capability) => ({ ...acc, [capability]: value }), {} as PlanCapabilityMap);
}
