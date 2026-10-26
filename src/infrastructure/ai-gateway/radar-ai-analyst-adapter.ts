import { randomUUID } from "node:crypto";
import type { AiGatewayPort } from "../../application/ports/ai-gateway.port.js";
import type { RadarAiAnalystInput, RadarAiAnalystPort, RadarAiAnalystResult } from "../../application/ports/radar-ai.port.js";
import { SENTIMENT_RADAR_ANALYSIS_POLICY } from "../../application/ai-gateway/policies.js";
import type { SentimentRadarAnalysisResult } from "../../application/ai-gateway/schemas/sentiment-radar-analysis-result.v1.js";

/**
 * Único adapter concreto de `RadarAiAnalystPort` (Radar de Sentimento, Camada 2) — traduz "faça o
 * diagnóstico desta conversa" num `AiRequest` real (`operation: "sentiment_radar_analysis"`).
 * `application/radar/*` nunca vê `AiGatewayPort` diretamente.
 *
 * O gateway recebido aqui DEVE ser o `CreditGatedAiGateway`: é ele que confere o saldo de novo
 * imediatamente antes do provider e que registra o consumo no ledger central depois do sucesso,
 * de forma idempotente pela chave em `metadata.idempotencyKey`.
 */
export class AiGatewayRadarAnalyst implements RadarAiAnalystPort {
  constructor(private readonly aiGateway: AiGatewayPort) {}

  async analyze(input: RadarAiAnalystInput): Promise<RadarAiAnalystResult> {
    const result = await this.aiGateway.execute({
      operation: "sentiment_radar_analysis",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      userId: input.requestedByUserId,
      correlationId: randomUUID(),
      // Nunca `conversationId` aqui de propósito — essa coluna de `ai_executions` tem FK para o
      // domínio `conversation` (Arthur), não para `inbox_conversations` (mesmo racional de
      // `inbox-ai-responder-adapter.ts`). A auditoria do Radar vive em `radar_ai_analysis_logs`.
      input: {
        score: input.score,
        level: input.level,
        reasons: [...input.reasons],
        waitingMinutes: input.waitingMinutes,
        transferCount: input.transferCount,
        reopenCount: input.reopenCount,
        recentMessages: input.recentMessages.map((message) => ({ direction: message.direction, body: message.body })),
      },
      outputSchema: { id: "sentiment-radar-analysis-result", version: 1 },
      policy: SENTIMENT_RADAR_ANALYSIS_POLICY,
      metadata: { idempotencyKey: input.idempotencyKey, feature: "sentiment_radar" },
    });

    if (!result.ok) {
      return { ok: false, category: result.error.category, message: result.error.message };
    }

    const output = result.data.output as SentimentRadarAnalysisResult;
    return {
      ok: true,
      analysis: {
        diagnostico: output.diagnostico,
        causaRaiz: output.causaRaiz,
        riscoPrincipal: output.riscoPrincipal,
        acaoImediata: output.acaoImediata,
        prioridade: output.prioridade,
        resumoParaGestor: output.resumoParaGestor,
      },
      provider: result.data.provider,
      model: result.data.model,
      usage: {
        inputTokens: result.data.usage.inputTokens,
        outputTokens: result.data.usage.outputTokens,
        estimatedCost: result.data.usage.estimatedCost,
      },
      traceId: result.data.traceId,
    };
  }
}
