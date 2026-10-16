import { z } from "zod";

/**
 * `MeetingAiAnalysisResultV1` — Vorix Meetings. Operação `meeting_ai_analysis`: análise estruturada
 * de UMA reunião a partir da transcrição. Duas camadas de validação (mesma convenção das demais):
 *
 * 1. ESTRUTURAL — Zod `strict()`.
 * 2. SEMÂNTICA (anti-alucinação) — toda decisão/tarefa/próximo passo traz `evidence`, um trecho
 *    LITERAL da transcrição, e `sourceTimestampMs` dentro da duração da reunião. Item sem
 *    evidência literal é DESCARTADO (nunca vira decisão inventada); timestamp fora da reunião é
 *    removido. Zero itens sobreviventes é um resultado válido.
 */

export const MEETING_AI_ANALYSIS_RESULT_SCHEMA_VERSION = 1;

const groundedItemSchema = z
  .object({
    description: z.string().min(1).max(500),
    evidence: z.string().min(1).max(400),
    sourceTimestampMs: z.number().int().min(0).nullable(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const taskSchema = groundedItemSchema
  .extend({
    assigneeName: z.string().min(1).max(120).nullable(),
    dueDate: z.string().min(1).max(60).nullable(),
  })
  .strict();

const meetingAiAnalysisResultSchema = z
  .object({
    schemaVersion: z.literal(MEETING_AI_ANALYSIS_RESULT_SCHEMA_VERSION),
    executiveSummary: z.string().min(1).max(3000),
    topics: z.array(z.string().min(1).max(200)).max(20),
    decisions: z.array(groundedItemSchema).max(30),
    tasks: z.array(taskSchema).max(40),
    nextSteps: z.array(groundedItemSchema).max(30),
    risks: z.array(z.string().min(1).max(400)).max(20),
    objections: z.array(z.string().min(1).max(400)).max(20),
    openQuestions: z.array(z.string().min(1).max(400)).max(20),
    templateSections: z.array(z.object({ title: z.string().min(1).max(120), content: z.string().min(1).max(2000) }).strict()).max(12).default([]),
    warnings: z.array(z.string()).max(20),
  })
  .strict();

export type MeetingAiAnalysisResult = z.infer<typeof meetingAiAnalysisResultSchema>;
export type StructuredValidationResult<T> = { valid: true; data: T } | { valid: false; errors: readonly string[] };

const groundedItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["description", "evidence", "sourceTimestampMs", "confidence"],
  properties: {
    description: { type: "string", minLength: 1, maxLength: 500 },
    evidence: { type: "string", minLength: 1, maxLength: 400, description: "Trecho LITERAL copiado da transcrição que comprova o item — nunca paráfrase." },
    sourceTimestampMs: { type: ["integer", "null"], minimum: 0, description: "Início (ms) do trecho da transcrição de onde veio o item." },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

/** JSON Schema da tool forçada (espelho manual do Zod, mesmo padrão das demais operações). */
export const MEETING_AI_ANALYSIS_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "executiveSummary", "topics", "decisions", "tasks", "nextSteps", "risks", "objections", "openQuestions", "templateSections", "warnings"],
  properties: {
    schemaVersion: { const: MEETING_AI_ANALYSIS_RESULT_SCHEMA_VERSION },
    executiveSummary: { type: "string", minLength: 1, maxLength: 3000, description: "Resumo executivo fiel ao que foi dito." },
    topics: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 200 } },
    decisions: { type: "array", maxItems: 30, items: groundedItemJsonSchema },
    tasks: {
      type: "array",
      maxItems: 40,
      items: {
        ...groundedItemJsonSchema,
        required: [...groundedItemJsonSchema.required, "assigneeName", "dueDate"],
        properties: {
          ...groundedItemJsonSchema.properties,
          assigneeName: { type: ["string", "null"], description: "Quem ficou responsável, SÓ se dito na reunião." },
          dueDate: { type: ["string", "null"], description: "Prazo, SÓ se dito na reunião (texto como foi falado)." },
        },
      },
    },
    nextSteps: { type: "array", maxItems: 30, items: groundedItemJsonSchema },
    risks: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 400 } },
    objections: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 400 } },
    openQuestions: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 400 } },
    templateSections: {
      type: "array",
      maxItems: 12,
      description: "Uma entrada por seção do modelo de resumo pedido (vazio sem modelo).",
      items: { type: "object", additionalProperties: false, required: ["title", "content"], properties: { title: { type: "string", minLength: 1, maxLength: 120 }, content: { type: "string", minLength: 1, maxLength: 2000 } } },
    },
    warnings: { type: "array", maxItems: 20, items: { type: "string" } },
  },
};

export function validateMeetingAiAnalysisStructure(raw: unknown): StructuredValidationResult<MeetingAiAnalysisResult> {
  const result = meetingAiAnalysisResultSchema.safeParse(raw);
  if (!result.success) return { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
  return { valid: true, data: result.data };
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Descarta itens sem evidência literal; zera timestamps fora da reunião. */
export function applyMeetingAiAnalysisSemanticValidation(params: { structural: MeetingAiAnalysisResult; transcriptText: string; durationMs: number }): { valid: true; data: MeetingAiAnalysisResult; warnings: readonly string[] } {
  const source = normalize(params.transcriptText);
  const warnings: string[] = [...params.structural.warnings];
  const ground = <T extends { description: string; evidence: string; sourceTimestampMs: number | null }>(items: readonly T[], kind: string): T[] =>
    items
      .filter((item) => {
        const found = source.includes(normalize(item.evidence));
        if (!found) warnings.push(`${kind}_evidence_not_grounded: "${item.description.slice(0, 80)}"`);
        return found;
      })
      .map((item) => (item.sourceTimestampMs !== null && item.sourceTimestampMs > params.durationMs ? { ...item, sourceTimestampMs: null } : item));
  return {
    valid: true,
    data: {
      ...params.structural,
      decisions: ground(params.structural.decisions, "decision"),
      tasks: ground(params.structural.tasks, "task"),
      nextSteps: ground(params.structural.nextSteps, "next_step"),
      warnings,
    },
    warnings,
  };
}
