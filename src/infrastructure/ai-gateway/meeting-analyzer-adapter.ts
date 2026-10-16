import { randomUUID } from "node:crypto";
import type { MeetingAnalyzerOutput, MeetingAnalyzerPort } from "../../application/meetings/meeting-processing.js";
import type { AiGatewayPort } from "../../application/ports/ai-gateway.port.js";
import { MEETING_AI_ANALYSIS_POLICY } from "../../application/ai-gateway/policies.js";
import type { MeetingAiAnalysisResult } from "../../application/ai-gateway/schemas/meeting-ai-analysis-result.v1.js";

/**
 * Único adapter de `MeetingAnalyzerPort`: traduz "analise esta reunião" num `AiRequest` real
 * (`operation: "meeting_ai_analysis"`) pelo gateway central — o mesmo `CreditGatedAiGateway` do
 * resto do Vorix (sem carteira paralela). A `idempotencyKey` vai no metadata: tentativas do mesmo
 * job nunca cobram duas vezes.
 */
export class AiGatewayMeetingAnalyzer implements MeetingAnalyzerPort {
  constructor(private readonly aiGateway: AiGatewayPort) {}

  async analyze(input: Parameters<MeetingAnalyzerPort["analyze"]>[0]) {
    const result = await this.aiGateway.execute({
      operation: "meeting_ai_analysis",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      correlationId: randomUUID(),
      input: {
        title: input.title,
        language: input.language,
        durationMs: input.durationMs,
        segments: input.segments.map((segment) => ({ startMs: segment.startMs, ...(segment.speaker ? { speaker: segment.speaker } : {}), text: segment.text })),
        ...(input.template ? { template: { label: input.template.label, sections: input.template.sections.map((section) => ({ title: section.title, instruction: section.instruction })) } } : {}),
      },
      outputSchema: { id: "meeting-ai-analysis-result", version: 1 },
      policy: MEETING_AI_ANALYSIS_POLICY,
      metadata: { idempotencyKey: input.idempotencyKey },
    });
    if (!result.ok) return { ok: false as const, category: result.error.category, message: result.error.message, retryable: result.error.retryable };
    const output = result.data.output as MeetingAiAnalysisResult;
    const mapped: MeetingAnalyzerOutput = {
      executiveSummary: output.executiveSummary,
      topics: output.topics,
      decisions: output.decisions.map(({ description, sourceTimestampMs, confidence }) => ({ description, sourceTimestampMs, confidence })),
      tasks: output.tasks.map(({ description, sourceTimestampMs, confidence, assigneeName, dueDate }) => ({ description, sourceTimestampMs, confidence, assigneeName, dueDate })),
      nextSteps: output.nextSteps.map(({ description, sourceTimestampMs, confidence }) => ({ description, sourceTimestampMs, confidence })),
      risks: output.risks,
      objections: output.objections,
      openQuestions: output.openQuestions,
      templateSections: output.templateSections ?? [],
    };
    return { ok: true as const, output: mapped, model: result.data.model };
  }
}
