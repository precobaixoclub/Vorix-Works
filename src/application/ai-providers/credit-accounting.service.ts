import type { PlatformBillingRepositoryPort } from "../ports/platform-billing-repository.port.js";
import type { PlatformAiSettingsRepositoryPort } from "../ports/platform-ai-settings-repository.port.js";
import type { AiProvidersRepositoryPort } from "../ports/ai-providers-repository.port.js";
import { periodOf } from "../../domain/platform-billing/tenant-billing.model.js";
import { estimatedRevenueUsd, type AiOperationType, type AiProviderCode } from "../../domain/ai-providers/index.js";

export type CreditAccountingDeps = {
  platformBillingRepository: PlatformBillingRepositoryPort;
  platformAiSettingsRepository: PlatformAiSettingsRepositoryPort;
  aiProvidersRepository: AiProvidersRepositoryPort;
  idGenerator: (prefix: string) => string;
};

export type CreditAvailability =
  | { ok: true; operationType: AiOperationType; monthlyRemainingBefore: number; creditsExtraBefore: number }
  | { ok: false; reason: "operation_unknown" | "not_configured" | "account_blocked" | "quota_exceeded"; message: string };

/**
 * Lógica de crédito compartilhada entre `CreditGatedAiGateway` (texto) e `MediaGenerationService`
 * (imagem/vídeo) — Sprint 26. Único lugar que sabe "quanto custa em crédito" e "quanto sobrou" —
 * nenhum caso de uso calcula isso na mão. Crédito é sempre um número FIXO por `AiOperationType`,
 * nunca proporcional a token/segundo real gasto no provider (essa proporcionalidade só afeta
 * `providerCostUsd`, nunca o que é debitado do tenant).
 */
export class CreditAccountingService {
  constructor(private readonly deps: CreditAccountingDeps) {}

  async checkAvailability(tenantId: string, operationTypeCode: string, now: Date): Promise<CreditAvailability> {
    const operationType = await this.deps.aiProvidersRepository.getOperationType(operationTypeCode);
    if (!operationType || !operationType.active) {
      return { ok: false, reason: "operation_unknown", message: `Operação de IA "${operationTypeCode}" não está configurada ou está desativada.` };
    }

    const billing = await this.deps.platformBillingRepository.getTenantBilling(tenantId);
    if (!billing) {
      return { ok: false, reason: "not_configured", message: "Tenant sem configuração de billing — contate o suporte." };
    }
    if (["suspended", "cancelled", "expired"].includes(billing.subscriptionStatus)) {
      const label = billing.subscriptionStatus === "suspended" ? "suspensa" : billing.subscriptionStatus === "expired" ? "com assinatura expirada" : "cancelada";
      return { ok: false, reason: "account_blocked", message: `Conta ${label}. Regularize para continuar usando a IA.` };
    }

    const period = periodOf(now);
    const usage = await this.deps.platformBillingRepository.getAiUsage({ tenantId, period });
    const consumedThisMonth = usage?.creditsConsumed ?? 0;
    const monthlyRemainingBefore = Math.max(0, billing.monthlyCreditsQuota - consumedThisMonth);
    const totalAvailable = monthlyRemainingBefore + billing.creditsExtra;

    if (totalAvailable < operationType.creditsCost) {
      return { ok: false, reason: "quota_exceeded", message: "Saldo de créditos Vorix insuficiente para esta operação. Faça upgrade de plano ou compre créditos avulsos." };
    }

    return { ok: true, operationType, monthlyRemainingBefore, creditsExtraBefore: billing.creditsExtra };
  }

  /** Registra uma geração bem-sucedida: ledger financeiro + agregado mensal + dedução de crédito
   * avulso se a cota mensal já tiver estourado. Nunca lança — falha em registrar não deve derrubar
   * uma resposta de IA já entregue ao cliente (quem chama decide o que fazer com o erro). */
  async recordSuccess(input: {
    tenantId: string;
    workspaceId?: string;
    operationType: AiOperationType;
    providerCode: AiProviderCode;
    modelId: string;
    providerCostUsd: number;
    monthlyRemainingBefore: number;
    creditsExtraBefore: number;
    requestedByUserId?: string;
    tokens?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
    metadata?: Record<string, unknown>;
    now: Date;
  }): Promise<void> {
    const settings = await this.deps.platformAiSettingsRepository.get();
    const creditsConsumed = input.operationType.creditsCost;
    const revenueUsd = estimatedRevenueUsd(creditsConsumed, settings.creditUnitValueUsd);
    const period = periodOf(input.now);
    const nowIso = input.now.toISOString();

    await this.deps.aiProvidersRepository.recordGeneration({
      id: this.deps.idGenerator("gen"),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      operationTypeCode: input.operationType.code,
      providerCode: input.providerCode,
      modelId: input.modelId,
      creditsConsumed,
      providerCostUsd: input.providerCostUsd,
      estimatedRevenueUsd: revenueUsd,
      status: "success",
      requestedByUserId: input.requestedByUserId,
      occurredAt: nowIso,
      metadata: input.metadata ?? {},
    });

    await this.deps.platformBillingRepository.addAiUsage({
      tenantId: input.tenantId,
      period,
      inputTokens: input.tokens?.inputTokens ?? 0,
      outputTokens: input.tokens?.outputTokens ?? 0,
      cachedInputTokens: input.tokens?.cachedInputTokens ?? 0,
      creditsConsumed,
      providerCostUsd: input.providerCostUsd,
      customerPriceUsd: revenueUsd,
      requestsDelta: 1,
      now: nowIso,
    });

    const spilloverIntoExtras = Math.max(0, creditsConsumed - input.monthlyRemainingBefore);
    if (spilloverIntoExtras > 0 && input.creditsExtraBefore > 0) {
      const deducted = Math.min(spilloverIntoExtras, input.creditsExtraBefore);
      await this.deps.platformBillingRepository.applyCreditDelta({
        id: this.deps.idGenerator("consumo"),
        tenantId: input.tenantId,
        deltaCredits: -deducted,
        reason: "ai_consumption",
        metadata: { period, operationTypeCode: input.operationType.code, creditsConsumed, monthlyRemainingBefore: input.monthlyRemainingBefore },
        now: nowIso,
      });
    }
  }

  /** Registra uma geração que falhou — sem custo/crédito debitado, só para auditoria/observabilidade. */
  async recordFailure(input: {
    tenantId: string;
    workspaceId?: string;
    operationType: AiOperationType;
    providerCode: AiProviderCode;
    modelId: string;
    errorCode: string;
    requestedByUserId?: string;
    now: Date;
  }): Promise<void> {
    await this.deps.aiProvidersRepository.recordGeneration({
      id: this.deps.idGenerator("gen"),
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      operationTypeCode: input.operationType.code,
      providerCode: input.providerCode,
      modelId: input.modelId,
      creditsConsumed: 0,
      providerCostUsd: 0,
      estimatedRevenueUsd: 0,
      status: "failed",
      errorCode: input.errorCode,
      requestedByUserId: input.requestedByUserId,
      occurredAt: input.now.toISOString(),
      metadata: {},
    });
  }
}
