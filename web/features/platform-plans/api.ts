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
  monthlyTokenQuota: number;
  monthlyPublicationsQuota: number;
  highlighted?: boolean;
  features: readonly string[];
};

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export async function fetchPublicPlans(): Promise<readonly PublicPlan[]> {
  const response = await fetch(`${getApiBaseUrl()}/v1/platform/plans`, {
    method: "GET",
    // Cache no cliente: revalida a cada 5min. Landing muitas vezes é servida a usuários anônimos.
    next: { revalidate: 300 },
  });
  const body = (await response.json().catch(() => undefined)) as Envelope<{ plans: PublicPlan[] }> | undefined;
  if (!body) throw new ApiError("INVALID_RESPONSE", "Resposta inválida da API de planos.", response.status, false);
  if (!body.ok) throw new ApiError(body.error.code, body.error.message, response.status, false);
  return body.data.plans;
}

export function formatPlanPrice(plan: PublicPlan): string {
  if (plan.monthlyPriceUsd === 0) return "Grátis";
  return `US$ ${plan.monthlyPriceUsd}`;
}

export function formatTokenQuota(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M tokens`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toLocaleString("pt-BR")}k tokens`;
  return `${tokens.toLocaleString("pt-BR")} tokens`;
}
