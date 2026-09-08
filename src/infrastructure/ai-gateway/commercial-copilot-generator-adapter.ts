import { randomUUID } from "node:crypto";
import type {
  CommercialCopilotGeneratorInput,
  CommercialCopilotGeneratorPort,
  CommercialCopilotGeneratorResult,
} from "../../application/ports/commercial-copilot-generator.port.js";
import type { AiGatewayPort } from "../../application/ports/ai-gateway.port.js";
import { COMMERCIAL_COPILOT_SUGGESTIONS_POLICY } from "../../application/ai-gateway/policies.js";
import type { CommercialCopilotSuggestionsResult } from "../../application/ai-gateway/schemas/commercial-copilot-suggestions-result.v1.js";

/**
 * Único adapter concreto de `CommercialCopilotGeneratorPort` (CRM/Comercial, Fase 5) — traduz o
 * pedido de "sugira próximas ações para este contato" num `AiRequest` real
 * (`operation: "commercial_copilot_suggestions"`). `application/crm/*` nunca vê `AiGatewayPort`
 * diretamente — só este adapter, injetado via `CommercialCopilotUseCaseDeps.generator` na
 * composição raiz da API.
 */
export class AiGatewayCommercialCopilotGenerator implements CommercialCopilotGeneratorPort {
  constructor(private readonly aiGateway: AiGatewayPort) {}

  async generateSuggestions(input: CommercialCopilotGeneratorInput): Promise<CommercialCopilotGeneratorResult> {
    const result = await this.aiGateway.execute({
      operation: "commercial_copilot_suggestions",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      correlationId: randomUUID(),
      // Nunca `conversationId`/`briefingId` aqui de propósito — essas colunas de `ai_executions`
      // têm FK para tabelas de outros domínios (mesmo racional de `inbox-ai-responder-adapter.ts`).
      input: {
        contactName: input.contactName,
        origin: input.origin,
        tags: input.tags,
        daysSinceLastInteraction: input.daysSinceLastInteraction,
        deals: input.deals,
        pendingTasks: input.pendingTasks,
      },
      outputSchema: { id: "commercial-copilot-suggestions-result", version: 1 },
      policy: COMMERCIAL_COPILOT_SUGGESTIONS_POLICY,
    });

    if (!result.ok) {
      return { ok: false, category: result.error.category, message: result.error.message };
    }

    const output = result.data.output as CommercialCopilotSuggestionsResult;
    return {
      ok: true,
      suggestions: output.suggestions,
      traceId: result.data.traceId,
    };
  }
}
