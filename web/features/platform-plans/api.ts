import { getApiBaseUrl } from "@/lib/api-error";
import { ApiError } from "@/lib/api-client";

/**
 * Dados de plano público — espelha `PlatformPlanDefinition` do backend, mas só as chaves que a
 * landing e a página de pricing precisam. Buscados via `GET /v1/platform/plans` (público, sem
 * auth). Cache por 5 minutos: essa lista muda em release, não em runtime.
 */
export type PublicPlan = {
  code: "FREE" | "START" | "PRO" | "BUSINESS";
  name: string;
  tagline: string;
  monthlyPriceUsd: number;
  yearlyPriceUsd: number;
  /** Pricing/Capacity Etapa B — desde a correção do P0 da auditoria, este DTO vem de
   * `plan_versions` (banco), a MESMA fonte usada pelo checkout — nunca mais um catálogo
   * hardcoded separado. `currency` é sempre a moeda real cobrada (hoje "BRL"). */
  currency: string;
  includedUsers: number | null;
  includedWhatsappConnections: number | null;
  monthlyCreditsQuota: number;
  highlighted?: boolean;
  trialDays: number | null;
};

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/** Adicional de capacidade público (seção 26 do pedido) — mesma fonte (`addon_definitions`) usada
 * pela compra real dentro do produto, nunca um valor hardcoded na página. */
export type PublicCapacityAddon = { code: string; name: string; monthlyPriceUsd: number; currency: string; resource: "users" | "messaging_connections" };

export async function fetchPublicCatalog(): Promise<{ plans: readonly PublicPlan[]; addons: readonly PublicCapacityAddon[] }> {
  const response = await fetch(`${getApiBaseUrl()}/v1/platform/plans`, {
    method: "GET",
    // Cache no cliente: revalida a cada 5min. Landing muitas vezes é servida a usuários anônimos.
    next: { revalidate: 300 },
  });
  const body = (await response.json().catch(() => undefined)) as Envelope<{ plans: PublicPlan[]; addons: PublicCapacityAddon[] }> | undefined;
  if (!body) throw new ApiError("INVALID_RESPONSE", "Resposta inválida da API de planos.", response.status, false);
  if (!body.ok) throw new ApiError(body.error.code, body.error.message, response.status, false);
  return body.data;
}

export async function fetchPublicPlans(): Promise<readonly PublicPlan[]> {
  return (await fetchPublicCatalog()).plans;
}

export function formatPlanPrice(plan: PublicPlan): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: plan.currency }).format(plan.monthlyPriceUsd);
}

export function formatCapacityLine(plan: Pick<PublicPlan, "includedUsers" | "includedWhatsappConnections">): string {
  const users = plan.includedUsers === null ? "usuários ilimitados" : `${plan.includedUsers} usuário${plan.includedUsers === 1 ? "" : "s"}`;
  const numbers = plan.includedWhatsappConnections === null ? "números ilimitados" : `${plan.includedWhatsappConnections} número${plan.includedWhatsappConnections === 1 ? "" : "s"} conectado${plan.includedWhatsappConnections === 1 ? "" : "s"}`;
  return `${users} · ${numbers}`;
}

export type CapacityRecommendationOption = {
  planCode: PublicPlan["code"];
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
  feasible: boolean;
};

export type CapacityRecommendation = { options: CapacityRecommendationOption[]; recommended: CapacityRecommendationOption | undefined };

/** Simulador público (seção 27 do pedido) — sem autenticação, mesmo cálculo do backend usado no
 * preview autenticado (`recommendBestPlan`). Frontend nunca reimplementa a conta. */
export async function simulateCapacity(input: { users: number; whatsappConnections: number }): Promise<CapacityRecommendation> {
  const response = await fetch(`${getApiBaseUrl()}/v1/platform/plans/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => undefined)) as Envelope<CapacityRecommendation> | undefined;
  if (!body) throw new ApiError("INVALID_RESPONSE", "Resposta inválida do simulador.", response.status, false);
  if (!body.ok) throw new ApiError(body.error.code, body.error.message, response.status, false);
  return body.data;
}

export function formatCreditsQuota(credits: number): string {
  if (credits >= 1_000_000) return `${(credits / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M créditos`;
  if (credits >= 1_000) return `${(credits / 1_000).toLocaleString("pt-BR")}k créditos`;
  return `${credits.toLocaleString("pt-BR")} créditos`;
}
