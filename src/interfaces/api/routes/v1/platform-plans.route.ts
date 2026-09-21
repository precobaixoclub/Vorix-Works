import type { FastifyInstance } from "fastify";
import { recommendBestPlan } from "../../../../domain/platform-billing/capacity.model.js";
import { listPublicPlans } from "../../../../domain/platform-billing/index.js";
import type { AddonDefinitionRepositoryPort, PlanVersionRepositoryPort } from "../../../../application/ports/plan-version-repository.port.js";
import { successEnvelope } from "../../http/response-envelope.js";
import { ValidationError } from "../../http/app-error.js";

export type PlatformPlansRoutesDeps = {
  planVersionRepository?: PlanVersionRepositoryPort;
  addonDefinitionRepository?: AddonDefinitionRepositoryPort;
};

export type PublicPlanDto = {
  code: string;
  name: string;
  tagline: string;
  monthlyPriceUsd: number;
  yearlyPriceUsd: number;
  currency: string;
  includedUsers: number | null;
  includedWhatsappConnections: number | null;
  monthlyCreditsQuota: number;
  highlighted: boolean;
  trialDays: number | null;
};

export type PublicCapacityAddonDto = { code: string; name: string; monthlyPriceUsd: number; currency: string; resource: "users" | "messaging_connections" };

/** PRO como "Recomendado" é decisão de produto (seção 25/33 do pedido: nunca "Mais escolhido" sem
 * dado real) — vive só na camada de apresentação, nunca no catálogo comercial (não é dado
 * financeiro, não precisa de versionamento). */
function isHighlighted(planCode: string): boolean {
  return planCode === "PRO";
}

/**
 * `GET /platform/plans` — Pricing/Capacity Etapa B, correção do P0 crítico da auditoria (seção 2 do
 * pedido: "o preço mostrado precisa ser exatamente o preço que pode ser cobrado"). ANTES lia do
 * catálogo TypeScript hardcoded (`PLATFORM_PLAN_CATALOG`), 100% desconectado do que o checkout
 * realmente cobra (`plan_versions`, via `monthlyProviderPriceRef`) — dois preços podiam divergir
 * silenciosamente. AGORA lê direto de `plan_versions` (banco), a MESMA fonte usada por
 * `startCheckout`/`changePlan` — nunca mais duas fontes de preço.
 *
 * Fallback pro catálogo legado só quando `planVersionRepository` não está disponível (modo sem
 * Postgres/identity — nunca em produção real) — degrada graciosamente, nunca derruba o boot, mesmo
 * padrão de config já usado no resto do projeto.
 */
export async function registerPlatformPlansRoutes(app: FastifyInstance, deps: PlatformPlansRoutesDeps = {}): Promise<void> {
  app.get("/platform/plans", async (request) => {
    if (!deps.planVersionRepository) {
      return successEnvelope({ plans: listPublicPlans(), addons: [] }, request.id);
    }
    const active = await deps.planVersionRepository.listActivePlans();
    const plans: PublicPlanDto[] = active
      .filter((plan) => plan.planCode !== "FREE" && plan.planCode !== "ENTERPRISE")
      .sort((a, b) => a.monthlyPriceUsd - b.monthlyPriceUsd)
      .map((plan) => ({
        code: plan.planCode,
        name: plan.name,
        tagline: plan.tagline,
        monthlyPriceUsd: plan.monthlyPriceUsd,
        yearlyPriceUsd: plan.yearlyPriceUsd,
        currency: plan.currency,
        includedUsers: plan.limits.users,
        includedWhatsappConnections: plan.limits.messaging_connections,
        monthlyCreditsQuota: plan.limits.ai_credits ?? 0,
        highlighted: isHighlighted(plan.planCode),
        trialDays: plan.trialDays,
      }));

    // Pricing/Capacity Etapa B (seção 26 do pedido) — "Personalize conforme sua operação" mostra
    // os 2 adicionais de capacidade (usuário/número), mesma fonte do catálogo, nunca hardcoded.
    const addons: PublicCapacityAddonDto[] = deps.addonDefinitionRepository
      ? (await deps.addonDefinitionRepository.listActive())
          .filter((addon): addon is typeof addon & { resource: "users" | "messaging_connections" } => addon.resource === "users" || addon.resource === "messaging_connections")
          .map((addon) => ({ code: addon.code, name: addon.name, monthlyPriceUsd: addon.monthlyPriceUsd, currency: addon.currency, resource: addon.resource }))
      : [];

    return successEnvelope({ plans, addons }, request.id);
  });

  const SIMULATE_BODY_SCHEMA = {
    type: "object",
    required: ["users", "whatsappConnections"],
    additionalProperties: false,
    properties: {
      users: { type: "integer", minimum: 0, maximum: 10_000 },
      whatsappConnections: { type: "integer", minimum: 0, maximum: 1_000 },
    },
  } as const;

  /**
   * `POST /platform/plans/simulate` — simulador público de capacidade (seção 27 do pedido), sem
   * autenticação (visitante avaliando antes de criar conta). Reusa o MESMO `recommendBestPlan` do
   * backend usado pelo preview autenticado — frontend nunca reimplementa esta conta (seção 9/27:
   * "não deixar frontend reinventar cálculo").
   */
  app.post("/platform/plans/simulate", { schema: { body: SIMULATE_BODY_SCHEMA } }, async (request) => {
    if (!deps.planVersionRepository || !deps.addonDefinitionRepository) {
      throw new ValidationError("SIMULATE_NOT_AVAILABLE: simulador indisponível neste ambiente.");
    }
    const body = request.body as { users: number; whatsappConnections: number };
    const [planVersions, addonDefinitions] = await Promise.all([
      deps.planVersionRepository.listActivePlans(),
      deps.addonDefinitionRepository.listActive(),
    ]);
    const recommendation = recommendBestPlan(planVersions, addonDefinitions, body);
    return successEnvelope(recommendation, request.id);
  });
}
