import type { AiGatewayPort, AiGatewayResult, AiRequest } from "../../application/ports/ai-gateway.port.js";

/**
 * Adapter usado quando `AI_GATEWAY_ENABLED=false` (padrão) — nesta configuração, o fluxo de
 * Briefing nunca deveria sequer CHAMAR `execute()` (a decisão de não chamar é tomada antes, em
 * `extraction-decision.ts`, checando a flag). Este adapter existe como rede de segurança: se algum
 * código chamar `execute()` por engano com o Gateway "desligado", o comportamento é consistente com
 * o resto do contrato (nunca lança — sempre `{ok:false, error}`, categoria `not_configured`),
 * nunca uma exceção que quebraria o turno da conversa.
 */
export class NotConfiguredAiGateway implements AiGatewayPort {
  async execute(request: AiRequest): Promise<AiGatewayResult> {
    return {
      ok: false,
      error: {
        category: "not_configured",
        message: `AI_GATEWAY_NOT_CONFIGURED: nenhum provider está configurado para a operação "${request.operation}".`,
        retryable: false,
      },
    };
  }
}

export function createNotConfiguredAiGateway(): NotConfiguredAiGateway {
  return new NotConfiguredAiGateway();
}
