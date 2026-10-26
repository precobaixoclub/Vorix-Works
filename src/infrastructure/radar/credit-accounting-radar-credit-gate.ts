import type { CreditAccountingService } from "../../application/ai-providers/credit-accounting.service.js";
import type { RadarCreditGatePort, RadarCreditStatus } from "../../application/ports/radar-ai.port.js";

/** Operação do Radar no catálogo central de créditos (`ai_operation_types`, migration 0143). O
 * custo em crédito vem de lá — editável no painel admin, nunca hardcoded no Radar. */
export const SENTIMENT_RADAR_OPERATION_CODE = "sentiment_radar_analysis";

/**
 * `RadarCreditGatePort` sobre o serviço CENTRAL de créditos (`CreditAccountingService`, o mesmo
 * das demais funcionalidades de IA). Só consulta — nunca debita; o débito acontece no
 * `CreditGatedAiGateway`, depois de uma análise bem-sucedida.
 */
export class CreditAccountingRadarCreditGate implements RadarCreditGatePort {
  constructor(private readonly deps: { creditAccounting: CreditAccountingService; now?: () => Date }) {}

  async check(tenantId: string): Promise<RadarCreditStatus> {
    const availability = await this.deps.creditAccounting.checkAvailability(tenantId, SENTIMENT_RADAR_OPERATION_CODE, this.deps.now ? this.deps.now() : new Date());
    if (availability.ok) {
      return {
        available: true,
        creditsCost: availability.operationType.creditsCost,
        remainingCredits: availability.monthlyRemainingBefore + availability.creditsExtraBefore,
      };
    }
    switch (availability.reason) {
      case "quota_exceeded":
        return { available: false, reason: "no_credits", creditsCost: 0, remainingCredits: 0 };
      case "account_blocked":
        return { available: false, reason: "account_blocked", creditsCost: 0, remainingCredits: 0 };
      default:
        // Operação não cadastrada/desativada ou tenant sem billing — a análise não pode ser cobrada,
        // então não roda.
        return { available: false, reason: "billing_not_configured", creditsCost: 0, remainingCredits: 0 };
    }
  }
}
