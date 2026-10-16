import { randomUUID } from "node:crypto";
import type { MeetingAiPort } from "../../application/meetings/meeting-intelligence.js";
import type { AiGatewayPort } from "../../application/ports/ai-gateway.port.js";
import { MEETING_FOLLOW_UP_POLICY, MEETING_QUESTION_ANSWER_POLICY } from "../../application/ai-gateway/policies.js";
import type { MeetingQuestionAnswerResult } from "../../application/ai-gateway/schemas/meeting-question-answer-result.v1.js";
import type { MeetingFollowUpResult } from "../../application/ai-gateway/schemas/meeting-follow-up-result.v1.js";

/**
 * "Pergunte à reunião" e follow-up pelo gateway central de IA (o MESMO `CreditGatedAiGateway`:
 * crédito debitado só em sucesso, sem carteira paralela). `idempotencyKey` no metadata.
 */
export class AiGatewayMeetingIntelligence implements MeetingAiPort {
  constructor(private readonly aiGateway: AiGatewayPort) {}

  async answerQuestion(input: Parameters<MeetingAiPort["answerQuestion"]>[0]) {
    const result = await this.aiGateway.execute({
      operation: "meeting_question_answer",
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      correlationId: randomUUID(),
      input: { question: input.question, language: input.language, sources: input.sources },
      outputSchema: { id: "meeting-question-answer-result", version: 1 },
      policy: MEETING_QUESTION_ANSWER_POLICY,
      metadata: { idempotencyKey: input.idempotencyKey },
    });
    if (!result.ok) return { ok: false as const, category: result.error.category, message: result.error.message };
    const output = result.data.output as MeetingQuestionAnswerResult;
    return { ok: true as const, answer: { answer: output.answer, found: output.found, citations: output.citations } };
  }

  async generateFollowUp(input: Parameters<MeetingAiPort["generateFollowUp"]>[0]) {
    const { tenantId, workspaceId, idempotencyKey, ...context } = input;
    const result = await this.aiGateway.execute({
      operation: "meeting_follow_up",
      tenantId,
      workspaceId,
      correlationId: randomUUID(),
      input: context,
      outputSchema: { id: "meeting-follow-up-result", version: 1 },
      policy: MEETING_FOLLOW_UP_POLICY,
      metadata: { idempotencyKey },
    });
    if (!result.ok) return { ok: false as const, category: result.error.category, message: result.error.message };
    const output = result.data.output as MeetingFollowUpResult;
    return { ok: true as const, draft: { emailSubject: output.emailSubject, emailBody: output.emailBody, whatsappMessage: output.whatsappMessage } };
  }
}
