import type { AiGatewayPort, AiGatewayResult, AiRequest } from "../ports/ai-gateway.port.js";
import { CreditAccountingService } from "../ai-providers/credit-accounting.service.js";

export type CreditGatedAiGatewayDeps = {
  inner: AiGatewayPort;
  creditAccounting: CreditAccountingService;
  now: () => Date;
};

/**
 * Envolve o `AiGateway` real com controle de créditos Vorix por Tenant — Sprint 25 (Fase 2),
 * migrado na Sprint 26 de "cota proporcional a tokens" para "crédito fixo por operação"
 * (`AiOperationType.creditsCost`, ver `ai_operation_types` / `CreditAccountingService`).
 *
 * Comportamento:
 *   1. Antes de chamar a IA: resolve o `AiOperationType` de `request.operation` e confere se o
 *      tenant tem créditos suficientes (`CreditAccountingService.checkAvailability`). Se não,
 *      retorna `{ok: false, error.category: "quota_exceeded"}` — SEM gastar chamada real.
 *   2. Se OK, delega ao gateway real (que faz sanitização, roteamento, retry, persist, telemetria).
 *   3. Após sucesso: registra a geração no ledger financeiro + agregado mensal + deduz créditos
 *      avulsos se a cota mensal já tiver estourado (tudo via `CreditAccountingService`).
 *
 * A receita estimada por geração = `creditsCost * creditUnitValueUsd` (parâmetro admin), não mais
 * `providerCost * priceMultiplier` — o cliente nunca vê o custo real do provider.
 */
export class CreditGatedAiGateway implements AiGatewayPort {
  constructor(private readonly deps: CreditGatedAiGatewayDeps) {}

  async execute(request: AiRequest): Promise<AiGatewayResult> {
    const nowDate = this.deps.now();
    const availability = await this.deps.creditAccounting.checkAvailability(request.tenantId, request.operation, nowDate);

    if (!availability.ok) {
      const category = availability.reason === "operation_unknown" ? "invalid_request" : "quota_exceeded";
      return { ok: false, error: { category, message: availability.message, retryable: false } };
    }

    const result = await this.deps.inner.execute(request);
    if (!result.ok) {
      // Falha do provider não consome crédito — só registra para auditoria, nunca lança.
      try {
        await this.deps.creditAccounting.recordFailure({
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          operationType: availability.operationType,
          providerCode: (result.error.provider as "anthropic" | "openai" | "google" | undefined) ?? "anthropic",
          modelId: result.error.model ?? availability.operationType.defaultModelId ?? "unknown",
          errorCode: result.error.category,
          requestedByUserId: request.userId,
          now: nowDate,
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[CreditGatedAiGateway] Falha ao registrar geração com erro:", error);
      }
      return result;
    }

    try {
      await this.deps.creditAccounting.recordSuccess({
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        operationType: availability.operationType,
        providerCode: result.data.provider as "anthropic" | "openai" | "google",
        modelId: result.data.model,
        providerCostUsd: result.data.usage.estimatedCost,
        priceMultiplier: availability.priceMultiplier,
        monthlyRemainingBefore: availability.monthlyRemainingBefore,
        creditsExtraBefore: availability.creditsExtraBefore,
        requestedByUserId: request.userId,
        tokens: {
          inputTokens: result.data.usage.inputTokens,
          outputTokens: result.data.usage.outputTokens,
          cachedInputTokens: result.data.usage.cachedInputTokens,
        },
        now: nowDate,
      });
    } catch (error) {
      // Nunca derruba a resposta de IA já bem-sucedida — só loga na sombra.
      // eslint-disable-next-line no-console
      console.error("[CreditGatedAiGateway] Falha ao registrar consumo:", error);
    }

    return result;
  }
}
