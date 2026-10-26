import { z } from "zod";

/**
 * `SentimentRadarAnalysisResultV1` — Radar de Sentimento, Camada 2. Operação
 * `sentiment_radar_analysis`: diagnóstico de risco de UMA conversa. Validação em duas camadas,
 * mesma convenção das demais operações:
 *
 * 1. ESTRUTURAL (`validateSentimentRadarAnalysisStructure`) — Zod `strict()`: forma, tamanho, enums.
 * 2. SEMÂNTICA (`applySentimentRadarAnalysisSemanticValidation`) — rejeita campos vazios após trim.
 */

export const SENTIMENT_RADAR_ANALYSIS_RESULT_SCHEMA_VERSION = 1;

const MAIN_RISKS = ["churn", "insatisfacao", "escalamento", "financeiro", "outro"] as const;
const PRIORITIES = ["critica", "alta", "media"] as const;

const sentimentRadarAnalysisResultSchema = z
  .object({
    schemaVersion: z.literal(SENTIMENT_RADAR_ANALYSIS_RESULT_SCHEMA_VERSION),
    diagnostico: z.string().min(1).max(500),
    causaRaiz: z.string().min(1).max(400),
    riscoPrincipal: z.enum(MAIN_RISKS),
    acaoImediata: z.string().min(1).max(400),
    prioridade: z.enum(PRIORITIES),
    resumoParaGestor: z.string().min(1).max(300),
  })
  .strict();

export type SentimentRadarAnalysisResult = z.infer<typeof sentimentRadarAnalysisResultSchema>;

export type StructuredValidationResult<T> = { valid: true; data: T } | { valid: false; errors: readonly string[] };

/** JSON Schema espelhando `sentimentRadarAnalysisResultSchema` — `input_schema` da tool forçada. */
export const SENTIMENT_RADAR_ANALYSIS_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "diagnostico", "causaRaiz", "riscoPrincipal", "acaoImediata", "prioridade", "resumoParaGestor"],
  properties: {
    schemaVersion: { const: SENTIMENT_RADAR_ANALYSIS_RESULT_SCHEMA_VERSION },
    diagnostico: { type: "string", minLength: 1, maxLength: 500, description: "Diagnóstico da situação em 1-2 frases." },
    causaRaiz: { type: "string", minLength: 1, maxLength: 400, description: "Causa raiz provável, baseada só no que aparece na conversa." },
    riscoPrincipal: { type: "string", enum: [...MAIN_RISKS], description: "Principal risco desta conversa." },
    acaoImediata: { type: "string", minLength: 1, maxLength: 400, description: "Ação recomendada para o atendente agora." },
    prioridade: { type: "string", enum: [...PRIORITIES] },
    resumoParaGestor: { type: "string", minLength: 1, maxLength: 300, description: "Uma frase para o gestor entender o status." },
  },
};

export function validateSentimentRadarAnalysisStructure(raw: unknown): StructuredValidationResult<SentimentRadarAnalysisResult> {
  const result = sentimentRadarAnalysisResultSchema.safeParse(raw);
  if (!result.success) {
    return { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
  }
  return { valid: true, data: result.data };
}

export type SemanticValidationResult =
  | { valid: true; data: SentimentRadarAnalysisResult; warnings: readonly string[] }
  | { valid: false; errors: readonly string[] };

export function applySentimentRadarAnalysisSemanticValidation(params: { structural: SentimentRadarAnalysisResult }): SemanticValidationResult {
  const { structural } = params;
  const textFields = ["diagnostico", "causaRaiz", "acaoImediata", "resumoParaGestor"] as const;
  const empty = textFields.filter((field) => structural[field].trim().length === 0);
  if (empty.length > 0) return { valid: false, errors: empty.map((field) => `${field}: vazio após trim`) };
  return {
    valid: true,
    data: {
      ...structural,
      diagnostico: structural.diagnostico.trim(),
      causaRaiz: structural.causaRaiz.trim(),
      acaoImediata: structural.acaoImediata.trim(),
      resumoParaGestor: structural.resumoParaGestor.trim(),
    },
    warnings: [],
  };
}
