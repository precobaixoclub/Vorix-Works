import { randomUUID } from "node:crypto";
import type { AiGatewayPort } from "../../application/ports/ai-gateway.port.js";
import type { DealInsightsGeneratorInput, DealInsightsGeneratorPort, DealInsightsGeneratorResult } from "../../application/ports/deal-insights.port.js";
import { DEAL_COMMERCIAL_INSIGHTS_POLICY } from "../../application/ai-gateway/policies.js";
import type { DealCommercialInsightsResult } from "../../application/ai-gateway/schemas/deal-commercial-insights-result.v1.js";

/** Único adapter de `DealInsightsGeneratorPort` — traduz o pedido em `AiRequest`
 * (`operation: "deal_commercial_insights"`). Falha do provider nunca lança. */
export class AiGatewayDealInsightsGenerator implements DealInsightsGeneratorPort {
  constructor(private readonly aiGateway: AiGatewayPort) {}

  async generate(input: DealInsightsGeneratorInput): Promise<DealInsightsGeneratorResult> {
    const result = await this.aiGateway.execute({
      operation: "deal_commercial_insights",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      correlationId: randomUUID(),
      input: {
        dealTitle: input.dealTitle,
        stageName: input.stageName,
        status: input.status,
        facts: input.facts,
        proposals: input.proposals,
        pendingTasks: input.pendingTasks,
        messages: input.messages,
      },
      outputSchema: { id: "deal-commercial-insights-result", version: 1 },
      policy: DEAL_COMMERCIAL_INSIGHTS_POLICY,
    });
    if (!result.ok) return { ok: false, category: result.error.category, message: result.error.message };
    const output = result.data.output as DealCommercialInsightsResult;
    return { ok: true, traceId: result.data.traceId, summary: output.summary, summaryEvidence: output.summaryEvidence, risks: output.risks, nextActions: output.nextActions };
  }
}
