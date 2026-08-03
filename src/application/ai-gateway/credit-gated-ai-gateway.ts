import type { PlatformBillingRepositoryPort } from "../ports/platform-billing-repository.port.js";
import type { AiGatewayPort, AiGatewayResult, AiRequest, AiResponse, AiUsage } from "../ports/ai-gateway.port.js";
import { periodOf } from "../../domain/platform-billing/tenant-billing.model.js";

export type CreditGatedAiGatewayDeps = {
  inner: AiGatewayPort;
  platformBillingRepository: PlatformBillingRepositoryPort;
  idGenerator: (prefix: string) => string;
  now: () => Date;
};

/**
 * Envolve o `AiGateway` real com controle de créditos por Tenant — Sprint 25/Fase 2.
 *
 * Comportamento:
 *   1. Antes de chamar a IA: consulta `tenant_billing` + consumo do mês corrente
 *      (`tenant_ai_usage_monthly`). Se `totalDisponivel <= 0`, retorna imediatamente
 *      `{ok: false, error.category: "quota_exceeded"}` — SEM gastar chamada real.
 *      Também bloqueia se `subscription_status` for "suspended"/"cancelled"/"expired".
 *   2. Se OK, delega ao gateway real (que faz sanitização, roteamento, retry, persist, telemetria).
 *   3. Após sucesso: registra o consumo real em `tenant_ai_usage_monthly` (`addAiUsage`) e deduz
 *      dos `creditsExtraTokens` se a cota mensal do plano já foi esgotada (via `applyCreditDelta`
 *      com `reason='ai_consumption'`, que também deixa linha no ledger imutável).
 *
 * O preço cobrado do cliente = `providerCost * priceMultiplier` (por padrão 2x — ver
 * `platform-plan-catalog.ts`); a diferença aparece como lucro no painel admin.
 */
export class CreditGatedAiGateway implements AiGatewayPort {
  constructor(private readonly deps: CreditGatedAiGatewayDeps) {}

  async execute(request: AiRequest): Promise<AiGatewayResult> {
    const nowDate = this.deps.now();
    const nowIso = nowDate.toISOString();
    const period = periodOf(nowDate);

    const billing = await this.deps.platformBillingRepository.getTenantBilling(request.tenantId);
    if (!billing) {
      // Sem linha de billing, assumimos que o tenant NÃO deveria estar chamando a API (só
      // acontece se alguém pulou a criação de tenant_billing). Bloqueia por segurança.
      return {
        ok: false,
        error: {
          category: "quota_exceeded",
          message: "Tenant sem configuração de billing — contate o suporte.",
          retryable: false,
        },
      };
    }

    if (["suspended", "cancelled", "expired"].includes(billing.subscriptionStatus)) {
      return {
        ok: false,
        error: {
          category: "quota_exceeded",
          message: `Conta ${billing.subscriptionStatus === "suspended" ? "suspensa" : billing.subscriptionStatus === "expired" ? "com assinatura expirada" : "cancelada"}. Regularize para continuar usando a IA.`,
          retryable: false,
        },
      };
    }

    const currentUsage = await this.deps.platformBillingRepository.getAiUsage({ tenantId: request.tenantId, period });
    const consumedThisMonth = currentUsage ? currentUsage.inputTokens + currentUsage.outputTokens : 0;
    const monthlyRemaining = Math.max(0, billing.monthlyTokenQuota - consumedThisMonth);
    const totalAvailable = monthlyRemaining + billing.creditsExtraTokens;

    if (totalAvailable <= 0) {
      return {
        ok: false,
        error: {
          category: "quota_exceeded",
          message: "Saldo de tokens de IA esgotado para este mês. Faça upgrade de plano ou compre créditos avulsos.",
          retryable: false,
        },
      };
    }

    const result = await this.deps.inner.execute(request);
    if (!result.ok) return result;

    // Consumo real. Nunca lançamos erro daqui — falha em registrar consumo NÃO deve derrubar a
    // resposta da IA que já foi bem-sucedida (usuário paga em duplo se retry). Só loga na sombra.
    try {
      await this.recordConsumption(request.tenantId, result.data, billing, monthlyRemaining, period, nowIso);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[CreditGatedAiGateway] Falha ao registrar consumo:", error);
    }

    return result;
  }

  private async recordConsumption(
    tenantId: string,
    response: AiResponse,
    billing: { creditsExtraTokens: number; priceMultiplier: number },
    monthlyRemainingBefore: number,
    period: string,
    nowIso: string,
  ): Promise<void> {
    const usage: AiUsage = response.usage;
    const tokensUsed = usage.inputTokens + usage.outputTokens;
    if (tokensUsed <= 0) return;

    const providerCostUsd = usage.estimatedCost;
    const customerPriceUsd = providerCostUsd * billing.priceMultiplier;

    await this.deps.platformBillingRepository.addAiUsage({
      tenantId,
      period,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
      providerCostUsd,
      customerPriceUsd,
      requestsDelta: 1,
      now: nowIso,
    });

    // Se estourou a cota mensal inclusa no plano, o excedente sai de `creditsExtraTokens`.
    const spilloverIntoExtras = Math.max(0, tokensUsed - monthlyRemainingBefore);
    if (spilloverIntoExtras > 0 && billing.creditsExtraTokens > 0) {
      const deducted = Math.min(spilloverIntoExtras, billing.creditsExtraTokens);
      await this.deps.platformBillingRepository.applyCreditDelta({
        id: this.deps.idGenerator("consumo"),
        tenantId,
        deltaTokens: -deducted,
        reason: "ai_consumption",
        metadata: {
          period,
          totalTokensUsed: tokensUsed,
          monthlyRemainingBefore,
          providerCostUsd,
          customerPriceUsd,
        },
        now: nowIso,
      });
    }
  }
}
