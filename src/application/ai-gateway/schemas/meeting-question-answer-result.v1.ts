import { z } from "zod";

/**
 * `MeetingQuestionAnswerResultV1` — "Pergunte à reunião". Estrutural (Zod strict) + semântica:
 * citação sem trecho literal da reunião citada é descartada (nunca vira "fonte" inventada).
 */

export const MEETING_QUESTION_ANSWER_RESULT_SCHEMA_VERSION = 1;

const citationSchema = z
  .object({
    meetingId: z.string().min(1).max(120),
    sourceTimestampMs: z.number().int().min(0),
    evidence: z.string().min(1).max(400),
  })
  .strict();

const meetingQuestionAnswerResultSchema = z
  .object({
    schemaVersion: z.literal(MEETING_QUESTION_ANSWER_RESULT_SCHEMA_VERSION),
    answer: z.string().min(1).max(3000),
    found: z.boolean(),
    citations: z.array(citationSchema).max(10),
    warnings: z.array(z.string()).max(20),
  })
  .strict();

export type MeetingQuestionAnswerResult = z.infer<typeof meetingQuestionAnswerResultSchema>;

export const MEETING_QUESTION_ANSWER_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "answer", "found", "citations", "warnings"],
  properties: {
    schemaVersion: { const: MEETING_QUESTION_ANSWER_RESULT_SCHEMA_VERSION },
    answer: { type: "string", minLength: 1, maxLength: 3000, description: "Resposta direta, fiel às transcrições." },
    found: { type: "boolean", description: "false quando a resposta não está nas transcrições." },
    citations: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["meetingId", "sourceTimestampMs", "evidence"],
        properties: {
          meetingId: { type: "string", minLength: 1, maxLength: 120 },
          sourceTimestampMs: { type: "integer", minimum: 0 },
          evidence: { type: "string", minLength: 1, maxLength: 400, description: "Trecho LITERAL da transcrição." },
        },
      },
    },
    warnings: { type: "array", maxItems: 20, items: { type: "string" } },
  },
};

export function validateMeetingQuestionAnswerStructure(raw: unknown): { valid: true; data: MeetingQuestionAnswerResult } | { valid: false; errors: readonly string[] } {
  const result = meetingQuestionAnswerResultSchema.safeParse(raw);
  if (!result.success) return { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
  return { valid: true, data: result.data };
}

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** Mantém só citações cujo trecho existe literalmente na reunião citada. */
export function applyMeetingQuestionAnswerSemanticValidation(params: { structural: MeetingQuestionAnswerResult; transcriptByMeeting: ReadonlyMap<string, string> }): { valid: true; data: MeetingQuestionAnswerResult; warnings: readonly string[] } {
  const warnings = [...params.structural.warnings];
  const citations = params.structural.citations.filter((citation) => {
    const source = params.transcriptByMeeting.get(citation.meetingId);
    const grounded = !!source && normalize(source).includes(normalize(citation.evidence));
    if (!grounded) warnings.push(`citation_not_grounded: "${citation.evidence.slice(0, 80)}"`);
    return grounded;
  });
  return { valid: true, data: { ...params.structural, citations, warnings }, warnings };
}
