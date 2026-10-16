import { getBriefingSchema } from "../../domain/briefing/schema-registry.js";
import type { BriefingType } from "../../domain/briefing/briefing.model.js";
import type { AiOperation } from "../ports/ai-gateway.port.js";
import type { PromptTemplate } from "./prompt-template.js";
import { meetingAiAnalysisPromptV1, meetingTranscriptPlainText, type MeetingAiAnalysisPromptContext } from "./prompts/meeting-ai-analysis.v1.js";
import {
  applyMeetingAiAnalysisSemanticValidation,
  validateMeetingAiAnalysisStructure,
  MEETING_AI_ANALYSIS_RESULT_SCHEMA_VERSION,
  MEETING_AI_ANALYSIS_TOOL_INPUT_SCHEMA,
  type MeetingAiAnalysisResult,
} from "./schemas/meeting-ai-analysis-result.v1.js";
import { meetingQuestionAnswerPromptV1, type MeetingQuestionAnswerPromptContext } from "./prompts/meeting-question-answer.v1.js";
import { meetingFollowUpPromptV1, type MeetingFollowUpPromptContext } from "./prompts/meeting-follow-up.v1.js";
import {
  applyMeetingQuestionAnswerSemanticValidation,
  validateMeetingQuestionAnswerStructure,
  MEETING_QUESTION_ANSWER_RESULT_SCHEMA_VERSION,
  MEETING_QUESTION_ANSWER_TOOL_INPUT_SCHEMA,
  type MeetingQuestionAnswerResult,
} from "./schemas/meeting-question-answer-result.v1.js";
import { validateMeetingFollowUpStructure, MEETING_FOLLOW_UP_RESULT_SCHEMA_VERSION, MEETING_FOLLOW_UP_TOOL_INPUT_SCHEMA } from "./schemas/meeting-follow-up-result.v1.js";
import { briefingFieldExtractionPromptV1, type BriefingFieldExtractionPromptContext } from "./prompts/briefing-field-extraction.v1.js";
import { inboxAutoReplyPromptV1, type InboxAutoReplyPromptContext, type InboxAutoReplyPromptMessage } from "./prompts/inbox-auto-reply.v1.js";
import {
  commercialCopilotSuggestionsPromptV1,
  type CommercialCopilotDealSummary,
  type CommercialCopilotPromptContext,
  type CommercialCopilotTaskSummary,
} from "./prompts/commercial-copilot-suggestions.v1.js";
import {
  applySemanticValidation,
  validateBriefingFieldExtractionStructure,
  BRIEFING_FIELD_EXTRACTION_RESULT_SCHEMA_VERSION,
  BRIEFING_FIELD_EXTRACTION_TOOL_INPUT_SCHEMA,
  type StructuredValidationResult,
} from "./schemas/briefing-field-extraction-result.v1.js";
import {
  applyInboxAutoReplySemanticValidation,
  validateInboxAutoReplyStructure,
  INBOX_AUTO_REPLY_RESULT_SCHEMA_VERSION,
  INBOX_AUTO_REPLY_TOOL_INPUT_SCHEMA,
} from "./schemas/inbox-auto-reply-result.v1.js";
import {
  applyCommercialCopilotSuggestionsSemanticValidation,
  validateCommercialCopilotSuggestionsStructure,
  COMMERCIAL_COPILOT_SUGGESTIONS_RESULT_SCHEMA_VERSION,
  COMMERCIAL_COPILOT_SUGGESTIONS_TOOL_INPUT_SCHEMA,
  type CommercialCopilotSuggestionsResult,
} from "./schemas/commercial-copilot-suggestions-result.v1.js";

/**
 * Registro operação → template + validação — Sprint 08 (Fase 9/11). Único ponto do Gateway que
 * conhece o domínio de Briefing (via `getBriefingSchema`) — o `AiGateway` em si (`ai-gateway.ts`)
 * nunca importa nada de `src/domain/briefing`, só chama estas funções genéricas. Isso é
 * intencional e diferente do isolamento Ícaro/Gateway: o Gateway PRECISA conhecer Briefing para
 * executar sua única operação real desta sprint — o que ele nunca pode conhecer é o Ícaro
 * (`src/application/ai/*`), ver `scripts/check-ai-stack-isolation.mjs`.
 *
 * Cada operação registrada tem seu próprio formato de resultado (`BriefingFieldExtractionResult`,
 * `InboxAutoReplyResult`...) — por isso `validateSemantics` devolve este tipo genérico
 * (`data: unknown`) em vez do tipo específico de uma única operação; cada `validateSemantics`
 * concreto abaixo ainda é fortemente tipado internamente, só a assinatura comum é solta.
 */
export type PromptTemplateSemanticValidationResult = { valid: true; data: unknown; warnings: readonly string[] } | { valid: false; errors: readonly string[] };

export type PromptTemplateRegistration = {
  template: PromptTemplate<unknown>;
  buildContext: (sanitizedInput: Readonly<Record<string, unknown>>) => unknown;
  toolName: string;
  toolDescription: string;
  toolInputSchema: Record<string, unknown>;
  outputSchemaRef: { id: string; version: number };
  validateStructure: (raw: unknown) => StructuredValidationResult<unknown>;
  validateSemantics: (structural: unknown, sanitizedInput: Readonly<Record<string, unknown>>) => PromptTemplateSemanticValidationResult;
};

function buildBriefingFieldExtractionContext(input: Readonly<Record<string, unknown>>): BriefingFieldExtractionPromptContext {
  const schemaType = input.schemaType as BriefingType;
  const schema = getBriefingSchema(schemaType);
  if (!schema) {
    throw new Error(`AI_GATEWAY_INTERNAL_ERROR: nenhum schema registrado para "${schemaType}" — o chamador nunca deveria acionar esta operação sem um schema ativo.`);
  }
  return {
    schema,
    message: String(input.message ?? ""),
    knownFieldKeys: Array.isArray(input.knownFieldKeys) ? (input.knownFieldKeys as string[]) : [],
  };
}

function buildInboxAutoReplyContext(input: Readonly<Record<string, unknown>>): InboxAutoReplyPromptContext {
  const rawMessages = Array.isArray(input.recentMessages) ? (input.recentMessages as unknown[]) : [];
  const recentMessages: InboxAutoReplyPromptMessage[] = rawMessages
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      direction: entry.direction === "outbound" ? "outbound" : "inbound",
      body: typeof entry.body === "string" ? entry.body : "",
      sentByAi: entry.sentByAi === true,
    }));
  return {
    contactName: typeof input.contactName === "string" ? input.contactName : undefined,
    recentMessages,
  };
}

function buildCommercialCopilotSuggestionsContext(input: Readonly<Record<string, unknown>>): CommercialCopilotPromptContext {
  return {
    contactName: String(input.contactName ?? ""),
    origin: typeof input.origin === "string" ? input.origin : undefined,
    tags: Array.isArray(input.tags) ? (input.tags as string[]) : [],
    daysSinceLastInteraction: typeof input.daysSinceLastInteraction === "number" ? input.daysSinceLastInteraction : undefined,
    deals: Array.isArray(input.deals) ? (input.deals as CommercialCopilotDealSummary[]) : [],
    pendingTasks: Array.isArray(input.pendingTasks) ? (input.pendingTasks as CommercialCopilotTaskSummary[]) : [],
  };
}

function toSegments(raw: unknown): MeetingAiAnalysisPromptContext["segments"] {
  return (Array.isArray(raw) ? (raw as unknown[]) : [])
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({ startMs: Number(entry.startMs) || 0, ...(typeof entry.speaker === "string" ? { speaker: entry.speaker } : {}), text: String(entry.text ?? "") }));
}

function buildMeetingAiAnalysisContext(input: Readonly<Record<string, unknown>>): MeetingAiAnalysisPromptContext {
  const template = typeof input.template === "object" && input.template !== null ? (input.template as Record<string, unknown>) : undefined;
  const sections = Array.isArray(template?.sections)
    ? (template!.sections as unknown[]).filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null).map((entry) => ({ title: String(entry.title ?? ""), instruction: String(entry.instruction ?? "") }))
    : [];
  return {
    title: String(input.title ?? ""),
    language: typeof input.language === "string" ? input.language : "pt",
    segments: toSegments(input.segments),
    ...(template && sections.length ? { template: { label: String(template.label ?? ""), sections } } : {}),
  };
}

function buildMeetingQuestionAnswerContext(input: Readonly<Record<string, unknown>>): MeetingQuestionAnswerPromptContext {
  const sources = (Array.isArray(input.sources) ? (input.sources as unknown[]) : [])
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({ meetingId: String(entry.meetingId ?? ""), title: String(entry.title ?? ""), ...(typeof entry.date === "string" ? { date: entry.date } : {}), segments: toSegments(entry.segments) }));
  return { question: String(input.question ?? ""), language: typeof input.language === "string" ? input.language : "pt", sources };
}

function buildMeetingFollowUpContext(input: Readonly<Record<string, unknown>>): MeetingFollowUpPromptContext {
  const strings = (raw: unknown) => (Array.isArray(raw) ? raw.map(String) : []);
  return {
    title: String(input.title ?? ""),
    language: typeof input.language === "string" ? input.language : "pt",
    ...(typeof input.recipientName === "string" ? { recipientName: input.recipientName } : {}),
    ...(typeof input.senderName === "string" ? { senderName: input.senderName } : {}),
    executiveSummary: String(input.executiveSummary ?? ""),
    decisions: strings(input.decisions),
    nextSteps: strings(input.nextSteps),
    tasks: (Array.isArray(input.tasks) ? (input.tasks as unknown[]) : [])
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => ({ description: String(entry.description ?? ""), ...(typeof entry.owner === "string" ? { owner: entry.owner } : {}), ...(typeof entry.dueDate === "string" ? { dueDate: entry.dueDate } : {}) })),
  };
}

export const PROMPT_TEMPLATE_REGISTRY: Partial<Record<AiOperation, PromptTemplateRegistration>> = {
  meeting_question_answer: {
    template: meetingQuestionAnswerPromptV1 as PromptTemplate<unknown>,
    buildContext: (input) => buildMeetingQuestionAnswerContext(input),
    toolName: "submit_meeting_answer",
    toolDescription: "Envia a resposta à pergunta sobre a(s) reunião(ões), com citações literais das transcrições.",
    toolInputSchema: MEETING_QUESTION_ANSWER_TOOL_INPUT_SCHEMA,
    outputSchemaRef: { id: "meeting-question-answer-result", version: MEETING_QUESTION_ANSWER_RESULT_SCHEMA_VERSION },
    validateStructure: (raw) => validateMeetingQuestionAnswerStructure(raw),
    validateSemantics: (structural, sanitizedInput) => {
      const context = buildMeetingQuestionAnswerContext(sanitizedInput);
      const transcriptByMeeting = new Map(context.sources.map((source) => [source.meetingId, source.segments.map((segment) => segment.text).join(" ")]));
      return applyMeetingQuestionAnswerSemanticValidation({ structural: structural as MeetingQuestionAnswerResult, transcriptByMeeting });
    },
  },
  meeting_follow_up: {
    template: meetingFollowUpPromptV1 as PromptTemplate<unknown>,
    buildContext: (input) => buildMeetingFollowUpContext(input),
    toolName: "submit_meeting_follow_up",
    toolDescription: "Envia os rascunhos de follow-up da reunião: assunto e corpo do e-mail e a mensagem de WhatsApp.",
    toolInputSchema: MEETING_FOLLOW_UP_TOOL_INPUT_SCHEMA,
    outputSchemaRef: { id: "meeting-follow-up-result", version: MEETING_FOLLOW_UP_RESULT_SCHEMA_VERSION },
    validateStructure: (raw) => validateMeetingFollowUpStructure(raw),
    validateSemantics: (structural) => ({ valid: true, data: structural, warnings: [] }),
  },
  meeting_ai_analysis: {
    template: meetingAiAnalysisPromptV1 as PromptTemplate<unknown>,
    buildContext: (input) => buildMeetingAiAnalysisContext(input),
    toolName: "submit_meeting_analysis",
    toolDescription: "Envia o registro estruturado da reunião: resumo, tópicos, decisões, tarefas, próximos passos, riscos, objeções e perguntas em aberto — tudo com evidência literal da transcrição.",
    toolInputSchema: MEETING_AI_ANALYSIS_TOOL_INPUT_SCHEMA,
    outputSchemaRef: { id: "meeting-ai-analysis-result", version: MEETING_AI_ANALYSIS_RESULT_SCHEMA_VERSION },
    validateStructure: (raw) => validateMeetingAiAnalysisStructure(raw),
    validateSemantics: (structural, sanitizedInput) => {
      const context = buildMeetingAiAnalysisContext(sanitizedInput);
      const durationMs = typeof sanitizedInput.durationMs === "number" ? sanitizedInput.durationMs : Number.MAX_SAFE_INTEGER;
      return applyMeetingAiAnalysisSemanticValidation({ structural: structural as MeetingAiAnalysisResult, transcriptText: meetingTranscriptPlainText(context.segments), durationMs });
    },
  },
  commercial_copilot_suggestions: {
    template: commercialCopilotSuggestionsPromptV1 as PromptTemplate<unknown>,
    buildContext: (input) => buildCommercialCopilotSuggestionsContext(input),
    toolName: "submit_commercial_copilot_suggestions",
    toolDescription: "Envia as sugestões de próxima ação comercial para este contato, cada uma com evidência literal e confiança.",
    toolInputSchema: COMMERCIAL_COPILOT_SUGGESTIONS_TOOL_INPUT_SCHEMA,
    outputSchemaRef: { id: "commercial-copilot-suggestions-result", version: COMMERCIAL_COPILOT_SUGGESTIONS_RESULT_SCHEMA_VERSION },
    validateStructure: (raw) => validateCommercialCopilotSuggestionsStructure(raw),
    validateSemantics: (structural, sanitizedInput) => {
      const context = buildCommercialCopilotSuggestionsContext(sanitizedInput);
      const sourceText = commercialCopilotSuggestionsPromptV1.buildUserInput(context);
      return applyCommercialCopilotSuggestionsSemanticValidation({ structural: structural as CommercialCopilotSuggestionsResult, sourceText });
    },
  },
  inbox_auto_reply: {
    template: inboxAutoReplyPromptV1 as PromptTemplate<unknown>,
    buildContext: (input) => buildInboxAutoReplyContext(input),
    toolName: "submit_inbox_auto_reply",
    toolDescription: "Envia o texto da resposta a ser enviada ao cliente pelo WhatsApp.",
    toolInputSchema: INBOX_AUTO_REPLY_TOOL_INPUT_SCHEMA,
    outputSchemaRef: { id: "inbox-auto-reply-result", version: INBOX_AUTO_REPLY_RESULT_SCHEMA_VERSION },
    validateStructure: (raw) => validateInboxAutoReplyStructure(raw),
    validateSemantics: (structural, _sanitizedInput) => applyInboxAutoReplySemanticValidation({ structural: structural as Parameters<typeof applyInboxAutoReplySemanticValidation>[0]["structural"] }),
  },
  briefing_field_extraction: {
    template: briefingFieldExtractionPromptV1 as PromptTemplate<unknown>,
    buildContext: (input) => buildBriefingFieldExtractionContext(input),
    toolName: "submit_briefing_field_extraction",
    toolDescription: "Envia os candidatos de campo extraídos da mensagem do usuário, de acordo com o schema informado.",
    toolInputSchema: BRIEFING_FIELD_EXTRACTION_TOOL_INPUT_SCHEMA,
    outputSchemaRef: { id: "briefing-field-extraction-result", version: BRIEFING_FIELD_EXTRACTION_RESULT_SCHEMA_VERSION },
    validateStructure: (raw) => validateBriefingFieldExtractionStructure(raw),
    validateSemantics: (structural, sanitizedInput) =>
      applySemanticValidation({
        structural: structural as Parameters<typeof applySemanticValidation>[0]["structural"],
        schema: getBriefingSchema(sanitizedInput.schemaType as BriefingType)!,
        sourceText: String(sanitizedInput.message ?? ""),
      }),
  },
};

export function getPromptTemplateRegistration(operation: AiOperation): PromptTemplateRegistration | undefined {
  return PROMPT_TEMPLATE_REGISTRY[operation];
}
